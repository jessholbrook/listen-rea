import { clearStudyReconciliation } from "./reconciliation-lifecycle";
import { clearStudyNotifications } from "./notification-store";
import { db, list, put, uid, now } from "./db";
import type { Study } from "./domain";
import type { RenderJob, MediaClip, MediaReel } from "./reporting";
export async function queueRenderDeletion(
  s: Study,
  files: string[],
  notBefore?: number,
) {
  if (files.length) {
    const id = uid();
    await put("deletion", {
      id,
      workspaceId: s.workspaceId,
      studyId: s.id,
      files: [...new Set(files)],
      createdAt: now(),
      ...(notBefore ? { notBefore } : {}),
    });
    return id;
  }
}
export async function clearReporting(s: Study) {
  await clearStudyReconciliation(s.workspaceId, s.id);
  await clearStudyNotifications(s.workspaceId, s.id);
  const cfg = await db
    .prepare(
      "SELECT data FROM documents WHERE kind='prolificConfig' AND id=? AND workspace_id=?",
    )
    .get(s.id, s.workspaceId);
  if (cfg) {
    const c = JSON.parse(String(cfg.data));
    await put("prolificConfig", {
      ...c,
      admissionsEnabled: false,
      quote: undefined,
      version: c.version + 1,
    });
  }
  await db
    .prepare(
      "DELETE FROM documents WHERE kind='prolificSubmission' AND workspace_id=? AND study_id=?",
    )
    .run(s.workspaceId, s.id);
  const clipIds = new Set(
    (await list<MediaClip>("mediaClip", s.workspaceId, s.id)).map((c) => c.id),
  );
  const reels = (await list<MediaReel>("mediaReel", s.workspaceId)).filter(
    (r) => r.studyId === s.id || r.clipIds?.some((id) => clipIds.has(id)),
  );
  const reelIds = new Set(reels.map((r) => r.id));
  const jobs = (await list<RenderJob>("renderJob", s.workspaceId)).filter(
    (j) =>
      j.studyId === s.id ||
      reelIds.has(j.reelId) ||
      j.clipVersions?.some((c) => clipIds.has(c.id)) ||
      j.sourceVersions?.some((v) => v.studyId === s.id),
  );
  const imports = await list<{ file: { id: string } }>(
    "presentationImport",
    s.workspaceId,
    s.id,
  );
  await queueRenderDeletion(s, [
    ...jobs.flatMap((j) => (j.outputId ? [j.outputId] : [])),
    ...imports.map((d) => d.file.id),
  ]);
  for (const job of jobs) {
    await db
      .prepare(
        "DELETE FROM documents WHERE workspace_id=? AND kind='backgroundJob' AND json_extract(data,'$.targetId')=?",
      )
      .run(s.workspaceId, job.id);
    await db
      .prepare(
        "DELETE FROM documents WHERE workspace_id=? AND kind='renderJob' AND id=?",
      )
      .run(s.workspaceId, job.id);
  }
  for (const reel of reels)
    await db
      .prepare(
        "DELETE FROM documents WHERE workspace_id=? AND kind='mediaReel' AND id=?",
      )
      .run(s.workspaceId, reel.id);
  for (const studyId of new Set([
    s.id,
    ...jobs.map((j) => j.studyId),
    ...reels.map((r) => r.studyId),
  ]))
    await db
      .prepare("DELETE FROM shares WHERE workspace_id=? AND study_id=?")
      .run(s.workspaceId, studyId);
  await db
    .prepare(
      "DELETE FROM documents WHERE kind='backgroundJob' AND workspace_id=? AND study_id=? AND json_extract(data,'$.kind')='render'",
    )
    .run(s.workspaceId, s.id);
  await db
    .prepare(
      "DELETE FROM documents WHERE workspace_id=? AND study_id=? AND kind IN ('reportEdition','reportSnapshot','mediaClip','mediaReel','renderJob','presentationImport','reportClipDraft','automationPlan','automationExecution')",
    )
    .run(s.workspaceId, s.id);
  // Creation requests acquire a study after insertion. Cover older records whose index was not rebound.
  await db
    .prepare(
      "DELETE FROM documents WHERE kind IN ('automationPlan','automationExecution') AND workspace_id=? AND (study_id=? OR json_extract(data,'$.studyId')=?)",
    )
    .run(s.workspaceId, s.id, s.id);
  await db
    .prepare("DELETE FROM shares WHERE workspace_id=? AND study_id=?")
    .run(s.workspaceId, s.id);
}
