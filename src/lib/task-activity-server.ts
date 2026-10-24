import { z } from "zod";
import { db, list, transaction } from "./db";
import { fail, respond } from "./http";
import type { Actor } from "./domain";
import type { LibraryCollection } from "./library-collections";
import { currentCollectionTasks } from "./collection-tasks-server";
import { taskActivityKind } from "./task-activity-records";
import {
  taskActivityActions,
  taskActivityFields,
  type TaskActivity,
  type TaskActivityView,
  type TaskEventView,
  type TaskState,
} from "./task-activity";
import { planDate } from "./review-plans";
export async function dispatchTaskActivity(
  req: Request,
  p: string[],
  a: Actor,
  reportAll = false,
) {
  if (p[1] !== "task-activity") return null;
  if (p.length !== 2) fail(404, "Task history route unavailable.");
  if (req.method !== "GET") fail(405, "Task history is read-only.");
  const params = new URL(req.url).searchParams;
  if ([...params.keys()].length !== new Set(params.keys()).size)
    fail(400, "Choose each filter once.");
  const id = z.union([z.uuid(), z.literal("")]).default("");
  const q = z
    .object({
      collectionId: id,
      taskId: id,
      personId: z
        .union([z.uuid(), z.literal(""), z.literal("system")])
        .default(""),
      action: z.union([z.enum(taskActivityActions), z.literal("")]).default(""),
      field: z.union([z.enum(taskActivityFields), z.literal("")]).default(""),
      from: z.union([planDate, z.literal("")]).default(""),
      to: z.union([planDate, z.literal("")]).default(""),
      timeZone: z
        .string()
        .max(100)
        .refine((s) => {
          try {
            new Intl.DateTimeFormat("en", { timeZone: s });
            return true;
          } catch {
            return false;
          }
        }, "Choose a valid time zone.")
        .default("UTC"),
      page: z.coerce.number().int().min(0).max(100000).default(0),
    })
    .strict()
    .parse(Object.fromEntries(params));
  if (q.from && q.to && q.from > q.to)
    fail(400, "Choose an end date on or after the start date.");
  return transaction(async () => {
    const actor = await db
      .prepare("SELECT workspace_id FROM users WHERE id=?")
      .get(a.id);
    if (!actor || actor.workspace_id !== a.workspaceId)
      fail(403, "Workspace access unavailable.");
    const tasks = await currentCollectionTasks(a),
      collections = await list<LibraryCollection>(
        "libraryCollection",
        a.workspaceId,
      ),
      members = await db
        .prepare("SELECT id,name FROM users WHERE workspace_id=?")
        .all(a.workspaceId),
      person = (id: string) => ({
        id,
        name: String(members.find((m) => m.id === id)?.name || "") || null,
      });
    const logs = (
      await list<TaskActivity>(taskActivityKind, a.workspaceId)
    ).filter((r) =>
      tasks.some((t) => t.id === r.id && t.collectionId === r.collectionId),
    );
    const projected = (s: TaskState) => ({
      assignee: s.assigneeId ? person(s.assigneeId) : null,
      dueDate: s.dueDate,
      status: s.status,
    });
    const events: TaskEventView[] = logs
      .flatMap((r) => {
        const task = tasks.find((t) => t.id === r.id)!,
          c = collections.find((c) => c.id === task.collectionId)!;
        return r.events.map((e) => {
          const { actorId, before, after, ...safe } = e;
          return {
            ...safe,
            actor: actorId ? person(actorId) : null,
            before: before ? projected(before) : null,
            after: projected(after),
            task: {
              id: task.id,
              collectionId: task.collectionId,
              title: task.title,
              collectionTitle: c.title,
            },
          };
        });
      })
      .sort(
        (a, b) =>
          b.at.localeCompare(a.at) ||
          a.task.id.localeCompare(b.task.id) ||
          b.sequence - a.sequence ||
          b.id.localeCompare(a.id),
      );
    const fmt = new Intl.DateTimeFormat("en", {
      timeZone: q.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const day = (at: string) => {
      const p = fmt.formatToParts(new Date(at));
      return ["year", "month", "day"]
        .map((t) => p.find((p) => p.type === t)!.value)
        .join("-");
    };
    const filtered = events.filter(
      (e) =>
        (!q.collectionId || e.task.collectionId === q.collectionId) &&
        (!q.taskId || e.task.id === q.taskId) &&
        (!q.action || e.action === q.action) &&
        (!q.personId ||
          (q.personId === "system"
            ? !e.actor
            : [
                e.actor?.id,
                e.before?.assignee?.id,
                e.after.assignee?.id,
              ].includes(q.personId))) &&
        (!q.field ||
          (q.field === "title"
            ? e.titleChanged
            : q.field === "assignee"
              ? e.before?.assignee?.id !== e.after.assignee?.id
              : q.field === "dueDate"
                ? (e.before?.dueDate || null) !== e.after.dueDate
                : e.before?.status !== e.after.status)) &&
        (!q.from || day(e.at) >= q.from) &&
        (!q.to || day(e.at) <= q.to),
    );
    if (reportAll && filtered.length > 1000)
      fail(413, "Narrow the history filters to at most 1,000 events.");
    const pages = Math.max(1, Math.ceil(filtered.length / 20)),
      page = Math.min(q.page, pages - 1),
      ids = new Set(
        events.flatMap((e) =>
          [e.actor?.id, e.before?.assignee?.id, e.after.assignee?.id].filter(
            (id): id is string => !!id,
          ),
        ),
      );
    const result: TaskActivityView = {
      events: reportAll ? filtered : filtered.slice(page * 20, page * 20 + 20),
      total: filtered.length,
      page,
      pages,
      omitted: logs
        .filter(
          (r) =>
            (!q.collectionId || r.collectionId === q.collectionId) &&
            (!q.taskId || r.id === q.taskId),
        )
        .reduce((s, r) => s + r.omitted, 0),
      tasks: tasks
        .map((t) => ({
          id: t.id,
          title: t.title,
          collectionId: t.collectionId,
        }))
        .sort(
          (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
        ),
      collections: collections
        .map((c) => ({ id: c.id, title: c.title }))
        .sort(
          (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
        ),
      people: [...ids]
        .map(person)
        .sort(
          (a, b) =>
            (a.name || "").localeCompare(b.name || "") ||
            a.id.localeCompare(b.id),
        ),
    };
    return respond(result);
  });
}
