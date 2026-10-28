import {
  db,
  get,
  list,
  put,
  uid,
  hash,
  now,
  transaction,
  requireStudy,
} from "./db";
import { canEdit, fail } from "./http";
import type { Actor } from "./domain";
import type { LibraryRecording } from "./library-recordings";
import { transcriptionStepMs } from "./library-recordings";
import type { RenderJob } from "./reporting";
import {
  activeJob,
  backgroundCreate,
  type BackgroundJob,
} from "./background-jobs";
export const backgroundKind = "backgroundJob";
export async function jobActor(j: BackgroundJob): Promise<Actor | undefined> {
  const u = await db
    .prepare(
      "SELECT id,email,name,workspace_id,role FROM users WHERE id=? AND workspace_id=?",
    )
    .get(j.creatorId, j.workspaceId);
  return u
    ? {
        id: String(u.id),
        email: String(u.email),
        name: String(u.name),
        workspaceId: String(u.workspace_id),
        role: u.role as Actor["role"],
      }
    : undefined;
}
export async function jobTarget(j: BackgroundJob) {
  return j.kind === "transcription"
    ? get<LibraryRecording>("libraryRecording", j.targetId, j.workspaceId)
    : get<RenderJob>("renderJob", j.targetId, j.workspaceId);
}
export async function pruneBackgroundJobs(workspaceId?: string) {
  // No content snapshots. Erased sources revoke queued and completed coordination immediately.
  await db
    .prepare(
      "DELETE FROM documents WHERE kind='backgroundJob' AND (? IS NULL OR workspace_id=?) AND (NOT EXISTS (SELECT 1 FROM documents s WHERE s.kind='study' AND s.id=documents.study_id AND s.workspace_id=documents.workspace_id) OR NOT EXISTS (SELECT 1 FROM documents t WHERE t.workspace_id=documents.workspace_id AND t.id=json_extract(documents.data,'$.targetId') AND t.kind=CASE json_extract(documents.data,'$.kind') WHEN 'transcription' THEN 'libraryRecording' ELSE 'renderJob' END))",
    )
    .run(workspaceId || null, workspaceId || null);
}
export async function createBackgroundJob(a: Actor, payload: unknown) {
  canEdit(a);
  const input = backgroundCreate.parse(payload),
    inputHash = hash(JSON.stringify(input));
  return transaction(async () => {
    await requireStudy(input.studyId, a);
    await pruneBackgroundJobs(a.workspaceId);
    const existing = (
      await list<BackgroundJob>(backgroundKind, a.workspaceId)
    ).find((j) => j.requestId === input.requestId);
    if (existing) {
      if (existing.inputHash !== inputHash)
        fail(409, "This request has different settings.");
      return { job: existing, reused: true };
    }
    if (
      (await list<BackgroundJob>(backgroundKind, a.workspaceId)).filter(
        activeJob,
      ).length >= 20
    )
      fail(409, "This workspace has 20 active jobs. Wait or cancel one first.");
    if (
      (await list<BackgroundJob>(backgroundKind, a.workspaceId)).some(
        (j) => j.targetId === input.targetId && activeJob(j),
      )
    )
      fail(409, "This source already has an active background job.");
    const j: BackgroundJob = {
      id: uid(),
      workspaceId: a.workspaceId,
      studyId: input.studyId,
      creatorId: a.id,
      requestId: input.requestId,
      inputHash,
      kind: input.kind,
      targetId: input.targetId,
      targetVersion: input.version,
      state: "queued",
      version: 1,
      wake: 1,
      dispatchPending: true,
      attempts: 0,
      stepAttempts: 0,
      completed: 0,
      total: 1,
      createdAt: now(),
      updatedAt: now(),
    };
    if (j.kind === "transcription") {
      const r = await get<LibraryRecording>(
        "libraryRecording",
        j.targetId,
        a.workspaceId,
      );
      if (!r || r.studyId !== j.studyId) fail(404, "Recording unavailable.");
      if (r.version !== input.version)
        fail(409, "Recording changed. Refresh first.");
      if (
        !r.file ||
        r.original ||
        r.status === "imported" ||
        r.backgroundJobId ||
        (r.attempt && Date.now() - r.attempt.at < 120000)
      )
        fail(
          409,
          "Upload an available recording before starting a background job.",
        );
      r.backgroundJobId = j.id;
      r.version++;
      j.targetVersion = r.version;
      j.completed = r.job?.completed.length || 0;
      j.total = Math.ceil(r.file.durationMs / transcriptionStepMs);
      await put("libraryRecording", r);
    } else {
      const r = await get<RenderJob>("renderJob", j.targetId, a.workspaceId);
      if (!r || r.studyId !== j.studyId) fail(404, "Render job unavailable.");
      if (
        r.reelVersion !== input.version ||
        r.state === "complete" ||
        r.backgroundJobId ||
        (r.state === "running" && (r.leaseUntil || 0) > Date.now())
      )
        fail(409, "Render changed or is already processing. Refresh first.");
      r.backgroundJobId = j.id;
      await put("renderJob", r);
    }
    await put(backgroundKind, j);
    return { job: j, reused: false };
  });
}
export async function releaseTarget(j: BackgroundJob, cancel = false) {
  if (j.kind === "transcription") {
    const r = await get<LibraryRecording>(
      "libraryRecording",
      j.targetId,
      j.workspaceId,
    );
    if (r?.backgroundJobId === j.id) {
      r.backgroundJobId = undefined;
      if (cancel) {
        r.attempt = undefined;
        r.status = r.original ? "draft" : "uploaded";
        r.version++;
      }
      await put("libraryRecording", r);
    }
  } else {
    const r = await get<RenderJob>("renderJob", j.targetId, j.workspaceId);
    if (r?.backgroundJobId === j.id) {
      r.backgroundJobId = undefined;
      if (cancel && r.state !== "complete") {
        if (r.outputId)
          await put("deletion", {
            id: uid(),
            workspaceId: j.workspaceId,
            studyId: j.studyId,
            files: [r.outputId],
            createdAt: now(),
            notBefore: Date.now() + 180000,
          });
        r.lease = undefined;
        r.leaseUntil = undefined;
        r.state = "failed";
        r.error =
          "Background job cancelled. Saved source clips remain available.";
      }
      await put("renderJob", r);
    }
  }
}
export async function changeBackgroundJob(
  a: Actor,
  id: string,
  input: { version: number; op: "cancel" | "retry" | "dispatch" },
) {
  canEdit(a);
  return transaction(async () => {
    await pruneBackgroundJobs(a.workspaceId);
    const j = await get<BackgroundJob>(backgroundKind, id, a.workspaceId);
    if (!j) fail(404, "Job unavailable.");
    if (j.version !== input.version) fail(409, "Job changed. Refresh first.");
    if (input.op === "cancel") {
      if (j.state === "complete" || j.state === "cancelled")
        fail(409, "Job already finished.");
      await releaseTarget(j, true);
      j.state = "cancelled";
      j.lease = undefined;
      j.leaseUntil = undefined;
      j.wake++;
    } else {
      if (input.op === "retry") {
        if (j.state !== "failed") fail(409, "Only failed jobs can be retried.");
        const r = await jobTarget(j);
        if (!r || r.backgroundJobId !== j.id)
          fail(409, "The source changed. Start a new job.");
        const owner = await jobActor(j);
        if (
          !owner ||
          !["admin", "researcher", "collaborator"].includes(owner.role)
        )
          fail(
            409,
            "The requesting member no longer has edit access. Cancel this job and create a new one.",
          );
        j.state = "queued";
        j.stepAttempts = 0;
        j.error = undefined;
        j.wake++;
      } else if (
        j.state !== "queued" &&
        !(j.state === "running" && (j.leaseUntil || 0) < Date.now())
      )
        fail(409, "This job does not need delivery recovery.");
      j.dispatchPending = true;
    }
    j.version++;
    j.updatedAt = now();
    await put(backgroundKind, j);
    return j;
  });
}
