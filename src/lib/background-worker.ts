import { db, get, put, uid, now, transaction } from "./db";
import {
  backgroundKind,
  jobActor,
  jobTarget,
  releaseTarget,
} from "./background-jobs-store";
import { activeJob, type BackgroundJob } from "./background-jobs";
import {
  dispatchLibraryRecordings,
  transcribeExternalRecording,
} from "./library-recordings-server";
import { dispatchReporting } from "./reporting-server";
import { publishBackgroundJob } from "./background-queue";
import type { LibraryRecording } from "./library-recordings";
import type { Actor } from "./domain";
import type { RenderJob } from "./reporting";
import { HttpError } from "./http";
export type BackgroundMessage = { jobId: string; wake: number };
export async function runBackgroundMessage(
  message: BackgroundMessage,
  options: {
    transcribe?: typeof transcribeExternalRecording;
    publish?: typeof publishBackgroundJob;
    render?: (j: BackgroundJob, a: Actor) => Promise<void>;
  } = {},
) {
  const publish = options.publish || publishBackgroundJob;
  let claimed: BackgroundJob | undefined,
    a: Actor | undefined,
    redispatch: BackgroundJob | undefined;
  await transaction(async () => {
    const j = await get<BackgroundJob>(backgroundKind, message.jobId);
    if (!j || !activeJob(j)) return;
    if (j.wake !== message.wake) {
      if (j.dispatchPending) redispatch = j;
      return;
    }
    if (j.state === "running" && (j.leaseUntil || 0) > Date.now())
      throw Error("BACKGROUND_BUSY");
    // Serialise expensive work within each workspace, independently of consumer concurrency.
    const other = await db
      .prepare(
        "SELECT id FROM documents WHERE kind='backgroundJob' AND workspace_id=? AND id<>? AND json_extract(data,'$.state')='running' AND json_extract(data,'$.leaseUntil')>?",
      )
      .get(j.workspaceId, j.id, Date.now());
    if (other) throw Error("BACKGROUND_BUSY");
    a = await jobActor(j);
    const target = await jobTarget(j),
      study = await get("study", j.studyId, j.workspaceId);
    if (!target || !study) {
      await db
        .prepare("DELETE FROM documents WHERE kind='backgroundJob' AND id=?")
        .run(j.id);
      return;
    }
    if (!a || !["admin", "researcher", "collaborator"].includes(a.role)) {
      j.state = "failed";
      j.error = "permission";
      j.version++;
      j.updatedAt = now();
      await put(backgroundKind, j);
      return;
    }
    if (
      target.backgroundJobId === j.id &&
      ((j.kind === "transcription" && (target as LibraryRecording).original) ||
        (j.kind === "render" && (target as RenderJob).state === "complete"))
    ) {
      j.state = "complete";
      j.completed = j.total;
      j.version++;
      j.lease = undefined;
      j.leaseUntil = undefined;
      j.updatedAt = now();
      await releaseTarget(j);
      await put(backgroundKind, j);
      return;
    }
    if (j.kind === "transcription" && target.backgroundJobId === j.id) {
      const r = target as LibraryRecording;
      const saved = r.job?.completed.length || 0;
      // The original source transaction may have committed before the worker died.
      // Checkpoints and attempt/error markers are server-owned, never user-editable.
      const checkpointAdvanced =
        saved > j.completed &&
        saved < j.total &&
        r.status === "uploaded" &&
        !r.attempt;
      const interruptedClaim =
        saved === j.completed &&
        r.status === "transcribing" &&
        !!r.attempt &&
        Date.now() - r.attempt.at >= 120000;
      const recordedFailure =
        saved === j.completed &&
        r.status === "uploaded" &&
        !r.attempt &&
        r.lastError === "provider_or_processing";
      if (checkpointAdvanced || interruptedClaim || recordedFailure) {
        j.targetVersion = r.version;
        if (checkpointAdvanced) {
          j.completed = saved;
          j.stepAttempts = 0;
        }
      }
    }
    if (
      target.backgroundJobId !== j.id ||
      (j.kind === "transcription" &&
        (target as LibraryRecording).version !== j.targetVersion)
    ) {
      j.state = "failed";
      j.error = "source_changed";
      j.version++;
      j.updatedAt = now();
      await put(backgroundKind, j);
      return;
    }
    if (j.stepAttempts >= 3) {
      j.state = "failed";
      j.error = "retry_limit";
      j.version++;
      j.updatedAt = now();
      await put(backgroundKind, j);
      return;
    }
    j.state = "running";
    j.attempts++;
    j.stepAttempts++;
    j.lease = uid();
    j.leaseUntil = Date.now() + 150000;
    j.version++;
    j.updatedAt = now();
    j.dispatchPending = false;
    await put(backgroundKind, j);
    claimed = j;
  });
  if (redispatch) {
    await publish(redispatch.id, redispatch.wake);
    return;
  }
  if (!claimed || !a) return;
  const j = claimed;
  let failed: unknown;
  try {
    if (j.kind === "transcription") {
      const r = await dispatchLibraryRecordings(
        new Request(
          "http://worker/api/library/recordings/" + j.targetId + "/transcribe",
          {
            method: "POST",
            body: JSON.stringify({
              version: j.targetVersion,
              permissionConfirmed: true,
            }),
          },
        ),
        ["library", "recordings", j.targetId, "transcribe"],
        a,
        options.transcribe || transcribeExternalRecording,
        j.id,
      );
      if (!r || !r.ok) throw Error("BACKGROUND_STEP_FAILED");
    } else if (options.render) await options.render(j, a);
    else {
      const r = await dispatchReporting(
        new Request(
          "http://worker/api/studies/" +
            j.studyId +
            "/reporting/jobs/" +
            j.targetId +
            "/run",
          { method: "POST" },
        ),
        ["studies", j.studyId, "reporting", "jobs", j.targetId, "run"],
        a,
        j.id,
      );
      if (!r || !r.ok) throw Error("BACKGROUND_STEP_FAILED");
    }
  } catch (error) {
    failed = error;
  }
  let next: BackgroundJob | undefined;
  await transaction(async () => {
    const current = await get<BackgroundJob>(
      backgroundKind,
      j.id,
      j.workspaceId,
    );
    if (!current || current.lease !== j.lease || current.state !== "running")
      return;
    const target = await jobTarget(current),
      study = await get("study", j.studyId, j.workspaceId);
    if (!target || !study) {
      await db
        .prepare("DELETE FROM documents WHERE kind='backgroundJob' AND id=?")
        .run(j.id);
      return;
    }
    current.lease = undefined;
    current.leaseUntil = undefined;
    current.version++;
    current.updatedAt = now();
    const done =
      current.kind === "transcription"
        ? !!(target as LibraryRecording).original
        : (target as RenderJob).state === "complete";
    current.completed = done
      ? current.total
      : current.kind === "transcription"
        ? (target as LibraryRecording).job?.completed.length || 0
        : 0;
    if (current.kind === "transcription")
      current.targetVersion = (target as LibraryRecording).version;
    if (done) {
      current.state = "complete";
      current.error = undefined;
      await releaseTarget(current);
    } else if (
      failed instanceof HttpError &&
      [400, 403, 404, 409, 413].includes(failed.status)
    ) {
      current.state = "failed";
      current.error = "source_changed";
    } else if (failed || current.kind === "render") {
      current.error = "processing";
      current.state = current.stepAttempts >= 3 ? "failed" : "queued";
      if (current.state === "queued") {
        current.wake++;
        current.dispatchPending = true;
        next = current;
      }
    } else {
      current.state = "queued";
      current.stepAttempts = 0;
      current.wake++;
      current.dispatchPending = true;
      next = current;
    }
    await put(backgroundKind, current);
  });
  if (next)
    await publish(
      next.id,
      next.wake,
      failed ? Math.min(60, next.stepAttempts * 15) : 0,
    );
}
