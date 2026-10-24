import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, client, base } from "./harness";
before(() => start({ port: 3108 }), { timeout: 90000 });
after(stop);
test(
  "screen captures bind consent, clips and timing to the current task, survive retries, and follow private deletion",
  { timeout: 90000 },
  async () => {
    const owner = await client(),
      stranger = await client(),
      person = await client(),
      other = await client();
    await owner("auth/signup", "POST", {
      name: "Screen Owner",
      email: "screen@example.test",
      password: "screen-test-password",
    });
    await stranger("auth/signup", "POST", {
      name: "Screen Stranger",
      email: "screen-stranger@example.test",
      password: "screen-test-password",
    });
    let s = (await owner("studies", "POST", { title: "Desktop task test" }))
      .study;
    s.draft.questions = [
      {
        ...s.draft.questions[1],
        followUps: 0,
        task: { url: "https://example.com", maxSeconds: 30 },
      },
    ];
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
      h = { "x-interview-token": r.token };
    const r2 = await other(`public/${s.id}`, "POST", { consent: true }),
      h2 = { "x-interview-token": r2.token };
    assert.equal(
      (
        await person(
          `interviews/${i.id}/captures`,
          "POST",
          { consent: false, version: 0 },
          h,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await person(
          `interviews/${i.id}/captures`,
          "POST",
          { consent: true, version: 3 },
          h,
        )
      ).status,
      409,
    );
    const c = (
      await person(
        `interviews/${i.id}/captures`,
        "POST",
        { consent: true, version: 0 },
        h,
      )
    ).capture;
    assert.ok(c.consentAt);
    assert.equal(c.questionId, i.guide.questions[0].id);
    assert.equal(
      (
        await person(
          `interviews/${i.id}/captures`,
          "POST",
          { consent: true, version: 0 },
          h,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await person(
          `interviews/${i.id}/answer`,
          "POST",
          { requestId: randomUUID(), version: 0, answer: "Finished the task" },
          h,
        )
      ).status,
      409,
    );
    const bytes = Buffer.concat([
        Buffer.from("1a45dfa3", "hex"),
        Buffer.alloc(32, 7),
      ]),
      id = randomUUID();
    async function upload(
      seq: number,
      offset: number,
      duration = 1000,
      clipId = id,
      body = bytes,
      consent = "yes",
      captureId = c.id,
      interview = i.id,
      auth = h,
    ) {
      return fetch(
        `${base}/api/interviews/${interview}/captures/${captureId}/clips`,
        {
          method: "POST",
          headers: {
            ...auth,
            "content-type": "video/webm",
            "x-recording-consent": consent,
            "x-recording-id": clipId,
            "x-clip-sequence": String(seq),
            "x-clip-offset": String(offset),
            "x-recording-duration": String(duration),
          },
          body,
        },
      );
    }
    assert.equal((await upload(0, 0, 1000, id, bytes, "no")).status, 400);
    assert.equal((await upload(1, 1000)).status, 409);
    const first = await upload(0, 0);
    assert.equal(first.status, 200);
    const repeated = await upload(0, 0);
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).reused, true);
    assert.equal(
      (
        await upload(
          0,
          0,
          1000,
          id,
          Buffer.concat([bytes, Buffer.from("changed")]),
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await upload(
          0,
          0,
          1000,
          randomUUID(),
          bytes,
          "yes",
          c.id,
          r2.interview.id,
          h2,
        )
      ).status,
      404,
    );
    assert.equal((await upload(1, 100, 1000, randomUUID())).status, 409);
    assert.equal((await upload(1, 31000, 1000, randomUUID())).status, 400);
    const second = await upload(1, 3000, 1000, randomUUID());
    assert.equal(second.status, 200);
    const clips = (
      await person(`interviews/${i.id}/captures`, "GET", undefined, h)
    ).captures[0].clips;
    assert.equal(clips.length, 2);
    assert.equal(clips[1].offsetMs, 3000);
    assert.equal(
      (await stranger(`studies/${s.id}/captures?interview=${i.id}`)).status,
      404,
    );
    assert.equal(
      (await person(`studies/${s.id}/captures?interview=${i.id}`)).status,
      401,
    );
    assert.equal(
      (await owner(`studies/${s.id}/captures?interview=${r2.interview.id}`))
        .captures.length,
      0,
    );
    assert.equal(
      (
        await person(
          `interviews/${i.id}/transcribe`,
          "POST",
          { audioId: id },
          h,
        )
      ).status,
      404,
    );
    const video = await fetch(
      `${base}/api/interviews/${i.id}/recording/${id}`,
      { headers: h },
    );
    assert.equal(video.status, 200);
    assert.deepEqual(Buffer.from(await video.arrayBuffer()), bytes);
    const range = await fetch(
      `${base}/api/interviews/${i.id}/recording/${id}`,
      { headers: { ...h, range: "bytes=4-9" } },
    );
    assert.equal(range.status, 206);
    assert.deepEqual(
      Buffer.from(await range.arrayBuffer()),
      bytes.subarray(4, 10),
    );
    assert.equal(
      (
        await fetch(`${base}/api/interviews/${i.id}/recording/${id}`, {
          headers: { ...h, range: "bytes=999-" },
        })
      ).status,
      416,
    );
    assert.equal((await fetch(`${base}/api/recordings/${id}`)).status, 401);
    await person(
      `interviews/${i.id}/captures/${c.id}/finish`,
      "POST",
      { status: "stopped" },
      h,
    );
    assert.equal((await upload(2, 6000, 1000, randomUUID())).status, 409);
    const resumed = (await person(`interviews/${i.id}`, "GET", undefined, h))
      .interview;
    assert.equal(resumed.version, 0);
    const c2 = (
      await person(
        `interviews/${i.id}/captures`,
        "POST",
        { consent: true, version: 0 },
        h,
      )
    ).capture;
    assert.notEqual(c2.id, c.id);
    await person(
      `interviews/${i.id}/captures/${c2.id}/finish`,
      "POST",
      { status: "interrupted" },
      h,
    );
    const a = await person(
      `interviews/${i.id}/answer`,
      "POST",
      {
        requestId: randomUUID(),
        version: 0,
        answer: "Finished the task",
        audioId: id,
      },
      h,
    );
    assert.equal(a.status, 400);
    assert.equal(
      (
        await person(
          `interviews/${i.id}/answer`,
          "POST",
          { requestId: randomUUID(), version: 0, answer: "Finished the task" },
          h,
        )
      ).interview.status,
      "complete",
    );
    assert.equal((await upload(0, 0)).status, 200);
    const deleted = await owner(`studies/${s.id}/responses/${i.id}`, "DELETE");
    assert.equal(deleted.mediaCleanupPending, false);
    assert.equal(
      (await owner(`studies/${s.id}/captures?interview=${i.id}`)).status,
      404,
    );
    assert.equal(
      (await person(`interviews/${i.id}/recording/${id}`, "GET", undefined, h))
        .status,
      404,
    );
  },
);
