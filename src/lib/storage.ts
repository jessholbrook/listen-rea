import { mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { put, get, del } from "@vercel/blob";
import { setGlobalDispatcher, EnvHttpProxyAgent } from "undici";
import { dataDir } from "./db";
// Native fetch used by storage SDKs must retain the cloud HTTPS proxy route.
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY)
  setGlobalDispatcher(new EnvHttpProxyAgent());
export const maxRecordingBytes = 3 * 1024 * 1024;
export function storageMode() {
  return process.env.VERCEL || process.env.RESEARCH_STORAGE === "blob"
    ? "blob"
    : "local";
}
const key = (id: string) => {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("INVALID_MEDIA_ID");
  return "fieldnotes/recordings/" + id;
};
function requireBlob() {
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID)
    throw new Error("DEPLOYMENT_STORAGE_REQUIRED");
}
export async function writeRecording(
  id: string,
  bytes: Uint8Array,
  mime: string,
) {
  const pathname = key(id);
  if (storageMode() === "blob") {
    requireBlob();
    await put(pathname, Buffer.from(bytes), {
      access: "private",
      contentType: mime,
      addRandomSuffix: false,
      allowOverwrite: false,
      multipart: bytes.length > maxRecordingBytes,
    });
  } else {
    const dir = path.join(dataDir, "media");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(dir, id), bytes, { mode: 0o600, flag: "wx" });
  }
}
export async function readRecording(id: string): Promise<Buffer> {
  const pathname = key(id);
  if (storageMode() === "blob") {
    requireBlob();
    const response = await get(pathname, {
      access: "private",
      useCache: false,
    });
    if (!response?.stream) throw new Error("MEDIA_NOT_FOUND");
    return Buffer.from(await new Response(response.stream).arrayBuffer());
  }
  return readFile(path.join(dataDir, "media", id));
}
export async function deleteRecording(id: string) {
  const pathname = key(id);
  if (storageMode() === "blob") {
    requireBlob();
    await del(pathname);
  } else await rm(path.join(dataDir, "media", id), { force: true });
}

// Media seeking must retain authorization for every byte-range request.
export async function recordingResponse(
  req: Request,
  id: string,
  mime: string,
) {
  let stream: ReadableStream<Uint8Array>, size: number;
  if (storageMode() === "blob") {
    requireBlob();
    const result = await get(key(id), { access: "private", useCache: false });
    if (!result?.stream) throw Error("MEDIA_NOT_FOUND");
    stream = result.stream;
    size = result.blob.size;
  } else {
    key(id);
    const file = path.join(dataDir, "media", id);
    size = (await stat(file)).size;
    stream = Readable.toWeb(
      createReadStream(file),
    ) as ReadableStream<Uint8Array>;
  }
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Cache-Control": "private, no-store",
    "Content-Disposition": "inline",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  };
  if (mime === "application/pdf") {
    headers["Content-Disposition"] =
      'attachment; filename="echo-lab-document.pdf"';
    headers["Content-Security-Policy"] =
      "default-src 'none'; sandbox; frame-ancestors 'none'";
  }
  const range = req.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    const invalid = () => {
      void stream.cancel();
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${size}` },
      });
    };
    if (!m || (!m[1] && !m[2])) return invalid();
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1]
      ? m[2]
        ? Math.min(Number(m[2]), size - 1)
        : size - 1
      : size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start >= size ||
      end < start ||
      (!m[1] && Number(m[2]) === 0)
    )
      return invalid();
    return new Response(recordingSlice(stream, start, end), {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
      },
    });
  }
  return new Response(stream, {
    headers: {
      ...headers,
      ...(size <= maxRecordingBytes ? { "Content-Length": String(size) } : {}),
    },
  });
}

// Bound memory and honor byte ranges while streaming private media through authorization.
function recordingSlice(
  stream: ReadableStream<Uint8Array>,
  start: number,
  end: number,
) {
  const reader = stream.getReader();
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          const at = offset;
          offset += value.length;
          if (offset <= start) continue;
          controller.enqueue(
            value.subarray(
              Math.max(0, start - at),
              Math.min(value.length, end - at + 1),
            ),
          );
          if (offset > end) {
            controller.close();
            await reader.cancel();
          }
          return;
        }
      } catch (e) {
        controller.error(e);
        await reader.cancel().catch(() => {});
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

// A storage write can succeed before its acknowledgement or database commit is
// lost. Adopt only the exact immutable bytes on retry, never an occupied ID.
export async function ensureRecording(
  id: string,
  bytes: Uint8Array,
  mime: string,
) {
  try {
    await writeRecording(id, bytes, mime);
  } catch (cause) {
    let existing: Buffer;
    try {
      existing = await readRecording(id);
    } catch {
      throw cause;
    }
    if (!existing.equals(Buffer.from(bytes))) throw new Error("MEDIA_CONFLICT");
  }
}
