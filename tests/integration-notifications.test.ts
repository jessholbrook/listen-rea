import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, client } from "./harness";
import { notificationsSetup } from "./notifications-fixture";
import {
  notificationUrl,
  notificationProjection,
} from "../src/lib/integration-notifications";
import {
  notificationAllowed,
  publicNotificationAddress,
} from "../src/lib/notification-transport";
before(() => start({ port: 3450, notifications: true }), { timeout: 90000 });
after(stop);
const rejects = (fn: () => Promise<unknown>, status: number) =>
  assert.rejects(fn, (e) => (e as any).status === status);
test("destination policy rejects credentials, local/private/documentation addresses, queries, redirects-to-private ports and non-approved origins", () => {
  for (const url of [
    "http://receiver.example.com",
    "https://127.0.0.1",
    "https://[::1]",
    "https://user:secret@receiver.example.com",
    "https://receiver.example.com:444/hook",
    "https://receiver.example.com/hook?a=1",
    "https://receiver.example.com/#key",
    "https://x.internal",
  ])
    assert.throws(() => notificationUrl(url));
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.31.1.1",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::ffff:127.0.0.1",
    "fd00::1",
    "fe80::1",
    "2001:db8::1",
  ])
    assert.equal(publicNotificationAddress(ip), false, ip);
  for (const ip of ["8.8.8.8", "76.76.21.21", "2606:4700::1111"])
    assert.equal(publicNotificationAddress(ip), true, ip);
  assert.equal(
    notificationAllowed("https://unapproved.example.com/notify"),
    false,
  );
  const event = notificationProjection("study", null, {
    id: "s",
    version: 1,
    dataVersion: 0,
    revisionId: null,
    fielding: "draft",
    title: "secret title",
    draft: { intro: "private" },
  });
  assert.ok(event);
  assert.ok(!JSON.stringify(event).includes("private"));
  assert.ok(!JSON.stringify(event).includes("secret title"));
});
test("registration is disabled/idempotent/encrypted, requires receiver ownership and current admins, and configuration views never disclose signing keys", async () => {
  const c = await notificationsSetup();
  const initial = c.getEndpoint();
  assert.equal(
    (await (await c.ask("", "POST", c.input))!.json()).endpoint.id,
    initial.id,
  );
  await rejects(
    () => c.ask("", "POST", { ...c.input, name: "changed receiver" }),
    409,
  );
  await rejects(() => c.setEnabled(), 409);
  const anon = await client();
  assert.equal((await anon("notifications")).status, 401);
  const invite = (await c.owner("invites", "POST", { role: "researcher" }))
      .invite,
    reader = await client();
  await reader("auth/signup", "POST", {
    name: "Notification reader",
    email: randomUUID() + "@example.test",
    password: "notification-reader-password",
    invite,
  });
  assert.equal((await reader("notifications")).status, 403);
  await c.verify();
  await c.setEnabled();
  const config = JSON.stringify(await c.current());
  assert.ok(!config.includes(c.secret));
  assert.ok(!config.includes("sealedKey"));
  const raw = await c.local.get<any>(
    "notificationEndpoint",
    initial.id,
    c.actor.workspaceId,
  );
  assert.ok(raw.sealedKey);
  assert.ok(!JSON.stringify(raw).includes(c.secret));
});
test("source changes capture a transactional metadata outbox, rollback creates no delivery, successful HMAC acknowledgments keep stable event IDs", async () => {
  const c = await notificationsSetup();
  await c.verify();
  await c.setEnabled();
  await assert.rejects(() =>
    c.local.transaction(async () => {
      await c.changed();
      throw Error("rollback synthetic mutation");
    }),
  );
  assert.equal((await c.current()).deliveries.length, 0);
  await c.changed();
  let view = await c.current();
  assert.equal(view.deliveries.length, 1);
  const id = view.deliveries[0].id;
  await c.deliver(id);
  view = await c.current();
  assert.equal(view.deliveries[0].state, "delivered");
  assert.equal(view.deliveries[0].attempts, 1);
  const sent = c.calls.at(-1)!;
  c.signature(sent);
  assert.equal(JSON.parse(sent.body).id, view.deliveries[0].eventId);
  assert.equal(JSON.parse(sent.body).sequence, 1);
  assert.ok(!sent.body.includes("Synthetic notification study"));
  assert.ok(!sent.body.includes(c.secret));
  await c.deliver(id);
  assert.equal(
    c.calls.filter((v) => v.headers["Echo-Lab-Verification"] !== "1").length,
    1,
  );
});
test("retryable and ambiguous outcomes back off, duplicate wake deliveries reserve one attempt, same-event retries are bounded and redirects never count as delivery", async () => {
  const c = await notificationsSetup();
  await c.verify();
  await c.setEnabled();
  await c.changed();
  c.setStatus(503);
  await Promise.all([c.drain(), c.drain()]);
  let d = (await c.current()).deliveries[0];
  assert.equal(d.state, "pending");
  assert.equal(d.attempts, 1);
  assert.ok(d.nextAt > Date.now());
  const first = c.calls.at(-1)!;
  c.setLose(true);
  await c.due();
  await c.drain();
  d = (await c.current()).deliveries[0];
  assert.equal(d.state, "pending");
  assert.equal(d.attempts, 2);
  assert.equal(c.calls.at(-1)!.body, first.body);
  assert.equal(
    c.calls.at(-1)!.headers["Echo-Lab-Event-Id"],
    first.headers["Echo-Lab-Event-Id"],
  );
  c.setLose(false);
  c.setStatus(302);
  await c.due();
  await c.drain();
  d = (await c.current()).deliveries[0];
  assert.equal(d.state, "failed");
  assert.equal(d.httpStatus, 302);
  const request = {
    version: d.version,
    requestId: randomUUID(),
    reviewed: true,
  };
  await c.ask("deliveries/" + d.id + "/retry", "POST", request);
  await c.ask("deliveries/" + d.id + "/retry", "POST", request);
  assert.equal((await c.current()).deliveries[0].manualRetries, 1);
  c.setStatus(204);
  await c.due();
  await c.drain();
  assert.equal((await c.current()).deliveries[0].state, "delivered");
});
test("disabling, changing scope, rotating or deleting a destination revokes queued payloads; late completions cannot restore cancelled or erased data", async () => {
  const c = await notificationsSetup();
  await c.verify();
  await c.setEnabled();
  await c.changed();
  let d = (await c.current()).deliveries[0];
  c.setHook(async () => {
    await c.setEnabled(false);
  });
  await c.deliver(d.id);
  d = (await c.current()).deliveries[0];
  assert.equal(d.state, "cancelled");
  assert.equal(
    (await c.local.get<any>("notificationDelivery", d.id, c.actor.workspaceId))
      .payload,
    undefined,
  );
  const e = c.getEndpoint(),
    rotation = { version: e.version, requestId: randomUUID(), reviewed: true };
  const r = await (await c.ask(e.id + "/rotate", "POST", rotation))!.json();
  assert.notEqual(r.signingKey, c.secret);
  assert.equal(r.endpoint.enabled, false);
  assert.equal(r.endpoint.verifiedAt, undefined);
  assert.equal(
    (await (await c.ask(e.id + "/rotate", "POST", rotation))!.json())
      .signingKey,
    r.signingKey,
  );
  await c.current();
  await c.ask(e.id, "DELETE", {
    version: c.getEndpoint().version,
    reviewed: true,
  });
  assert.equal((await c.current()).endpoints.length, 0);
  await rejects(() => c.ask("", "POST", c.input), 410);
});
test("response availability and exclusion/erasure remove private IDs from the outbox and stop late workers without restoring source copies", async () => {
  const c = await notificationsSetup();
  await c.verify();
  await c.setEnabled();
  const joined = await c.completed();
  let raw = (
    await c.local.list<any>("notificationDelivery", c.actor.workspaceId)
  ).filter((d) => d.eventType === "response.changed");
  assert.equal(raw.length, 1);
  assert.equal(raw[0].payload.data.id, joined.interview.id);
  assert.ok(!JSON.stringify(raw).includes("Synthetic private answer"));
  await c.owner(
    `studies/${c.study.id}/responses/${joined.interview.id}`,
    "PATCH",
    { excluded: true, reason: "Synthetic source hold" },
  );
  raw = await c.local.list<any>("notificationDelivery", c.actor.workspaceId);
  assert.ok(!JSON.stringify(raw).includes(joined.interview.id));
  await c.owner(
    `studies/${c.study.id}/responses/${joined.interview.id}`,
    "PATCH",
    { excluded: false, reason: "" },
  );
  const response = (
    await c.local.list<any>("notificationDelivery", c.actor.workspaceId)
  ).find((d) => d.eventType === "response.changed");
  assert.ok(response);
  c.setHook(async () => {
    await c.owner(
      `studies/${c.study.id}/responses/${joined.interview.id}`,
      "DELETE",
    );
  });
  await c.deliver(response.id);
  raw = await c.local.list<any>("notificationDelivery", c.actor.workspaceId);
  assert.ok(!JSON.stringify(raw).includes(joined.interview.id));
  assert.equal(
    await c.local.get("notificationDelivery", response.id, c.actor.workspaceId),
    undefined,
  );
});
test("bounded capacity exposes dropped-event counters and sequencing gaps; current scopes and departed authorizers stop future delivery", async () => {
  const c = await notificationsSetup();
  await c.verify();
  await c.setEnabled();
  await c.changed();
  const e = c.getEndpoint(),
    first = (
      await c.local.list<any>("notificationDelivery", c.actor.workspaceId)
    )[0];
  await c.local.transaction(async () => {
    for (let n = 1; n < 1000; n++)
      await c.local.put("notificationDelivery", {
        ...first,
        id: randomUUID(),
        eventId: randomUUID(),
      });
  });
  await c.changed();
  const view = await c.current();
  assert.equal(view.endpoints[0].dropped, 1);
  assert.equal(view.endpoints[0].sequence, 2);
  assert.equal(
    (await c.local.list("notificationDelivery", c.actor.workspaceId)).length,
    1000,
  );
  await c.local.db
    .prepare("UPDATE users SET role='researcher' WHERE id=?")
    .run(c.actor.id);
  const before = c.calls.length;
  await c.deliver(first.id);
  assert.equal(c.calls.length, before);
  assert.equal(
    (
      await c.local.get<any>(
        "notificationDelivery",
        first.id,
        c.actor.workspaceId,
      )
    ).state,
    "cancelled",
  );
});
test("job events omit target IDs and private errors, deliver only when the scoped job/source remains available, and fresh events wake earlier than delayed retries", async () => {
  const c = await notificationsSetup();
  await c.verify();
  await c.setEnabled();
  const target = await c.local.get<any>(
      "study",
      c.study.id,
      c.actor.workspaceId,
    ),
    id = randomUUID(),
    recording = randomUUID();
  await c.local.put("libraryRecording", {
    id: recording,
    workspaceId: c.actor.workspaceId,
    studyId: target.id,
    status: "uploaded",
  });
  const job = {
    id,
    workspaceId: c.actor.workspaceId,
    studyId: target.id,
    kind: "transcription",
    targetId: recording,
    version: 1,
    state: "queued",
    inputHash: "private-hash",
    error: "private-detail",
  };
  await c.local.put("backgroundJob", job);
  const d = (
    await c.local.list<any>("notificationDelivery", c.actor.workspaceId)
  )[0];
  assert.ok(!JSON.stringify(d.payload).includes(recording));
  assert.ok(!JSON.stringify(d.payload).includes("private-detail"));
  await c.deliver(d.id);
  assert.equal(
    (await c.local.get<any>("notificationDelivery", d.id, c.actor.workspaceId))
      .state,
    "delivered",
  );
  await c.changed();
  c.setStatus(503);
  await c.drain();
  const wake = await c.local.get<any>(
    "notificationWake",
    c.actor.workspaceId,
    c.actor.workspaceId,
  );
  assert.ok(wake.nextAt > Date.now());
  await c.changed();
  const ready = await c.local.get<any>(
    "notificationWake",
    c.actor.workspaceId,
    c.actor.workspaceId,
  );
  assert.ok(ready.nextAt <= Date.now());
  assert.notEqual(wake.generation, ready.generation);
});
test("automatic attempts stop at five, manual retry cycles stop at three, expired events cannot be resent and scope changes need current selected studies", async () => {
  const c = await notificationsSetup();
  await c.verify();
  await c.setEnabled();
  await c.changed();
  c.setStatus(503);
  const id = (await c.current()).deliveries[0].id;
  for (let cycle = 0; cycle < 4; cycle++) {
    for (let n = 0; n < 5; n++) {
      await c.due();
      await c.drain();
    }
    const d = (await c.current()).deliveries[0];
    assert.equal(d.state, "failed");
    assert.equal(d.attempts, (cycle + 1) * 5);
    const action = () =>
      c.ask("deliveries/" + id + "/retry", "POST", {
        version: d.version,
        requestId: randomUUID(),
        reviewed: true,
      });
    if (cycle < 3) await action();
    else await rejects(action, 409);
  }
  const bodies = c.calls
    .filter((call) => call.headers["Echo-Lab-Verification"] !== "1")
    .map((call) => call.body);
  assert.equal(new Set(bodies).size, 1);
  const e = c.getEndpoint();
  await rejects(
    () =>
      c.ask(e.id, "PUT", {
        name: e.name,
        url: e.url,
        studyIds: [randomUUID()],
        eventTypes: e.eventTypes,
        version: e.version,
        enabled: false,
        reviewed: true,
      }),
    404,
  );
  await c.changed();
  const pending = (await c.current()).deliveries.find(
    (d: any) => d.state === "pending",
  );
  assert.ok(pending);
  await c.local.db
    .prepare(
      "UPDATE documents SET data=json_set(data,'$.createdAt',?) WHERE kind='notificationDelivery' AND id=?",
    )
    .run(new Date(Date.now() - 8 * 86400000).toISOString(), pending.id);
  const before = c.calls.length;
  await c.deliver(pending.id);
  assert.equal(c.calls.length, before);
  assert.equal(
    (
      await c.local.get<any>(
        "notificationDelivery",
        pending.id,
        c.actor.workspaceId,
      )
    ).state,
    "cancelled",
  );
});
test("a late batch cannot delete or replace a newer workspace lease after recovery", async () => {
  const c = await notificationsSetup();
  await c.verify();
  await c.setEnabled();
  await c.changed();
  const replacement = randomUUID();
  c.setHook(async () => {
    const w = await c.local.get<any>(
      "notificationWake",
      c.actor.workspaceId,
      c.actor.workspaceId,
    );
    await c.local.put("notificationWake", {
      ...w,
      leaseToken: replacement,
      leaseUntil: Date.now() + 180000,
    });
  });
  await c.drain();
  const w = await c.local.get<any>(
    "notificationWake",
    c.actor.workspaceId,
    c.actor.workspaceId,
  );
  assert.equal(w.leaseToken, replacement);
  assert.equal((await c.current()).deliveries[0].state, "delivered");
});
