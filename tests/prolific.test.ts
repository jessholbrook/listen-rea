import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { start, stop, base, client } from "./harness";
import { prolificSetup } from "./prolific-fixture";
import {
  projectedCost,
  reviewDeadline,
  prolificConfigInput,
} from "../src/lib/prolific";
before(() => start({ port: 3444 }), { timeout: 90000 });
after(stop);
test("Prolific minor-unit cost parsing includes rewards, fees and tax and rejects incomplete/cross-currency budgets; review deadlines use independent 21-day reference", () => {
  assert.equal(
    projectedCost(
      {
        rewards: {
          rewards: { amount: 3000, currency: "USD" },
          fees: { amount: 1284, currency: "USD" },
          tax: { amount: 0, currency: "USD" },
        },
      },
      "USD",
    ),
    4284,
  );
  assert.throws(() =>
    projectedCost(
      { rewards: { rewards: { amount: 100, currency: "GBP" } } },
      "USD",
    ),
  );
  assert.throws(() =>
    projectedCost(
      {
        rewards: {
          rewards: { amount: 100, currency: "USD" },
          fees: { amount: 0.5, currency: "USD" },
          tax: { amount: 0, currency: "USD" },
        },
      },
      "USD",
    ),
  );
  assert.equal(
    reviewDeadline("AWAITING REVIEW", "2026-10-01T12:00:00Z"),
    "2026-10-22T12:00:00.000Z",
  );
  assert.equal(reviewDeadline("APPROVED", "2026-10-01T12:00:00Z"), null);
});
test("reviewed provider drafts and no-credit test clones use separate IDs, manual completion actions and exact retry receipts without any paid launch", async () => {
  const c = await prolificSetup(),
    cfg = await c.current(),
    input = {
      requestId: randomUUID(),
      version: cfg.version,
      kind: "create",
      reviewed: true,
    };
  const created = await (await c.ask("operations", "POST", input))!.json();
  assert.equal(created.config.draftId, "vendor_draft");
  assert.equal(
    (await (await c.ask("operations", "POST", input))!.json()).operation.id,
    created.operation.id,
  );
  assert.equal(
    c.calls.filter((v) => v.method === "POST" && v.path === "studies/").length,
    1,
  );
  const request = c.calls.find(
    (v) => v.method === "POST" && v.path === "studies/",
  )!.data;
  assert.deepEqual(request.completion_codes[0].actions, [
    { action: "MANUALLY_REVIEW" },
  ]);
  assert.deepEqual(request.filters, []);
  assert.equal(
    (await c.owner("studies/" + c.study.id)).study.fielding,
    "active",
  );
  const launched = await (await c.operation("test"))!.json();
  assert.equal(launched.config.activeId, "vendor_test");
  assert.equal(launched.config.mode, "test");
  assert.equal(launched.config.admissionsEnabled, true);
  assert.equal(
    c.calls.some((v) => v.method === "POST" && v.data?.action === "PUBLISH"),
    false,
  );
  const info = await c.owner("public/" + c.study.id);
  assert.equal(info.prolificHandoff, true);
  const a = await client(),
    payload = {
      consent: true,
      attributes: {
        PROLIFIC_PID: "participant_1",
        SESSION_ID: "submission_1",
        segment: "Synthetic",
      },
      surveyHandoff: {
        provider: "prolific",
        responseId: "participant_1",
        externalStudyId: "vendor_test",
        sessionId: "submission_1",
        secret: "ab".repeat(32),
      },
    };
  const joined = await a("public/" + c.study.id, "POST", payload);
  assert.equal(joined.status, 201);
  assert.equal(joined.interview.attributes.PROLIFIC_PID, undefined);
  assert.equal(joined.interview.attributes.SESSION_ID, undefined);
  assert.equal(
    (await a("public/" + c.study.id, "POST", payload)).token,
    joined.token,
  );
  assert.equal(
    (
      await a("public/" + c.study.id, "POST", {
        ...payload,
        surveyHandoff: {
          ...payload.surveyHandoff,
          sessionId: "different_session",
        },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await a("public/" + c.study.id, "POST", {
        ...payload,
        surveyHandoff: {
          ...payload.surveyHandoff,
          responseId: "other",
          externalStudyId: "wrong_study",
        },
      })
    ).status,
    409,
  );
  await a(
    "interviews/" + joined.interview.id + "/answer",
    "POST",
    {
      requestId: randomUUID(),
      version: 0,
      answer: "Synthetic Prolific response, manually typed.",
    },
    { "x-interview-token": joined.token },
  );
  await c.operation("pause");
  const destination = await a(
    "interviews/" + joined.interview.id + "/survey-handoff",
    "GET",
    undefined,
    { "x-interview-token": joined.token },
  );
  assert.equal(destination.destination.provider, "prolific");
  assert.equal(
    new URL(destination.destination.url).searchParams.get("cc"),
    cfg.code,
  );
  assert.equal(
    new URL(destination.destination.url).searchParams.has("ResponseID"),
    false,
  );
});
test("paid and test launch gates reject unconfigured access, stale plans, changed/cross-currency quotes and over-budget launches before any funded write", async () => {
  const c = await prolificSetup();
  assert.equal((await c.owner(c.root)).connected, false);
  assert.equal(
    (
      await c.owner(c.root + "/operations", "POST", {
        requestId: randomUUID(),
        version: 1,
        kind: "create",
        reviewed: true,
      })
    ).status,
    503,
  );
  const outsider = await client();
  await outsider("auth/signup", "POST", {
    name: "Other",
    email: randomUUID() + "@example.test",
    password: "prolific-test-password",
  });
  assert.equal((await outsider(c.root)).status, 404);
  await c.operation("create");
  c.test(false);
  await assert.rejects(() => c.operation("test"), /No-credit test access/);
  await assert.rejects(
    () => c.operation("paid", { fundedAndBudgetReviewed: true }),
    /Paid launch is disabled/,
  );
  c.paid(true);
  const cfg = await c.current();
  await c.ask("quote", "POST", { version: cfg.version });
  const quoted = await c.current();
  assert.equal(quoted.quote.totalMinor, 857);
  c.cost({
    rewards: {
      rewards: { amount: 600, currency: "USD" },
      fees: { amount: 500, currency: "USD" },
      tax: { amount: 0, currency: "USD" },
    },
  });
  await assert.rejects(
    () =>
      c.operation("paid", {
        fundedAndBudgetReviewed: true,
        quoteId: quoted.quote.id,
      }),
    /quote changed or exceeds/,
  );
  assert.equal(
    c.calls.some((v) => v.method === "POST" && v.data?.action === "PUBLISH"),
    false,
  );
  c.cost({
    rewards: {
      rewards: { amount: 600, currency: "GBP" },
      fees: { amount: 257, currency: "GBP" },
      tax: { amount: 0, currency: "GBP" },
    },
  });
  await assert.rejects(() =>
    c.ask("quote", "POST", { version: quoted.version }),
  );
  assert.equal(
    c.calls.some((v) =>
      /submissions\/.*transition|bonuses|messages/.test(v.path),
    ),
    false,
  );
});
test("ambiguous provider creates stay held across new request IDs and resolve only to a matching unpublished draft; updates stay unpublished", async () => {
  const c = await prolificSetup();
  c.lose(true);
  await assert.rejects(() => c.operation("create"), /outcome is uncertain/);
  await assert.rejects(() => c.operation("create"), /unresolved/);
  assert.equal(
    c.calls.filter((v) => v.method === "POST" && v.path === "studies/").length,
    1,
  );
  c.remotes.set("wrong", {
    ...c.remotes.get("vendor_draft"),
    id: "wrong",
    reward: 999,
  });
  await assert.rejects(
    () =>
      c.ask("resolve", "POST", {
        version: 1,
        remoteId: "wrong",
        reviewed: true,
      }),
    /differs from/,
  );
  await c.ask("resolve", "POST", {
    version: 1,
    remoteId: "vendor_draft",
    reviewed: true,
  });
  let cfg = await c.current();
  assert.equal(cfg.admissionsEnabled, false);
  const s = (await c.owner("studies/" + c.study.id)).study;
  await c.ask("", "PUT", {
    version: cfg.version,
    studyVersion: s.version,
    config: { ...c.config, title: "Revised recruitment" },
    reviewed: true,
  });
  await c.operation("update");
  cfg = await c.current();
  assert.equal(cfg.providerStatus, "UNPUBLISHED");
  assert.equal(c.remotes.get("vendor_draft").name, "Revised recruitment");
});
test("submission reconciliation separates inclusion, identity, provider approval and reported payment; source erasure prevents cached/webhook reappearance and late writes", async () => {
  const c = await prolificSetup();
  await c.operation("create");
  await c.operation("test");
  const person = await client(),
    payload = {
      consent: true,
      surveyHandoff: {
        provider: "prolific",
        responseId: "participant_1",
        externalStudyId: "vendor_test",
        sessionId: "submission_1",
        secret: "ab".repeat(32),
      },
    },
    joined = await person("public/" + c.study.id, "POST", payload),
    h = { "x-interview-token": joined.token };
  await person(
    "interviews/" + joined.interview.id + "/answer",
    "POST",
    {
      requestId: randomUUID(),
      version: 0,
      answer: "Synthetic source for provider reconciliation.",
    },
    h,
  );
  c.submissions([
    {
      id: "submission_1",
      participant_id: "participant_1",
      status: "AWAITING REVIEW",
      started_at: "2026-10-01T11:45:00Z",
      completed_at: "2026-10-01T12:00:00Z",
      payment_info: { status: "pending" },
    },
  ]);
  await c.sync();
  let data = await (await c.ask())!.json();
  assert.equal(data.rows[0].identityMatched, true);
  assert.equal(data.rows[0].reviewDeadline, "2026-10-22T12:00:00.000Z");
  assert.equal(data.rows[0].payment, "pending");
  await c.owner(
    `studies/${c.study.id}/responses/${joined.interview.id}`,
    "PATCH",
    { excluded: true, reason: "Synthetic quality review" },
  );
  await c.sync();
  data = await (await c.ask())!.json();
  assert.equal(data.rows[0].excluded, true);
  assert.equal(data.rows[0].payment, "pending");
  c.beforeSyncCommit(async () => {
    await c.owner(
      `studies/${c.study.id}/responses/${joined.interview.id}`,
      "DELETE",
    );
  });
  await assert.rejects(() => c.sync(), /sources or connection changed/);
  await c.sync();
  data = await (await c.ask())!.json();
  assert.deepEqual(data.rows, []);
  assert.equal(data.config.admissionsEnabled, false);
  assert.equal(
    (await person("public/" + c.study.id, "POST", payload)).status,
    409,
  );
  const claims = await c.local.list<any>(
    "surveyHandoff",
    c.actor.workspaceId,
    c.study.id,
  );
  assert.equal(claims[0].responseId, "");
  assert.equal(claims[0].sessionId, undefined);
  const csv = await c.owner(c.root + "/export");
  assert.equal(csv.status, 200);
  assert.equal(
    c.calls.some(
      (v) => v.method === "POST" && /submissions|bonuses/.test(v.path),
    ),
    false,
  );
});
test("signed webhooks keep content-free deduplicated receipts and durable queue wakes without trusting event statuses or storing participant identifiers", async () => {
  const c = await prolificSetup();
  await c.operation("create");
  const { prolificWebhook } = await import("../src/lib/prolific-webhook"),
    oldWorkspace = process.env.RESEARCH_PROLIFIC_ECHO_WORKSPACE_ID,
    oldSecret = process.env.RESEARCH_PROLIFIC_WEBHOOK_SECRET;
  process.env.RESEARCH_PROLIFIC_ECHO_WORKSPACE_ID = c.actor.workspaceId;
  process.env.RESEARCH_PROLIFIC_WEBHOOK_SECRET =
    "marked-webhook-test-secret-only";
  try {
    const timestamp = String(Math.floor(Date.now() / 1000)),
      eventId = randomUUID(),
      body = JSON.stringify({
        event_type: "submission.status.change",
        resource_id: "secret_submission",
        participant_id: "secret_participant",
        status: "APPROVED",
      });
    const signature = createHmac(
      "sha256",
      process.env.RESEARCH_PROLIFIC_WEBHOOK_SECRET!,
    )
      .update(timestamp + body)
      .digest("base64");
    const req = (sig = signature, ts = timestamp) =>
      new Request(base + "/api/webhooks/prolific", {
        method: "POST",
        headers: {
          "x-event-id": eventId,
          "x-prolific-request-timestamp": ts,
          "x-prolific-request-signature": sig,
        },
        body,
      });
    let queued = 0;
    const enqueue = async () => {
      queued++;
    };
    assert.equal((await prolificWebhook(req("bad"), enqueue)).status, 401);
    assert.equal(
      (await prolificWebhook(req(signature, "1000000000"), enqueue)).status,
      401,
    );
    assert.equal(
      (await (await prolificWebhook(req(), enqueue)).json()).duplicate,
      false,
    );
    assert.equal(
      (await (await prolificWebhook(req(), enqueue)).json()).duplicate,
      true,
    );
    assert.equal(queued, 1);
    const events = await c.local.list<any>(
        "prolificEvent",
        c.actor.workspaceId,
      ),
      wakes = await c.local.list<any>("prolificWake", c.actor.workspaceId);
    assert.equal(events.length, 1);
    assert.equal(JSON.stringify(events).includes("secret_participant"), false);
    assert.equal(JSON.stringify(events).includes("secret_submission"), false);
    assert.equal(wakes.length, 1);
    assert.equal(wakes[0].state, "pending");
  } finally {
    if (oldWorkspace === undefined)
      delete process.env.RESEARCH_PROLIFIC_ECHO_WORKSPACE_ID;
    else process.env.RESEARCH_PROLIFIC_ECHO_WORKSPACE_ID = oldWorkspace;
    if (oldSecret === undefined)
      delete process.env.RESEARCH_PROLIFIC_WEBHOOK_SECRET;
    else process.env.RESEARCH_PROLIFIC_WEBHOOK_SECRET = oldSecret;
  }
});
test("enabled paid launch rechecks an exact quote, starts only its original draft once, and permits a safe pause after external edits", async () => {
  const c = await prolificSetup();
  await c.operation("create");
  c.paid(true);
  const initial = await c.current();
  await c.ask("quote", "POST", { version: initial.version });
  const quoted = await c.current();
  const input = {
    version: quoted.version,
    kind: "paid",
    reviewed: true,
    fundedAndBudgetReviewed: true,
    quoteId: quoted.quote.id,
    requestId: randomUUID(),
  };
  const result = await (await c.ask("operations", "POST", input))!.json();
  assert.equal(result.config.activeId, "vendor_draft");
  assert.equal(result.config.mode, "paid");
  await c.ask("operations", "POST", input);
  assert.equal(c.calls.filter((v) => v.data?.action === "PUBLISH").length, 1);
  c.remotes.get("vendor_draft").description = "An external dashboard edit";
  await c.operation("pause");
  assert.equal((await c.current()).providerStatus, "PAUSED");
  assert.equal((await c.current()).admissionsEnabled, false);
});
test("read-only queue reconciliation retains an event arriving during work and schedules a fresh generation without any provider writes", async () => {
  const c = await prolificSetup();
  await c.operation("create");
  const { requestProlificWake, runProlificWake } =
    await import("../src/lib/prolific-queue");
  const previous = process.env.RESEARCH_PROLIFIC_ECHO_WORKSPACE_ID;
  process.env.RESEARCH_PROLIFIC_ECHO_WORKSPACE_ID = c.actor.workspaceId;
  try {
    const published: string[] = [],
      publish = async (_id: string, generation: string) => {
        published.push(generation);
      };
    await requestProlificWake(await c.current(), publish);
    const first = (
      await c.local.list<any>("prolificWake", c.actor.workspaceId)
    )[0];
    c.beforeSyncCommit(async () => {
      const w = await c.local.get<any>(
        "prolificWake",
        c.study.id,
        c.actor.workspaceId,
      );
      await c.local.put("prolificWake", { ...w, dirty: true });
    });
    const beforeWrites = c.calls.filter((v) => v.method !== "GET").length;
    await runProlificWake(c.study.id, first.generation, c.provider, publish);
    const next = (
      await c.local.list<any>("prolificWake", c.actor.workspaceId)
    )[0];
    assert.notEqual(next.generation, first.generation);
    assert.equal(next.state, "pending");
    assert.equal(published.length, 2);
    await runProlificWake(c.study.id, next.generation, c.provider, publish);
    assert.equal(
      (await c.local.list<any>("prolificWake", c.actor.workspaceId)).length,
      0,
    );
    assert.equal(
      c.calls.filter((v) => v.method !== "GET").length,
      beforeWrites,
    );
  } finally {
    if (previous === undefined)
      delete process.env.RESEARCH_PROLIFIC_ECHO_WORKSPACE_ID;
    else process.env.RESEARCH_PROLIFIC_ECHO_WORKSPACE_ID = previous;
  }
});
test("a live Prolific allocation reserves local cohort capacity across ordinary admission paths", async () => {
  const c = await prolificSetup();
  await c.operation("create");
  await c.operation("test");
  const person = await client();
  for (let n = 0; n < 3; n++)
    assert.equal(
      (await person("public/" + c.study.id, "POST", { consent: true })).status,
      201,
    );
  assert.equal(
    (await person("public/" + c.study.id, "POST", { consent: true })).status,
    409,
  );
  for (let n = 0; n < 2; n++)
    assert.equal(
      (
        await person("public/" + c.study.id, "POST", {
          consent: true,
          surveyHandoff: {
            provider: "prolific",
            externalStudyId: "vendor_test",
            responseId: "reserved_person_" + n,
            sessionId: "reserved_session_" + n,
            secret: "ab".repeat(32),
          },
        })
      ).status,
      201,
    );
  assert.equal(
    (await person("public/" + c.study.id, "POST", { consent: true })).status,
    409,
  );
});
