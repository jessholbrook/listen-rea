import { z } from "zod";
import { createHash } from "node:crypto";
import { actor, canEdit, body, respond, fail, limit } from "./http";
import { get, put, list, transaction, requireStudy, uid, now, db } from "./db";
import { ensureRecording, readRecording, deleteRecording } from "./storage";
import { watermarkImage, watermarkVideo } from "./media-watermark-process";
import { watermarkVersion } from "./media-watermark";
import type { ConceptImage } from "./concept-images";
import type { ConceptVideo } from "./concept-videos";
export type WatermarkMetadata = {
  sourceAssetId?: string;
  watermarkAssetId?: string;
  watermarkVersion?: string;
};
type Asset = (ConceptImage | ConceptVideo) & WatermarkMetadata;
const pending = new Map<string, Promise<Asset>>();
export async function dispatchMediaWatermark(req: Request, p: string[]) {
  if (
    p.length !== 5 ||
    p[0] !== "studies" ||
    p[4] !== "watermark" ||
    !["concept-images", "concept-videos"].includes(p[2])
  )
    return null;
  const a = await actor(),
    s = await requireStudy(p[1], a),
    kind = p[2] === "concept-images" ? "conceptImage" : "conceptVideo",
    source = await get<Asset>(kind, p[3], a.workspaceId);
  if (!source) fail(404, "Media is unavailable.");
  if (req.method === "GET") return respond({ enabled: !!source.sourceAssetId });
  if (req.method !== "POST") fail(405, "Method not allowed.");
  canEdit(a);
  const { enabled } = z
    .object({ enabled: z.boolean() })
    .strict()
    .parse(await body(req));
  if (!enabled) {
    const original = source.sourceAssetId
      ? await get<Asset>(kind, source.sourceAssetId, a.workspaceId)
      : source;
    if (!original) fail(404, "The original media is unavailable.");
    return respond({ asset: { id: original.id }, enabled: false });
  }
  if (source.sourceAssetId)
    return respond({ asset: { id: source.id }, enabled: true });
  const cached = source.watermarkAssetId
    ? await get<Asset>(kind, source.watermarkAssetId, a.workspaceId)
    : undefined;
  if (
    cached?.sourceAssetId === source.id &&
    cached.watermarkVersion === watermarkVersion
  )
    return respond({ asset: { id: cached.id }, enabled: true });
  limit("media-watermark:" + a.workspaceId, 20);
  const key = kind + ":" + source.id;
  let work = pending.get(key);
  if (!work) {
    work = (async () => {
      const bytes = await readRecording(source.id),
        video =
          kind === "conceptVideo"
            ? await watermarkVideo(bytes, source.width, source.height)
            : undefined;
      const data =
          video?.data ||
          (await watermarkImage(bytes, source.width, source.height)),
        id = uid();
      let wrote = false;
      try {
        return await transaction(async () => {
          const current = await get<Asset>(kind, source.id, a.workspaceId);
          if (!current)
            fail(404, "The original media was removed. Choose another upload.");
          const previous = current.watermarkAssetId
            ? await get<Asset>(kind, current.watermarkAssetId, a.workspaceId)
            : undefined;
          if (
            previous?.sourceAssetId === source.id &&
            previous.watermarkVersion === watermarkVersion
          )
            return previous;
          if ((await list(kind, a.workspaceId, source.studyId)).length >= 100)
            fail(
              400,
              "This study has 100 uploads of this type. Delete unused copies before watermarking.",
            );
          await ensureRecording(
            id,
            data,
            kind === "conceptImage" ? "image/png" : "video/mp4",
          );
          wrote = true;
          const { watermarkAssetId, ...original } = current;
          const asset: Asset = {
            ...original,
            id,
            createdAt: now(),
            bytes: data.length,
            digest: createHash("sha256").update(data).digest("hex"),
            sourceAssetId: source.id,
            watermarkVersion,
            ...(video ? { durationMs: video.durationMs } : {}),
          };
          await put(kind, asset);
          await put(kind, { ...current, watermarkAssetId: id });
          return asset;
        });
      } catch (error) {
        if (wrote) {
          const job = uid();
          await put("deletion", {
            id: job,
            workspaceId: a.workspaceId,
            studyId: s.id,
            files: [id],
            createdAt: now(),
          });
          try {
            await deleteRecording(id);
            await db
              .prepare("DELETE FROM documents WHERE kind='deletion' AND id=?")
              .run(job);
          } catch {}
        }
        throw error;
      }
    })();
    pending.set(key, work);
    work
      .finally(() => {
        if (pending.get(key) === work) pending.delete(key);
      })
      .catch(() => {});
  }
  const asset = await work;
  return respond({ asset: { id: asset.id }, enabled: true });
}
