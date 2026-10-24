export type ScreenDraft = {
  id: string;
  interviewId: string;
  turnVersion: number;
  captureId: string;
  sequence: number;
  offsetMs: number;
  durationMs: number;
  blob: Blob;
  createdAt: number;
};
async function action<T>(
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("echo-lab-screen", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("clips", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () =>
      reject(new Error("Local screen recording storage is unavailable."));
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction("clips", mode),
        r = run(t.objectStore("clips"));
      t.oncomplete = () => resolve(r.result);
      t.onerror = t.onabort = () =>
        reject(t.error || new Error("Could not save the screen clip locally."));
    });
  } finally {
    db.close();
  }
}
export const saveScreenDraft = (d: ScreenDraft) =>
  action("readwrite", (s) => s.put(d));
export const deleteScreenDraft = (id: string) =>
  action("readwrite", (s) => s.delete(id));
export async function screenDrafts(interviewId: string, version: number) {
  const all = await action<ScreenDraft[]>("readonly", (s) => s.getAll());
  for (const d of all)
    if (Date.now() - d.createdAt > 24 * 3600000) await deleteScreenDraft(d.id);
  return all
    .filter(
      (d) =>
        d.interviewId === interviewId &&
        d.turnVersion === version &&
        Date.now() - d.createdAt <= 24 * 3600000,
    )
    .sort(
      (a, b) =>
        a.captureId.localeCompare(b.captureId) || a.sequence - b.sequence,
    );
}
