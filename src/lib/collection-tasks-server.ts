import { recordTaskActivity } from "./task-activity-records";
import { z } from "zod";
import {
  db,
  get,
  list,
  put,
  uid,
  now,
  hash,
  transaction,
  pruneLibraryCollections,
  removeCollectionTask,
} from "./db";
import { body, canEdit, fail, respond, HttpError } from "./http";
import type { Actor } from "./domain";
import type { LibraryCollection } from "./library-collections";
import { requireCurrentLibraryAnswer } from "./library-answers-server";
import { currentLibraryBrief } from "./library-briefs-server";
import {
  taskCreate,
  taskEdit,
  taskView,
  type CollectionTask,
} from "./collection-tasks";
const kind = "libraryCollectionTask";
export async function currentCollectionTasks(a: Actor, collectionId?: string) {
  await pruneLibraryCollections(a.workspaceId);
  const pending = (await list<CollectionTask>(kind, a.workspaceId)).filter(
    (t) => !collectionId || t.collectionId === collectionId,
  );
  for (const id of new Set(
    pending.filter((t) => t.target?.kind === "answer").map((t) => t.target!.id),
  )) {
    await requireCurrentLibraryAnswer(a, id).catch((e) => {
      if (!(e instanceof HttpError && e.status === 404)) throw e;
    });
  }
  for (const id of new Set(
    pending.filter((t) => t.target?.kind === "brief").map((t) => t.target!.id),
  )) {
    await currentLibraryBrief(a, id).catch((e) => {
      if (!(e instanceof HttpError && e.status === 404)) throw e;
    });
  }
  await pruneLibraryCollections(a.workspaceId);
  return (await list<CollectionTask>(kind, a.workspaceId)).filter(
    (t) => !collectionId || t.collectionId === collectionId,
  );
}
export async function dispatchCollectionTasks(
  req: Request,
  p: string[],
  a: Actor,
) {
  if (p[1] !== "collections" || p[3] !== "tasks") return null;
  if (p.length !== 4 && p.length !== 5) fail(404, "Task route unavailable.");
  const collectionId = z.uuid().parse(p[2]);
  if (p.length === 5) z.uuid().parse(p[4]);
  if (
    !["GET", "POST", "PUT", "DELETE"].includes(req.method) ||
    (p.length === 4 && !["GET", "POST"].includes(req.method)) ||
    (p.length === 5 && !["PUT", "DELETE"].includes(req.method))
  )
    fail(405, "Task method unavailable.");
  const payload =
    req.method === "GET" ? undefined : (canEdit(a), await body(req));
  return transaction(async () => {
    const member = await db
      .prepare("SELECT role,workspace_id FROM users WHERE id=?")
      .get(a.id);
    if (!member || member.workspace_id !== a.workspaceId)
      fail(403, "Workspace access unavailable.");
    const currentEditor =
      ["admin", "researcher", "collaborator"].includes(a.role) &&
      ["admin", "researcher", "collaborator"].includes(String(member.role));
    if (req.method !== "GET" && !currentEditor)
      fail(403, "Edit access unavailable.");
    await pruneLibraryCollections(a.workspaceId);
    const c = await get<LibraryCollection>(
      "libraryCollection",
      collectionId,
      a.workspaceId,
    );
    if (!c) fail(404, "Collection unavailable.");
    const tasks = await currentCollectionTasks(a, collectionId);
    const members = await db
      .prepare(
        "SELECT id,name FROM users WHERE workspace_id=? ORDER BY name,id",
      )
      .all(a.workspaceId);
    if (req.method === "GET")
      return respond({
        tasks: tasks
          .sort(
            (a, b) =>
              a.createdAt.localeCompare(b.createdAt) ||
              a.id.localeCompare(b.id),
          )
          .map(taskView),
        members,
        canEdit: currentEditor,
        userId: a.id,
      });
    if (req.method === "DELETE") {
      const { version } = z
        .object({ version: z.number().int().positive() })
        .strict()
        .parse(payload);
      const task = tasks.find((t) => t.id === p[4]);
      if (!task) fail(404, "Task unavailable.");
      if (task.version !== version)
        fail(409, "Task changed. Refresh before deleting.");
      await removeCollectionTask(task);
      await pruneLibraryCollections(a.workspaceId);
      return respond({ deleted: true });
    }
    const input =
      req.method === "POST"
        ? taskCreate.parse(payload)
        : taskEdit.parse(payload);
    if (input.assigneeId && !members.some((m) => m.id === input.assigneeId))
      fail(404, "Choose an assignee from this workspace.");
    const content = {
      title: input.title,
      assigneeId: input.assigneeId,
      dueDate: input.dueDate,
      status: input.status,
    };
    if (req.method === "PUT") {
      const { version } = taskEdit.parse(payload),
        t = tasks.find((t) => t.id === p[4]);
      if (!t) fail(404, "Task unavailable.");
      if (version > t.version)
        fail(409, "Task changed. Refresh before saving.");
      if (
        JSON.stringify(content) ===
        JSON.stringify({
          title: t.title,
          assigneeId: t.assigneeId,
          dueDate: t.dueDate,
          status: t.status,
        })
      )
        return respond({ task: taskView(t), reused: true });
      if (version !== t.version)
        fail(409, "Task changed. Refresh before saving.");
      const updated = {
        ...t,
        ...content,
        version: t.version + 1,
        updatedAt: now(),
        completedAt:
          content.status === "completed" ? t.completedAt || now() : null,
      };
      await put(kind, updated);
      await recordTaskActivity(updated, t, a.id, "task_updated");
      return respond({ task: taskView(updated) });
    }
    const { requestId, target } = taskCreate.parse(payload),
      inputHash = hash(JSON.stringify({ collectionId, ...content, target }));
    if (
      await get(
        "libraryCollectionTaskTombstone",
        hash(a.workspaceId + ":" + requestId),
        a.workspaceId,
      )
    )
      fail(409, "This task request was deleted. Start a new task.");
    const existing = (await list<CollectionTask>(kind, a.workspaceId)).find(
      (t) => t.requestId === requestId,
    );
    if (existing) {
      if (existing.inputHash !== inputHash)
        fail(409, "This request has different task settings.");
      return respond({ task: taskView(existing), reused: true });
    }
    if (tasks.length >= 100)
      fail(409, "This collection has 100 tasks. Delete one first.");
    if (target?.kind === "interview" && !c.interviewIds.includes(target.id))
      fail(404, "Interview unavailable in this collection.");
    if (target?.kind === "answer") {
      const answer = await requireCurrentLibraryAnswer(a, target.id);
      if (answer.filter.collectionId !== collectionId)
        fail(404, "Answer unavailable in this collection.");
    }
    if (target?.kind === "brief") {
      if (!c.briefIds.includes(target.id))
        fail(404, "Brief unavailable in this collection.");
      await currentLibraryBrief(a, target.id);
    }
    const t: CollectionTask = {
      ...content,
      target,
      id: uid(),
      workspaceId: a.workspaceId,
      collectionId,
      requestId,
      inputHash,
      version: 1,
      createdAt: now(),
      updatedAt: now(),
      completedAt: content.status === "completed" ? now() : null,
    };
    await put(kind, t);
    await recordTaskActivity(t, null, a.id, "task_created");
    return respond({ task: taskView(t) }, 201);
  });
}
