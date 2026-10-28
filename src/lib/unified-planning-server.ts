import { db, list, transaction } from "./db";
import { fail, respond } from "./http";
import type { Actor } from "./domain";
import { dispatchActionCenter } from "./research-action-center-server";
import { dispatchReviewInbox } from "./team-review-inbox-server";
import type { ActionCenter } from "./research-action-center";
import type { ReviewInbox } from "./team-review-inbox";
export async function dispatchUnifiedPlanning(
  req: Request,
  p: string[],
  a: Actor,
) {
  if (p[1] !== "unified-planning") return null;
  if (p.length !== 2) fail(404, "Planning route unavailable.");
  if (req.method !== "GET")
    fail(405, "Planning is read-only; use the original scheduling workflows.");
  if (new URL(req.url).search)
    fail(400, "Planning query parameters are unavailable.");
  return transaction(async () => {
    const member = await db
      .prepare("SELECT workspace_id,role FROM users WHERE id=?")
      .get(a.id);
    if (!member || member.workspace_id !== a.workspaceId)
      fail(403, "Workspace access unavailable.");
    const readActions = async () =>
      (await (await dispatchActionCenter(
        new Request("http://localhost/api/library/action-center"),
        ["library", "action-center"],
        a,
      ))!.json()) as ActionCenter;
    await readActions();
    const reviews = (await (await dispatchReviewInbox(
      new Request("http://localhost/api/library/review-inbox"),
      ["library", "review-inbox"],
      a,
    ))!.json()) as ReviewInbox;
    const actions = await readActions();
    const remaining = new Set(
      (
        await list<{ id: string }>("libraryCollectionHandoff", a.workspaceId)
      ).map((p) => p.id),
    );
    reviews.packets = reviews.packets.filter((p) => remaining.has(p.id));
    const editable =
      ["admin", "researcher", "collaborator"].includes(String(member.role)) &&
      ["admin", "researcher", "collaborator"].includes(a.role);
    actions.canEdit = editable;
    reviews.canEdit = editable;
    return respond({ actions, reviews, loadedAt: new Date().toISOString() });
  });
}
