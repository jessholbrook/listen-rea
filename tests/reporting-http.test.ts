import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, client, base } from "./harness";
import { toneWav } from "./reporting-fixture";
import { defaultStyle } from "../src/lib/reporting";
before(() => start({ port: 3109 }), { timeout: 90000 });
after(stop);
test(
  "report editions, private reels and exports preserve evidence, history and deletion boundaries",
  { timeout: 120000 },
  async () => {
    const owner = await client(),
      other = await client(),
      person = await client(),
      collaborator = await client();
    await owner("auth/signup", "POST", {
      name: "Report Owner",
      email: "reports@example.test",
      password: "report-test-password",
    });
    await other("auth/signup", "POST", {
      name: "Report Stranger",
      email: "report-stranger@example.test",
      password: "report-test-password",
    });
    const invite = (await owner("invites", "POST", { role: "collaborator" }))
      .invite;
    await collaborator("auth/signup", "POST", {
      name: "Report Colleague",
      email: "report-colleague@example.test",
      password: "report-test-password",
      invite,
    });
    let s = (await owner("studies", "POST", { title: "Reporting lifecycle" }))
      .study;
    s.draft.questions = [{ ...s.draft.questions[1], followUps: 0 }];
    s = (
      await owner(`studies/${s.id}`, "PUT", {
        guide: s.draft,
        version: s.version,
      })
    ).study;
    s = (await owner(`studies/${s.id}/publish`, "POST", { version: s.version }))
      .study;
    await owner(`studies/${s.id}/fielding`, "POST", { state: "active" });
    const r = await person(`public/${s.id}`, "POST", { consent: true }),
      i = r.interview,
      headers = { "x-interview-token": r.token },
      audioId = randomUUID();
    const audio = await fetch(base + `/api/interviews/${i.id}/recording`, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "audio/wav",
        "x-recording-consent": "yes",
        "x-recording-id": audioId,
        "x-recording-duration": "3000",
      },
      body: toneWav(),
    });
    assert.equal(audio.status, 200);
    const answer = "We check the original evidence before making a decision.";
    const complete = await person(
      `interviews/${i.id}/answer`,
      "POST",
      {
        requestId: randomUUID(),
        version: 0,
        answer,
        audioId,
        durationMs: 3000,
      },
      headers,
    );
    assert.equal(complete.interview.status, "complete");
    const turn = complete.interview.turns[0];
    const path = `studies/${s.id}/reporting`;
    let analysis = (
      await owner(`studies/${s.id}/analysis`, "POST", { mode: "manual" })
    ).analysis;
    analysis = (
      await owner(`studies/${s.id}/analysis`, "PUT", {
        ...analysis,
        summary: "Review source evidence before deciding.",
        themes: [
          {
            id: "evidence",
            title: "Check the source",
            description: "One participant describes checking source evidence.",
            citations: [{ interviewId: i.id, turnId: turn.id, quote: answer }],
          },
        ],
        reviewed: true,
      })
    ).analysis;
    const memo = analysis.memo;
    const template = (
      await owner(path + "/templates", "POST", {
        ...defaultStyle,
        name: "Research style",
        brand: "Team Research",
        accent: "#123456",
      })
    ).template;
    assert.equal(
      (await collaborator(path + "/templates", "POST", defaultStyle)).status,
      403,
    );
    let edition = (
      await owner(path + "/editions", "POST", {
        analysisId: analysis.id,
        title: "Executive edition",
        templateId: template.id,
      })
    ).edition;
    assert.equal(edition.style.brand, "Team Research");
    assert.equal(
      (await owner(path + `/editions/${edition.id}/deck`)).status,
      400,
    );
    const saved = await owner(path + `/editions/${edition.id}`, "PUT", {
      ...edition,
      reviewed: true,
    });
    assert.equal(saved.status, 200);
    edition = saved.edition;
    assert.equal(
      (
        await owner(path + `/editions/${edition.id}`, "PUT", {
          ...edition,
          version: 1,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await owner(path + `/editions/${edition.id}`, "PUT", {
          ...edition,
          blocks: edition.blocks.map((b: any) => ({
            ...b,
            citations: [
              {
                interviewId: i.id,
                turnId: turn.id,
                quote: "invented evidence",
              },
            ],
          })),
        })
      ).status,
      400,
    );
    const share = (await owner(path + `/editions/${edition.id}/share`, "POST"))
      .token;
    assert.equal((await person("shared/" + share)).kind, "edition");
    const reportText = (await person("shared/" + share)).memo;
    assert.ok(reportText.includes(answer));
    const publishedDeck = await fetch(base + `/api/shared/${share}/deck`);
    assert.equal(publishedDeck.status, 200);
    assert.equal(
      Buffer.from(await publishedDeck.arrayBuffer())
        .subarray(0, 2)
        .toString(),
      "PK",
    );
    const history = (await owner(path + `/editions/${edition.id}/history`))
      .history;
    const original = history.find((h: any) => h.action === "created");
    edition = (
      await owner(path + `/editions/${edition.id}/restore`, "POST", {
        version: edition.version,
        snapshotId: original.id,
      })
    ).edition;
    assert.equal(edition.reviewed, false);
    assert.equal((await person("shared/" + share)).status, 404);
    assert.equal((await owner(`studies/${s.id}/analysis`)).analysis.memo, memo);
    const unrelated = (
      await owner("studies", "POST", { title: "Other report study" })
    ).study;
    assert.equal(
      (
        await owner(
          `studies/${unrelated.id}/reporting/editions/${edition.id}/history`,
        )
      ).status,
      404,
    );
    assert.equal((await other(path)).status, 404);
    assert.equal((await person(path)).status, 401);
    const clipInput = {
      name: "Evidence moment",
      mediaId: audioId,
      quote: answer,
      startMs: 200,
      endMs: 1200,
      caption: "Check source evidence",
      reviewed: true,
    };
    assert.equal(
      (await owner(path + "/clips", "POST", { ...clipInput, endMs: 4000 }))
        .status,
      400,
    );
    const clip = (await owner(path + "/clips", "POST", clipInput)).clip;
    assert.ok(clip);
    const captions = await owner(path + `/clips/${clip.id}/captions`);
    assert.match(captions.text, /00:00:00.000 --> 00:00:01.000/);
    const c2 = (
      await owner(path + "/clips", "POST", {
        ...clipInput,
        name: "Second moment",
        startMs: 1400,
        endMs: 2400,
        caption: "A second reviewed caption",
      })
    ).clip;
    let reel = (
      await owner(path + "/reels", "POST", {
        name: "Research reel",
        clipIds: [clip.id, c2.id],
        reviewed: true,
      })
    ).reel;
    reel = (
      await owner(path + `/reels/${reel.id}`, "PUT", {
        ...reel,
        clipIds: [c2.id, clip.id],
      })
    ).reel;
    assert.equal(reel.clipIds[0], c2.id);
    const job = (
      await owner(path + "/jobs", "POST", {
        reelId: reel.id,
        version: reel.version,
      })
    ).job;
    const rendered = await owner(path + `/jobs/${job.id}/run`, "POST");
    assert.equal(rendered.job.state, "complete", rendered.job.error);
    assert.ok(rendered.job.bytes > 0);
    assert.ok(Math.abs(rendered.job.durationMs - 2000) < 500);
    const again = await owner(path + `/jobs/${job.id}/run`, "POST");
    assert.equal(again.job.attempts, 1);
    assert.equal(again.job.outputId, rendered.job.outputId);
    const reelShare = (await owner(path + `/jobs/${job.id}/share`, "POST"))
      .token;
    assert.equal((await person("shared/" + reelShare)).kind, "reel");
    const video = await fetch(base + `/api/shared/${reelShare}/media`, {
      headers: { range: "bytes=0-99" },
    });
    assert.equal(video.status, 206);
    assert.equal((await video.arrayBuffer()).byteLength, 100);
    assert.equal(
      (await fetch(base + `/api/recordings/${rendered.job.outputId}`)).status,
      401,
    );
    const newPerson = await client(),
      r2 = await newPerson(`public/${s.id}`, "POST", { consent: true });
    await newPerson(
      `interviews/${r2.interview.id}/answer`,
      "POST",
      {
        requestId: randomUUID(),
        version: 0,
        answer: "A new response changes the corpus.",
      },
      { "x-interview-token": r2.token },
    );
    assert.equal((await person("shared/" + reelShare)).status, 404);
    assert.equal((await owner(path + `/jobs/${job.id}/download`)).status, 409);
    edition = (
      await owner(path + `/editions/${edition.id}/rebase`, "POST", {
        version: edition.version,
      })
    ).edition;
    assert.equal(edition.sampleSize, 2);
    assert.equal(edition.reviewed, false);
    edition = (
      await owner(path + `/editions/${edition.id}`, "PUT", {
        ...edition,
        reviewed: true,
      })
    ).edition;
    assert.equal(edition.reviewed, true);
    const updatedStyle = await owner(
      path + `/templates/${template.id}`,
      "PUT",
      { ...template, brand: "Updated brand" },
    );
    assert.equal(updatedStyle.status, 200);
    assert.equal(
      (await owner(path + `/editions/${edition.id}`)).edition.style.brand,
      "Team Research",
    );
    await owner(`studies/${s.id}/responses/${i.id}`, "PATCH", {
      excluded: true,
      reason: "Review fixture exclusion",
    });
    const editedStale = await owner(path + `/editions/${edition.id}`, "PUT", {
      ...edition,
      blocks: edition.blocks.map((b: any) => ({ ...b, citations: [] })),
    });
    assert.equal(editedStale.status, 200);
    assert.equal(editedStale.edition.reviewed, false);
    const rebased = await owner(
      path + `/editions/${edition.id}/rebase`,
      "POST",
      { version: editedStale.edition.version },
    );
    assert.equal(rebased.status, 200);
    assert.equal(rebased.edition.sampleSize, 1);
    const removed = await owner(`studies/${s.id}/responses/${i.id}`, "DELETE");
    assert.equal(removed.mediaCleanupPending, false);
    const after = await owner(path);
    for (const key of ["editions", "clips", "reels", "jobs"])
      assert.equal(after[key].length, 0);
    assert.equal((await person("shared/" + reelShare)).status, 404);
    assert.equal((await owner(path + `/jobs/${job.id}/download`)).status, 404);
  },
);

test(
  "failed render jobs persist and retries do not publish incomplete outputs",
  { timeout: 90000 },
  async () => {
    const owner = await client(),
      person = await client();
    await owner("auth/signup", "POST", {
      name: "Render Failure Owner",
      email: "render-failure@example.test",
      password: "report-test-password",
    });
    let s = (await owner("studies", "POST", { title: "Invalid media fixture" }))
      .study;
    s.draft.questions = [{ ...s.draft.questions[1], followUps: 0 }];
    s = (
      await owner(`studies/${s.id}`, "PUT", {
        guide: s.draft,
        version: s.version,
      })
    ).study;
    s = (await owner(`studies/${s.id}/publish`, "POST", { version: s.version }))
      .study;
    await owner(`studies/${s.id}/fielding`, "POST", { state: "active" });
    const r = await person(`public/${s.id}`, "POST", { consent: true }),
      h = { "x-interview-token": r.token },
      id = randomUUID();
    await fetch(base + `/api/interviews/${r.interview.id}/recording`, {
      method: "POST",
      headers: {
        ...h,
        "content-type": "audio/wav",
        "x-recording-consent": "yes",
        "x-recording-id": id,
        "x-recording-duration": "3000",
      },
      body: Buffer.from("RIFF deliberately invalid WAV fixture"),
    });
    await person(
      `interviews/${r.interview.id}/answer`,
      "POST",
      {
        requestId: randomUUID(),
        version: 0,
        answer: "Synthetic invalid media source",
        audioId: id,
      },
      h,
    );
    const p = `studies/${s.id}/reporting`,
      c = (
        await owner(p + "/clips", "POST", {
          name: "Invalid fixture clip",
          mediaId: id,
          quote: "Synthetic invalid media source",
          startMs: 0,
          endMs: 1000,
          caption: "Fixture",
          reviewed: true,
        })
      ).clip,
      reel = (
        await owner(p + "/reels", "POST", {
          name: "Failure fixture",
          clipIds: [c.id],
          reviewed: true,
        })
      ).reel,
      j = (
        await owner(p + "/jobs", "POST", {
          reelId: reel.id,
          version: reel.version,
        })
      ).job;
    for (let n = 1; n <= 2; n++) {
      const r = await owner(p + `/jobs/${j.id}/run`, "POST");
      assert.equal(r.job.state, "failed");
      assert.equal(r.job.attempts, n);
      assert.ok(r.job.error);
    }
    assert.equal((await owner(p + `/jobs/${j.id}/download`)).status, 409);
    assert.equal((await owner(p + `/jobs/${j.id}/share`, "POST")).status, 400);
    assert.equal((await owner(p)).jobs[0].state, "failed");
  },
);
