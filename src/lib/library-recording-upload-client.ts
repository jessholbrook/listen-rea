import { api } from "./client";
import { importPartBytes, recordingView } from "./library-recordings";
export type RecordingDetail = ReturnType<typeof recordingView>;
export async function uploadRecordingParts(
  r: RecordingDetail,
  source: File,
  signal: AbortSignal,
  update: (r: RecordingDetail) => void = () => {},
  paused: () => boolean = () => false,
) {
  const sum = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await source.arrayBuffer()),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const mime =
    source.type ||
    (
      {
        wav: "audio/wav",
        mp4: "video/mp4",
        webm: "audio/webm",
        ogg: "audio/ogg",
      } as Record<string, string>
    )[source.name.split(".").at(-1)!.toLowerCase()] ||
    "application/octet-stream";
  r = (
    await api<{ recording: RecordingDetail }>(
      "library/recordings/" + r.id + "/upload",
      "POST",
      { version: r.version, bytes: source.size, digest: sum, mime },
      undefined,
      signal,
    )
  ).recording;
  update(r);
  for (let index = 0; index < r.upload!.parts.length; index++) {
    if (paused()) return r;
    if (signal.aborted) throw Error("Upload paused.");
    if (r.upload!.parts[index].digest) continue;
    const uploaded = await fetch("/api/library/recordings/" + r.id + "/part", {
      method: "PUT",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "content-type": "application/octet-stream",
        "x-recording-version": String(r.version),
        "x-recording-part": String(index),
      },
      body: source.slice(
        index * importPartBytes,
        (index + 1) * importPartBytes,
      ),
      signal,
    });
    const value = await uploaded.json();
    if (!uploaded.ok) throw Error(value.error || "Upload failed.");
    r = value.recording;
    update(r);
  }
  if (paused()) return r;
  r = (
    await api<{ recording: RecordingDetail }>(
      "library/recordings/" + r.id + "/complete",
      "POST",
      undefined,
      { "x-recording-version": String(r.version) },
      signal,
    )
  ).recording;
  return r;
}
