import { db, list, transaction, pruneLibraryCollections } from "./db";
import { fail, respond } from "./http";
import type { Actor } from "./domain";
import type { LibraryCollection } from "./library-collections";
import type { CollectionHandoff } from "./collection-handoff";
import { currentHandoffInboxPacket } from "./collection-handoff-server";
import type { ReviewInbox, InboxPacket } from "./team-review-inbox";
export async function dispatchReviewInbox(req: Request, p: string[], a: Actor) {
  if (p[1] !== "review-inbox") return null;
  if (p.length !== 2) fail(404, "Review inbox route unavailable.");
  if (req.method !== "GET")
    fail(405, "Review packets in the original handoff editor.");
  return transaction(async () => {
    await pruneLibraryCollections(a.workspaceId);
    const packets: InboxPacket[] = [];
    for (const id of new Set(
      (
        await list<CollectionHandoff>("libraryCollectionHandoff", a.workspaceId)
      ).map((p) => p.collectionId),
    )) {
      const current = await currentHandoffInboxPacket(a, id);
      if (current) packets.push(current);
    }
    // Later validation of shared research can erase packets projected earlier.
    const remaining = new Set(
      (
        await list<CollectionHandoff>("libraryCollectionHandoff", a.workspaceId)
      ).map((p) => p.id),
    );
    const result: ReviewInbox = {
      canEdit: ["admin", "researcher", "collaborator"].includes(a.role),
      packets: packets.filter((p) => remaining.has(p.id)),
      collections: (
        await list<LibraryCollection>("libraryCollection", a.workspaceId)
      )
        .map((c) => ({ id: c.id, title: c.title }))
        .sort(
          (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
        ),
      members: (
        await db
          .prepare(
            "SELECT id,name FROM users WHERE workspace_id=? AND role IN ('admin','researcher','collaborator') ORDER BY name,id",
          )
          .all(a.workspaceId)
      ).map((m) => ({ id: String(m.id), name: String(m.name) })),
      userId: a.id,
    };
    return respond(result);
  });
}
