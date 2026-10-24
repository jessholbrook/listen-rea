import { recordTaskActivity } from "./task-activity-records";
import { db, get, put, now, transaction } from "./db";
import { body, fail, respond, HttpError } from "./http";
import type { Actor } from "./domain";
import type { LibraryCollection } from "./library-collections";
import type { CollectionTask } from "./collection-tasks";
import { currentCollectionTasks } from "./collection-tasks-server";
import { currentHandoffInboxPacket } from "./collection-handoff-server";
import {
  triagePreviewInput,
  triageApplyInput,
  type TriageChanges,
  type TriageTarget,
  type TriageRow,
  type TriageStatus,
} from "./operations-triage";
const editor = async (a: Actor) => {
  const u = await db
    .prepare("SELECT role,workspace_id FROM users WHERE id=?")
    .get(a.id);
  return (
    !!u &&
    u.workspace_id === a.workspaceId &&
    ["admin", "researcher", "collaborator"].includes(String(u.role))
  );
};
const members = async (a: Actor) =>
  (
    await db
      .prepare("SELECT id,name FROM users WHERE workspace_id=?")
      .all(a.workspaceId)
  ).map((m) => ({ id: String(m.id), name: String(m.name) }));
async function taskChange(
  a: Actor,
  target: TriageTarget,
  changes: TriageChanges,
  apply: boolean,
): Promise<TriageRow> {
  return transaction(async () => {
    const result = (status: TriageStatus): TriageRow => ({ ...target, status });
    if (!(await editor(a))) return result("forbidden");
    const tasks = await currentCollectionTasks(a, target.collectionId),
      t = tasks.find((t) => t.id === target.id),
      collection = await get<LibraryCollection>(
        "libraryCollection",
        target.collectionId,
        a.workspaceId,
      );
    if (!t || !collection) return result("unavailable");
    if (t.version !== target.version) return result("conflict");
    const people = await members(a);
    const assignment = changes.assignee;
    if (
      assignment.mode === "set" &&
      !people.some((m) => m.id === assignment.id)
    )
      return result("conflict");
    const assigneeId =
        changes.assignee.mode === "keep"
          ? t.assigneeId
          : changes.assignee.mode === "clear"
            ? null
            : changes.assignee.id,
      dueDate =
        changes.dueDate.mode === "keep"
          ? t.dueDate
          : changes.dueDate.mode === "clear"
            ? null
            : changes.dueDate.date,
      changed = assigneeId !== t.assigneeId || dueDate !== t.dueDate,
      person = (id: string | null) =>
        id ? { id, name: people.find((p) => p.id === id)?.name || null } : null;
    const row: TriageRow = {
      ...target,
      status: changed ? "ready" : "unchanged",
      title: t.title,
      collectionTitle: collection.title,
      taskStatus: t.status,
      before: { assignee: person(t.assigneeId), dueDate: t.dueDate },
      after: { assignee: person(assigneeId), dueDate },
    };
    if (apply && changed) {
      const updated: CollectionTask = {
        ...t,
        assigneeId,
        dueDate,
        version: t.version + 1,
        updatedAt: now(),
      };
      await put("libraryCollectionTask", updated);
      await recordTaskActivity(updated, t, a.id, "task_triaged");
      // Follow the original handoff signature rules immediately after the task change.
      await currentHandoffInboxPacket(a, t.collectionId);
      return { ...row, status: "applied", version: updated.version };
    }
    return row;
  });
}
export async function dispatchOperationsTriage(
  req: Request,
  p: string[],
  a: Actor,
) {
  if (p[1] !== "operations-triage") return null;
  if (p.length !== 3 || !["preview", "apply"].includes(p[2]))
    fail(404, "Triage route unavailable.");
  if (req.method !== "POST") fail(405, "Triage requires POST.");
  if (new URL(req.url).search)
    fail(400, "Triage does not accept query parameters.");
  const apply = p[2] === "apply",
    input = (apply ? triageApplyInput : triagePreviewInput).parse(
      await body(req),
    );
  await transaction(async () => {
    if (!(await editor(a))) fail(403, "Edit access unavailable.");
    const assignment = input.changes.assignee;
    if (
      assignment.mode === "set" &&
      !(await members(a)).some((m) => m.id === assignment.id)
    )
      fail(409, "Assignee unavailable. Refresh before previewing again.");
  });
  const tasks: TriageRow[] = [];
  for (const target of input.tasks) {
    try {
      tasks.push(await taskChange(a, target, input.changes, apply));
    } catch (error) {
      tasks.push({
        ...target,
        status:
          error instanceof HttpError
            ? error.status === 403
              ? "forbidden"
              : error.status === 404
                ? "unavailable"
                : error.status === 409
                  ? "conflict"
                  : "failed"
            : "failed",
      });
    }
  }
  const rows = await transaction(async () => {
    if (!(await editor(a)))
      return tasks.map((t) => ({
        id: t.id,
        collectionId: t.collectionId,
        version: t.version,
        status: "forbidden" as const,
      }));
    const current = await currentCollectionTasks(a);
    return tasks.map((t) =>
      current.some((c) => c.id === t.id && c.collectionId === t.collectionId)
        ? t
        : {
            id: t.id,
            collectionId: t.collectionId,
            version: t.version,
            status: "unavailable" as const,
          },
    );
  });
  return respond({ changes: input.changes, tasks: rows });
}
