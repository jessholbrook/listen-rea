import { db, get, list, put, hash, uid, now, transaction } from "./db";
import type { LibraryRecording } from "./library-recordings";
export async function removePendingRecording(r: LibraryRecording) {
  if (r.status === "imported")
    throw Error("IMPORTED_RECORDING_OWNED_BY_RESPONSE");
  await transaction(async () => {
    const current = await get<LibraryRecording>(
      "libraryRecording",
      r.id,
      r.workspaceId,
    );
    if (!current || current.status === "imported") return;
    r = current;
    if (r.batchId)
      await put("libraryRecordingBatchTombstone", {
        id: hash(r.workspaceId + ":" + r.batchId),
        workspaceId: r.workspaceId,
        createdAt: now(),
      });
    await put("libraryRecordingTombstone", {
      id: hash(r.workspaceId + ":" + r.requestId),
      workspaceId: r.workspaceId,
      createdAt: now(),
    });
    await db
      .prepare(
        "DELETE FROM documents WHERE kind='libraryRecording' AND id=? AND workspace_id=?",
      )
      .run(r.id, r.workspaceId);
    const files = [
      ...new Set([
        ...(r.file ? [r.file.id] : []),
        ...(r.upload
          ? [r.upload.fileId, ...r.upload.parts.map((p) => p.id)]
          : []),
      ]),
    ];
    if (files.length)
      await put("deletion", {
        id: uid(),
        workspaceId: r.workspaceId,
        studyId: r.studyId,
        files,
        createdAt: now(),
      });
  });
}
export async function recordingDraftRetention() {
  const rows = await db
    .prepare("SELECT data FROM documents WHERE kind='libraryRecording'")
    .all();
  for (const row of rows) {
    const r = JSON.parse(String(row.data)) as LibraryRecording;
    if (r.status !== "imported" && new Date(r.expiresAt).getTime() < Date.now())
      await removePendingRecording(r);
  }
  await db
    .prepare(
      "DELETE FROM documents WHERE kind IN ('libraryRecordingTombstone','libraryRecordingBatchTombstone') AND json_extract(data,'$.createdAt')<?",
    )
    .run(new Date(Date.now() - 90 * 86400000).toISOString());
}
