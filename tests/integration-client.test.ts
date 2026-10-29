import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { start, stop, base } from "./harness";
import { reconciliationSetup } from "./reconciliation-fixture";
import { EchoLabClient, EchoLabError } from "../integrations/echo-lab-client";
import { FileDestination } from "../examples/integration-recovery/store";
import {
  syncDestination,
  selectionOf,
} from "../examples/integration-recovery/sync";
before(() => start({ port: 3454 }), { timeout: 90000 });
after(stop);
async function fixture(
  work: (
    ctx: Awaited<ReturnType<typeof reconciliationSetup>>,
    store: FileDestination,
    selection: ReturnType<typeof selectionOf>,
    client: EchoLabClient,
  ) => Promise<void>,
) {
  const c = await reconciliationSetup();
  await c.grant();
  const selection = selectionOf({
      studyIds: [c.s.id],
      resources: ["study", "response"],
      pageSize: 1,
    }),
    client = new EchoLabClient({
      origin: base,
      token: c.token,
      allowLoopback: true,
      attempts: 1,
    }),
    temp = await mkdtemp(path.join(tmpdir(), "echo-client-real-")),
    store = await FileDestination.connect(
      path.join(temp, "destination"),
      client.binding(selection),
      true,
    );
  try {
    await work(c, store, selection, client);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
test("real API sync resumes a durably saved page after reopen and never persists API credentials", async () =>
  fixture(async (c, store, selection, client) => {
    await c.source();
    assert.equal(
      (
        await store.exclusive(() =>
          syncDestination(client, store, selection, 1),
        )
      ).state,
      "paused",
    );
    const before = await store.load();
    assert.ok(before.pending);
    assert.equal((await client.view(before.runId!)).run.position, 0);
    const reopen = await FileDestination.connect(
      store.directory,
      client.binding(selection),
    );
    const done = await reopen.exclusive(() =>
      syncDestination(client, reopen, selection),
    );
    assert.equal(done.state, "complete");
    assert.equal(done.copies, 2);
    assert.ok(!(await store.load()).pending);
    assert.ok(
      !(
        await readFile(path.join(store.directory, "destination.json"), "utf8")
      ).includes(c.token),
    );
  }));
test("a failed local page save cannot acknowledge progress", async () =>
  fixture(async (c, store, selection, client) => {
    await c.source();
    let saves = 0;
    const fail = {
      load: () => store.load(),
      save: async (v: any) => {
        saves++;
        if (saves === 3) throw Error("Marked disk failure");
        await store.save(v);
      },
    };
    await assert.rejects(() =>
      store.exclusive(() => syncDestination(client, fail, selection)),
    );
    const saved = await store.load();
    assert.ok(saved.runId);
    assert.equal(saved.pending, undefined);
    assert.equal((await client.view(saved.runId!)).run.position, 0);
    assert.equal(
      (await store.exclusive(() => syncDestination(client, store, selection)))
        .state,
      "complete",
    );
  }));
test("lost checkpoint responses replay the original request safely after the server has committed", async () =>
  fixture(async (c, store, selection, client) => {
    await c.source();
    let lost = false;
    const flaky = new EchoLabClient({
      origin: base,
      token: c.token,
      allowLoopback: true,
      attempts: 1,
      fetch: async (u, i) => {
        const r = await fetch(u, i);
        if (String(u).endsWith("/checkpoint") && !lost) {
          lost = true;
          await r.body?.cancel();
          throw Error("Marked lost acknowledgment");
        }
        return r;
      },
    });
    await assert.rejects(
      () => store.exclusive(() => syncDestination(flaky, store, selection)),
      EchoLabError,
    );
    const saved = await store.load();
    assert.ok(saved.pending);
    assert.equal((await client.view(saved.runId!)).run.position, 1);
    assert.equal(
      (await store.exclusive(() => syncDestination(client, store, selection)))
        .state,
      "complete",
    );
    assert.equal((await store.load()).copies.length, 2);
  }));
test("fresh availability checks remove excluded and erased local copies without requiring deletion notifications", async () =>
  fixture(async (c, store, selection, client) => {
    const source = await c.source();
    assert.equal(
      (await store.exclusive(() => syncDestination(client, store, selection)))
        .copies,
      2,
    );
    await c.local.put("interview", { ...source, excluded: true });
    assert.equal(
      (await store.exclusive(() => syncDestination(client, store, selection)))
        .copies,
      1,
    );
    await c.local.put("interview", source);
    assert.equal(
      (await store.exclusive(() => syncDestination(client, store, selection)))
        .copies,
      2,
    );
    await c.owner(`studies/${c.s.id}/responses/${source.id}`, "DELETE");
    assert.equal(
      (await store.exclusive(() => syncDestination(client, store, selection)))
        .copies,
      1,
    );
  }));
test("permission loss stops synchronization and never interprets denial as permission to erase local copies", async () =>
  fixture(async (c, store, selection, client) => {
    await c.source();
    await store.exclusive(() => syncDestination(client, store, selection));
    const before = await store.load();
    await c.grant({ enabled: false });
    await assert.rejects(
      () => store.exclusive(() => syncDestination(client, store, selection)),
      (e) => e instanceof EchoLabError && e.status === 403,
    );
    assert.deepEqual((await store.load()).copies, before.copies);
  }));
test("changed page tokens are reread without skipping, and source erasure retires a saved run before starting fresh", async () =>
  fixture(async (c, store, selection, client) => {
    const source = await c.source();
    let changed = false;
    const changing = new EchoLabClient({
      origin: base,
      token: c.token,
      allowLoopback: true,
      attempts: 1,
      fetch: async (u, i) => {
        if (String(u).endsWith("/checkpoint") && !changed) {
          changed = true;
          await c.changed();
        }
        return fetch(u, i);
      },
    });
    assert.equal(
      (await store.exclusive(() => syncDestination(changing, store, selection)))
        .state,
      "complete",
    );
    await store.exclusive(() => syncDestination(client, store, selection, 1));
    assert.ok((await store.load()).pending);
    await c.owner(`studies/${c.s.id}/responses/${source.id}`, "DELETE");
    assert.equal(
      (await store.exclusive(() => syncDestination(client, store, selection)))
        .state,
      "needs_restart",
    );
    assert.equal((await store.load()).copies.length, 1);
    assert.equal((await store.load()).runId, undefined);
    assert.equal(
      (await store.exclusive(() => syncDestination(client, store, selection)))
        .state,
      "complete",
    );
  }));
