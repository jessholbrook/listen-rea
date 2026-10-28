import {
  attachmentFingerprint,
  clearAttachmentReports,
} from "./attachment-evidence-server";
import { z } from "zod";
import { db, get, put, transaction, requireStudy, now, dirty } from "./db";
import { actor, canEdit, body, fail, respond } from "./http";
import { imageReviewFields, type ImageReview } from "./image-review";
import type { Interview } from "./domain";
export async function dispatchImageReview(req: Request, p: string[]) {
  if (
    p[0] !== "studies" ||
    p[2] !== "participant-images" ||
    p[4] !== "review" ||
    p.length !== 5
  )
    return null;
  const a = await actor();
  await requireStudy(p[1], a);
  if (!["GET", "PUT"].includes(req.method)) fail(405, "Method unavailable.");
  if (req.method === "PUT") canEdit(a);
  const input =
    req.method === "PUT"
      ? imageReviewFields
          .extend({
            version: z.number().int().nonnegative(),
            source: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict()
          .parse(await body(req))
      : undefined;
  return transaction(async () => {
    const s = await requireStudy(p[1], a);
    const media = await db
      .prepare(
        "SELECT * FROM media WHERE id=? AND workspace_id=? AND study_id=? AND kind='participant-image'",
      )
      .get(p[3], a.workspaceId, s.id);
    if (!media) fail(404, "Attached image is unavailable.");
    const i = await get<Interview>(
      "interview",
      String(media.interview_id),
      a.workspaceId,
    );
    const t =
      i?.studyId === s.id
        ? i.turns.find((t) => t.participantImage?.id === p[3])
        : undefined;
    if (!i || !t)
      fail(409, "Submit the image with an answer before reviewing it.");
    const source = attachmentFingerprint(i, t, media.digest);
    const saved = await get<ImageReview>("imageReview", p[3], a.workspaceId);
    if (
      saved &&
      (saved.source !== source ||
        saved.interviewId !== i.id ||
        saved.turnId !== t.id)
    )
      fail(409, "The review source changed. Reload before reviewing.");
    const history = saved?.history || [];
    const version = history.at(-1)?.version || 0;
    const asked = t.imageProbe?.status === "asked";
    if (!input) return respond({ source, version, history, asked });
    if (input.source !== source || input.version !== version)
      fail(
        409,
        "Another researcher changed this review. Reload the saved review before editing.",
      );
    if (!asked && (input.grounding !== "not_applicable" || input.correction))
      fail(400, "There is no generated image question to assess or correct.");
    if (asked && input.grounding === "not_applicable")
      fail(400, "Assess the generated image question, or mark it uncertain.");
    if (history.length >= 200)
      fail(409, "This review has reached its correction history limit.");
    if (
      input.includeInReports &&
      (input.quality !== "usable" || input.notes.trim().length < 3)
    )
      fail(
        400,
        "Only usable images with researcher notes can be included in reports.",
      );
    const { version: _version, source: _source, ...fields } = input;
    const next = [
      ...history,
      {
        ...fields,
        version: version + 1,
        at: now(),
        reviewer: { id: a.id, name: a.name },
      },
    ];
    await put("imageReview", {
      id: p[3],
      workspaceId: a.workspaceId,
      studyId: s.id,
      interviewId: i.id,
      turnId: t.id,
      source,
      history: next,
    });
    if (history.at(-1)?.includeInReports || input.includeInReports)
      await clearAttachmentReports(s);
    await dirty(s);
    return respond({ source, version: version + 1, history: next, asked });
  });
}
