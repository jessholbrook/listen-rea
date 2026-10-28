import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import ffmpeg from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { start, stop, client, base } from "./harness";
import { toneWav } from "./reporting-fixture";
before(() => start({ port: 3110 }), { timeout: 90000 });
after(stop);
test(
  "library imports, identifier previews, workspace search and media honor source and deletion boundaries",
  { timeout: 90000 },
  async () => {
    const owner = await client(),
      stranger = await client(),
      person = await client(),
      anonymous = await client();
    await owner("auth/signup", "POST", {
      name: "Library Owner",
      email: "library@example.test",
      password: "library-test-password",
    });
    await stranger("auth/signup", "POST", {
      name: "Other Owner",
      email: "other-library@example.test",
      password: "library-test-password",
    });
    const s = (await owner("studies", "POST", { title: "Feedback decisions" }))
        .study,
      s2 = (await owner("studies", "POST", { title: "Support workflows" }))
        .study;
    const input = {
      studyId: s.id,
      requestId: randomUUID(),
      externalId: "alex-1",
      title: "Alex external interview",
      transcript: "Participant: We use feedback to make product decisions.",
      permissionConfirmed: true,
      transcriptReviewed: true,
    };
    assert.equal((await anonymous("library")).status, 401);
    assert.equal(
      (await stranger("library/imports", "POST", input)).status,
      404,
    );
    assert.equal(
      (
        await owner("library/imports", "POST", {
          ...input,
          permissionConfirmed: false,
        })
      ).status,
      400,
    );
    const imported = await owner("library/imports", "POST", input);
    assert.equal(imported.status, 201);
    const id = imported.interviewId;
    assert.equal(
      (await owner("library/imports", "POST", input)).interviewId,
      id,
    );
    assert.equal(
      (
        await owner("library/imports", "POST", {
          ...input,
          title: "Changed input",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await owner("library/imports", "POST", {
          ...input,
          requestId: randomUUID(),
        })
      ).status,
      409,
    );
    const second = await owner("library/imports", "POST", {
      ...input,
      studyId: s2.id,
      requestId: randomUUID(),
      transcript: "Participant: Support tickets help us understand feedback.",
      title: "Support external interview",
    });
    let result = await owner("library/search", "POST", { query: "feedback" });
    assert.equal(result.total, 2);
    assert.ok(
      result.hits.every(
        (h: any) =>
          h.studyId && h.revisionId && h.turnId && h.source === "external",
      ),
    );
    assert.equal(
      (
        await owner("library/search", "POST", {
          query: "feedback",
          studyIds: [s.id],
        })
      ).total,
      1,
    );
    assert.equal(
      (await stranger("library/search", "POST", { query: "feedback" })).total,
      0,
    );
    assert.equal(
      (
        await stranger("library/search", "POST", {
          query: "feedback",
          studyIds: [s.id],
        })
      ).status,
      404,
    );
    assert.equal((await stranger("library/sources/" + id)).status, 404);
    const detail = await owner("library/sources/" + id);
    assert.equal(detail.source.origin.transcriptReviewed, true);
    assert.equal(
      (
        await owner("library/qa", "POST", {
          question: "What is the salary of a unicorn?",
          studyIds: [s.id],
        })
      ).citations.length,
      0,
    );
    const badCsv = "external_id,segment\nalex-1,Enterprise\nmissing,Small";
    let preview = await owner(`library/attributes/${s.id}/preview`, "POST", {
      csv: badCsv,
    });
    assert.equal(preview.valid, false);
    assert.match(preview.rows[1].error, /No matching/);
    assert.equal(
      (
        await owner(`library/attributes/${s.id}/apply`, "POST", {
          csv: badCsv,
          fingerprint: preview.fingerprint,
        })
      ).status,
      400,
    );
    const duplicate = await owner(
      `library/attributes/${s.id}/preview`,
      "POST",
      { csv: "external_id,segment\nalex-1,A\nalex-1,B" },
    );
    assert.match(duplicate.rows[1].error, /Duplicate/);
    const data = "external_id,segment,note\nalex-1,Enterprise,Reviewed";
    preview = await owner(`library/attributes/${s.id}/preview`, "POST", {
      csv: data,
    });
    assert.equal(preview.valid, true);
    assert.equal(preview.rows[0].interviewId, id);
    assert.equal(
      (
        await owner(`library/attributes/${s.id}/apply`, "POST", {
          csv: data,
          fingerprint: preview.fingerprint,
        })
      ).updated,
      1,
    );
    assert.equal(
      (
        await owner(`library/attributes/${s.id}/apply`, "POST", {
          csv: data,
          fingerprint: preview.fingerprint,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await owner("library/search", "POST", {
          query: "feedback",
          attribute: { key: "segment", value: "Enterprise" },
        })
      ).total,
      1,
    );
    // Imported responses do not consume the recruited participant limit.
    let guide = {
      ...s.draft,
      limit: 1,
      questions: [{ ...s.draft.questions[1], followUps: 0 }],
    };
    let current = (
      await owner("studies/" + s.id, "PUT", { guide, version: s.version })
    ).study;
    current = (
      await owner(`studies/${s.id}/publish`, "POST", {
        version: current.version,
      })
    ).study;
    await owner(`studies/${s.id}/fielding`, "POST", { state: "active" });
    const admitted = await person(`public/${s.id}`, "POST", { consent: true });
    assert.equal(admitted.status, 201);
    const nativeCsv = `response_id,segment\n${admitted.interview.id},Internal`;
    const nativePreview = await owner(
      `library/attributes/${s.id}/preview`,
      "POST",
      { csv: nativeCsv },
    );
    assert.equal(
      (
        await owner(`library/attributes/${s.id}/apply`, "POST", {
          csv: nativeCsv,
          fingerprint: nativePreview.fingerprint,
        })
      ).updated,
      1,
    );
    const native = await person(
      `interviews/${admitted.interview.id}/answer`,
      "POST",
      {
        requestId: randomUUID(),
        version: 0,
        answer: "Native participants also use feedback.",
      },
      { "x-interview-token": admitted.token },
    );
    assert.equal(native.interview.status, "complete");
    const upload = async (
      who: typeof owner,
      responseId: string,
      bytes: Buffer,
      mime: string,
    ) => {
      // Obtain a workspace cookie via a fresh authenticated fetch client for binary requests.
      const auth = await fetch(base + "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email:
            who === owner
              ? "library@example.test"
              : "other-library@example.test",
          password: "library-test-password",
        }),
      });
      return fetch(base + `/api/library/imports/${responseId}/media`, {
        method: "POST",
        headers: {
          cookie: auth.headers.get("set-cookie")!.split(";")[0],
          "content-type": mime,
        },
        body: new Uint8Array(bytes),
      });
    };
    const wav = toneWav(2000);
    assert.equal((await upload(stranger, id, wav, "audio/wav")).status, 404);
    assert.equal(
      (await upload(owner, id, Buffer.from("not an audio file"), "audio/wav"))
        .status,
      400,
    );
    let media = await upload(owner, id, wav, "audio/wav");
    assert.equal(media.status, 201);
    const audio = await media.json();
    assert.equal(
      (await (await upload(owner, id, wav, "audio/wav")).json()).reused,
      true,
    );
    assert.equal(
      (await upload(owner, id, toneWav(2500), "audio/wav")).status,
      409,
    );
    assert.equal((await stranger("recordings/" + audio.mediaId)).status, 404);
    assert.equal((await anonymous("recordings/" + audio.mediaId)).status, 401);
    const sources = await owner(`studies/${s.id}/reporting`);
    assert.equal(
      sources.sources.find((m: any) => m.mediaId === audio.mediaId).interviewId,
      id,
    );
    const clip = await owner(`studies/${s.id}/reporting/clips`, "POST", {
      name: "Imported audio",
      mediaId: audio.mediaId,
      quote: "We use feedback",
      startMs: 0,
      endMs: 1000,
      caption: "Reviewed external transcript",
      reviewed: true,
    });
    assert.equal(clip.status, 201);
    const tmp = mkdtempSync(path.join(tmpdir(), "echo-import-test-"));
    let videoId: string;
    try {
      const file = path.join(tmp, "fixture.mp4");
      execFileSync(ffmpeg!, [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=160x90:r=12",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=400:sample_rate=24000",
        "-t",
        "2",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        file,
      ]);
      const video = await upload(
        owner,
        second.interviewId,
        readFileSync(file),
        "video/mp4",
      );
      assert.equal(video.status, 201);
      videoId = (await video.json()).mediaId;
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    const videoSources = await owner(`studies/${s2.id}/reporting`);
    assert.equal(
      videoSources.sources.find((m: any) => m.mediaId === videoId).kind,
      "screen",
    );
    const analysis = await owner(`studies/${s.id}/analysis`, "POST", {
      mode: "manual",
    });
    assert.match(analysis.analysis.memo, /external transcripts/);
    await owner(`studies/${s.id}/responses/${id}`, "PATCH", {
      excluded: true,
      reason: "Check source context",
    });
    assert.equal((await owner("library/sources/" + id)).status, 404);
    assert.equal(
      (
        await owner("library/search", "POST", {
          query: "feedback",
          studyIds: [s.id],
        })
      ).total,
      1,
    );
    await owner(`studies/${s.id}/responses/${id}`, "PATCH", {
      excluded: false,
      reason: "Reviewed",
    });
    assert.equal(
      (await owner(`studies/${s.id}/responses/${id}`, "DELETE"))
        .mediaCleanupPending,
      false,
    );
    assert.equal((await owner("library/sources/" + id)).status, 404);
    assert.equal((await owner("recordings/" + audio.mediaId)).status, 404);
    assert.equal((await owner(`studies/${s.id}/reporting`)).clips.length, 0);
    assert.equal(
      (
        await owner(
          `studies/${s2.id}/responses/${second.interviewId}`,
          "DELETE",
        )
      ).mediaCleanupPending,
      false,
    );
    assert.equal((await owner("recordings/" + videoId!)).status, 404);
  },
);
