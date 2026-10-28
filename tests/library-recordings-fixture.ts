import ffmpeg from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { savedLibrarySetup } from "./library-answers-fixture";
import { toneWav } from "./reporting-fixture";
export const recordingRoot = "library/recordings";
export async function recordingSetup() {
  const c = await savedLibrarySetup([]),
    s = (
      await c.owner("studies", "POST", { title: "Private external recordings" })
    ).study,
    service = await import("../src/lib/library-recordings-server");
  const create = async (changes: any = {}) => {
    const input = {
      requestId: randomUUID(),
      studyId: s.id,
      title: "Synthetic external interview",
      externalId: randomUUID(),
      language: "en",
      permissionConfirmed: true,
      transcriptionPermission: true,
      ...changes,
    };
    const r = await c.owner(recordingRoot, "POST", input);
    assert.equal(r.status, 201, JSON.stringify(r));
    return { input, recording: r.recording };
  };
  const upload = async (r: any, bytes = toneWav(1200), mime = "audio/wav") => {
    const v = await c.owner(
      recordingRoot + "/" + r.id + "/file",
      "PUT",
      bytes,
      { "content-type": mime, "x-recording-version": String(r.version) },
    );
    assert.equal(v.status, 200, JSON.stringify(v));
    return v.recording;
  };
  const transcribe = async (
    r: any,
    run: any = async () => ({
      text: "MARKED_SYNTHETIC_MACHINE_TRANSCRIPT: The draft is saved before review.",
      model: "marked-provider-fixture",
      generatedAt: new Date().toISOString(),
    }),
  ) => {
    const v = await service.dispatchLibraryRecordings(
      new Request(
        "http://localhost/api/library/recordings/" + r.id + "/transcribe",
        {
          method: "POST",
          body: JSON.stringify({
            version: r.version,
            permissionConfirmed: true,
          }),
        },
      ),
      ["library", "recordings", r.id, "transcribe"],
      c.actor,
      run,
    );
    return (await v!.json()).recording;
  };
  return { ...c, s, service, create, upload, transcribe };
}

export function recordingVideo() {
  return execFileSync(
    ffmpeg!,
    [
      "-v",
      "error",
      "-nostdin",
      "-threads",
      "1",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=96x64:r=5",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=16000",
      "-t",
      "1.2",
      "-c:v",
      "libvpx",
      "-c:a",
      "libopus",
      "-f",
      "webm",
      "pipe:1",
    ],
    { maxBuffer: 3 * 1024 * 1024 },
  );
}
