import { z } from "zod";
import { db, get, list, put, hash, now, transaction } from "./db";
import { body, fail, respond } from "./http";
import type { Actor } from "./domain";
import type { PinBoard, PinScope } from "./operations-workspace";
import type { SavedReviewViewList } from "./saved-review-views";
import { dispatchSavedReviewViews } from "./saved-review-views-server";
export const operationsPinsKind = "libraryOperationsPins";
type PinRecord = PinBoard & {
  id: string;
  workspaceId: string;
  ownerId: string | null;
  scope: PinScope;
  createdAt: string;
  updatedAt: string;
};
const editor = (role: string) =>
  ["admin", "researcher", "collaborator"].includes(role);
export async function dispatchOperationsPins(
  req: Request,
  p: string[],
  a: Actor,
) {
  if (p[1] !== "operations-pins") return null;
  if (
    p.length !== 2 &&
    (p.length !== 3 || !["private", "shared"].includes(p[2]))
  )
    fail(404, "Pin route unavailable.");
  if (req.method !== (p.length === 2 ? "GET" : "PUT"))
    fail(405, "Pin method unavailable.");
  if (new URL(req.url).search)
    fail(400, "Pin query parameters are unavailable.");
  const input =
    req.method === "PUT"
      ? z
          .object({
            version: z.number().int().min(0),
            viewIds: z
              .array(z.uuid())
              .max(12)
              .refine(
                (ids) => new Set(ids).size === ids.length,
                "Choose each view once.",
              ),
          })
          .strict()
          .parse(await body(req))
      : null;
  return transaction(async () => {
    const members = await db
        .prepare("SELECT id,role FROM users WHERE workspace_id=?")
        .all(a.workspaceId),
      member = members.find((m) => m.id === a.id);
    if (!member) fail(403, "Workspace access unavailable.");
    const canManageShared = editor(a.role) && editor(String(member.role));
    if (input && p[2] === "shared" && !canManageShared)
      fail(403, "An editor must manage team pins.");
    const catalog: SavedReviewViewList = await (await dispatchSavedReviewViews(
      new Request("http://localhost/api/library/saved-review-views"),
      ["library", "saved-review-views"],
      a,
    ))!.json();
    for (const r of await list<PinRecord>(operationsPinsKind, a.workspaceId))
      if (r.scope === "private" && !members.some((m) => m.id === r.ownerId))
        await db
          .prepare(
            "DELETE FROM documents WHERE kind=? AND id=? AND workspace_id=?",
          )
          .run(operationsPinsKind, r.id, a.workspaceId);
    const id = (scope: PinScope) =>
      hash(
        "operations-pins:" +
          a.workspaceId +
          ":" +
          (scope === "private" ? a.id : "shared"),
      );
    const eligible = (scope: PinScope, viewId: string) =>
      catalog.views.some(
        (v) =>
          v.id === viewId && (scope === "private" || v.visibility === "shared"),
      );
    async function read(scope: PinScope) {
      const r = await get<PinRecord>(
        operationsPinsKind,
        id(scope),
        a.workspaceId,
      );
      if (!r) return { version: 0, viewIds: [] } as PinBoard;
      const ids = r.viewIds.filter((viewId) => eligible(scope, viewId));
      if (ids.length !== r.viewIds.length) {
        r.viewIds = ids;
        r.version++;
        r.updatedAt = now();
        await put(operationsPinsKind, r);
      }
      return { version: r.version, viewIds: [...r.viewIds] };
    }
    if (!input)
      return respond({
        private: await read("private"),
        shared: await read("shared"),
        canManageShared,
      });
    const scope = p[2] as PinScope,
      current = await read(scope);
    if (current.version !== input.version)
      fail(409, "Pinned views changed. Refresh operations before saving.");
    if (input.viewIds.some((viewId) => !eligible(scope, viewId)))
      fail(
        scope === "shared" ? 400 : 404,
        "Choose currently available views; team pins require shared views.",
      );
    if (JSON.stringify(current.viewIds) === JSON.stringify(input.viewIds))
      return respond({ board: current });
    const at = now(),
      old = await get<PinRecord>(operationsPinsKind, id(scope), a.workspaceId);
    const record: PinRecord = {
      id: id(scope),
      workspaceId: a.workspaceId,
      ownerId: scope === "private" ? a.id : null,
      scope,
      viewIds: input.viewIds,
      version: current.version + 1,
      createdAt: old?.createdAt || at,
      updatedAt: at,
    };
    await put(operationsPinsKind, record);
    return respond({
      board: { version: record.version, viewIds: record.viewIds },
    });
  });
}
