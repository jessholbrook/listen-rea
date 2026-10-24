import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { client } from "./image-review-fixture";
import { toneWav } from "./reporting-fixture";
import {
  recordingSetup,
  recordingRoot as root,
} from "./library-recordings-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3359 : 3358 }),
  { timeout: 90000 },
);
after(stop);
test(
  "private recording drafts remain out of research until saved review and explicit import; exact upload/approval retries preserve private media and provenance",
  { timeout: 120000 },
  async () => {
    const c = await recordingSetup(),
      created = await c.create();
    let r = created.recording;
    const path = root + "/" + r.id;
    assert.equal(
      (await c.owner(root, "POST", created.input)).recording.id,
      r.id,
    );
    assert.equal(
      (await c.owner(root, "POST", { ...created.input, title: "Different" }))
        .status,
      409,
    );
    r = await c.upload(r);
    assert.equal((await c.owner("library")).sources.length, 0);
    assert.equal(
      (await c.owner("library/search", "POST", { query: "draft" })).total,
      0,
    );
    assert.equal(
      (
        await c.owner(path + "/file", "PUT", toneWav(1200), {
          "content-type": "audio/wav",
          "x-recording-version": "1",
        })
      ).recording.version,
      r.version,
    );
    assert.equal(
      (
        await c.owner(path + "/file", "PUT", toneWav(1400), {
          "content-type": "audio/wav",
          "x-recording-version": String(r.version),
        })
      ).status,
      409,
    );
    const play = await c.owner(path + "/file", "GET", undefined, {
      range: "bytes=0-43",
    });
    assert.equal(play.status, 206);
    assert.equal(play.bytes.length, 44);
    r = await c.transcribe(r);
    assert.equal(r.status, "draft");
    assert.equal((await c.owner("library")).sources.length, 0);
    assert.equal(
      (
        await c.owner(path + "/approve", "POST", {
          version: r.version,
          reviewed: true,
        })
      ).status,
      409,
    );
    const original = structuredClone(r.original);
    r = (
      await c.owner(path, "PUT", {
        version: r.version,
        text: "Researcher corrected transcript: save the draft before reviewing it.",
        reviewed: true,
      })
    ).recording;
    assert.deepEqual(r.original, original);
    assert.equal(r.history.length, 2);
    assert.equal(r.history.at(-1).editor.id, c.actor.id);
    assert.equal(
      (
        await c.owner(path, "PUT", {
          version: r.version,
          text: r.history.at(-1).text,
          reviewed: true,
          original: { text: "forged" },
        })
      ).status,
      400,
    );
    const approved = await c.owner(path + "/approve", "POST", {
      version: r.version,
      reviewed: true,
    });
    assert.equal(approved.status, 200, JSON.stringify(approved));
    const id = approved.interviewId;
    assert.equal(
      (
        await c.owner(path + "/approve", "POST", {
          version: r.version,
          reviewed: true,
        })
      ).interviewId,
      id,
    );
    assert.equal(approved.recording.original, undefined);
    assert.equal(approved.recording.history, undefined);
    assert.equal(approved.recording.file, undefined);
    const source = (await c.owner("library/sources/" + id)).source;
    assert.equal(source.turns[0].answer, r.history.at(-1).text);
    assert.equal(source.origin.transcription.model, "marked-provider-fixture");
    assert.equal(source.origin.transcription.edited, true);
    assert.equal(source.origin.transcription.reviewedBy.id, c.actor.id);
    assert.equal(source.media.length, 1);
    const bytes = await c.owner("recordings/" + source.media[0].id);
    assert.equal(bytes.status, 200);
    assert.ok(bytes.bytes.equals(toneWav(1200)));
    assert.equal(
      (await c.owner(path, "DELETE", { version: approved.recording.version }))
        .status,
      409,
    );
    await c.owner("studies/" + c.s.id + "/responses/" + id, "DELETE");
    assert.equal(
      await c.local.get("libraryRecording", r.id, c.actor.workspaceId),
      undefined,
    );
    assert.equal(
      (await c.owner("recordings/" + source.media[0].id)).status,
      404,
    );
    assert.equal((await c.owner(root, "POST", created.input)).status, 409);
  },
);
test(
  "provider failures preserve uploaded bytes, claims prevent duplicate generation, and deletion/expiry prevent late transcripts from restoring erased data",
  { timeout: 120000 },
  async () => {
    const c = await recordingSetup(),
      created = await c.create();
    let r = await c.upload(created.recording);
    await assert.rejects(
      () =>
        c.transcribe(r, async () => {
          throw Error("PROVIDER_UNAVAILABLE");
        }),
      /PROVIDER_UNAVAILABLE/,
    );
    r = (await c.owner(root + "/" + r.id)).recording;
    assert.equal(r.status, "uploaded");
    assert.equal(r.lastError, "provider_or_processing");
    assert.equal(r.original, undefined);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve)),
      gate = new Promise<void>((resolve) => (release = resolve));
    const pending = c.transcribe(r, async () => {
      entered();
      await gate;
      return {
        text: "A late private transcript must never be restored.",
        model: "marked",
        generatedAt: new Date().toISOString(),
      };
    });
    await started;
    const running = (await c.owner(root + "/" + r.id)).recording;
    assert.equal(running.status, "transcribing");
    await assert.rejects(
      () => c.transcribe(running),
      (e: any) => e.status === 409,
    );
    assert.equal(
      (await c.owner(root + "/" + r.id, "DELETE", { version: running.version }))
        .status,
      200,
    );
    release();
    await assert.rejects(
      () => pending,
      (e: any) => e.status === 404 || e.status === 409,
    );
    assert.equal(
      await c.local.get("libraryRecording", r.id, c.actor.workspaceId),
      undefined,
    );
    assert.equal((await c.owner(root, "POST", created.input)).status, 409);
    const storage = await import("../src/lib/storage");
    await assert.rejects(() => storage.readRecording(r.file.id));
    const second = await c.create();
    r = await c.upload(second.recording);
    r = await c.transcribe(r);
    await c.local.put("libraryRecording", {
      ...(await c.local.get<any>(
        "libraryRecording",
        r.id,
        c.actor.workspaceId,
      )),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await (
      await import("../src/lib/library-recording-lifecycle")
    ).recordingDraftRetention();
    await (await import("../src/lib/features")).cleanDeletions();
    assert.equal((await c.owner(root + "/" + r.id)).status, 404);
  },
);
test(
  "workspace/role/consent/version and actual container validation reject forged, empty, unsupported or stale files without searchable responses",
  { timeout: 120000 },
  async () => {
    const c = await recordingSetup(),
      created = await c.create(),
      r = created.recording,
      path = root + "/" + r.id;
    const anon = await client(),
      other = await client();
    assert.equal((await anon(root)).status, 401);
    await other("auth/signup", "POST", {
      name: "Other recorder",
      email: randomUUID() + "@example.test",
      password: "other-recorder-password",
    });
    assert.equal((await other(path)).status, 404);
    assert.equal((await other(root, "POST", created.input)).status, 404);
    for (const extra of [
      { permissionConfirmed: false },
      { transcriptionPermission: false },
      { original: { text: "forged" } },
      { language: "xx" },
    ])
      assert.equal(
        (
          await c.owner(root, "POST", {
            ...created.input,
            requestId: randomUUID(),
            ...extra,
          })
        ).status,
        400,
      );
    for (const [bytes, mime, status] of [
      [Buffer.from("not audio"), "audio/wav", 400],
      [Buffer.from("RIFF0000WAVEgarbage"), "audio/wav", 400],
      [Buffer.alloc(0), "audio/wav", 400],
      [Buffer.alloc(3 * 1024 * 1024 + 1), "audio/wav", 413],
      [toneWav(1200), "text/html", 400],
    ] as const)
      assert.equal(
        (
          await c.owner(path + "/file", "PUT", bytes, {
            "content-type": mime,
            "x-recording-version": "1",
          })
        ).status,
        status,
      );
    const email = randomUUID() + "@example.test",
      viewer = await client();
    await viewer("auth/signup", "POST", {
      name: "Viewer",
      email,
      password: "viewer-recording-password",
    });
    await c.local.db
      .prepare("UPDATE users SET workspace_id=?,role='viewer' WHERE email=?")
      .run(c.actor.workspaceId, email);
    assert.equal((await viewer(path)).status, 200);
    assert.equal(
      (
        await viewer(path + "/transcribe", "POST", {
          version: 1,
          permissionConfirmed: true,
        })
      ).status,
      403,
    );
    assert.equal((await viewer(path, "DELETE", { version: 1 })).status, 403);
    assert.equal(
      (
        await c.owner(path + "/file", "PUT", toneWav(1200), {
          "content-type": "audio/wav",
          "x-recording-version": "9",
        })
      ).status,
      409,
    );
    const otherStudy = (
      await other("studies", "POST", { title: "Other recording workspace" })
    ).study;
    const otherInput = { ...created.input, studyId: otherStudy.id };
    const otherDraft = (await other(root, "POST", otherInput)).recording;
    assert.ok(otherDraft);
    await c.owner(path, "DELETE", { version: r.version });
    await other(root + "/" + otherDraft.id, "DELETE", {
      version: otherDraft.version,
    });
    assert.equal((await c.owner(root, "POST", created.input)).status, 409);
    assert.equal((await other(root, "POST", otherInput)).status, 409);
    assert.equal((await c.owner("library")).sources.length, 0);
    assert.equal(
      (
        await c.local.db
          .prepare("SELECT id FROM media WHERE workspace_id=?")
          .all(c.actor.workspaceId)
      ).length,
      0,
    );
  },
);
test(
  "erasing an approved recording removes its imported transcript, saved answers and dependent briefs together",
  { timeout: 120000 },
  async () => {
    const c = await recordingSetup(),
      made = await c.create();
    let r = await c.transcribe(await c.upload(made.recording));
    r = (
      await c.owner(root + "/" + r.id, "PUT", {
        version: r.version,
        text: "Participant: We save the draft before review.",
        reviewed: true,
      })
    ).recording;
    const imported = await c.owner(root + "/" + r.id + "/approve", "POST", {
        version: r.version,
        reviewed: true,
      }),
      id = imported.interviewId;
    const { answerTranscriptQuestion } =
      await import("../src/lib/library-transcript-qa-server");
    const generated = await answerTranscriptQuestion(
      new Request("http://localhost/api/library/qa", {
        method: "POST",
        body: JSON.stringify({
          studyIds: [c.s.id],
          question: "What does the draft review describe?",
          saveDraft: true,
          requestId: randomUUID(),
        }),
      }),
      c.actor,
      async (_s: any, p: any) => {
        const h = p.evidence[0];
        return {
          answer: "MARKED_INTERPRETATION",
          citations: [
            {
              studyId: h.studyId,
              interviewId: h.interviewId,
              turnId: h.turnId,
              quote: h.quote,
            },
          ],
        };
      },
    );
    const qa = await generated.json();
    let a = (await c.owner("library/answers/" + qa.savedAnswerId)).answer;
    const { answerEdit, briefInput } = await import("./library-briefs-fixture");
    a = (await c.owner("library/answers/" + a.id, "PUT", answerEdit(a))).answer;
    const b = (
      await c.owner("library/briefs", "POST", {
        ...briefInput([a]),
        requestId: randomUUID(),
      })
    ).brief;
    await c.owner("studies/" + c.s.id + "/responses/" + id, "DELETE");
    for (const [kind, key] of [
      ["libraryRecording", r.id],
      ["libraryAnswer", a.id],
      ["libraryBrief", b.id],
    ])
      assert.equal(
        await c.local.get(kind, key, c.actor.workspaceId),
        undefined,
      );
    assert.equal((await c.owner("library")).sources.length, 0);
    assert.equal((await c.owner("recordings/" + r.file.id)).status, 404);
  },
);

test(
  "resumable private parts verify exact files and recover an eleven-minute recording across durable transcription checkpoints, review, import and erasure",
  { timeout: 180000 },
  async () => {
    const { createHash } = await import("node:crypto"),
      { importPartBytes } = await import("../src/lib/library-recordings"),
      c = await recordingSetup(),
      made = await c.create(),
      bytes = toneWav(660000),
      sum = (b: Buffer) => createHash("sha256").update(b).digest("hex"),
      path = root + "/" + made.recording.id;
    let r = made.recording;
    const input = {
      version: r.version,
      bytes: bytes.length,
      digest: sum(bytes),
      mime: "audio/wav",
    };
    r = (await c.owner(path + "/upload", "POST", input)).recording;
    assert.equal(
      r.upload.parts.length,
      Math.ceil(bytes.length / importPartBytes),
    );
    assert.equal(r.upload.fileId, undefined);
    assert.equal(r.upload.parts[0].id, undefined);
    assert.equal(
      (
        await c.owner(path + "/complete", "POST", undefined, {
          "x-recording-version": String(r.version),
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await c.owner(path + "/upload", "POST", {
          ...input,
          digest: "0".repeat(64),
        })
      ).status,
      409,
    );
    for (let n = 0; n < r.upload.parts.length; n++) {
      const part = bytes.subarray(
          n * importPartBytes,
          (n + 1) * importPartBytes,
        ),
        version = r.version;
      const headers = {
        "content-type": "application/octet-stream",
        "x-recording-version": String(version),
        "x-recording-part": String(n),
      };
      if (n === 0) {
        assert.equal(
          (await c.owner(path + "/part", "PUT", part.subarray(1), headers))
            .status,
          400,
        );
        assert.equal(
          (
            await c.owner(
              path + "/part",
              "PUT",
              Buffer.alloc(importPartBytes + 1),
              headers,
            )
          ).status,
          413,
        );
      }
      const uploaded = await c.owner(path + "/part", "PUT", part, headers);
      assert.equal(uploaded.status, 200, JSON.stringify(uploaded));
      r = uploaded.recording;
      // Simulate a new client after an acknowledgement was lost. Exact retries skip paid work and existing bytes.
      assert.equal(
        (await c.owner(path + "/part", "PUT", part, headers)).recording.version,
        r.version,
      );
      if (n === 0) {
        const changed = Buffer.from(part);
        changed[99] ^= 1;
        assert.equal(
          (await c.owner(path + "/part", "PUT", changed, headers)).status,
          409,
        );
        r = (await c.owner(path)).recording;
        assert.ok(r.upload.parts[0].digest);
        assert.equal(
          (await c.owner(path + "/upload", "POST", input)).recording.id,
          r.id,
        );
      }
    }
    const parts = (
      await c.local.get<any>("libraryRecording", r.id, c.actor.workspaceId)
    ).upload.parts;
    r = (
      await c.owner(path + "/complete", "POST", undefined, {
        "x-recording-version": String(r.version),
      })
    ).recording;
    assert.equal(r.status, "uploaded");
    assert.ok(r.file.durationMs >= 659000);
    assert.equal(
      (
        await c.owner(path + "/complete", "POST", undefined, {
          "x-recording-version": "1",
        })
      ).recording.id,
      r.id,
    );
    const storage = await import("../src/lib/storage");
    for (const p of parts)
      await assert.rejects(() => storage.readRecording(p.id));
    assert.ok((await storage.readRecording(r.file.id)).equals(bytes));
    assert.equal((await c.owner("library")).sources.length, 0);
    let providerCalls = 0;
    const transcript = (n: number) =>
      (
        `MARKED_STEP_${n}: ` +
        "Save the draft before reviewing the source. ".repeat(250)
      ).trim();
    const generate = async (_bytes: any, stage: any) => {
      providerCalls++;
      assert.equal(
        stage.job.completed.length,
        providerCalls === 1 ? 0 : providerCalls === 2 ? 1 : 2,
      );
      return {
        text: transcript(stage.job.completed.length),
        model: "marked-checkpoint-provider",
        generatedAt: new Date().toISOString(),
      };
    };
    r = await c.transcribe(r, generate);
    assert.deepEqual(r.job, { total: 3, completed: 1 });
    assert.equal(r.original, undefined);
    assert.equal(JSON.stringify(r).includes("MARKED_STEP"), false);
    await assert.rejects(
      () =>
        c.transcribe(r, async () => {
          throw Error("CHECKPOINT_PROVIDER_FAILURE");
        }),
      /CHECKPOINT_PROVIDER_FAILURE/,
    );
    r = (await c.owner(path)).recording;
    assert.equal(r.job.completed, 1);
    assert.equal(r.status, "uploaded");
    r = await c.transcribe(r, generate);
    assert.equal(r.job.completed, 2);
    // Recover a function termination from the durable lease without repeating the previous steps.
    const staged = await c.local.get<any>(
      "libraryRecording",
      r.id,
      c.actor.workspaceId,
    );
    await c.local.put("libraryRecording", {
      ...staged,
      status: "transcribing",
      attempt: { id: randomUUID(), at: Date.now() - 121000 },
    });
    r = (await c.owner(path)).recording;
    r = await c.transcribe(r, generate);
    const full = [0, 1, 2].map(transcript).join("\n\n");
    assert.equal(r.original.text, full);
    assert.equal(r.job, undefined);
    assert.equal(providerCalls, 3);
    r = (
      await c.owner(path, "PUT", {
        version: r.version,
        text: full,
        reviewed: true,
      })
    ).recording;
    const imported = await c.owner(path + "/approve", "POST", {
      version: r.version,
      reviewed: true,
    });
    assert.equal(imported.status, 200, JSON.stringify(imported));
    const source = (await c.owner("library/sources/" + imported.interviewId))
      .source;
    assert.ok(source.turns.length > 1);
    assert.equal(source.turns.map((t: any) => t.answer).join(""), full);
    assert.ok(source.turns.every((t: any) => t.answer.length <= 10000));
    assert.equal(
      (await c.owner("library/search", "POST", { query: "MARKED_STEP_2" }))
        .total > 0,
      true,
    );
    assert.equal(imported.recording.upload, undefined);
    assert.equal(imported.recording.job, undefined);
    await c.owner(
      "studies/" + c.s.id + "/responses/" + imported.interviewId,
      "DELETE",
    );
    await assert.rejects(() => storage.readRecording(r.file.id));
    assert.equal((await c.owner(root, "POST", made.input)).status, 409);
  },
);

test(
  "unfinished uploads, digest mismatches and orphan cleanup guards cannot expose bytes or delete adopted media",
  { timeout: 120000 },
  async () => {
    const { createHash } = await import("node:crypto"),
      c = await recordingSetup(),
      bytes = toneWav(1200),
      storage = await import("../src/lib/storage"),
      features = await import("../src/lib/features");
    const made = await c.create(),
      path = root + "/" + made.recording.id;
    let r = (
      await c.owner(path + "/upload", "POST", {
        version: 1,
        bytes: bytes.length,
        digest: "0".repeat(64),
        mime: "audio/wav",
      })
    ).recording;
    r = (
      await c.owner(path + "/part", "PUT", bytes, {
        "x-recording-version": String(r.version),
        "x-recording-part": "0",
      })
    ).recording;
    assert.equal(
      (
        await c.owner(path + "/complete", "POST", undefined, {
          "x-recording-version": String(r.version),
        })
      ).status,
      400,
    );
    assert.equal((await c.owner(path + "/file")).status, 404);
    const staged = await c.local.get<any>(
        "libraryRecording",
        r.id,
        c.actor.workspaceId,
      ),
      part = staged.upload.parts[0];
    await c.local.put("deletion", {
      id: part.id,
      workspaceId: c.actor.workspaceId,
      files: [part.id],
      recordingGuard: r.id,
      notBefore: 0,
    });
    await features.cleanDeletions();
    assert.ok((await storage.readRecording(part.id)).equals(bytes));
    await c.owner(path, "DELETE", { version: r.version });
    await assert.rejects(() => storage.readRecording(part.id));
    assert.equal(
      (
        await c.owner(path + "/part", "PUT", bytes, {
          "x-recording-version": String(r.version),
          "x-recording-part": "0",
        })
      ).status,
      404,
    );
    const good = await c.create();
    r = (
      await c.owner(root + "/" + good.recording.id + "/upload", "POST", {
        version: 1,
        bytes: bytes.length,
        digest: createHash("sha256").update(bytes).digest("hex"),
        mime: "audio/wav",
      })
    ).recording;
    const pending = await c.local.get<any>(
      "libraryRecording",
      r.id,
      c.actor.workspaceId,
    );
    await c.local.put("deletion", {
      id: pending.upload.parts[0].id,
      workspaceId: c.actor.workspaceId,
      files: [pending.upload.parts[0].id],
      recordingGuard: r.id,
      notBefore: 0,
    });
    // A crash after storage write and before checkpoint commit leaves only a bounded orphan guard.
    await storage.ensureRecording(
      pending.upload.parts[0].id,
      bytes,
      "application/octet-stream",
    );
    await features.cleanDeletions();
    await assert.rejects(() =>
      storage.readRecording(pending.upload.parts[0].id),
    );
    await c.owner(root + "/" + r.id, "DELETE", { version: r.version });
  },
);

test(
  "researcher speaker sections preserve machine originals, exact ordered text and server-owned media provenance through keyword/semantic citations, saved answers, exports, briefs and erasure",
  { timeout: 120000 },
  async () => {
    const c = await recordingSetup(),
      made = await c.create(),
      text =
        "What protects unfinished work?\n\nSaving the draft keeps unfinished progress available before review.",
      cut = text.indexOf("Saving"),
      sections = [
        { start: 0, end: cut, speaker: "Interviewer", startMs: 0, endMs: 1000 },
        {
          start: cut,
          end: text.length,
          speaker: "Participant A",
          startMs: 1500,
          endMs: 4000,
        },
      ],
      path = root + "/" + made.recording.id;
    let r = await c.transcribe(
      await c.upload(made.recording, toneWav(5000)),
      async () => ({
        text,
        model: "marked-speaker-fixture",
        generatedAt: new Date().toISOString(),
      }),
    );
    const original = structuredClone(r.original);
    r = (
      await c.owner(path, "PUT", {
        version: r.version,
        text,
        reviewed: false,
        sections: sections.map((s) => ({
          ...s,
          speaker: "",
          startMs: null,
          endMs: null,
        })),
      })
    ).recording;
    assert.equal(
      (
        await c.owner(path + "/approve", "POST", {
          version: r.version,
          reviewed: true,
        })
      ).status,
      409,
    );
    r = (
      await c.owner(path, "PUT", {
        version: r.version,
        text,
        reviewed: true,
        sections,
      })
    ).recording;
    assert.deepEqual(r.original, original);
    assert.equal(r.history.length, 3);
    assert.equal(r.history[1].sections[1].speaker, "");
    const approved = await c.owner(path + "/approve", "POST", {
      version: r.version,
      reviewed: true,
    });
    assert.equal(approved.status, 200, JSON.stringify(approved));
    const id = approved.interviewId,
      source = (await c.owner("library/sources/" + id)).source;
    assert.equal(source.turns.map((t: any) => t.answer).join(""), text);
    assert.equal(source.turns.length, 2);
    const context = source.turns[1].recordingSection;
    assert.equal(context.mediaId, source.media[0].id);
    assert.equal(context.speaker, "Participant A");
    assert.equal(context.startMs, 1500);
    assert.equal(context.endMs, 4000);
    assert.equal(context.reviewedBy.id, c.actor.id);
    assert.equal(approved.recording.history, undefined);
    const hits = (await c.owner("library/search", "POST", { query: "draft" }))
      .hits;
    assert.equal(hits[0].recordingSection.speaker, "Participant A");
    // Semantic chunks are generated from the same current speaker-aware corpus.
    const { transcriptLibraryCorpus } =
      await import("../src/lib/library-transcript-corpus");
    const corpus = await transcriptLibraryCorpus(c.actor, {
      studyIds: [c.s.id],
      query: "",
    });
    assert.deepEqual(corpus.hits[1].recordingSection, context);
    const { dispatchLibrarySemantic, retrieveLibrarySemantic } =
        await import("../src/lib/library-semantic-server"),
      { fixtureEmbedding } = await import("./library-semantic-fixture"),
      { libraryAttachmentFilter } =
        await import("../src/lib/library-attachments");
    const filter = libraryAttachmentFilter.parse({ studyIds: [c.s.id] });
    await dispatchLibrarySemantic(
      new Request("http://localhost/api/library/semantic/index", {
        method: "POST",
        body: JSON.stringify({ ...filter, scope: "transcripts" }),
      }),
      ["library", "semantic", "index"],
      c.actor,
      fixtureEmbedding,
    );
    const semantic = await retrieveLibrarySemantic(
      c.actor,
      "transcripts",
      filter,
      "unfinished progress",
      50,
      fixtureEmbedding,
    );
    assert.deepEqual(
      (
        semantic.items.find(
          (h) => (h.hit as any).recordingSection?.speaker === "Participant A",
        )!.hit as any
      ).recordingSection,
      context,
    );
    const { answerTranscriptQuestion } =
      await import("../src/lib/library-transcript-qa-server");
    const requestId = randomUUID(),
      input = {
        studyIds: [c.s.id],
        question: "How does saving the draft protect progress?",
        saveDraft: true,
        requestId,
      };
    const generate = async (_system: any, p: any) => {
      const h = p.evidence.find((h: any) => h.quote.includes("Saving"));
      assert.deepEqual(h.recordingSection, {
        speaker: "Participant A",
        startMs: 1500,
        endMs: 4000,
      });
      assert.equal(JSON.stringify(p).includes(context.mediaId), false);
      assert.equal(JSON.stringify(p).includes(c.actor.id), false);
      return {
        answer: "MARKED_REVIEWED_SPEAKER_FINDING",
        citations: [
          {
            studyId: h.studyId,
            interviewId: h.interviewId,
            turnId: h.turnId,
            quote:
              "Saving the draft keeps unfinished progress available before review.",
            recordingSection: {
              speaker: "FORGED_MODEL_LABEL",
              startMs: 999999,
            },
          },
        ],
      };
    };
    const request = () =>
      new Request("http://localhost/api/library/qa", {
        method: "POST",
        body: JSON.stringify(input),
      });
    const qa = await (
      await answerTranscriptQuestion(request(), c.actor, generate)
    ).json();
    assert.deepEqual(qa.citations[0].recordingSection, context);
    const retry = await (
      await answerTranscriptQuestion(request(), c.actor, async () => {
        throw Error("DO_NOT_REGENERATE");
      })
    ).json();
    assert.deepEqual(retry.citations[0].recordingSection, context);
    let saved = (await c.owner("library/answers/" + qa.savedAnswerId)).answer;
    assert.deepEqual(saved.sources[0].transcript.recordingSection, context);
    const { answerEdit, briefInput, briefUpdate } =
      await import("./library-briefs-fixture");
    saved = (
      await c.owner("library/answers/" + saved.id, "PUT", answerEdit(saved))
    ).answer;
    let brief = (
      await c.owner("library/briefs", "POST", {
        ...briefInput([saved]),
        requestId: randomUUID(),
      })
    ).brief;
    brief = (
      await c.owner(
        "library/briefs/" + brief.id,
        "PUT",
        briefUpdate(brief, { reviewed: true, includeInExports: true }),
      )
    ).brief;
    for (const rootPath of [
      "library/answers/" + saved.id,
      "library/briefs/" + brief.id,
    ])
      for (const format of ["md", "csv"]) {
        const exported = await c.owner(rootPath + "/export?format=" + format);
        assert.equal(exported.status, 200, JSON.stringify(exported));
        const content = exported.bytes.toString();
        assert.ok(content.includes("Participant A"));
        assert.ok(
          content.includes("/api/recordings/" + context.mediaId + "#t=1.5,4"),
        );
        if (format === "csv") assert.ok(content.includes("recording_start_ms"));
      }
    const stored = await c.local.get<any>("interview", id, c.actor.workspaceId);
    stored.turns[1].recordingSection.speaker = "Corrected participant label";
    stored.version++;
    await c.local.put("interview", stored);
    for (const [kind, key] of [
      ["libraryAnswer", saved.id],
      ["libraryBrief", brief.id],
    ])
      assert.equal(
        await c.local.get(kind, key, c.actor.workspaceId),
        undefined,
      );
    await c.owner("studies/" + c.s.id + "/responses/" + id, "DELETE");
    await assert.rejects(() =>
      import("../src/lib/storage").then((s) =>
        s.readRecording(context.mediaId),
      ),
    );
    assert.equal((await c.owner(path)).status, 404);
  },
);

test(
  "speaker review rejects omitted text, invented media/reviewer fields, out-of-bounds or overlapping timing, empty reviewed labels and stale versions",
  { timeout: 120000 },
  async () => {
    const c = await recordingSetup(),
      made = await c.create();
    let r = await c.transcribe(await c.upload(made.recording));
    const text = r.original.text,
      path = root + "/" + r.id,
      valid = {
        start: 0,
        end: text.length,
        speaker: "Participant",
        startMs: 0,
        endMs: 1000,
      };
    for (const sections of [
      [],
      [{ ...valid, end: text.length - 1 }],
      [{ ...valid, start: 1 }],
      [{ ...valid, speaker: "" }],
      [{ ...valid, startMs: null }],
      [{ ...valid, endMs: 1201 }],
      [{ ...valid, mediaId: randomUUID() }],
      [{ ...valid, reviewedBy: { id: randomUUID() } }],
      [
        { ...valid, end: 10 },
        { ...valid, start: 10, startMs: 900 },
      ],
    ]) {
      assert.equal(
        (
          await c.owner(path, "PUT", {
            version: r.version,
            text,
            reviewed: true,
            sections,
          })
        ).status,
        400,
        JSON.stringify(sections),
      );
    }
    for (const [actor, status] of [
      [{ ...c.actor, workspaceId: randomUUID() }, 404],
      [{ ...c.actor, role: "viewer" }, 403],
    ] as const) {
      await assert.rejects(
        () =>
          c.service.dispatchLibraryRecordings(
            new Request("http://localhost/api/" + path, {
              method: "PUT",
              body: JSON.stringify({
                version: r.version,
                text,
                reviewed: true,
                sections: [valid],
              }),
            }),
            ["library", "recordings", r.id],
            actor as any,
          ),
        (e: any) => e.status === status,
      );
    }
    const before = r.version;
    r = (
      await c.owner(path, "PUT", {
        version: r.version,
        text,
        reviewed: true,
        sections: [valid],
      })
    ).recording;
    assert.equal(
      (
        await c.owner(path, "PUT", {
          version: before,
          text,
          reviewed: true,
          sections: [valid],
        })
      ).status,
      409,
    );
    r = (
      await c.owner(path, "PUT", {
        version: r.version,
        text: text + " Corrected.",
        reviewed: false,
      })
    ).recording;
    assert.equal(r.history.at(-1).sections, undefined);
    assert.equal(r.history.at(-1).reviewed, false);
    await c.owner(path, "DELETE", { version: r.version });
  },
);
