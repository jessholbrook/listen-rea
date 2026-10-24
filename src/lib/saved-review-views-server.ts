import { z } from "zod";
import { db, list, put, uid, now, transaction } from "./db";
import { body, fail, respond } from "./http";
import type { Actor } from "./domain";
import {
  reviewViewContent,
  type SavedReviewView,
  type SavedReviewViewItem,
} from "./saved-review-views";
export const savedViewKind = "librarySavedReviewView";
const editor = (role: string) =>
  ["admin", "researcher", "collaborator"].includes(role);
export async function dispatchSavedReviewViews(
  req: Request,
  p: string[],
  a: Actor,
) {
  if (p[1] !== "saved-review-views") return null;
  if (p.length !== 2 && p.length !== 3)
    fail(404, "Saved view route unavailable.");
  const item = p.length === 3;
  if (!(item ? ["GET", "PUT", "DELETE"] : ["GET", "POST"]).includes(req.method))
    fail(405, "Saved view method unavailable.");
  if (item) z.uuid().parse(p[2]);
  const params = new URL(req.url).searchParams;
  if ([...params.keys()].length !== new Set(params.keys()).size)
    fail(400, "Choose each parameter once.");
  const q = (
    item && req.method === "GET"
      ? z
          .object({ version: z.coerce.number().int().positive().optional() })
          .strict()
      : z.object({}).strict()
  ).parse(Object.fromEntries(params));
  const payload = req.method === "GET" ? null : await body(req);
  return transaction(async () => {
    const members = await db
        .prepare("SELECT id,name,role FROM users WHERE workspace_id=?")
        .all(a.workspaceId),
      actor = members.find((m) => m.id === a.id);
    if (!actor) fail(403, "Workspace access unavailable.");
    const role = String(actor.role),
      canShare = editor(role);
    let records = await list<SavedReviewView>(savedViewKind, a.workspaceId);
    for (const r of records)
      if (
        r.visibility === "private" &&
        !members.some((m) => m.id === r.ownerId)
      )
        await db
          .prepare(
            "DELETE FROM documents WHERE kind=? AND id=? AND workspace_id=?",
          )
          .run(savedViewKind, r.id, a.workspaceId);
    records = records.filter(
      (r) =>
        r.visibility === "shared" || members.some((m) => m.id === r.ownerId),
    );
    const visible = (r: SavedReviewView) =>
      r.visibility === "shared" || r.ownerId === a.id;
    const manageable = (r: SavedReviewView) =>
      r.visibility === "private"
        ? r.ownerId === a.id
        : canShare && (r.ownerId === a.id || role === "admin");
    const view = (r: SavedReviewView): SavedReviewViewItem => ({
      id: r.id,
      name: r.name,
      visibility: r.visibility,
      config: r.config,
      version: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      owner: {
        id: r.ownerId,
        name:
          String(members.find((m) => m.id === r.ownerId)?.name || "") || null,
      },
      canManage: manageable(r),
      canChangeVisibility: r.ownerId === a.id,
    });
    if (!item && req.method === "GET")
      return respond({
        views: records
          .filter(visible)
          .map(view)
          .sort(
            (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
          ),
        canShare,
      });
    const old = item ? records.find((r) => r.id === p[2]) : undefined;
    if (item && (!old || !visible(old))) fail(404, "Saved view unavailable.");
    if (req.method === "GET") {
      if (
        "version" in q &&
        q.version !== undefined &&
        q.version !== old!.version
      )
        fail(409, "Saved view changed. Refresh the list before applying it.");
      return respond({ view: view(old!) });
    }
    if (old && !manageable(old))
      fail(403, "Only the creator or an admin can manage shared views.");
    if (req.method === "DELETE") {
      const v = z
        .object({ version: z.number().int().positive() })
        .strict()
        .parse(payload);
      if (old!.version !== v.version)
        fail(409, "Saved view changed. Refresh before deleting.");
      await db
        .prepare(
          "DELETE FROM documents WHERE kind=? AND id=? AND workspace_id=?",
        )
        .run(savedViewKind, old!.id, a.workspaceId);
      return respond({ ok: true });
    }
    const v = (
      item
        ? reviewViewContent
            .extend({ version: z.number().int().positive() })
            .strict()
        : reviewViewContent
    ).parse(payload);
    if (old && old.version !== (v as typeof v & { version: number }).version)
      fail(409, "Saved view changed. Refresh before saving.");
    if (v.visibility === "shared" && !canShare)
      fail(403, "An editor must create or update workspace-shared views.");
    if (old && old.ownerId !== a.id && v.visibility !== old.visibility)
      fail(
        403,
        "Only the creator can change a saved view’s visibility. Save your own private copy instead.",
      );
    const ownerId = old?.ownerId || a.id;
    const count = records.filter(
      (r) =>
        r.id !== old?.id &&
        r.visibility === v.visibility &&
        (v.visibility === "shared" || r.ownerId === ownerId),
    ).length;
    if (count >= (v.visibility === "shared" ? 50 : 25))
      fail(
        409,
        v.visibility === "shared"
          ? "This workspace has reached its 50-shared-view limit."
          : "You have reached your 25-private-view limit.",
      );
    const at = now(),
      record: SavedReviewView = {
        id: old?.id || uid(),
        workspaceId: a.workspaceId,
        ownerId,
        name: v.name,
        visibility: v.visibility,
        config: v.config,
        version: (old?.version || 0) + 1,
        createdAt: old?.createdAt || at,
        updatedAt: at,
      };
    await put(savedViewKind, record);
    return respond({ view: view(record) });
  });
}
