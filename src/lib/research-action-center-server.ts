import { db, list, transaction } from "./db";
import { fail, respond } from "./http";
import type { Actor } from "./domain";
import type { LibraryCollection } from "./library-collections";
import { currentCollectionTasks } from "./collection-tasks-server";
import { taskView } from "./collection-tasks";
import type { ActionCenter } from "./research-action-center";
export async function dispatchActionCenter(
  req: Request,
  p: string[],
  a: Actor,
) {
  if (p[1] !== "action-center") return null;
  if (p.length !== 2) fail(404, "Action center route unavailable.");
  if (req.method !== "GET")
    fail(405, "Action center is read-only. Edit the original collection task.");
  return transaction(async () => {
    const tasks = await currentCollectionTasks(a);
    const collections = (
      await list<LibraryCollection>("libraryCollection", a.workspaceId)
    )
      .map((c) => ({ id: c.id, title: c.title }))
      .sort(
        (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
      );
    const members = (
      await db
        .prepare(
          "SELECT id,name FROM users WHERE workspace_id=? ORDER BY name,id",
        )
        .all(a.workspaceId)
    ).map((m) => ({ id: String(m.id), name: String(m.name) }));
    const targets = await db
      .prepare(
        "SELECT kind,id,json_extract(data,'$.origin.title') AS interview_title,json_extract(data,'$.original.question') AS question,json_extract(data,'$.scope') AS scope,json_extract(data,'$.title') AS title FROM documents WHERE workspace_id=? AND kind IN ('interview','libraryAnswer','libraryBrief') AND id IN (SELECT value FROM json_each(?))",
      )
      .all(
        a.workspaceId,
        JSON.stringify([
          ...new Set(tasks.flatMap((t) => (t.target ? [t.target.id] : []))),
        ]),
      );
    const result: ActionCenter = {
      collections,
      members,
      userId: a.id,
      canEdit: ["admin", "researcher", "collaborator"].includes(a.role),
      tasks: tasks.map((t) => {
        const target = t.target,
          kind =
            target?.kind === "answer"
              ? "libraryAnswer"
              : target?.kind === "brief"
                ? "libraryBrief"
                : "interview",
          row = target
            ? targets.find((r) => r.id === target.id && r.kind === kind)
            : undefined;
        return {
          ...taskView(t),
          source: row
            ? {
                label: String(
                  target?.kind === "interview"
                    ? row.interview_title || "Echo Lab interview"
                    : target?.kind === "answer"
                      ? row.question
                      : row.title,
                ).slice(0, 160),
                ...(target?.kind === "answer"
                  ? {
                      scope:
                        row.scope === "transcripts"
                          ? ("transcripts" as const)
                          : ("attachments" as const),
                    }
                  : {}),
              }
            : null,
        };
      }),
    };
    return respond(result);
  });
}
