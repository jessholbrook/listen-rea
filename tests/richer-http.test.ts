import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { start, stop } from "./harness";
import { richerFixture } from "./richer-fixture";
import { client } from "./image-review-fixture";
before(() => start({ port: 3436 }), { timeout: 90000 });
after(stop);
test("task attempts bind current source versions, require explicit outcomes, recover across reload, and revoke reviewed exports on erasure", async () => {
  const c = await richerFixture(),
    path = c.root + "/usability",
    h = c.headers;
  const foreign = await client();
  assert.equal((await foreign(path)).status, 404);
  const start = { requestId: randomUUID(), version: 0, op: "start" };
  let a = (await c.person(path, "POST", start, h)).attempt;
  assert.ok(a.id);
  assert.equal(a.turnIndex, 0);
  assert.equal((await c.person(path, "POST", start, h)).attempt.id, a.id);
  assert.equal(
    (
      await c.person(
        c.root + "/answer",
        "POST",
        { requestId: randomUUID(), version: 0, answer: "A task reflection." },
        h,
      )
    ).status,
    409,
  );
  assert.equal(
    (await c.person(path, "POST", { ...start, requestId: randomUUID() }, h))
      .status,
    409,
  );
  a = (
    await c.person(
      path,
      "POST",
      {
        requestId: randomUUID(),
        version: 0,
        op: "pause",
        attemptId: a.id,
        attemptVersion: a.version,
      },
      h,
    )
  ).attempt;
  assert.equal(
    (await c.person(path, "GET", undefined, h)).attempts[0].state,
    "paused",
  );
  assert.equal(
    (
      await c.person(
        path,
        "POST",
        {
          requestId: randomUUID(),
          version: 0,
          op: "resume",
          attemptId: a.id,
          attemptVersion: a.version - 1,
        },
        h,
      )
    ).status,
    409,
  );
  a = (
    await c.person(
      path,
      "POST",
      {
        requestId: randomUUID(),
        version: 0,
        op: "resume",
        attemptId: a.id,
        attemptVersion: a.version,
      },
      h,
    )
  ).attempt;
  assert.equal(
    (
      await c.person(
        path,
        "POST",
        {
          requestId: randomUUID(),
          version: 0,
          op: "end",
          attemptId: a.id,
          attemptVersion: a.version,
          outcome: "completed",
        },
        h,
      )
    ).status,
    400,
  );
  const end = {
    requestId: randomUUID(),
    version: 0,
    op: "end",
    attemptId: a.id,
    attemptVersion: a.version,
    outcome: "not_completed",
    reviewed: true,
  };
  a = (await c.person(path, "POST", end, h)).attempt;
  assert.equal(a.outcome, "not_completed");
  assert.equal(a.state, "ended");
  assert.equal(
    (await c.person(path, "POST", end, h)).attempt.version,
    a.version,
  );
  assert.equal(
    (
      await c.person(
        c.root + "/answer",
        "POST",
        {
          requestId: randomUUID(),
          version: 0,
          answer: "I could not find support.",
        },
        h,
      )
    ).interview.status,
    "complete",
  );
  const results = `studies/${c.s.id}/usability`,
    data = await c.owner(results);
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].included, true);
  assert.ok(data.rows[0].turnId);
  assert.equal(
    data.rows[0].timing.wallMs,
    data.rows[0].timing.activeMs + data.rows[0].timing.pausedMs,
  );
  const input = { signature: data.signature, reviewed: true };
  assert.equal(
    (await c.owner(results + "/export", "POST", { ...input, reviewed: false }))
      .status,
    400,
  );
  assert.ok(
    (await c.owner(results + "/export", "POST", input)).bytes
      .toString()
      .includes("participant_reported_outcome"),
  );
  assert.equal(
    (await c.owner(results + "?attribute=segment&value=Other")).rows.length,
    0,
  );
  await c.owner(`studies/${c.s.id}/responses/${c.i.id}`, "DELETE");
  assert.equal((await c.owner(results + "/export", "POST", input)).status, 409);
  assert.equal(
    Number(
      (
        await c.local.db
          .prepare(
            "SELECT COUNT(*) AS n FROM documents WHERE kind='taskAttempt' AND json_extract(data,'$.interviewId')=?",
          )
          .get(c.i.id)
      )?.n,
    ),
    0,
  );
});
test("live voice reserves and deduplicates scoped calls, closes on expiry, fences changed sources and never exposes provider credentials", async () => {
  const c = await richerFixture(false);
  const { dispatchRealtime, closeRealtime } =
    await import("../src/lib/realtime-server");
  const path = ["interviews", c.i.id, "realtime"],
    payload = {
      requestId: randomUUID(),
      version: 0,
      consent: true,
      sdp: "v=0\r\nSYNTHETIC_TEST_OFFER",
    };
  let opens = 0,
    closes = 0,
    queued = 0,
    usage = 0;
  const deps = {
    ready: () => true,
    open: async () => {
      opens++;
      return { callId: "synthetic_call", sdp: "v=0\r\nSYNTHETIC_TEST_ANSWER" };
    },
    hangup: async () => {
      closes++;
    },
    queue: async () => {
      queued++;
    },
    usage: async () => {
      usage++;
    },
  };
  const req = (data: any, method = "POST") =>
    new Request("http://localhost/api/" + path.join("/"), {
      method,
      headers: { ...c.headers, "content-type": "application/json" },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  const a = await (await dispatchRealtime(req(payload), path, deps))!.json();
  assert.ok(a.sdp);
  assert.equal(a.callId, undefined);
  assert.equal(a.key, undefined);
  assert.deepEqual([opens, queued, usage], [1, 1, 1]);
  assert.equal(
    (await (await dispatchRealtime(req(payload), path, deps))!.json()).id,
    a.id,
  );
  assert.equal(opens, 1);
  await assert.rejects(
    () =>
      dispatchRealtime(
        req({ ...payload, requestId: randomUUID() }),
        path,
        deps,
      ),
    /already open/,
  );
  await closeRealtime(a.id, false, deps.hangup);
  assert.equal(closes, 0);
  const doc = await c.local.get<any>("realtimeCall", a.id);
  doc.expiresAt = Date.now() - 1;
  await c.local.put("realtimeCall", doc);
  await closeRealtime(a.id, false, deps.hangup);
  assert.equal(closes, 1);
  assert.equal((await c.local.get<any>("realtimeCall", a.id)).sdp, undefined);
  const changed = {
    ...deps,
    open: async () => {
      const i = await c.local.get<any>("interview", c.i.id);
      i.version++;
      await c.local.put("interview", i);
      return { callId: "changed_source", sdp: "changed" };
    },
  };
  await assert.rejects(
    () =>
      dispatchRealtime(
        req({ ...payload, requestId: randomUUID() }),
        path,
        changed,
      ),
    /changed while voice/,
  );
  assert.equal(closes, 2);
  await c.owner(`studies/${c.s.id}/responses/${c.i.id}`, "DELETE");
  assert.equal(await c.local.get("realtimeCall", a.id), undefined);
  await closeRealtime(a.id, false, deps.hangup);
  assert.equal(closes, 2);
});
test("screen help requires explicit image consent/current capture, keeps only bounded guidance/digests, deduplicates provider calls and rejects stale sources", async () => {
  const c = await richerFixture();
  const { dispatchTaskProbe } = await import("../src/lib/task-probe-server");
  const h = c.headers,
    capture = (
      await c.person(
        c.root + "/captures",
        "POST",
        { version: 0, consent: true },
        h,
      )
    ).capture;
  const jpeg = await sharp({
      create: { width: 160, height: 90, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer(),
    payload = {
      requestId: randomUUID(),
      version: 0,
      aiConsent: true,
      image: "data:image/jpeg;base64," + jpeg.toString("base64"),
    },
    path = ["interviews", c.i.id, "captures", capture.id, "live-probe"];
  let calls = 0;
  const deps = {
    ready: () => true,
    model: () => "marked-vision-fixture",
    generate: async () => {
      calls++;
      return {
        question: "What can you see on this screen?",
        visibleContext: "A white screen.",
        uncertainty: "No interface text is visible.",
      };
    },
  };
  const req = (input = payload) =>
    new Request("http://localhost/api/" + path.join("/"), {
      method: "POST",
      headers: h,
      body: JSON.stringify(input),
    });
  await assert.rejects(() =>
    dispatchTaskProbe(req({ ...payload, aiConsent: false }), path, deps),
  );
  assert.equal(calls, 0);
  const r = await (await dispatchTaskProbe(req(), path, deps))!.json();
  assert.ok(r.guidance.question);
  await dispatchTaskProbe(req(), path, deps);
  assert.equal(calls, 1);
  const doc = await c.local.get<any>("taskProbe", r.id);
  assert.equal(doc.image, undefined);
  assert.ok(doc.imageDigest);
  assert.equal(doc.model, "marked-vision-fixture");
  const view = await c.owner(`studies/${c.s.id}/usability`);
  assert.equal(view.guidance.length, 1);
  const file = await c.owner(`studies/${c.s.id}/usability/export`, "POST", {
    signature: view.signature,
    reviewed: true,
    format: "guidance",
  });
  assert.ok(
    file.bytes
      .toString()
      .includes("optional_AI_guidance_not_participant_evidence"),
  );
  await assert.rejects(
    () =>
      dispatchTaskProbe(
        req({ ...payload, requestId: randomUUID() }),
        path,
        deps,
      ),
    /thirty seconds/,
  );
  await c.person(
    c.root + "/captures/" + capture.id + "/finish",
    "POST",
    { status: "stopped" },
    h,
  );
  await assert.rejects(() => dispatchTaskProbe(req(), path, deps), /changed/);
  await c.owner(`studies/${c.s.id}/responses/${c.i.id}`, "DELETE");
  assert.equal(await c.local.get("taskProbe", r.id), undefined);
});
test("a screen proposal returning after response erasure cannot save guidance or recreate its source", async () => {
  const c = await richerFixture();
  const { dispatchTaskProbe } = await import("../src/lib/task-probe-server");
  const capture = (
    await c.person(
      c.root + "/captures",
      "POST",
      { version: 0, consent: true },
      c.headers,
    )
  ).capture;
  const jpeg = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "white" },
  })
    .jpeg()
    .toBuffer();
  const req = new Request("http://localhost/api/probe", {
    method: "POST",
    headers: c.headers,
    body: JSON.stringify({
      requestId: randomUUID(),
      version: 0,
      aiConsent: true,
      image: "data:image/jpeg;base64," + jpeg.toString("base64"),
    }),
  });
  const deps = {
    ready: () => true,
    model: () => "marked-vision-fixture",
    generate: async () => {
      await c.owner(`studies/${c.s.id}/responses/${c.i.id}`, "DELETE");
      return {
        question: "What do you see?",
        visibleContext: "A white screen.",
        uncertainty: "No text visible.",
      };
    },
  };
  await assert.rejects(
    () =>
      dispatchTaskProbe(
        req,
        ["interviews", c.i.id, "captures", capture.id, "live-probe"],
        deps,
      ),
    /changed/,
  );
  assert.equal(
    (await c.owner(`studies/${c.s.id}/usability`)).guidance.length,
    0,
  );
});

test("a provider hangup outage cannot block private recording erasure; content-free cleanup retries independently", async () => {
  const c = await richerFixture();
  const { cleanDeletions } = await import("../src/lib/features");
  const { ensureRecording, readRecording } = await import("../src/lib/storage");
  const file = randomUUID(),
    id = randomUUID();
  await ensureRecording(
    file,
    Buffer.from("synthetic private recording bytes"),
    "audio/wav",
  );
  await c.local.put("deletion", {
    id,
    workspaceId: c.actor.workspaceId,
    studyId: c.s.id,
    files: [file],
    realtimeCalls: ["marked_unavailable_call"],
    createdAt: new Date().toISOString(),
  });
  await cleanDeletions(async () => {
    throw Error("marked provider outage");
  });
  await assert.rejects(() => readRecording(file));
  assert.ok(await c.local.get("deletion", id));
  await cleanDeletions(async () => {});
  assert.equal(await c.local.get("deletion", id), undefined);
});
