import { db } from "./db";
export async function clearStudyReconciliation(
  workspaceId: string,
  studyId: string,
) {
  await db
    .prepare(
      "DELETE FROM documents WHERE kind='reconciliationRun' AND workspace_id=? AND EXISTS (SELECT 1 FROM json_each(json_extract(data,'$.studyIds')) WHERE value=?)",
    )
    .run(workspaceId, studyId);
}
export async function pruneReconciliation(workspaceId?: string) {
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  await db
    .prepare(
      "DELETE FROM documents WHERE kind IN ('reconciliationRun','reconciliationReceipt') AND json_extract(data,'$.createdAt')<?" +
        (workspaceId ? " AND workspace_id=?" : ""),
    )
    .run(cutoff, ...(workspaceId ? [workspaceId] : []));
}
