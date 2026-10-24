import { db, list, put, uid, now } from "./db";
import type { Study } from "./domain";
import type { RenderJob } from "./reporting";
export async function queueRenderDeletion(s: Study, files: string[]) {
  if (files.length)
    await put("deletion", {
      id: uid(),
      workspaceId: s.workspaceId,
      studyId: s.id,
      files: [...new Set(files)],
      createdAt: now(),
    });
}
export async function clearReporting(s: Study) {
  const jobs = await list<RenderJob>("renderJob", s.workspaceId, s.id);
  await queueRenderDeletion(
    s,
    jobs.flatMap((j) => (j.outputId ? [j.outputId] : [])),
  );
  await db
    .prepare(
      "DELETE FROM documents WHERE workspace_id=? AND study_id=? AND kind IN ('reportEdition','reportSnapshot','mediaClip','mediaReel','renderJob')",
    )
    .run(s.workspaceId, s.id);
  await db
    .prepare("DELETE FROM shares WHERE workspace_id=? AND study_id=?")
    .run(s.workspaceId, s.id);
}
