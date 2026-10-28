import { videoGrantAllowed } from "./video-once-server";
import { processConceptVideo } from "./concept-video-process";
import { conceptVisible } from "./concept-timing";
import { createHash } from "node:crypto";
import { z } from "zod";
import { actor, canEdit, participant, fail, respond, limit } from "./http";
import { db, get, put, list, requireStudy, transaction, now, uid } from "./db";
import type { Study, Guide } from "./domain";
import { conceptFor } from "./concepts";
import { ensureRecording, recordingResponse, deleteRecording } from "./storage";
import { conceptVideoMaxInput, type ConceptVideo } from "./concept-videos";
export async function validateConceptVideos(s: Study, guide: Guide) {
  for (const c of guide.conceptTest?.concepts || [])
    if (
      c.videoAssetId &&
      !(await get<ConceptVideo>("conceptVideo", c.videoAssetId, s.workspaceId))
    )
      fail(
        400,
        "A concept video is unavailable in this workspace. Upload it again before saving or publishing.",
      );
}
async function videoBytes(req: Request) {
  const mime = req.headers.get("content-type")?.split(";")[0] || "";
  if (!["video/mp4", "video/webm"].includes(mime))
    fail(400, "Upload an MP4 or WebM video.");
  if (Number(req.headers.get("content-length")) > conceptVideoMaxInput)
    fail(413, "Concept videos must be at most 3 MB.");
  const reader = req.body?.getReader();
  if (!reader) fail(400, "Video is empty.");
  let total = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > conceptVideoMaxInput) {
      await reader.cancel();
      fail(413, "Concept videos must be at most 3 MB.");
    }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks),
    digest = createHash("sha256").update(bytes).digest("hex");
  return { ...(await processConceptVideo(bytes, mime)), digest };
}
function references(value: unknown, id: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((v) => references(v, id));
  return Object.entries(value).some(([k, v]) =>
    ["videoAssetId", "sourceAssetId"].includes(k)
      ? v === id
      : references(v, id),
  );
}
export async function dispatchConceptVideos(req: Request, p: string[]) {
  if (p.length !== 4 && p.length !== 3) return null;
  if (p[2] !== "concept-videos") return null;
  if (p[0] === "interviews" && p.length === 4 && req.method === "GET") {
    const i = await participant(req, p[1]);
    if (
      !conceptVisible(i) ||
      !videoGrantAllowed(req, i) ||
      conceptFor(i)?.videoAssetId !== p[3] ||
      !(await get<ConceptVideo>("conceptVideo", p[3], i.workspaceId))
    )
      fail(404, "Concept video is unavailable.");
    return recordingResponse(req, p[3], "video/mp4");
  }
  if (p[0] !== "studies") return null;
  const a = await actor(),
    s = await requireStudy(p[1], a);
  if (req.method === "GET") {
    if (!p[3])
      return respond({
        videos: (
          await list<ConceptVideo>("conceptVideo", a.workspaceId, s.id)
        ).map(({ digest, workspaceId, ...video }) => video),
      });
    if (!(await get<ConceptVideo>("conceptVideo", p[3], a.workspaceId)))
      fail(404, "Concept video is unavailable.");
    return recordingResponse(req, p[3], "video/mp4");
  }
  canEdit(a);
  if (req.method === "POST" && !p[3]) {
    limit("concept-upload:" + a.workspaceId, 60);
    const id = z.uuid().parse(req.headers.get("x-upload-id")),
      video = await videoBytes(req);
    return transaction(async () => {
      const current = await get<ConceptVideo>("conceptVideo", id);
      if (current) {
        if (
          current.workspaceId !== a.workspaceId ||
          current.studyId !== s.id ||
          current.digest !== video.digest
        )
          fail(
            409,
            "Upload ID already belongs to another video. Choose the video again.",
          );
        return respond(
          {
            video: {
              id: current.id,
              durationMs: current.durationMs,
              width: current.width,
              height: current.height,
              bytes: current.bytes,
            },
          },
          200,
        );
      }
      // Deleted IDs remain unavailable while a delayed storage cleanup may still run.
      if (
        (await get("conceptVideoDeleted", id)) ||
        (await get("participantImageDeleted", id)) ||
        (await get("conceptImageDeleted", id)) ||
        (await get("conceptImage", id)) ||
        (await db.prepare("SELECT id FROM media WHERE id=?").get(id))
      )
        fail(409, "This upload ID is unavailable. Choose the video again.");
      if (
        (await list<ConceptVideo>("conceptVideo", a.workspaceId, s.id))
          .length >= 100
      )
        fail(
          400,
          "This study has 100 uploaded videos. Delete unused uploads before adding more.",
        );
      try {
        await ensureRecording(id, video.data, "video/mp4");
      } catch (e) {
        if ((e as Error).message === "MEDIA_CONFLICT")
          fail(409, "This upload ID already contains different bytes.");
        throw e;
      }
      const record: ConceptVideo = {
        id,
        workspaceId: a.workspaceId,
        studyId: s.id,
        createdAt: now(),
        durationMs: video.durationMs,
        width: video.width,
        height: video.height,
        bytes: video.data.length,
        digest: video.digest,
      };
      await put("conceptVideo", record);
      return respond(
        {
          video: {
            id,
            durationMs: record.durationMs,
            width: record.width,
            height: record.height,
            bytes: record.bytes,
          },
        },
        201,
      );
    });
  }
  if (req.method === "DELETE" && p[3]) {
    let jobId = "";
    await transaction(async () => {
      const video = await get<ConceptVideo>(
        "conceptVideo",
        p[3],
        a.workspaceId,
      );
      if (!video || video.studyId !== s.id)
        fail(404, "Concept video is unavailable.");
      for (const row of await db
        .prepare(
          "SELECT data FROM documents WHERE workspace_id=? AND kind IN ('study','revision','history','interview','pulseSeries','conceptImage','conceptVideo')",
        )
        .all(a.workspaceId))
        if (references(JSON.parse(String(row.data)), video.id))
          fail(
            409,
            "This video is retained by a draft, revision, history entry, interview, tracker or watermarked copy. Remove it from the current concept to stop using it in new interviews; retained versions keep the original.",
          );
      jobId = uid();
      await put("deletion", {
        id: jobId,
        workspaceId: a.workspaceId,
        studyId: s.id,
        files: [video.id],
        createdAt: now(),
      });
      await put("conceptVideoDeleted", {
        id: video.id,
        workspaceId: a.workspaceId,
        studyId: s.id,
        createdAt: now(),
      });
      await db
        .prepare(
          "DELETE FROM documents WHERE kind='conceptVideo' AND id=? AND workspace_id=?",
        )
        .run(video.id, a.workspaceId);
    });
    try {
      await deleteRecording(p[3]);
      await db
        .prepare("DELETE FROM documents WHERE kind='deletion' AND id=?")
        .run(jobId);
    } catch {
      /* Existing deletion worker retries private storage cleanup. */
    }
    return respond({ ok: true });
  }
  fail(405, "Method not allowed.");
}
