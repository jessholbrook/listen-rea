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
  clearCollectionAnswers,
} from "./db";
import { body, canEdit, fail, respond } from "./http";
import type { Actor } from "./domain";
import {
  collectionContent,
  collectionCreate,
  collectionEdit,
  collectionView,
  type LibraryCollection,
} from "./library-collections";
async function members(
  a: Actor,
  input: { interviewIds: string[]; briefIds: string[] },
) {
  const interviews = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM documents i WHERE i.kind='interview' AND i.workspace_id=? AND i.id IN (SELECT value FROM json_each(?)) AND json_extract(i.data,'$.status')='complete' AND NOT COALESCE(json_extract(i.data,'$.excluded'),0) AND NOT COALESCE(json_extract(i.data,'$.preview'),0) AND EXISTS (SELECT 1 FROM documents s WHERE s.kind='study' AND s.id=i.study_id AND s.workspace_id=i.workspace_id)",
    )
    .get(a.workspaceId, JSON.stringify(input.interviewIds));
  if (Number(interviews?.n) !== input.interviewIds.length)
    fail(404, "Choose only included interviews from this workspace.");
  const briefs = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM documents WHERE kind='libraryBrief' AND workspace_id=? AND id IN (SELECT value FROM json_each(?))",
    )
    .get(a.workspaceId, JSON.stringify(input.briefIds));
  if (Number(briefs?.n) !== input.briefIds.length)
    fail(404, "A selected brief is unavailable.");
}
export async function dispatchLibraryCollections(
  req: Request,
  p: string[],
  a: Actor,
) {
  if (p[1] !== "collections") return null;
  const payload = ["POST", "PUT", "DELETE"].includes(req.method)
    ? (canEdit(a), await body(req))
    : undefined;
  return transaction(async () => {
    await pruneLibraryCollections(a.workspaceId);
    await db
      .prepare(
        "DELETE FROM documents WHERE kind IN ('libraryCollectionTombstone','libraryCollectionAnswerTombstone') AND workspace_id=? AND json_extract(data,'$.createdAt')<?",
      )
      .run(a.workspaceId, new Date(Date.now() - 90 * 86400000).toISOString());
    const editable = ["admin", "researcher", "collaborator"].includes(a.role);
    if (p.length === 2 && req.method === "GET")
      return respond({
        collections: (
          await list<LibraryCollection>("libraryCollection", a.workspaceId)
        ).map(collectionView),
        canEdit: editable,
      });
    if (p.length === 2 && req.method === "POST") {
      canEdit(a);
      const input = collectionCreate.parse(payload),
        { requestId, ...content } = input,
        inputHash = hash(JSON.stringify(content));
      if (
        await get(
          "libraryCollectionTombstone",
          hash(a.workspaceId + ":" + requestId),
          a.workspaceId,
        )
      )
        fail(
          409,
          "This collection request was deleted. Start a new collection.",
        );
      const all = await list<LibraryCollection>(
          "libraryCollection",
          a.workspaceId,
        ),
        existing = all.find((c) => c.requestId === requestId);
      if (existing) {
        if (existing.inputHash !== inputHash)
          fail(409, "This request has different collection settings.");
        return respond({ collection: collectionView(existing), reused: true });
      }
      if (all.length >= 50)
        fail(409, "This workspace has 50 collections. Delete one first.");
      await members(a, content);
      const c: LibraryCollection = {
        ...content,
        id: uid(),
        workspaceId: a.workspaceId,
        requestId,
        inputHash,
        version: 1,
        createdAt: now(),
        updatedAt: now(),
      };
      await put("libraryCollection", c);
      return respond({ collection: collectionView(c) }, 201);
    }
    if (p.length !== 3) fail(404, "Collection route unavailable.");
    const id = z.uuid().parse(p[2]),
      c = await get<LibraryCollection>("libraryCollection", id, a.workspaceId);
    if (!c) fail(404, "Collection unavailable.");
    if (req.method === "GET")
      return respond({ collection: collectionView(c), canEdit: editable });
    canEdit(a);
    if (req.method === "PUT") {
      const { version, ...content } = collectionEdit.parse(payload);
      await members(a, content);
      if (version > c.version)
        fail(409, "Collection changed. Refresh before saving.");
      if (
        JSON.stringify({
          title: c.title,
          interviewIds: c.interviewIds,
          briefIds: c.briefIds,
        }) === JSON.stringify(content)
      )
        return respond({ collection: collectionView(c), reused: true });
      if (version !== c.version)
        fail(409, "Collection changed. Refresh before saving.");
      if (
        c.interviewIds.length !== content.interviewIds.length ||
        c.interviewIds.some((id) => !content.interviewIds.includes(id))
      )
        await clearCollectionAnswers(a.workspaceId, c.id);
      const updated = {
        ...c,
        ...content,
        version: c.version + 1,
        updatedAt: now(),
      };
      await put("libraryCollection", updated);
      await pruneLibraryCollections(a.workspaceId);
      return respond({
        collection: collectionView(
          (await get<LibraryCollection>(
            "libraryCollection",
            id,
            a.workspaceId,
          ))!,
        ),
      });
    }
    if (req.method === "DELETE") {
      const { version } = z
        .object({ version: z.number().int().positive() })
        .strict()
        .parse(payload);
      if (c.version !== version)
        fail(409, "Collection changed. Refresh before deleting.");
      await clearCollectionAnswers(a.workspaceId, id);
      await put("libraryCollectionTombstone", {
        id: hash(a.workspaceId + ":" + c.requestId),
        workspaceId: a.workspaceId,
        createdAt: now(),
      });
      await db
        .prepare(
          "DELETE FROM documents WHERE kind='libraryCollection' AND id=? AND workspace_id=?",
        )
        .run(id, a.workspaceId);
      await pruneLibraryCollections(a.workspaceId);
      return respond({ deleted: true });
    }
    fail(405, "Collection method unavailable.");
  });
}
