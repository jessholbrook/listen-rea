import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import {
  recordingSetup,
  recordingRoot as root,
} from "./library-recordings-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3367 : 3366 }),
  { timeout: 90000 },
);
after(stop);
function input(studyId: string, count = 2) {
  return {
    requestId: randomUUID(),
    studyId,
    language: "en",
    permissionConfirmed: true,
    transcriptionPermission: true,
    items: Array.from({ length: count }, (_, i) => ({
      requestId: randomUUID(),
      title: `Synthetic batch interview ${i + 1}`,
      externalId: randomUUID(),
    })),
  };
}
test(
  "batch creation is atomic, scoped, bounded and idempotent under concurrent retries; deleted members cannot be resurrected",
  { timeout: 120000 },
  async () => {
    const c = await recordingSetup(),
      data = input(c.s.id);
    const concurrent = await Promise.all([
      c.owner(root + "/batch", "POST", data),
      c.owner(root + "/batch", "POST", data),
    ]);
    assert.deepEqual(concurrent.map((v) => v.status).sort(), [200, 201]);
    assert.deepEqual(
      concurrent[0].recordings.map((r: any) => r.id),
      concurrent[1].recordings.map((r: any) => r.id),
    );
    const recordings = concurrent[0].recordings;
    assert.equal(recordings.length, 2);
    assert.ok(recordings.every((r: any) => r.batchId === data.requestId));
    assert.equal((await c.owner(root)).recordings.length, 2);
    assert.equal(
      (
        await c.owner(root + "/batch", "POST", {
          ...data,
          items: data.items.map((v, i) =>
            i ? v : { ...v, title: "Changed title" },
          ),
        })
      ).status,
      409,
    );
    for (const bad of [
      { ...input(c.s.id), items: data.items.slice(0, 1) },
      { ...input(c.s.id), items: [data.items[0], data.items[0]] },
      { ...input(c.s.id, 11) },
      { ...input(c.s.id), permissionConfirmed: false },
      { ...input(randomUUID()) },
      { ...input(c.s.id), batchId: randomUUID() },
    ])
      assert.ok((await c.owner(root + "/batch", "POST", bad)).status >= 400);
    assert.equal((await c.owner(root)).recordings.length, 2);
    for (const role of ["viewer", "stakeholder"]) {
      await assert.rejects(
        () =>
          c.service.dispatchLibraryRecordings(
            new Request("http://localhost/api/library/recordings/batch", {
              method: "POST",
              body: JSON.stringify(data),
            }),
            ["library", "recordings", "batch"],
            { ...c.actor, role } as any,
          ),
        /edit access/,
      );
    }
    await assert.rejects(
      () =>
        c.service.dispatchLibraryRecordings(
          new Request("http://localhost/api/library/recordings/batch", {
            method: "POST",
            body: JSON.stringify(data),
          }),
          ["library", "recordings", "batch"],
          { ...c.actor, workspaceId: randomUUID() },
        ),
      /not[ _]found|unavailable/i,
    );
    assert.equal(
      (await c.owner(root + "/" + recordings[0].id, "DELETE", { version: 1 }))
        .status,
      200,
    );
    assert.equal((await c.owner(root + "/batch", "POST", data)).status, 409);
    assert.equal(
      (
        await c.owner(root + "/batch", "POST", {
          ...data,
          items: input(c.s.id).items,
        })
      ).status,
      409,
    );
    assert.equal((await c.owner(root)).recordings.length, 1);
  },
);
test(
  "batch capacity is all-or-nothing; source review, import, progress and erasure remain independent",
  { timeout: 120000 },
  async () => {
    const c = await recordingSetup(),
      data = input(c.s.id),
      made = await c.owner(root + "/batch", "POST", data);
    assert.equal(made.status, 201);
    let [r, other] = made.recordings;
    r = await c.upload(r);
    other = await c.upload(other);
    const uploads = (await c.owner(root)).recordings;
    assert.ok(uploads.every((r: any) => !r.original && !r.history));
    await assert.rejects(() =>
      c.transcribe(r, async () => {
        throw Error("MARKED_PROVIDER_FAILURE");
      }),
    );
    let failed = (await c.owner(root + "/" + r.id)).recording;
    assert.equal(failed.lastError, "provider_or_processing");
    other = await c.transcribe(other);
    assert.equal(other.status, "draft");
    assert.equal((await c.owner("library")).sources.length, 0);
    assert.equal(
      (
        await c.owner(root + "/" + other.id + "/approve", "POST", {
          version: other.version,
          reviewed: true,
        })
      ).status,
      409,
    );
    other = (
      await c.owner(root + "/" + other.id, "PUT", {
        version: other.version,
        text: other.history.at(-1).text,
        reviewed: true,
      })
    ).recording;
    const imported = await c.owner(root + "/" + other.id + "/approve", "POST", {
      version: other.version,
      reviewed: true,
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.recording.batchId, data.requestId);
    assert.equal(imported.recording.title, undefined);
    assert.equal(imported.recording.original, undefined);
    assert.equal((await c.owner(root + "/batch", "POST", data)).status, 200);
    const ten = await c.owner(root + "/batch", "POST", input(c.s.id, 10));
    assert.equal(ten.status, 201);
    const rejected = await c.owner(root + "/batch", "POST", input(c.s.id, 10));
    assert.equal(rejected.status, 409);
    assert.equal((await c.owner(root)).recordings.length, 12);
    await c.owner(
      "studies/" + c.s.id + "/responses/" + imported.interviewId,
      "DELETE",
    );
    assert.equal((await c.owner(root + "/batch", "POST", data)).status, 409);
    assert.equal((await c.owner(root + "/" + other.id)).status, 404);
    assert.equal(
      (await c.owner(root + "/" + failed.id)).recording.lastError,
      "provider_or_processing",
    );
    const { recordingDraftRetention } =
      await import("../src/lib/library-recording-lifecycle");
    await c.local.put("libraryRecording", {
      ...(await c.local.get<any>(
        "libraryRecording",
        r.id,
        c.actor.workspaceId,
      )),
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    await recordingDraftRetention();
    assert.equal((await c.owner(root + "/" + r.id)).status, 404);
    assert.equal((await c.owner(root + "/batch", "POST", data)).status, 409);
  },
);
