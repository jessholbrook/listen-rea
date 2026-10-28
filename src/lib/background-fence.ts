import { db, get } from "./db";
import { fail } from "./http";
import type { BackgroundJob } from "./background-jobs";
// Called inside the original output transaction, after expensive work and before publishing its result.
export async function assertBackgroundPermission(
  id: string,
  workspaceId: string,
) {
  const j = await get<BackgroundJob>("backgroundJob", id, workspaceId);
  if (!j || j.state !== "running" || (j.leaseUntil || 0) < Date.now())
    fail(409, "Background processing was cancelled or superseded.");
  const u = await db
    .prepare("SELECT role FROM users WHERE id=? AND workspace_id=?")
    .get(j.creatorId, workspaceId);
  if (!u || !["admin", "researcher", "collaborator"].includes(String(u.role)))
    fail(403, "Background processing permission changed.");
}
