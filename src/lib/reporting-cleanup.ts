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
      "DELETE FROM documents WHERE workspace_id=? AND study_id=? AND kind IN ('reportEdition','reportSnapshot','mediaClip','mediaReel','renderJob','presentationImport','reportClipDraft')",
    )
    .run(s.workspaceId, s.id);
  await db
    .prepare("DELETE FROM shares WHERE workspace_id=? AND study_id=?")
    .run(s.workspaceId, s.id);
}
