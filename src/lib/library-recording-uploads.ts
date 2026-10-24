import { createHash } from "node:crypto";
import { z } from "zod";
import { db, get, put, transaction, uid, now, requireStudy } from "./db";
import { body, fail, respond } from "./http";
import type { Actor } from "./domain";
import {
  type LibraryRecording,
  maxImportBytes,
  importPartBytes,
  maxImportDurationMs,
  recordingView,
} from "./library-recordings";
import { readRecording, ensureRecording } from "./storage";
import { inspectImportMedia, matchesImportMedia } from "./import-media";
import { cleanDeletions } from "./features";
const mimes = [
  "audio/wav",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
  "video/mp4",
  "video/webm",
];
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
async function current(a: Actor, id: string) {
  const r = await get<LibraryRecording>("libraryRecording", id, a.workspaceId);
  if (!r) fail(404, "Recording unavailable.");
  await requireStudy(r.studyId, a);
  return r;
}
function editable(r: LibraryRecording, version: number) {
  if (r.version !== version || r.status !== "awaiting_upload")
    fail(409, "Recording changed. Refresh first.");
}
async function reserve(a: Actor, r: LibraryRecording, file: string) {
  return transaction(async () => {
    const next = await current(a, r.id);
    if (next.status !== "awaiting_upload")
      fail(409, "Upload already finished. Refresh first.");
    const id = file;
    // Stable reservation IDs make acknowledgement-loss retries adopt the same cleanup guard.
    await put("deletion", {
      id,
      workspaceId: a.workspaceId,
      studyId: r.studyId,
      files: [file],
      recordingGuard: r.id,
      createdAt: now(),
      notBefore: Date.now() + 300000,
    });
    return id;
  });
}

async function release(a: Actor, job: string | null) {
  if (!job) return;
  await db
    .prepare(
      "DELETE FROM documents WHERE kind='deletion' AND id=? AND workspace_id=?",
    )
    .run(job, a.workspaceId);
}
export async function dispatchRecordingUpload(
  req: Request,
  route: string,
  a: Actor,
  r: LibraryRecording,
) {
  if (!["upload", "part", "complete"].includes(route)) return null;
  if (route === "upload" && req.method === "POST") {
    const input = z
      .object({
        version: z.number().int().positive(),
        bytes: z.number().int().min(1).max(maxImportBytes),
        digest: z.string().regex(/^[a-f0-9]{64}$/),
        mime: z.enum(mimes as [string, ...string[]]),
      })
      .strict()
      .parse(await body(req));
    return transaction(async () => {
      r = await current(a, r.id);
      if (r.upload) {
        if (
          r.upload.bytes !== input.bytes ||
          r.upload.mime !== input.mime ||
          r.upload.digest !== input.digest
        )
          fail(
            409,
            "Reselect the exact same file, or delete this recording to start over.",
          );
        return respond({ recording: recordingView(r), reused: true });
      }
      editable(r, input.version);
      if (r.file) fail(409, "An immutable recording already exists.");
      r.upload = {
        bytes: input.bytes,
        mime: input.mime,
        digest: input.digest,
        fileId: uid(),
        parts: Array.from(
          { length: Math.ceil(input.bytes / importPartBytes) },
          () => ({ id: uid() }),
        ),
      };
      r.version++;
      await put("libraryRecording", r);
      return respond({ recording: recordingView(r) });
    });
  }
  const version = z.coerce
    .number()
    .int()
    .positive()
    .parse(req.headers.get("x-recording-version"));
  if (route === "part" && req.method === "PUT") {
    const index = z.coerce
      .number()
      .int()
      .min(0)
      .max(19)
      .parse(req.headers.get("x-recording-part"));
    if (!r.upload || r.status !== "awaiting_upload")
      fail(409, "Initialize or refresh the upload first.");
    const part = r.upload.parts[index];
    if (!part) fail(400, "Invalid upload part.");
    const expected = Math.min(
      importPartBytes,
      r.upload.bytes - index * importPartBytes,
    );
    if (Number(req.headers.get("content-length") || 0) > expected)
      fail(413, "Upload part is too large.");
    const reader = req.body?.getReader();
    if (!reader) fail(400, "Empty upload part.");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > expected) {
        await reader.cancel();
        fail(413, "Upload part is too large.");
      }
      chunks.push(value);
    }
    if (size !== expected) fail(400, "Upload part has the wrong length.");
    const bytes = Buffer.concat(chunks),
      sum = digest(bytes);
    if (part.digest) {
      if (part.digest !== sum) fail(409, "Upload parts are immutable.");
      return respond({
        recording: recordingView(await current(a, r.id)),
        reused: true,
      });
    }
    editable(r, version);
    const job = await reserve(a, r, part.id);
    // Failed acknowledgements leave the immutable bytes adoptable on retry.
    await ensureRecording(part.id, bytes, "application/octet-stream");
    return transaction(async () => {
      const next = await current(a, r.id);
      const saved = next.upload?.parts[index];
      if (saved?.digest === sum && next.status === "awaiting_upload") {
        await release(a, job);
        return respond({ recording: recordingView(next), reused: true });
      }
      editable(next, version);
      if (!saved || saved.id !== part.id) fail(409, "Upload changed.");
      saved.bytes = size;
      saved.digest = sum;
      next.version++;
      await put("libraryRecording", next);
      await release(a, job);
      return respond({ recording: recordingView(next) });
    });
  }
  if (route === "complete" && req.method === "POST") {
    if (r.file && r.upload)
      return respond({ recording: recordingView(r), reused: true });
    editable(r, version);
    const upload = r.upload;
    if (!upload || upload.parts.some((p) => !p.digest))
      fail(409, "Upload all parts before finishing.");
    const parts: Buffer[] = [];
    for (const part of upload.parts) {
      const bytes = await readRecording(part.id);
      if (bytes.length !== part.bytes || digest(bytes) !== part.digest)
        fail(409, "A stored upload part failed verification.");
      parts.push(bytes);
    }
    const bytes = Buffer.concat(parts);
    if (bytes.length !== upload.bytes || digest(bytes) !== upload.digest)
      fail(
        400,
        "The complete file failed verification. Delete this upload and start again.",
      );
    if (!matchesImportMedia(bytes, upload.mime))
      fail(400, "File signature does not match its media type.");
    let durationMs: number;
    try {
      durationMs = await inspectImportMedia(
        bytes,
        upload.mime.startsWith("video/"),
        AbortSignal.timeout(65000),
        maxImportDurationMs,
      );
    } catch {
      fail(
        400,
        "Media must decode with audio and be at most 60 minutes; video imports need a video stream.",
      );
    }
    const job = await reserve(a, r, upload.fileId);
    await ensureRecording(upload.fileId, bytes, upload.mime);
    const response = await transaction(async () => {
      const next = await current(a, r.id);
      if (next.file?.id === upload.fileId) {
        await release(a, job);
        return respond({ recording: recordingView(next), reused: true });
      }
      editable(next, version);
      next.file = {
        id: upload.fileId,
        mime: upload.mime,
        bytes: bytes.length,
        digest: upload.digest,
        durationMs,
      };
      next.status = "uploaded";
      next.version++;
      await put("libraryRecording", next);
      await release(a, job);
      await put("deletion", {
        id: uid(),
        workspaceId: a.workspaceId,
        studyId: r.studyId,
        files: upload.parts.map((p) => p.id),
        createdAt: now(),
      });
      return respond({ recording: recordingView(next) });
    });
    await cleanDeletions();
    return response;
  }
  fail(405, "Upload method unavailable.");
}
