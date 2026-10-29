/** Account-free demonstration against a disposable local Echo Lab workspace. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { start, stop, base } from "../../tests/harness";
import { reconciliationSetup } from "../../tests/reconciliation-fixture";
import { EchoLabClient } from "../../integrations/echo-lab-client";
import { FileDestination } from "./store";
import { syncDestination, selectionOf } from "./sync";
import { acceptNotification } from "./receiver";
let temp: string | undefined;
try {
  if (!existsSync(".next/BUILD_ID"))
    throw Error("Run npm run build before integration:demo.");
  process.env.RESEARCH_TEST_PRODUCTION = "1";
  await start({ port: 3456 });
  const c = await reconciliationSetup();
  await c.grant();
  const source = await c.source();
  temp = await mkdtemp(path.join(tmpdir(), "echo-integration-demo-"));
  const selection = selectionOf({
      studyIds: [c.s.id],
      resources: ["study", "response"],
      pageSize: 1,
    }),
    client = new EchoLabClient({
      origin: base,
      token: c.token,
      allowLoopback: true,
    }),
    store = await FileDestination.connect(
      path.join(temp, "destination"),
      client.binding(selection),
      true,
    );
  const first = await store.exclusive(() =>
    syncDestination(client, store, selection, 1),
  );
  assert.equal(first.state, "paused");
  assert.ok((await store.load()).pending);
  console.log(
    "PASS: source copies and acknowledgment intent saved before simulated interruption.",
  );
  const reopened = await FileDestination.connect(
    store.directory,
    client.binding(selection),
  );
  const resumed = await reopened.exclusive(() =>
    syncDestination(client, reopened, selection),
  );
  assert.equal(resumed.state, "complete");
  assert.equal(resumed.copies, 2);
  console.log(
    "PASS: a reopened destination resumes the same run and completes two source copies.",
  );
  const secret = "eln_" + randomBytes(32).toString("hex"),
    event = {
      id: randomUUID(),
      type: "response.changed",
      occurredAt: new Date().toISOString(),
      sequence: 3,
      data: { studyId: c.s.id, id: source.id, version: 1 },
    },
    raw = JSON.stringify(event),
    timestamp = String(Math.floor(Date.now() / 1000));
  const req = () =>
    new Request("http://localhost/notifications", {
      method: "POST",
      headers: {
        "echo-lab-event-id": event.id,
        "echo-lab-timestamp": timestamp,
        "echo-lab-signature":
          "v1=" +
          createHmac("sha256", secret)
            .update(timestamp + "." + raw)
            .digest("hex"),
      },
      body: raw,
    });
  for (let n = 0; n < 2; n++)
    assert.equal(
      (
        await store.exclusive(() =>
          acceptNotification(req(), secret, [c.s.id], store),
        )
      ).status,
      204,
    );
  assert.equal((await store.load()).wake, 1);
  console.log(
    "PASS: marked local signed notification and its duplicate produce one durable wake-up (no external notification dispatch).",
  );
  await c.local.put("interview", { ...source, excluded: true });
  const after = await store.exclusive(() =>
    syncDestination(client, store, selection),
  );
  assert.equal(after.state, "complete");
  assert.equal(after.copies, 1);
  console.log(
    "PASS: a periodic catch-up removes an unavailable local response without needing a deletion notification.",
  );
  console.log(
    "Demo complete. Synthetic workspace and disposable destination are removed; no provider/model calls were made.",
  );
} finally {
  await stop();
  if (temp) await rm(temp, { recursive: true, force: true });
}
