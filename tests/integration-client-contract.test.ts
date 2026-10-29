import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { mkdtemp, rm, lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  EchoLabClient,
  EchoLabError,
  fingerprint,
  SourceChanged,
} from "../integrations/echo-lab-client";
import { verifyNotification } from "../integrations/notification-receiver";
import { acceptNotification } from "../examples/integration-recovery/receiver";
import {
  FileDestination,
  emptySnapshot,
  type Snapshot,
  type Destination,
} from "../examples/integration-recovery/store";
const token = "elk_" + randomBytes(32).toString("hex");
const selection = {
  studyIds: [randomUUID()],
  resources: ["study"] as const,
  pageSize: 1,
};
function signed(
  event: any,
  secret = "eln_" + "a".repeat(64),
  timestamp = String(Math.floor(Date.now() / 1000)),
) {
  const raw = Buffer.from(JSON.stringify(event)),
    headers = new Headers({
      "echo-lab-event-id": event.id,
      "echo-lab-timestamp": timestamp,
      "echo-lab-signature":
        "v1=" +
        createHmac("sha256", secret)
          .update(timestamp + ".")
          .update(raw)
          .digest("hex"),
    });
  return {
    raw,
    headers,
    secret,
    request: () =>
      new Request("http://localhost/notifications", {
        method: "POST",
        headers,
        body: raw,
      }),
  };
}
const event = () => ({
  id: randomUUID(),
  type: "study.changed",
  occurredAt: new Date().toISOString(),
  sequence: 2,
  data: {
    studyId: selection.studyIds[0],
    id: selection.studyIds[0],
    version: 2,
  },
});
function memory() {
  let saved = emptySnapshot(fingerprint("binding"));
  return {
    load: async () => structuredClone(saved),
    save: async (v: Snapshot) => {
      saved = structuredClone(v);
    },
  } satisfies Destination;
}
test("client confines bearer requests to a configured HTTPS origin, validates inputs and never follows server-provided paths", async () => {
  for (const origin of [
    "http://example.com",
    "https://u:p@example.com",
    "https://example.com/query?x=1",
    "https://example.com/#secret",
  ])
    assert.throws(
      () => new EchoLabClient({ origin, token, allowLoopback: true }),
    );
  assert.throws(() => new EchoLabClient({ origin: "http://localhost", token }));
  let url = "",
    init: RequestInit | undefined;
  const ref = {
      resource: "study" as const,
      studyId: selection.studyIds[0],
      id: selection.studyIds[0],
    },
    data = { id: ref.id, title: "Untrusted source" };
  const c = new EchoLabClient({
    origin: "https://example.com",
    token,
    fetch: async (u, i) => {
      url = String(u);
      init = i;
      return Response.json({ data });
    },
  });
  await c.source(ref, fingerprint(data));
  assert.equal(url, "https://example.com/api/v1/studies/" + ref.id);
  assert.equal(init?.redirect, "error");
  assert.equal(
    new Headers(init?.headers).get("authorization"),
    "Bearer " + token,
  );
  await assert.rejects(
    () => c.source({ ...ref, id: randomUUID() }, fingerprint(data)),
    SourceChanged,
  );
});
test("bounded retries preserve exact start bytes across uncertain outcomes and Retry-After, while permission/conflict/gone errors never retry or echo research bodies", async () => {
  const bodies: string[] = [],
    waits: number[] = [];
  let n = 0;
  const c = new EchoLabClient({
    origin: "https://example.com",
    token,
    wait: async (ms) => {
      waits.push(ms);
    },
    fetch: async (_u, i) => {
      bodies.push(String(i?.body));
      n++;
      if (n === 1) throw Error("SECRET NETWORK DETAIL");
      if (n === 2)
        return new Response(null, {
          status: 429,
          headers: { "retry-after": "2" },
        });
      return Response.json({
        run: {
          id: "a".repeat(64),
          version: 1,
          position: 0,
          total: 0,
          pageSize: 1,
          state: "active",
          scopeFingerprint: "b".repeat(64),
        },
      });
    },
  });
  await c.start({
    ...selection,
    resources: ["study"],
    requestId: randomUUID(),
  });
  assert.equal(new Set(bodies).size, 1);
  assert.deepEqual(waits, [250, 2000]);
  for (const status of [401, 403, 404, 409, 410]) {
    let calls = 0;
    const denied = new EchoLabClient({
      origin: "https://example.com",
      token,
      fetch: async () => {
        calls++;
        return Response.json({ error: "PRIVATE RESEARCH" }, { status });
      },
    });
    await assert.rejects(
      () => denied.view("a".repeat(64)),
      (e) =>
        e instanceof EchoLabError &&
        e.status === status &&
        !e.message.includes("PRIVATE"),
    );
    assert.equal(calls, 1);
  }
});
test("client rejects oversized/malformed responses and mismatched bulk references", async () => {
  const c = new EchoLabClient({
    origin: "https://example.com",
    token,
    fetch: async () => new Response("x".repeat(8 * 1024 * 1024 + 1)),
  });
  await assert.rejects(
    () => c.view("a".repeat(64)),
    (e) => e instanceof EchoLabError && e.code === "response_too_large",
  );
  const wrong = new EchoLabClient({
    origin: "https://example.com",
    token,
    fetch: async () => Response.json({ items: [] }),
  });
  await assert.rejects(
    () =>
      wrong.check([
        {
          resource: "study",
          studyId: selection.studyIds[0],
          id: selection.studyIds[0],
        },
      ]),
    (e) => e instanceof EchoLabError && e.code === "reference_mismatch",
  );
});
test("raw-body HMAC validates Unicode, freshness, identity and the real sequence-free challenge format", () => {
  const challenge = signed({
    id: randomUUID(),
    type: "endpoint.verification",
    occurredAt: new Date().toISOString(),
    data: { challenge: randomUUID() },
  });
  assert.equal(
    verifyNotification(challenge.raw, challenge.headers, challenge.secret).type,
    "endpoint.verification",
  );
  const v = signed({
    ...event(),
    data: { ...event().data, extra: "français 日本語" },
  });
  assert.equal(verifyNotification(v.raw, v.headers, v.secret).sequence, 2);
  for (const change of [
    () =>
      verifyNotification(
        Buffer.concat([v.raw, Buffer.from(" ")]),
        v.headers,
        v.secret,
      ),
    () => verifyNotification(v.raw, v.headers, "eln_" + "b".repeat(64)),
    () => verifyNotification(v.raw, v.headers, v.secret, Date.now() + 301000),
    () => verifyNotification(v.raw, v.headers, v.secret, Date.now() - 31000),
    () => {
      const h = new Headers(v.headers);
      h.set("echo-lab-event-id", randomUUID());
      verifyNotification(v.raw, h, v.secret);
    },
  ])
    assert.throws(change);
  const missing = signed({ ...event(), sequence: undefined });
  assert.throws(() =>
    verifyNotification(missing.raw, missing.headers, missing.secret),
  );
});
test("receiver acknowledges only durable acceptance, deduplicates stable identities, rejects identity changes and preserves wake-ups independent of source ordering", async () => {
  const store = memory(),
    e = event(),
    v = signed(e);
  for (let n = 0; n < 2; n++)
    assert.equal(
      (
        await acceptNotification(
          v.request(),
          v.secret,
          selection.studyIds,
          store,
        )
      ).status,
      204,
    );
  assert.equal((await store.load()).wake, 1);
  const altered = signed({ ...e, data: { ...e.data, version: 3 } });
  assert.equal(
    (
      await acceptNotification(
        altered.request(),
        altered.secret,
        selection.studyIds,
        store,
      )
    ).status,
    409,
  );
  const older = signed({ ...event(), sequence: 1 });
  assert.equal(
    (
      await acceptNotification(
        older.request(),
        older.secret,
        selection.studyIds,
        store,
      )
    ).status,
    204,
  );
  assert.equal((await store.load()).wake, 2);
  const failure = {
    ...store,
    save: async () => {
      throw Error("Disk unavailable");
    },
  };
  const unsaved = signed(event());
  await assert.rejects(() =>
    acceptNotification(
      unsaved.request(),
      unsaved.secret,
      selection.studyIds,
      failure,
    ),
  );
  assert.equal((await store.load()).wake, 2);
  assert.ok(!JSON.stringify(await store.load()).includes(e.id));
});
test("receiver capacity fails visibly, old receipts age out and invalid signatures/large bodies never enter the inbox", async () => {
  const store = memory(),
    s = await store.load();
  s.receipts = Array.from({ length: 1000 }, (_, n) => ({
    idHash: fingerprint(n),
    bodyHash: fingerprint(n),
    at: Date.now(),
  }));
  await store.save(s);
  const v = signed(event());
  assert.equal(
    (await acceptNotification(v.request(), v.secret, selection.studyIds, store))
      .status,
    503,
  );
  s.receipts.forEach((r) => (r.at = Date.now() - 8 * 86400000));
  await store.save(s);
  assert.equal(
    (await acceptNotification(v.request(), v.secret, selection.studyIds, store))
      .status,
    204,
  );
  assert.equal(
    (
      await acceptNotification(
        v.request(),
        "eln_" + "b".repeat(64),
        selection.studyIds,
        store,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await acceptNotification(
        new Request("http://localhost", {
          method: "POST",
          body: "x".repeat(65537),
        }),
        v.secret,
        selection.studyIds,
        store,
      )
    ).status,
    400,
  );
  assert.equal((await store.load()).receipts.length, 1);
});
test("file destination is private, atomic, scope-bound and exclusively locked, refusing existing directories and other writers", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "echo-client-store-"));
  try {
    const dir = path.join(temp, "private"),
      binding = fingerprint("scope"),
      store = await FileDestination.connect(dir, binding, true);
    assert.equal((await lstat(dir)).mode & 0o777, 0o700);
    assert.equal(
      (await lstat(path.join(dir, "destination.json"))).mode & 0o777,
      0o600,
    );
    await assert.rejects(() => FileDestination.connect(dir, binding, true));
    await assert.rejects(() =>
      FileDestination.connect(dir, fingerprint("other")),
    );
    await store.exclusive(async () => {
      await assert.rejects(() => store.exclusive(async () => {}));
      const value = await store.load();
      value.wake = 3;
      await store.save(value);
    });
    assert.equal((await store.load()).wake, 3);
    await writeFile(path.join(dir, "writer.lock"), "stale", { mode: 0o600 });
    await assert.rejects(() => store.exclusive(async () => {}));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("runnable loopback receiver handles the actual HTTP challenge, duplicate events and bounded malformed requests", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "echo-receiver-cli-")),
    dir = path.join(temp, "destination"),
    secret = "eln_" + randomBytes(32).toString("hex");
  const child = spawn(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "examples/integration-recovery/run.ts",
      "receive",
      "--directory",
      dir,
      "--initialize",
    ],
    {
      env: {
        ...process.env,
        ECHO_LAB_URL: "https://example.com",
        ECHO_LAB_API_KEY: token,
        ECHO_LAB_STUDY_IDS: selection.studyIds.join(","),
        ECHO_LAB_RESOURCES: "study",
        ECHO_LAB_SIGNING_KEY: secret,
        ECHO_LAB_RECEIVER_PORT: "3457",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error("Receiver startup timed out")),
        10000,
      );
      child.stdout.on("data", (b) => {
        if (String(b).includes("Receiver listening")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once("exit", () => {
        clearTimeout(timeout);
        reject(Error("Receiver failed to start"));
      });
    });
    const url = "http://127.0.0.1:3457/notifications",
      v = signed(event(), secret);
    for (let n = 0; n < 2; n++)
      assert.equal(
        (await fetch(url, { method: "POST", headers: v.headers, body: v.raw }))
          .status,
        204,
      );
    const challenge = randomUUID(),
      c = signed(
        {
          id: randomUUID(),
          type: "endpoint.verification",
          occurredAt: new Date().toISOString(),
          data: { challenge },
        },
        secret,
      );
    const response = await fetch(url, {
      method: "POST",
      headers: c.headers,
      body: c.raw,
    });
    assert.deepEqual(await response.json(), { echo_lab_challenge: challenge });
    assert.equal(
      (await fetch(url, { method: "POST", body: "x".repeat(65537) })).status,
      413,
    );
    const saved = JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(path.join(dir, "destination.json"), "utf8"),
    );
    assert.equal(saved.wake, 1);
    assert.equal(saved.receipts.length, 1);
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once("exit", () => resolve());
    });
    await rm(temp, { recursive: true, force: true });
  }
});
