import sharp from "sharp";
import { currentImageOptions } from "./option-images";
import { conceptVisible } from "./concept-timing";
import { createHash } from "node:crypto";
import { z } from "zod";
import { actor, canEdit, participant, fail, respond, limit } from "./http";
import { db, get, put, list, requireStudy, transaction, now, uid } from "./db";
import type { Study, Guide } from "./domain";
import { conceptFor } from "./concepts";
import { ensureRecording, recordingResponse, deleteRecording } from "./storage";
import {
  conceptImageMaxInput,
  conceptImageMaxOutput,
  type ConceptImage,
} from "./concept-images";
export async function validateConceptImages(s: Study, guide: Guide) {
  for (const c of [
    ...(guide.conceptTest?.concepts || []),
    ...guide.questions.flatMap((q) => [
      ...q.options,
      ...(q.maxdiff?.items || []),
    ]),
  ])
    if (
      c.imageAssetId &&
      !(await get<ConceptImage>("conceptImage", c.imageAssetId, s.workspaceId))
    )
      fail(
        400,
        "An image is unavailable in this workspace. Upload it again before saving or publishing.",
      );
}
export async function imageBytes(req: Request, label = "Concept images") {
  const mime = req.headers.get("content-type")?.split(";")[0];
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime || ""))
    fail(400, "Upload a static PNG, JPEG or WebP image.");
  if (Number(req.headers.get("content-length")) > conceptImageMaxInput)
    fail(413, `${label} must be at most 2 MB.`);
  const reader = req.body?.getReader();
  if (!reader) fail(400, "Image is empty.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > conceptImageMaxInput) {
      await reader.cancel();
      fail(413, `${label} must be at most 2 MB.`);
    }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks),
    digest = createHash("sha256").update(bytes).digest("hex");
  try {
    const image = sharp(bytes, { limitInputPixels: 16000000, failOn: "error" }),
      meta = await image.metadata();
    if (
      !["png", "jpeg", "webp"].includes(meta.format || "") ||
      "image/" + meta.format !== mime ||
      (meta.pages || 1) !== 1
    )
      throw new Error("format");
    const output = await image
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
    if (output.data.length > conceptImageMaxOutput)
      fail(413, "The prepared image exceeds 3 MB. Crop or simplify the image.");
    return {
      data: output.data,
      width: output.info.width,
      height: output.info.height,
      digest,
    };
  } catch (e) {
    if ((e as { status?: number }).status === 413) throw e;
    fail(
      400,
      "The image could not be decoded. Use a static PNG, JPEG or WebP image.",
    );
  }
}
function references(value: unknown, id: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((v) => references(v, id));
  return Object.entries(value).some(([k, v]) =>
    ["imageAssetId", "sourceAssetId"].includes(k)
      ? v === id
      : references(v, id),
  );
}
export async function dispatchConceptImages(req: Request, p: string[]) {
  if (p.length !== 4 && p.length !== 3) return null;
  if (
    p[2] === "option-images" &&
    p[0] === "interviews" &&
    p.length === 4 &&
    req.method === "GET"
  ) {
    const i = await participant(req, p[1]);
    if (
      !currentImageOptions(i).some((o) => o.imageAssetId === p[3]) ||
      !(await get<ConceptImage>("conceptImage", p[3], i.workspaceId))
    )
      fail(404, "Answer image is unavailable.");
    return recordingResponse(req, p[3], "image/png");
  }
  if (p[2] !== "concept-images") return null;
  if (p[0] === "interviews" && p.length === 4 && req.method === "GET") {
    const i = await participant(req, p[1]);
    if (
      !conceptVisible(i) ||
      conceptFor(i)?.imageAssetId !== p[3] ||
      !(await get<ConceptImage>("conceptImage", p[3], i.workspaceId))
    )
      fail(404, "Concept image is unavailable.");
    return recordingResponse(req, p[3], "image/png");
  }
  if (p[0] !== "studies") return null;
  const a = await actor(),
    s = await requireStudy(p[1], a);
  if (req.method === "GET") {
    if (!p[3])
      return respond({
        images: (
          await list<ConceptImage>("conceptImage", a.workspaceId, s.id)
        ).map(({ digest, workspaceId, ...image }) => image),
      });
    if (!(await get<ConceptImage>("conceptImage", p[3], a.workspaceId)))
      fail(404, "Concept image is unavailable.");
    return recordingResponse(req, p[3], "image/png");
  }
  canEdit(a);
  if (req.method === "POST" && !p[3]) {
    limit("concept-upload:" + a.workspaceId, 60);
    const id = z.uuid().parse(req.headers.get("x-upload-id")),
      image = await imageBytes(req);
    return transaction(async () => {
      const current = await get<ConceptImage>("conceptImage", id);
      if (current) {
        if (
          current.workspaceId !== a.workspaceId ||
          current.studyId !== s.id ||
          current.digest !== image.digest
        )
          fail(
            409,
            "Upload ID already belongs to another image. Choose the image again.",
          );
        return respond(
          {
            image: {
              id: current.id,
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
        (await get("participantImageDeleted", id)) ||
        (await get("conceptImageDeleted", id)) ||
        (await get("conceptVideoDeleted", id)) ||
        (await get("conceptVideo", id)) ||
        (await db.prepare("SELECT id FROM media WHERE id=?").get(id))
      )
        fail(409, "This upload ID is unavailable. Choose the image again.");
      if (
        (await list<ConceptImage>("conceptImage", a.workspaceId, s.id))
          .length >= 100
      )
        fail(
          400,
          "This study has 100 uploaded images. Delete unused uploads before adding more.",
        );
      await ensureRecording(id, image.data, "image/png");
      const record: ConceptImage = {
        id,
        workspaceId: a.workspaceId,
        studyId: s.id,
        createdAt: now(),
        width: image.width,
        height: image.height,
        bytes: image.data.length,
        digest: image.digest,
      };
      await put("conceptImage", record);
      return respond(
        {
          image: {
            id,
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
      const image = await get<ConceptImage>(
        "conceptImage",
        p[3],
        a.workspaceId,
      );
      if (!image || image.studyId !== s.id)
        fail(404, "Concept image is unavailable.");
      for (const row of await db
        .prepare(
          "SELECT data FROM documents WHERE workspace_id=? AND kind IN ('study','revision','history','interview','pulseSeries','conceptImage','conceptVideo')",
        )
        .all(a.workspaceId))
        if (references(JSON.parse(String(row.data)), image.id))
          fail(
            409,
            "This image is retained by a draft, revision, history entry, interview, tracker or watermarked copy. Remove it from the current concept or answer option to stop using it in new interviews; retained versions keep the original.",
          );
      jobId = uid();
      await put("deletion", {
        id: jobId,
        workspaceId: a.workspaceId,
        studyId: s.id,
        files: [image.id],
        createdAt: now(),
      });
      await put("conceptImageDeleted", {
        id: image.id,
        workspaceId: a.workspaceId,
        studyId: s.id,
        createdAt: now(),
      });
      await db
        .prepare(
          "DELETE FROM documents WHERE kind='conceptImage' AND id=? AND workspace_id=?",
        )
        .run(image.id, a.workspaceId);
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
