import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { client } from "./image-review-fixture";
import { recordingSetup } from "./library-recordings-fixture";
import type { BackgroundJob } from "../src/lib/background-jobs";
process.env.RESEARCH_BACKGROUND_DRIVER = "manual";
before(() => start({ port: 3432 }), { timeout: 90000 });
after(stop);
async function setup(
  durationSteps = 1,
  existing?: Awaited<ReturnType<typeof recordingSetup>>,
) {
  const c = existing || (await recordingSetup());
  let r = await c.upload((await c.create()).recording);
  if (durationSteps > 1) {
    const raw = await c.local.get<any>(
      "libraryRecording",
      r.id,
      c.actor.workspaceId,
    );
    raw.file.durationMs = durationSteps * 300000;
    await c.local.put("libraryRecording", raw);
  }
  const input = {
    requestId: randomUUID(),
    kind: "transcription",
    targetId: r.id,
    studyId: c.s.id,
    version: r.version,
    permissionConfirmed: true,
  };
  const created = await c.owner("background-jobs", "POST", input);
  assert.equal(created.status, 201, JSON.stringify(created));
  const worker = await import("../src/lib/background-worker");
  const stored = () =>
    c.local.get<BackgroundJob>(
      "backgroundJob",
      created.job.id,
      c.actor.workspaceId,
    );
  const messages: { jobId: string; wake: number }[] = [];
  const publish = async (jobId: string, wake: number) => {
    messages.push({ jobId, wake });
  };
  const run = async (transcribe: any) => {
    const j = await stored();
    await worker.runBackgroundMessage(
      { jobId: j!.id, wake: j!.wake },
      { transcribe, publish },
    );
  };
  return { ...c, r, input, created, worker, stored, messages, publish, run };
}
const output = (
  text = "MARKED_BACKGROUND_TRANSCRIPT: Review the original evidence before sharing.",
) => ({
  text,
  model: "marked-test-provider",
  generatedAt: new Date().toISOString(),
});
test(
  "durable transcription traverses saved steps once, reconciles delivery replay and leaves the transcript unreviewed",
  { timeout: 120000 },
  async () => {
    const c = await setup(2);
    let calls = 0;
    assert.equal(
      (await c.owner("background-jobs", "POST", c.input)).job.id,
      c.created.job.id,
    );
    assert.equal(
      (await c.owner("background-jobs", "POST", { ...c.input, version: 99 }))
        .status,
      409,
    );
    assert.equal(
      (
        await c.owner("background-jobs", "POST", {
          ...c.input,
          requestId: randomUUID(),
        })
      ).status,
      409,
    );
    await c.run(async () => {
      calls++;
      return output("MARKED_STEP_1: Original source context is preserved.");
    });
    assert.equal((await c.stored())!.completed, 1);
    assert.equal((await c.stored())!.state, "queued");
    const partial = await c.local.get<any>(
      "libraryRecording",
      c.r.id,
      c.actor.workspaceId,
    );
    assert.equal(partial.job.completed.length, 1);
    assert.equal(
      (
        await c.owner(`library/recordings/${c.r.id}/transcribe`, "POST", {
          version: partial.version,
          permissionConfirmed: true,
        })
      ).status,
      409,
    );
    await c.worker.runBackgroundMessage(
      { jobId: c.created.job.id, wake: 1 },
      {
        transcribe: async () => {
          throw Error("Replayed old step");
        },
        publish: c.publish,
      },
    );
    await c.run(async () => {
      calls++;
      return output("MARKED_STEP_2: Contrasting evidence remains visible.");
    });
    assert.equal(calls, 2);
    assert.equal((await c.stored())!.state, "complete");
    assert.equal((await c.stored())!.completed, 2);
    const r = await c.local.get<any>(
      "libraryRecording",
      c.r.id,
      c.actor.workspaceId,
    );
    assert.equal(r.backgroundJobId, undefined);
    assert.equal(r.history[0].reviewed, false);
    assert.ok(r.original.text.includes("MARKED_STEP_1"));
    assert.ok(r.original.text.includes("MARKED_STEP_2"));
    await c.worker.runBackgroundMessage(c.messages.at(-1)!, {
      transcribe: async () => {
        throw Error("Completed replay called provider");
      },
      publish: c.publish,
    });
    const view = (await c.owner("background-jobs/" + c.created.job.id)).job;
    for (const key of [
      "creatorId",
      "workspaceId",
      "requestId",
      "inputHash",
      "lease",
      "wake",
    ])
      assert.equal(view[key], undefined);
    assert.equal(JSON.stringify(view).includes("MARKED_STEP"), false);
  },
);
test(
  "cancellation fences an in-flight result, retains checkpoints and duplicate deliveries cannot process concurrently",
  { timeout: 120000 },
  async () => {
    const c = await setup(2);
    await c.run(async () =>
      output("MARKED_SAVED_STEP: Keep the original checkpoint."),
    );
    let started!: () => void, finish!: (v: any) => void;
    const entered = new Promise<void>((r) => (started = r)),
      pending = new Promise<any>((r) => (finish = r));
    const work = c.run(async () => {
      started();
      return pending;
    });
    await entered;
    const current = (await c.stored())!;
    await assert.rejects(
      () =>
        c.worker.runBackgroundMessage(
          { jobId: current.id, wake: current.wake },
          { publish: c.publish },
        ),
      /BACKGROUND_BUSY/,
    );
    assert.equal(
      (
        await c.owner("background-jobs/" + current.id, "PATCH", {
          version: current.version - 1,
          op: "cancel",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await c.owner("background-jobs/" + current.id, "PATCH", {
          version: current.version,
          op: "cancel",
        })
      ).job.state,
      "cancelled",
    );
    finish(output("DISCARDED_LATE_PROVIDER_RESULT"));
    await work;
    const r = await c.local.get<any>(
      "libraryRecording",
      c.r.id,
      c.actor.workspaceId,
    );
    assert.equal(r.original, undefined);
    assert.equal(r.job.completed.length, 1);
    assert.equal(r.backgroundJobId, undefined);
    assert.equal((await c.stored())!.state, "cancelled");
    assert.equal(JSON.stringify(r).includes("DISCARDED_LATE"), false);
  },
);
test(
  "three failed step attempts stop automatically; explicit versioned retry resumes without discarding progress",
  { timeout: 120000 },
  async () => {
    const c = await setup();
    let calls = 0;
    for (let n = 0; n < 3; n++)
      await c.run(async () => {
        calls++;
        throw Error("Synthetic provider failure");
      });
    let j = (await c.stored())!;
    assert.equal(j.state, "failed");
    assert.equal(j.attempts, 3);
    assert.equal(calls, 3);
    await c.run(async () => {
      throw Error("Failed job must not run");
    });
    assert.equal(
      (
        await c.owner("background-jobs/" + j.id, "PATCH", {
          version: j.version,
          op: "retry",
        })
      ).status,
      200,
    );
    await c.run(async () => output());
    j = (await c.stored())!;
    assert.equal(j.state, "complete");
    assert.equal(j.attempts, 4);
  },
);
test(
  "current membership is checked before processing and again before saving a late result",
  { timeout: 120000 },
  async () => {
    const c = await setup();
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.actor.id);
    await c.run(async () => {
      throw Error("Revoked member called provider");
    });
    assert.equal((await c.stored())!.error, "permission");
    assert.equal(
      (await c.owner("background-jobs", "POST", c.input)).status,
      403,
    );
    await c.local.db
      .prepare("UPDATE users SET role='admin' WHERE id=?")
      .run(c.actor.id);
    let j = (await c.stored())!;
    await c.owner("background-jobs/" + j.id, "PATCH", {
      version: j.version,
      op: "retry",
    });
    let started!: () => void, finish!: (v: any) => void;
    const entered = new Promise<void>((r) => (started = r)),
      pending = new Promise<any>((r) => (finish = r));
    const work = c.run(async () => {
      started();
      return pending;
    });
    await entered;
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.actor.id);
    finish(output("REVOKED_MEMBER_RESULT"));
    await work;
    assert.equal(
      (await c.local.get<any>("libraryRecording", c.r.id, c.actor.workspaceId))
        .original,
      undefined,
    );
    await c.local.db
      .prepare("UPDATE users SET role='admin' WHERE id=?")
      .run(c.actor.id);
  },
);
test(
  "workspace boundaries, strict inputs and source erasure revoke queued messages without recreating sources",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      foreign = await client(),
      anonymous = await client();
    await foreign("auth/signup", "POST", {
      name: "Foreign jobs",
      email: randomUUID() + "@example.test",
      password: "background-test-password",
    });
    assert.equal(
      (await foreign("background-jobs/" + c.created.job.id)).status,
      404,
    );
    assert.equal((await anonymous("background-jobs")).status, 401);
    assert.equal(
      (await c.owner("background-jobs?workspaceId=" + c.actor.workspaceId))
        .status,
      400,
    );
    assert.equal(
      (
        await c.owner("background-jobs", "POST", {
          ...c.input,
          permissionConfirmed: false,
        })
      ).status,
      400,
    );
    const r = (await c.owner("library/recordings/" + c.r.id)).recording;
    assert.equal(
      (
        await c.owner("library/recordings/" + c.r.id, "DELETE", {
          version: r.version,
        })
      ).status,
      200,
    );
    assert.equal(
      (await c.owner("background-jobs/" + c.created.job.id)).status,
      404,
    );
    await c.worker.runBackgroundMessage(
      { jobId: c.created.job.id, wake: 1 },
      {
        transcribe: async () => {
          throw Error("Deleted source called provider");
        },
        publish: c.publish,
      },
    );
    assert.equal(
      await c.local.get("libraryRecording", c.r.id, c.actor.workspaceId),
      undefined,
    );
  },
);
test(
  "scheduled maintenance recovers pending dispatch, preserves live leases, authenticates strictly and forces source retention",
  { timeout: 120000 },
  async () => {
    const c = await setup();
    const m = await import("../src/lib/background-maintenance");
    const old = process.env.CRON_SECRET;
    process.env.CRON_SECRET =
      "test-maintenance-secret-with-at-least-32-characters";
    try {
      assert.equal(m.maintenanceAuthorized(null), false);
      assert.equal(m.maintenanceAuthorized("Bearer wrong"), false);
      assert.equal(
        m.maintenanceAuthorized("Bearer " + process.env.CRON_SECRET),
        true,
      );
    } finally {
      if (old === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = old;
    }
    assert.equal((await c.owner("cron/background-maintenance")).status, 401);
    let cleanups = 0;
    const sent: string[] = [];
    await m.backgroundMaintenance(
      async (id) => {
        sent.push(id);
      },
      async () => {
        cleanups++;
      },
    );
    assert.equal(cleanups, 1);
    assert.ok(sent.includes(c.created.job.id));
    const j = (await c.stored())!;
    j.state = "running";
    j.leaseUntil = Date.now() + 120000;
    await c.local.put("backgroundJob", j);
    sent.length = 0;
    await m.backgroundMaintenance(
      async (id) => {
        sent.push(id);
      },
      async () => {},
    );
    assert.equal(sent.includes(j.id), false);
    j.leaseUntil = Date.now() - 1;
    await c.local.put("backgroundJob", j);
    await m.backgroundMaintenance(
      async (id) => {
        sent.push(id);
      },
      async () => {},
    );
    assert.ok(sent.includes(j.id));
    const { retention } = await import("../src/lib/features");
    await retention(); // Prime the normal per-process throttle before the scheduled call.
    const expired = await c.local.get<any>(
      "libraryRecording",
      c.r.id,
      c.actor.workspaceId,
    );
    expired.expiresAt = new Date(Date.now() - 1000).toISOString();
    await c.local.put("libraryRecording", expired);
    await m.backgroundMaintenance(async () => {});
    assert.equal(
      await c.local.get("libraryRecording", c.r.id, c.actor.workspaceId),
      undefined,
    );
    assert.equal(await c.stored(), undefined);
    const { readRecording } = await import("../src/lib/storage");
    await assert.rejects(() => readRecording(expired.file.id));
  },
);
test(
  "native render worker produces a private playable MP4 once and source erasure revokes the output and coordination",
  { timeout: 120000 },
  async () => {
    const { backgroundRenderSetup } =
      await import("./background-render-fixture");
    const c = await backgroundRenderSetup();
    const created = await c.owner("background-jobs", "POST", {
      requestId: randomUUID(),
      kind: "render",
      targetId: c.render.id,
      studyId: c.s.id,
      version: c.render.reelVersion,
      permissionConfirmed: true,
    });
    assert.equal(created.status, 201, JSON.stringify(created));
    const worker = await import("../src/lib/background-worker");
    await worker.runBackgroundMessage(
      { jobId: created.job.id, wake: 1 },
      { publish: async () => {} },
    );
    assert.equal(
      (await c.owner("background-jobs/" + created.job.id)).job.state,
      "complete",
    );
    const file = await c.owner(c.path + `/jobs/${c.render.id}/download`);
    assert.equal(file.status, 200);
    assert.ok(file.bytes.includes(Buffer.from("ftyp")));
    const current = await c.local.get<any>(
      "renderJob",
      c.render.id,
      c.actor.workspaceId,
    );
    assert.equal(current.attempts, 1);
    assert.equal(current.backgroundJobId, undefined);
    await worker.runBackgroundMessage(
      { jobId: created.job.id, wake: 1 },
      {
        render: async () => {
          throw Error("Completed render repeated");
        },
        publish: async () => {},
      },
    );
    await c.owner(`studies/${c.s.id}/responses/${c.interviewId}`, "DELETE");
    assert.equal(
      (await c.owner("background-jobs/" + created.job.id)).status,
      404,
    );
    assert.equal((await c.owner("recordings/" + current.outputId)).status, 404);
  },
);
test(
  "stale reel changes stop a queued render and cancellation invalidates its native lease without deleting source media",
  { timeout: 120000 },
  async () => {
    const { backgroundRenderSetup } =
      await import("./background-render-fixture");
    const c = await backgroundRenderSetup();
    const created = await c.owner("background-jobs", "POST", {
      requestId: randomUUID(),
      kind: "render",
      targetId: c.render.id,
      studyId: c.s.id,
      version: c.render.reelVersion,
      permissionConfirmed: true,
    });
    await c.owner(c.path + "/reels/" + c.reel.id, "PUT", {
      ...c.reel,
      name: "Changed reel",
      reviewed: true,
    });
    const { runBackgroundMessage } =
      await import("../src/lib/background-worker");
    await runBackgroundMessage(
      { jobId: created.job.id, wake: 1 },
      { publish: async () => {} },
    );
    assert.equal(
      (await c.owner("background-jobs/" + created.job.id)).status,
      404,
    );
    const updated = (await c.owner(c.path)).reels.find(
      (r: any) => r.id === c.reel.id,
    );
    const native = (
      await c.owner(c.path + "/jobs", "POST", {
        reelId: updated.id,
        version: updated.version,
      })
    ).job;
    const j = (
      await c.owner("background-jobs", "POST", {
        requestId: randomUUID(),
        kind: "render",
        targetId: native.id,
        studyId: c.s.id,
        version: native.reelVersion,
        permissionConfirmed: true,
      })
    ).job;
    const r = await c.local.get<any>(
      "renderJob",
      native.id,
      c.actor.workspaceId,
    );
    r.state = "running";
    r.lease = "synthetic-active-lease";
    r.leaseUntil = Date.now() + 100000;
    r.outputId = randomUUID();
    await c.local.put("renderJob", r);
    assert.equal(
      (
        await c.owner("background-jobs/" + j.id, "PATCH", {
          version: j.version,
          op: "cancel",
        })
      ).job.state,
      "cancelled",
    );
    const cancelled = await c.local.get<any>(
      "renderJob",
      r.id,
      c.actor.workspaceId,
    );
    assert.equal(cancelled.lease, undefined);
    assert.equal(cancelled.state, "failed");
    assert.ok(
      (await c.owner("library/sources/" + c.interviewId)).source.media.length,
    );
    const guards = await c.local.list<any>("deletion", c.actor.workspaceId);
    assert.ok(
      guards.some(
        (g) => g.files.includes(r.outputId) && g.notBefore > Date.now(),
      ),
    );
  },
);
test(
  "expired leases reconcile final/partial commits and interrupted provider attempts; outbox publication remains recoverable",
  { timeout: 120000 },
  async () => {
    const c = await setup();
    let j = (await c.stored())!;
    const raw = await c.local.get<any>(
      "libraryRecording",
      c.r.id,
      c.actor.workspaceId,
    );
    raw.original = output();
    raw.status = "draft";
    raw.version++;
    await c.local.put("libraryRecording", raw);
    j.state = "running";
    j.lease = "expired-test-lease";
    j.leaseUntil = Date.now() - 1;
    j.stepAttempts = 1;
    await c.local.put("backgroundJob", j);
    await c.run(async () => {
      throw Error("Committed result called provider again");
    });
    assert.equal((await c.stored())!.state, "complete");
    const second = await setup(1, c);
    const m = await import("../src/lib/background-maintenance");
    const recovery = await m.backgroundMaintenance(
      async () => {
        throw Error("Synthetic broker unavailable");
      },
      async () => {},
    );
    assert.ok(recovery.pending >= 1);
    assert.equal((await second.stored())!.dispatchPending, true);
    await second.run(async () => output());
    assert.equal((await second.stored())!.state, "complete");
    const partial = await setup(2, c);
    const claiming = (await partial.stored())!;
    claiming.state = "running";
    claiming.lease = "crashed-checkpoint-lease";
    claiming.leaseUntil = Date.now() + 150000;
    claiming.stepAttempts = 1;
    claiming.attempts = 1;
    await c.local.put("backgroundJob", claiming);
    const committed = await c.service.dispatchLibraryRecordings(
      new Request(
        "http://worker/api/library/recordings/" + partial.r.id + "/transcribe",
        {
          method: "POST",
          body: JSON.stringify({
            version: claiming.targetVersion,
            permissionConfirmed: true,
          }),
        },
      ),
      ["library", "recordings", partial.r.id, "transcribe"],
      c.actor,
      async () =>
        output("COMMITTED_PARTIAL_STEP: Keep this original checkpoint."),
      claiming.id,
    );
    assert.equal((await committed!.json()).recording.job.completed, 1);
    claiming.leaseUntil = Date.now() - 1;
    await c.local.put("backgroundJob", claiming);
    let resumedCalls = 0;
    await partial.run(async (_bytes: any, r: any) => {
      resumedCalls++;
      assert.equal(r.job.completed.length, 1);
      return output("RESUMED_NEXT_STEP: Do not repeat the first checkpoint.");
    });
    assert.equal(resumedCalls, 1);
    assert.equal((await partial.stored())!.state, "complete");
    assert.equal((await partial.stored())!.completed, 2);
    for (const interrupted of [true, false]) {
      const pending = await setup(1, c),
        active = (await pending.stored())!;
      const source = await c.local.get<any>(
        "libraryRecording",
        pending.r.id,
        c.actor.workspaceId,
      );
      source.version++;
      source.job = { total: 1, completed: [] };
      source.status = interrupted ? "transcribing" : "uploaded";
      if (interrupted)
        source.attempt = { id: randomUUID(), at: Date.now() - 120001 };
      else source.lastError = "provider_or_processing";
      await c.local.put("libraryRecording", source);
      active.state = "running";
      active.lease = "crashed-provider-lease";
      active.leaseUntil = Date.now() - 1;
      active.stepAttempts = 1;
      active.attempts = 1;
      await c.local.put("backgroundJob", active);
      await pending.run(async () => output());
      assert.equal((await pending.stored())!.state, "complete");
      assert.equal((await pending.stored())!.attempts, 2);
    }
  },
);
