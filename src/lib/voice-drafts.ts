export type VoiceDraft = {
  key: string;
  recordingId?: string;
  blob: Blob;
  durationMs: number;
  createdAt: number;
  audioId?: string;
  text?: string;
};
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("fieldnotes-voice", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("drafts", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("Voice draft storage is unavailable."));
  });
}
async function action<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("drafts", mode);
      const request = run(tx.objectStore("drafts"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export const saveVoiceDraft = (draft: VoiceDraft) =>
  action("readwrite", (s) => s.put(draft));
export async function loadVoiceDraft(key: string) {
  const draft = await action<VoiceDraft | undefined>("readonly", (s) =>
    s.get(key),
  );
  if (draft && Date.now() - draft.createdAt > 24 * 3600000) {
    await deleteVoiceDraft(key);
    return undefined;
  }
  return draft;
}
export const deleteVoiceDraft = (key: string) =>
  action("readwrite", (s) => s.delete(key));
