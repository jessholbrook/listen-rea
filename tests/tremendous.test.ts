import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { start, stop, base, client } from "./harness";
import { tremendousSetup } from "./tremendous-fixture";
import { minorUnits, sandboxRewardUrl } from "../src/lib/tremendous";
import {
  tremendousBinding,
  tremendousTransport,
} from "../src/lib/tremendous-provider";
before(() => start({ port: 3446 }), { timeout: 90000 });
after(stop);
const rejects = async (fn: () => Promise<unknown>, status: number) =>
  assert.rejects(fn, (e) => (e as any).status === status);
test("sandbox transport rejects production keys, unbound workspaces and forbidden operations; currency parser and link origin are strict", async () => {
  const keys = [
      "RESEARCH_TREMENDOUS_SANDBOX_API_KEY",
      "RESEARCH_TREMENDOUS_ECHO_WORKSPACE_ID",
      "RESEARCH_TREMENDOUS_SANDBOX_ORGANIZATION_ID",
      "RESEARCH_TREMENDOUS_SANDBOX_ENABLED",
    ],
    old = keys.map((k) => process.env[k]);
  try {
    process.env[keys[0]] = "PROD_marked-not-a-real-key";
    process.env[keys[1]] = "workspace";
    process.env[keys[2]] = "ORG123456789";
    process.env[keys[3]] = "true";
    assert.equal(tremendousBinding("workspace"), null);
    process.env[keys[0]] = "TEST_marked-not-a-real-key";
    assert.ok(tremendousBinding("workspace"));
    assert.equal(tremendousBinding("foreign"), null);
    await assert.rejects(
      () => tremendousTransport.request("workspace", "invoices", "POST", {}),
      /OPERATION_UNAVAILABLE/,
    );
    process.env[keys[3]] = "false";
    assert.equal(tremendousBinding("workspace"), null);
  } finally {
    keys.forEach((k, n) => {
      if (old[n] === undefined) delete process.env[k];
      else process.env[k] = old[n];
    });
  }
  assert.equal(minorUnits(10.29), 1029);
  assert.throws(() => minorUnits(1.001));
  assert.throws(() => minorUnits(-1));
  assert.equal(
    sandboxRewardUrl(
      "https://testflight.tremendous.com/rewards/payout/test-secret",
    ),
    "https://testflight.tremendous.com/rewards/payout/test-secret",
  );
  for (const url of [
    "https://testflight.tremendous.com.evil.test/rewards/payout/x",
    "https://api.tremendous.com/rewards/payout/x",
    "https://testflight.tremendous.com/rewards/payout/x?next=evil",
    "http://testflight.tremendous.com/rewards/payout/x",
  ])
    assert.throws(() => sandboxRewardUrl(url));
});
test("concurrent exact orders reserve one obligation and make one sandbox mutation; claim is participant-only, link-free in stored data and exports", async () => {
  const c = await tremendousSetup();
  const results = await Promise.all([
    c.ask("order", "POST", c.input),
    c.ask("order", "POST", c.input),
  ]);
  assert.ok(results.every((r) => r!.status === 200));
  assert.equal(
    c.calls.filter((v) => v.path === "orders" && v.method === "POST").length,
    1,
  );
  const view = await c.view(),
    order = view.orders[0];
  assert.equal(order.environment, "sandbox");
  assert.equal(order.orderStatus, "EXECUTED");
  assert.equal(order.redemptionStatus, "not_observed");
  assert.equal(view.reservedMinor, 2500);
  assert.equal(
    (await c.owner(`studies/${c.study.id}/incentives`)).rows[0].status,
    "approved",
  );
  const payload = c.calls.find((v) => v.path === "orders")!.data;
  assert.deepEqual(payload.payment, { funding_source_id: "BALANCE" });
  assert.equal(payload.reward.delivery.method, "LINK");
  assert.equal(payload.reward.recipient.email, undefined);
  assert.equal((await (await c.claim())!.json()).available, true);
  await rejects(() => c.claim("POST", { consent: true }, "wrong"), 404);
  await assert.rejects(() => c.claim("POST", { consent: false }));
  const response = (await c.claim("POST", { consent: true }))!;
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.ok((await response.json()).url.endsWith("marked-claim-secret"));
  const raw = await c.local.db
    .prepare(
      "SELECT data FROM documents WHERE kind='tremendousOrder' AND workspace_id=?",
    )
    .all(c.actor.workspaceId);
  const exportText = await (await c.ask("export"))!.text();
  for (const s of [
    JSON.stringify(raw),
    JSON.stringify(await c.view()),
    exportText,
    JSON.stringify(await c.owner(`studies/${c.study.id}/incentives`)),
  ]) {
    assert.ok(!s.includes("initial-secret"));
    assert.ok(!s.includes("marked-claim-secret"));
    assert.ok(!s.includes("do-not-store@example.test"));
  }
});
test("unconfigured, foreign and departed admin gates fail closed before reservation; plans can be prepared without an account", async () => {
  const c = await tremendousSetup();
  c.setEnabled(false);
  const before = c.calls.length;
  await rejects(() => c.ask("order", "POST", c.input), 503);
  assert.equal(c.calls.length, before);
  assert.equal((await c.view()).orders.length, 0);
  const anon = await client();
  assert.equal((await anon(c.root)).status, 401);
  const other = await client();
  await other("auth/signup", "POST", {
    name: "Foreign",
    email: randomUUID() + "@example.test",
    password: "foreign-sandbox-password",
  });
  assert.equal((await other(c.root)).status, 404);
  await c.local.db
    .prepare("UPDATE users SET role='researcher' WHERE id=?")
    .run(c.actor.id);
  await rejects(
    () => c.ask("", "PUT", { version: 1, plan: c.plan, reviewed: true }),
    403,
  );
});
test("insufficient funds is distinct from unknown outcomes; explicit frozen retry keeps the same external ID; no automatic replacement", async () => {
  const c = await tremendousSetup();
  c.setFailure(402);
  assert.equal(
    (await (await c.ask("order", "POST", c.input))!.json()).order.state,
    "insufficient_funds",
  );
  c.setFailure(undefined);
  assert.equal(
    (await (await c.ask("order", "POST", c.input))!.json()).order.state,
    "insufficient_funds",
  );
  assert.equal(c.calls.filter((v) => v.path === "orders").length, 1);
  await c.ask("retry", "POST", c.input);
  const writes = c.calls.filter((v) => v.path === "orders");
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].data, writes[1].data);
  assert.equal((await c.view()).orders[0].orderStatus, "EXECUTED");
  const lost = await tremendousSetup(c);
  lost.setFailure("lost");
  await lost.ask("order", "POST", lost.input);
  assert.equal((await lost.view()).orders[0].state, "unknown");
  await rejects(() => lost.ask("retry", "POST", lost.input), 409);
  await lost.ask("sync", "POST", {});
  assert.equal((await lost.view()).orders[0].state, "observed");
  assert.equal(lost.calls.filter((v) => v.path === "orders").length, 1);
});
test("pending and failed provider states never become available rewards; unknown redemption remains separate", async () => {
  let previous: Awaited<ReturnType<typeof tremendousSetup>> | undefined;
  for (const status of ["OPEN", "PENDING APPROVAL", "FAILED", "CANCELED"]) {
    const c = await tremendousSetup(previous);
    previous = c;
    c.setStatus(status);
    await c.ask("order", "POST", c.input);
    assert.equal((await (await c.claim())!.json()).available, false);
    await rejects(() => c.claim("POST", { consent: true }), 409);
    assert.equal(
      c.calls.filter((v) => v.path.includes("generate_link")).length,
      0,
    );
  }
});
test("changed approval, source exclusion, wrong organization, changed binding and reviewed budget stop new orders and claims", async () => {
  const c = await tremendousSetup();
  c.setOrganization("OTHERORG1234");
  await rejects(() => c.ask("order", "POST", c.input), 409);
  assert.equal((await c.view()).orders.length, 0);
  c.setOrganization("ORG123456789");
  await c.ask("", "PUT", {
    version: 1,
    plan: { ...c.plan, maxValueMinor: 2000 },
    reviewed: true,
  });
  await rejects(
    () => c.ask("order", "POST", { ...c.input, planVersion: 2 }),
    409,
  );
  await c.ask("", "PUT", { version: 2, plan: c.plan, reviewed: true });
  await c.ask("order", "POST", { ...c.input, planVersion: 3 });
  c.setBinding("rotated-binding");
  await rejects(() => c.ask("sync", "POST", {}), 409);
  c.setBinding("marked-sandbox-binding");
  await c.owner(`studies/${c.study.id}/responses/${c.source}`, "PATCH", {
    excluded: true,
    reason: "Synthetic quality hold",
  });
  await rejects(() => c.claim("POST", { consent: true }), 409);
  await c.owner(`studies/${c.study.id}/responses/${c.source}`, "PATCH", {
    excluded: false,
    reason: "",
  });
  await c.owner(`studies/${c.study.id}/incentives/${c.source}`, "POST", {
    requestId: randomUUID(),
    version: 1,
    action: "decline",
    reason: "Review changed",
  });
  await rejects(() => c.claim(), 409);
});
test("panel/handoff participants and manual payments cannot receive sandbox orders", async () => {
  const c = await tremendousSetup();
  const i = await c.local.get<any>("interview", c.source, c.actor.workspaceId);
  await c.local.put("interview", { ...i, handoffId: "marked-panel-claim" });
  await rejects(() => c.ask("order", "POST", c.input), 409);
  await c.local.put("interview", i);
  await c.owner(`studies/${c.study.id}/incentives/${c.source}`, "POST", {
    requestId: randomUUID(),
    version: 1,
    action: "record_payment",
    reason: "Recorded externally",
    payment: {
      reference: "manual-" + randomUUID(),
      method: "cash",
      paidAt: new Date().toISOString(),
    },
  });
  await rejects(() => c.ask("order", "POST", c.input), 409);
  assert.equal(c.calls.filter((v) => v.path === "orders").length, 0);
});
test("source erasure during creation or later reconciliation cannot restore order/claim data; unlinked spent hashes survive", async () => {
  let previous: Awaited<ReturnType<typeof tremendousSetup>> | undefined;
  for (const phase of ["create", "sync"]) {
    const c = await tremendousSetup(previous);
    previous = c;
    if (phase === "sync") await c.ask("order", "POST", c.input);
    c.setHook(async () => {
      assert.equal(
        (await c.owner(`studies/${c.study.id}/responses/${c.source}`, "DELETE"))
          .status,
        200,
      );
    });
    if (phase === "create")
      await rejects(() => c.ask("order", "POST", c.input), 409);
    else await c.ask("sync", "POST", {});
    assert.equal((await c.view()).orders.length, 0);
    await rejects(() => c.claim("POST", { consent: true }), 404);
    const spent = await c.local.list<any>(
      "tremendousSpent",
      c.actor.workspaceId,
    );
    assert.equal(spent.length, phase === "create" ? 1 : 2);
    assert.equal(spent[0].interviewId, undefined);
    assert.equal(spent[0].studyId, undefined);
    assert.ok(!JSON.stringify(spent).includes(c.source));
  }
});
test("signed sandbox webhooks deduplicate raw events and enqueue read-only reconciliation; out-of-order events never assert payment or redemption", async () => {
  const c = await tremendousSetup();
  await c.ask("order", "POST", c.input);
  const { tremendousWebhook } = await import("../src/lib/tremendous-webhook"),
    { runTremendousWake } = await import("../src/lib/tremendous-queue");
  const values: Record<string, string> = {
      RESEARCH_TREMENDOUS_ECHO_WORKSPACE_ID: c.actor.workspaceId,
      RESEARCH_TREMENDOUS_SANDBOX_API_KEY: "TEST_marked-not-real",
      RESEARCH_TREMENDOUS_SANDBOX_ORGANIZATION_ID: "ORG123456789",
      RESEARCH_TREMENDOUS_SANDBOX_ENABLED: "true",
      RESEARCH_TREMENDOUS_SANDBOX_WEBHOOK_SECRET:
        "marked-sandbox-webhook-secret",
    },
    old = Object.fromEntries(
      Object.keys(values).map((k) => [k, process.env[k]]),
    );
  Object.assign(process.env, values);
  try {
    const raw = JSON.stringify({
      event: "REWARDS.DELIVERY.FAILED",
      uuid: randomUUID(),
      created_utc: new Date().toISOString(),
      payload: {
        resource: { id: "REWARD123456", type: "rewards" },
        meta: { link: "never-persist-this-secret" },
      },
    });
    const request = (valid = true) =>
      new Request(base + "/api/webhooks/tremendous", {
        method: "POST",
        headers: {
          "tremendous-webhook-signature":
            "sha256=" +
            (valid
              ? createHmac(
                  "sha256",
                  values.RESEARCH_TREMENDOUS_SANDBOX_WEBHOOK_SECRET,
                )
                  .update(raw)
                  .digest("hex")
              : "0".repeat(64)),
        },
        body: raw,
      });
    let enqueued = 0;
    assert.equal(
      (
        await tremendousWebhook(request(false), async () => {
          enqueued++;
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await tremendousWebhook(request(), async () => {
          enqueued++;
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await (
          await tremendousWebhook(request(), async () => {
            enqueued++;
          })
        ).json()
      ).duplicate,
      true,
    );
    assert.equal(enqueued, 1);
    const wake = (
      await c.local.list<any>("tremendousWake", c.actor.workspaceId)
    )[0];
    const before = c.calls.filter((v) => v.method === "POST").length;
    await runTremendousWake(
      c.study.id,
      wake.generation,
      c.provider,
      async () => {},
    );
    assert.equal(c.calls.filter((v) => v.method === "POST").length, before);
    assert.equal((await c.view()).orders[0].orderStatus, "EXECUTED");
    const events = await c.local.list<any>(
      "tremendousEvent",
      c.actor.workspaceId,
    );
    assert.equal(events.length, 1);
    assert.ok(!JSON.stringify(events).includes("never-persist-this-secret"));
  } finally {
    for (const [k, v] of Object.entries(old)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
let sharedOverlapContext: Awaited<ReturnType<typeof tremendousSetup>>;
test("a late earlier provider read cannot restore EXECUTED after a newer cancellation; claims recheck current provider status", async () => {
  const c = await tremendousSetup();
  await c.ask("order", "POST", c.input);
  sharedOverlapContext = c;
  c.setHook(async () => {
    const remote = [...c.orders.values()][0];
    remote.order.status = "CANCELED";
    await c.ask("sync", "POST", {});
  });
  await c.ask("sync", "POST", {});
  assert.equal((await c.view()).orders[0].orderStatus, "CANCELED");
  await rejects(() => c.claim("POST", { consent: true }), 409);
  assert.equal(
    c.calls.filter((v) => v.path.includes("generate_link")).length,
    0,
  );
});

test("bounded reconciliation rotates unresolved references so they cannot starve later known orders", async () => {
  // New login would hit the intentional signup limit: create one shared owner for the final two scenarios instead.
  const c = await tremendousSetup(sharedOverlapContext);
  await c.ask("order", "POST", c.input);
  const real = (
    await c.local.list<any>("tremendousOrder", c.actor.workspaceId, c.study.id)
  )[0];
  for (let n = 0; n < 5; n++) {
    const id = c.local.hash("marked-unresolved-" + n + c.study.id);
    await c.local.put("tremendousOrder", {
      ...real,
      id,
      externalId: "marked_missing_" + n,
      orderId: undefined,
      rewardId: undefined,
      state: "unknown",
      lastSyncedAt: undefined,
      lastReadAt: undefined,
      createdAt: "2026-01-01T00:00:00Z",
    });
  }
  await rejects(() => c.ask("sync", "POST", {}), 409);
  const firstReadCount = c.calls.filter(
    (v) => v.path === "orders/" + real.externalId,
  ).length;
  await rejects(() => c.ask("sync", "POST", {}), 409);
  assert.equal(
    c.calls.filter((v) => v.path === "orders/" + real.externalId).length,
    firstReadCount + 1,
  );
  assert.equal(c.calls.filter((v) => v.path === "orders").length, 1);
});
