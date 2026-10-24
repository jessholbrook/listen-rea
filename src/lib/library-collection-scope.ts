import { get, pruneLibraryCollections } from "./db";
import { fail } from "./http";
import type { Actor } from "./domain";
import type { LibraryCollection } from "./library-collections";
export async function collectionScope(a: Actor, id?: string) {
  if (!id) return undefined;
  await pruneLibraryCollections(a.workspaceId);
  const c = await get<LibraryCollection>(
    "libraryCollection",
    id,
    a.workspaceId,
  );
  if (!c)
    fail(404, "This collection is unavailable. Choose an existing collection.");
  return c;
}
