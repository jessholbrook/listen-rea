import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { recordingSetup, recordingRoot } from "./library-recordings-fixture";
import { toneWav } from "./reporting-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3364 : 3363 }),
  { timeout: 90000 },
);
after(stop);
async function setup() {
  const c = await recordingSetup(),
    made = await c.create(),
    text =
      "What protects unfinished work?\n\nSaving the draft preserves progress before review.",
    cut = text.indexOf("Saving");
  let r = await c.transcribe(
    await c.upload(made.recording, toneWav(5000)),
    async () => ({
      text,
      model: "marked-revision-fixture",
      generatedAt: new Date().toISOString(),
    }),
  );
  const sections = [
    { start: 0, end: cut, speaker: "Interviewer", startMs: 0, endMs: 1000 },
    {
      start: cut,
      end: text.length,
      speaker: "Participant",
      startMs: 1500,
      endMs: 4000,
    },
  ];
  r = (
    await c.owner(recordingRoot + "/" + r.id, "PUT", {
      version: r.version,
      text,
      sections,
      reviewed: true,
    })
  ).recording;
  const approved = await c.owner(
      recordingRoot + "/" + r.id + "/approve",
      "POST",
      { version: r.version, reviewed: true },
    ),
    id = approved.interviewId,
    path = "library/sources/" + id + "/revisions",
    source = (await c.owner("library/sources/" + id)).source;
  return { ...c, id, path, source, text, sections };
}
test(
  "private source revisions publish once, preserve original media/provenance, clear dependent research, restore through new review, and erase all history with the response",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      original = structuredClone(c.source.origin.transcription),
      before = await c.local.get<any>("study", c.s.id, c.actor.workspaceId);
    const initial = await c.owner(c.path);
    assert.equal(initial.revision, null);
    assert.equal(initial.base.text, c.text);
    const { answerTranscriptQuestion } =
        await import("../src/lib/library-transcript-qa-server"),
      { answerEdit, briefInput } = await import("./library-briefs-fixture");
    const qa = await (
      await answerTranscriptQuestion(
        new Request("http://localhost/api/library/qa", {
          method: "POST",
          body: JSON.stringify({
            studyIds: [c.s.id],
            question: "How does draft review preserve progress?",
            saveDraft: true,
            requestId: randomUUID(),
          }),
        }),
        c.actor,
        async (_s: any, p: any) => {
          const h = p.evidence.find((h: any) => h.quote.includes("Saving"));
          return {
            answer: "MARKED_SOURCE_REVISION_FINDING",
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
      )
    ).json();
    let answer = (await c.owner("library/answers/" + qa.savedAnswerId)).answer;
    answer = (
      await c.owner("library/answers/" + answer.id, "PUT", answerEdit(answer))
    ).answer;
    const brief = (
      await c.owner("library/briefs", "POST", {
        ...briefInput([answer]),
        requestId: randomUUID(),
      })
    ).brief;
    const { dispatchLibrarySemantic } =
        await import("../src/lib/library-semantic-server"),
      { fixtureEmbedding } = await import("./library-semantic-fixture");
    await dispatchLibrarySemantic(
      new Request("http://localhost/api/library/semantic/index", {
        method: "POST",
        body: JSON.stringify({ scope: "transcripts", studyIds: [c.s.id] }),
      }),
      ["library", "semantic", "index"],
      c.actor,
      fixtureEmbedding,
    );
    const derived: string[][] = [];
    for (const kind of [
      "analysis",
      "reportEdition",
      "reportSnapshot",
      "mediaClip",
      "mediaReel",
      "responseTranslation",
      "pulseReview",
      "visualRun",
    ]) {
      const id = randomUUID();
      derived.push([kind, id]);
      await c.local.put(kind, {
        id,
        workspaceId: c.actor.workspaceId,
        studyId: c.s.id,
        interviewId: c.id,
        marker: "MARKED_OLD_SOURCE",
      });
    }
    const storage = await import("../src/lib/storage"),
      outputId = randomUUID(),
      jobId = randomUUID();
    await storage.writeRecording(
      outputId,
      Buffer.from("synthetic rendered old source"),
      "video/mp4",
    );
    await c.local.put("renderJob", {
      id: jobId,
      workspaceId: c.actor.workspaceId,
      studyId: c.s.id,
      outputId,
    });
    await c.local.db
      .prepare(
        "INSERT INTO shares(hash,study_id,workspace_id,analysis_id,expires) VALUES(?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        c.s.id,
        c.actor.workspaceId,
        derived[0][1],
        Date.now() + 60000,
      );
    const corrected =
        "What protects unfinished work?\n\nSaving the corrected draft keeps unfinished work available for source review.",
      sections = [
        c.sections[0],
        {
          ...c.sections[1],
          end: corrected.length,
          speaker: "Participant A",
          startMs: 2000,
          endMs: 4500,
        },
      ],
      input = {
        requestId: randomUUID(),
        version: 0,
        sourceVersion: c.source.version,
        text: corrected,
        sections,
        reason: "Correct transcript and reviewed speaker timing",
        reviewed: false,
      };
    let d = (await c.owner(c.path, "PUT", input)).revision;
    assert.equal(d.history.length, 2);
    assert.equal(d.history[0].text, c.text);
    assert.equal(d.history[1].requestId, undefined);
    assert.equal(
      (await c.owner(c.path, "PUT", input)).revision.history.length,
      2,
    );
    assert.equal(
      (await c.owner(c.path, "PUT", { ...input, reason: "Different" })).status,
      409,
    );
    assert.equal(
      (await c.owner("library/sources/" + c.id)).source.turns
        .map((t: any) => t.answer)
        .join(""),
      c.text,
    );
    assert.ok(
      await c.local.get("libraryAnswer", answer.id, c.actor.workspaceId),
    );
    assert.ok(await c.local.get("libraryBrief", brief.id, c.actor.workspaceId));
    assert.equal(
      (await c.local.get<any>("study", c.s.id, c.actor.workspaceId))
        .dataVersion,
      before!.dataVersion,
    );
    assert.equal(
      (
        await c.owner(c.path + "/publish", "POST", {
          requestId: randomUUID(),
          version: d.version,
          sourceVersion: c.source.version,
          reviewVersion: d.history.at(-1).version,
          reviewed: true,
        })
      ).status,
      409,
    );
    d = (
      await c.owner(c.path, "PUT", {
        ...input,
        requestId: randomUUID(),
        version: d.version,
        reviewed: true,
      })
    ).revision;
    const publication = {
      requestId: randomUUID(),
      version: d.version,
      sourceVersion: c.source.version,
      reviewVersion: d.history.at(-1).version,
      reviewed: true,
    };
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>((r) => {
        entered = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      });
    const late = answerTranscriptQuestion(
      new Request("http://localhost/api/library/qa", {
        method: "POST",
        body: JSON.stringify({
          studyIds: [c.s.id],
          question: "What protects progress before review?",
          saveDraft: true,
          requestId: randomUUID(),
        }),
      }),
      c.actor,
      async (_s: any, p: any) => {
        entered();
        await gate;
        const h = p.evidence[0];
        return {
          answer: "MARKED_LATE_OLD_SOURCE",
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
    await started;
    let applied = await c.owner(c.path + "/publish", "POST", publication);
    release();
    await assert.rejects(
      () => late,
      (e: any) => e.status === 409,
    );
    assert.equal(applied.status, 200, JSON.stringify(applied));
    d = applied.revision;
    assert.equal(
      (await c.owner(c.path + "/publish", "POST", publication)).reused,
      true,
    );
    const source = (await c.owner("library/sources/" + c.id)).source;
    assert.equal(source.turns.map((t: any) => t.answer).join(""), corrected);
    assert.equal(source.turns[1].recordingSection.speaker, "Participant A");
    assert.equal(source.turns[1].recordingSection.startMs, 2000);
    assert.equal(source.media[0].id, c.source.media[0].id);
    assert.ok(
      (await storage.readRecording(source.media[0].id)).equals(toneWav(5000)),
    );
    for (const key of [
      "model",
      "generatedAt",
      "recordingDigest",
      "originalTranscriptDigest",
    ])
      assert.equal(source.origin.transcription[key], original[key]);
    assert.equal(source.origin.transcription.revision.reason, input.reason);
    for (const [kind, id] of [
      ...derived,
      ["libraryAnswer", answer.id],
      ["libraryBrief", brief.id],
      ["renderJob", jobId],
    ])
      assert.equal(
        await c.local.get(kind, id, c.actor.workspaceId),
        undefined,
        kind,
      );
    assert.equal(
      (await c.local.list("libraryEmbedding", c.actor.workspaceId)).length,
      0,
    );
    assert.equal(
      (
        await c.local.db
          .prepare("SELECT hash FROM shares WHERE workspace_id=?")
          .all(c.actor.workspaceId)
      ).length,
      0,
    );
    await assert.rejects(() => storage.readRecording(outputId));
    assert.equal(
      (await c.local.get<any>("study", c.s.id, c.actor.workspaceId))
        .dataVersion,
      before!.dataVersion + 1,
    );
    applied = await c.owner(c.path + "/restore", "POST", {
      requestId: randomUUID(),
      version: d.version,
      sourceVersion: source.version,
      reviewVersion: 1,
      reason: "Restore original reviewed import",
    });
    d = applied.revision;
    assert.equal(d.history.at(-1).reviewed, false);
    assert.equal(d.history.at(-1).text, c.text);
    assert.equal(
      (await c.owner("library/sources/" + c.id)).source.turns[1]
        .recordingSection.speaker,
      "Participant A",
    );
    const restored = d.history.at(-1);
    d = (
      await c.owner(c.path, "PUT", {
        requestId: randomUUID(),
        version: d.version,
        sourceVersion: source.version,
        text: restored.text,
        sections: restored.sections,
        reason: "Checked restored transcript and timing",
        reviewed: true,
      })
    ).revision;
    applied = await c.owner(c.path + "/publish", "POST", {
      requestId: randomUUID(),
      version: d.version,
      sourceVersion: source.version,
      reviewVersion: d.history.at(-1).version,
      reviewed: true,
    });
    assert.equal(applied.status, 200);
    const final = (await c.owner("library/sources/" + c.id)).source;
    assert.equal(final.turns.map((t: any) => t.answer).join(""), c.text);
    const replay = await c.owner(c.path + "/publish", "POST", publication);
    assert.equal(replay.reused, true);
    assert.equal(replay.sourceVersion, final.version);
    assert.equal(replay.publishedSourceVersion, source.version);
    assert.equal(
      (await c.owner("library/sources/" + c.id)).source.turns
        .map((t: any) => t.answer)
        .join(""),
      c.text,
    );
    await c.owner("studies/" + c.s.id + "/responses/" + c.id, "DELETE");
    assert.equal(
      await c.local.get("librarySourceRevision", c.id, c.actor.workspaceId),
      undefined,
    );
    assert.equal((await c.owner(c.path, "PUT", input)).status, 404);
    assert.equal(
      (await c.owner(c.path + "/publish", "POST", publication)).status,
      404,
    );
    await assert.rejects(() => storage.readRecording(c.source.media[0].id));
  },
);
test(
  "revision authorization, strict provenance, source/document concurrency and bounded history reject unsafe publication without changing the current research source",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      base = {
        requestId: randomUUID(),
        version: 0,
        sourceVersion: c.source.version,
        text: c.text,
        sections: c.sections,
        reason: "Verify reviewed source",
        reviewed: true,
      };
    const service = await import("../src/lib/library-source-revisions-server");
    for (const [actor, status] of [
      [{ ...c.actor, role: "viewer" }, 403],
      [{ ...c.actor, workspaceId: randomUUID() }, 404],
    ] as const)
      await assert.rejects(
        () =>
          service.dispatchSourceRevisions(
            new Request("http://localhost/api/" + c.path),
            ["library", "sources", c.id, "revisions"],
            actor as any,
          ),
        (e: any) => e.status === status,
      );
    for (const extra of [
      { original: { text: "forged" } },
      { editor: { id: randomUUID() } },
      {
        sections: [{ ...c.sections[0], mediaId: randomUUID() }, c.sections[1]],
      },
      { sections: [c.sections[0], { ...c.sections[1], startMs: 900 }] },
      { sourceVersion: c.source.version + 1 },
    ])
      assert.equal(
        (await c.owner(c.path, "PUT", { ...base, ...extra })).status,
        "sourceVersion" in extra ? 409 : 400,
      );
    let d = (await c.owner(c.path, "PUT", base)).revision;
    assert.equal(
      (await c.owner(c.path, "PUT", { ...base, requestId: randomUUID() }))
        .status,
      409,
    );
    const i = await c.local.get<any>("interview", c.id, c.actor.workspaceId);
    i.attributes = { segment: "changed" };
    i.version++;
    await c.local.put("interview", i);
    assert.equal(
      (
        await c.owner(c.path + "/publish", "POST", {
          requestId: randomUUID(),
          version: d.version,
          sourceVersion: i.version,
          reviewVersion: d.history.at(-1).version,
          reviewed: true,
        })
      ).status,
      409,
    );
    const stored = await c.local.get<any>(
      "librarySourceRevision",
      c.id,
      c.actor.workspaceId,
    );
    stored.history = Array.from({ length: 20 }, (_, n) => ({
      ...stored.history[0],
      version: n + 1,
    }));
    await c.local.put("librarySourceRevision", stored);
    assert.equal(
      (
        await c.owner(c.path, "PUT", {
          ...base,
          requestId: randomUUID(),
          version: stored.version,
          sourceVersion: i.version,
        })
      ).status,
      409,
    );
    assert.equal(
      (await c.owner("library/sources/" + c.id)).source.turns
        .map((t: any) => t.answer)
        .join(""),
      c.text,
    );
    i.excluded = true;
    i.version++;
    await c.local.put("interview", i);
    assert.equal((await c.owner(c.path)).status, 404);
    await c.owner("studies/" + c.s.id + "/responses/" + c.id, "DELETE");
    assert.equal(
      await c.local.get("librarySourceRevision", c.id, c.actor.workspaceId),
      undefined,
    );
  },
);

test(
  "paired manual transcript/recording imports can be revised without inventing machine provenance, while transcript-only sources remain ineligible",
  { timeout: 120000 },
  async () => {
    const c = await recordingSetup(),
      text =
        "Reviewed external transcript: Saving the draft preserves progress.";
    const id = (
        await c.owner("library/imports", "POST", {
          requestId: randomUUID(),
          studyId: c.s.id,
          title: "Manual imported recording",
          externalId: randomUUID(),
          transcript: text,
          permissionConfirmed: true,
          transcriptReviewed: true,
        })
      ).interviewId,
      path = "library/sources/" + id + "/revisions";
    assert.equal(
      (await c.owner("library/sources/" + id)).source.canRevise,
      false,
    );
    assert.equal((await c.owner(path)).status, 409);
    const uploaded = await c.owner(
      "library/imports/" + id + "/media",
      "POST",
      toneWav(1200),
      { "content-type": "audio/wav" },
    );
    assert.equal(uploaded.status, 201);
    const source = (await c.owner("library/sources/" + id)).source;
    assert.equal(source.canRevise, true);
    const d = (
      await c.owner(path, "PUT", {
        requestId: randomUUID(),
        version: 0,
        sourceVersion: source.version,
        text: text + " Corrected.",
        reason: "Correct manual imported transcript",
        reviewed: true,
      })
    ).revision;
    assert.equal(d.history[0].editor.id, "");
    assert.equal(d.history[0].editor.name, source.origin.importedBy);
    const result = await c.owner(path + "/publish", "POST", {
      requestId: randomUUID(),
      version: d.version,
      sourceVersion: source.version,
      reviewVersion: d.history.at(-1).version,
      reviewed: true,
    });
    assert.equal(result.status, 200, JSON.stringify(result));
    const revised = (await c.owner("library/sources/" + id)).source;
    assert.equal(revised.origin.transcription, undefined);
    assert.equal(revised.origin.recordingRevision.editor.id, c.actor.id);
    assert.equal(revised.turns[0].answer, text + " Corrected.");
    await c.owner("studies/" + c.s.id + "/responses/" + id, "DELETE");
    assert.equal(
      await c.local.get("librarySourceRevision", id, c.actor.workspaceId),
      undefined,
    );
  },
);
