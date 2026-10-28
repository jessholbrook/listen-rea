import { clearAttachmentReports } from "./attachment-evidence-server";
import type { ImageReview } from "./image-review";
import {
  imageAIPermissionVersion,
  imageAIPermissionText,
} from "./participant-image-ai";
import { copy } from "./participant-copy";
import { clearReporting } from "./reporting-cleanup";
import { createHash } from "node:crypto";
import { z } from "zod";
import { imageBytes } from "./concept-images-server";
import { db, get, put, transaction, uid, now, requireStudy, dirty } from "./db";
import {
  actor,
  canEdit,
  participant,
  fail,
  respond,
  publicInterview,
  limit,
} from "./http";
import { ensureRecording, recordingResponse } from "./storage";
import { cleanDeletions } from "./features";
import { conceptPresentation } from "./concept-timing";
import { videoAnswerBlocked } from "./video-once";
import type { Interview, ParticipantImage } from "./domain";
const headerVersion = (req: Request) =>
  z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().nonnegative())
    .parse(req.headers.get("x-interview-version"));
export async function validateParticipantImage(i: Interview, id?: string) {
  const draft = i.participantImageDraft;
  if (!draft && !id) return;
  if (
    !draft ||
    !id ||
    draft.image.id !== id ||
    draft.version !== i.version ||
    !i.guide.questions[i.current]?.participantImages ||
    !(await db
      .prepare(
        "SELECT id FROM media WHERE id=? AND interview_id=? AND turn_version=? AND kind='participant-image'",
      )
      .get(id, i.id, i.version))
  )
    fail(
      409,
      "Submit the attached image with your answer, or remove it before continuing. Reload if this interview changed.",
    );
}
function writable(i: Interview, version: number) {
  if (i.status !== "active" || i.version !== version || i.pending)
    fail(
      409,
      "This interview changed or is saving an answer. Reload before changing an attachment.",
    );
  const q = i.guide.questions[i.current],
    p = conceptPresentation(i);
  if (
    q?.type !== "open" ||
    !q.participantImages ||
    p?.state === "waiting" ||
    p?.state === "viewing" ||
    videoAnswerBlocked(i)
  )
    fail(409, "Image attachments are unavailable for this question.");
}
// Namespace client retry IDs by interview and turn so uploads cannot select another storage object's ID.
function imageId(interview: string, version: number, request: string) {
  const hex = createHash("sha256")
    .update(JSON.stringify(["participant-image", interview, version, request]))
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export async function dispatchParticipantImages(req: Request, p: string[]) {
  if (
    p[2] !== "participant-images" ||
    !["interviews", "studies"].includes(p[0]) ||
    (p.length !== 3 && p.length !== 4)
  )
    return null;
  const owner = p[0] === "studies";
  if (owner && !p[3]) return null;
  const a = owner ? await actor() : undefined;
  const study = a ? await requireStudy(p[1], a) : undefined;
  const initial = owner ? undefined : await participant(req, p[1]);
  if (req.method === "GET" && p[3]) {
    const m = owner
      ? await db
          .prepare(
            "SELECT id FROM media WHERE id=? AND study_id=? AND workspace_id=? AND kind='participant-image'",
          )
          .get(p[3], study!.id, a!.workspaceId)
      : await db
          .prepare(
            "SELECT id FROM media WHERE id=? AND interview_id=? AND kind='participant-image'",
          )
          .get(p[3], initial!.id);
    if (!m) fail(404, "Attached image is unavailable.");
    return recordingResponse(req, p[3], "image/png");
  }
  if (req.method === "POST" && !owner && !p[3]) {
    const i = initial!;
    limit("participant-image:" + i.id, 20);
    const version = headerVersion(req);
    writable(i, version);
    if (req.headers.get("x-image-consent") !== "yes")
      fail(400, "Confirm image sharing before uploading.");
    let decodedDescription: string;
    try {
      decodedDescription = decodeURIComponent(
        req.headers.get("x-image-description") || "",
      );
    } catch {
      fail(400, "Image description is invalid.");
    }
    const description = z
      .string()
      .trim()
      .min(3)
      .max(500)
      .parse(decodedDescription);
    const aiAllowed = req.headers.get("x-image-ai-consent") === "yes";
    if (aiAllowed && !i.guide.questions[i.current].participantImageAI)
      fail(400, "AI image permission is unavailable for this question.");
    const request = z.uuid().parse(req.headers.get("x-upload-id")),
      id = imageId(i.id, version, request);
    const image = await imageBytes(req, "Image uploads");
    let written = false;
    try {
      return await transaction(async () => {
        const current = await get<Interview>("interview", i.id);
        if (!current) fail(404, "Interview not found.");
        writable(current, version);
        const existing = await db
          .prepare("SELECT * FROM media WHERE id=?")
          .get(id);
        if (existing) {
          if (
            existing.kind !== "participant-image" ||
            existing.interview_id !== i.id ||
            Number(existing.turn_version) !== version ||
            existing.digest !== image.digest ||
            current.participantImageDraft?.image.id !== id ||
            Boolean(current.participantImageDraft.image.aiPermission) !==
              aiAllowed ||
            current.participantImageDraft.image.description !== description
          )
            fail(
              409,
              "This upload attempt already contains another image or description. Choose the file again.",
            );
          return respond({
            interview: publicInterview(current, true),
            image: current.participantImageDraft.image,
            reused: true,
          });
        }
        if (current.participantImageDraft)
          fail(409, "Remove the attached image before choosing another.");
        if (
          (await get("participantImageDeleted", id)) ||
          (await get("conceptImage", id)) ||
          (await get("conceptVideo", id)) ||
          (await get("conceptImageDeleted", id)) ||
          (await get("conceptVideoDeleted", id))
        )
          fail(
            409,
            "This upload attempt is unavailable. Choose the file again.",
          );
        const count = await db
          .prepare(
            "SELECT COUNT(*) AS n FROM media WHERE interview_id=? AND kind='participant-image'",
          )
          .get(i.id);
        if (Number(count?.n) >= 100)
          fail(
            409,
            "This interview has reached its image attachment limit. Continue without another image.",
          );
        await ensureRecording(id, image.data, "image/png");
        written = true;
        const saved: ParticipantImage = {
          ...(aiAllowed
            ? {
                aiPermission: {
                  version: imageAIPermissionVersion,
                  provider: "OpenAI" as const,
                  text: copy(i.language || "en", imageAIPermissionText),
                  language: i.language || "en",
                  grantedAt: now(),
                },
              }
            : {}),
          id,
          description,
          width: image.width,
          height: image.height,
          bytes: image.data.length,
          uploadedAt: now(),
        };
        await db
          .prepare(
            "INSERT INTO media(id,interview_id,workspace_id,study_id,mime,bytes,duration_ms,created_at,consent_at,turn_version,kind,digest) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            id,
            i.id,
            i.workspaceId,
            i.studyId,
            "image/png",
            image.data.length,
            0,
            saved.uploadedAt,
            saved.uploadedAt,
            version,
            "participant-image",
            image.digest,
          );
        current.participantImageDraft = { version, image: saved };
        await put("interview", current);
        return respond(
          { interview: publicInterview(current, true), image: saved },
          201,
        );
      });
    } catch (error) {
      if (written) {
        await transaction(async () => {
          if (!(await db.prepare("SELECT id FROM media WHERE id=?").get(id))) {
            await put("participantImageDeleted", {
              id,
              workspaceId: i.workspaceId,
              studyId: i.studyId,
              createdAt: now(),
            });
            await put("deletion", {
              id: uid(),
              workspaceId: i.workspaceId,
              studyId: i.studyId,
              files: [id],
              createdAt: now(),
            });
          }
        });
        await cleanDeletions();
      }
      throw error;
    }
  }
  if (req.method === "DELETE" && p[3]) {
    if (a) canEdit(a);
    const result = await transaction(async () => {
      const m = owner
        ? await db
            .prepare(
              "SELECT * FROM media WHERE id=? AND study_id=? AND workspace_id=? AND kind='participant-image'",
            )
            .get(p[3], study!.id, a!.workspaceId)
        : await db
            .prepare(
              "SELECT * FROM media WHERE id=? AND interview_id=? AND kind='participant-image'",
            )
            .get(p[3], initial!.id);
      if (!m) fail(404, "Attached image is unavailable.");
      const i = await get<Interview>("interview", m.interview_id as string);
      if (!i) fail(404, "Interview not found.");
      if (i.pending)
        fail(
          409,
          "An answer is being saved. Wait before deleting this attachment.",
        );
      if (!owner) {
        const version = headerVersion(req);
        writable(i, version);
        if (i.participantImageDraft?.image.id !== p[3])
          fail(
            409,
            "Submitted attachments can only be deleted by the research team.",
          );
      }
      const imageReview = await get<ImageReview>(
        "imageReview",
        p[3],
        i.workspaceId,
      );
      if (imageReview?.history.some((r) => r.includeInReports))
        await clearAttachmentReports(
          (await get<import("./domain").Study>(
            "study",
            i.studyId,
            i.workspaceId,
          ))!,
        );
      const derived =
        i.promptImageId === p[3] ||
        i.turns.some(
          (t) =>
            t.imageProbe?.imageId === p[3] || t.promptSourceImageId === p[3],
        );
      if (derived) {
        for (const t of i.turns) {
          if (
            t.participantPDF &&
            (t.imageProbe?.imageId === p[3] || t.promptSourceImageId === p[3])
          ) {
            const text = await get<import("./pdf-text").PDFText>(
              "participantPDFText",
              t.participantPDF.id,
              i.workspaceId,
            );
            if (text?.history.some((h) => h.includeInReports))
              await clearAttachmentReports(
                (await get<import("./domain").Study>(
                  "study",
                  i.studyId,
                  i.workspaceId,
                ))!,
              );
            await db
              .prepare(
                "DELETE FROM documents WHERE kind IN ('participantPDFReview','participantPDFText') AND id=? AND workspace_id=?",
              )
              .run(t.participantPDF.id, i.workspaceId);
          }
          if (t.imageProbe?.imageId === p[3]) t.imageProbe = undefined;
          if (t.promptSourceImageId === p[3]) {
            if (t.participantPPTX)
              await db
                .prepare(
                  "DELETE FROM documents WHERE kind IN ('participantPPTXReview','participantPPTXText') AND id=? AND workspace_id=?",
                )
                .run(t.participantPPTX.id, i.workspaceId);
            if (t.participantDOCX)
              await db
                .prepare(
                  "DELETE FROM documents WHERE kind IN ('participantDOCXReview','participantDOCXText') AND id=? AND workspace_id=?",
                )
                .run(t.participantDOCX.id, i.workspaceId);
            t.prompt = copy(
              i.language || "en",
              "The image-based question was removed after its source image was deleted.",
            );
            t.promptSourceImageId = undefined;
          }
        }
        if (i.promptImageId === p[3]) {
          i.promptImageId = undefined;
          i.prompt = copy(
            i.language || "en",
            "What else would you like the research team to know about your answer?",
          );
          i.strategy = "scripted";
          i.version++;
          if (i.participantPPTXDraft) {
            i.participantPPTXDraft.version = i.version;
            await db
              .prepare(
                "UPDATE media SET turn_version=? WHERE id=? AND interview_id=?",
              )
              .run(i.version, i.participantPPTXDraft.pptx.id, i.id);
          }
          if (i.participantDOCXDraft) {
            i.participantDOCXDraft.version = i.version;
            await db
              .prepare(
                "UPDATE media SET turn_version=? WHERE id=? AND interview_id=?",
              )
              .run(i.version, i.participantDOCXDraft.docx.id, i.id);
          }
          if (i.participantPDFDraft) {
            i.participantPDFDraft.version = i.version;
            await db
              .prepare(
                "UPDATE media SET turn_version=? WHERE id=? AND interview_id=?",
              )
              .run(i.version, i.participantPDFDraft.pdf.id, i.id);
          }

          if (
            i.participantImageDraft &&
            i.participantImageDraft.image.id !== p[3]
          ) {
            i.participantImageDraft.version = i.version;
            await db
              .prepare(
                "UPDATE media SET turn_version=? WHERE id=? AND interview_id=?",
              )
              .run(i.version, i.participantImageDraft.image.id, i.id);
          }
        }
        await db
          .prepare(
            "DELETE FROM documents WHERE workspace_id=? AND study_id=? AND kind='analysis'",
          )
          .run(i.workspaceId, i.studyId);
        await db
          .prepare(
            "DELETE FROM documents WHERE workspace_id=? AND kind='responseTranslation' AND json_extract(data,'$.interviewId')=?",
          )
          .run(i.workspaceId, i.id);
        const liveStudy = await get<import("./domain").Study>(
          "study",
          i.studyId,
        );
        if (liveStudy) await clearReporting(liveStudy);
      }
      if (i.participantImageDraft?.image.id === p[3])
        i.participantImageDraft = undefined;
      for (const t of i.turns)
        if (t.participantImage?.id === p[3]) {
          t.participantImage = undefined;
          t.participantImageRemovedAt = now();
        }

      await db
        .prepare(
          "DELETE FROM documents WHERE kind='imageReview' AND id=? AND workspace_id=?",
        )
        .run(p[3], i.workspaceId);
      await put("interview", i);
      await db.prepare("DELETE FROM media WHERE id=?").run(p[3]);
      await put("participantImageDeleted", {
        id: p[3],
        workspaceId: i.workspaceId,
        studyId: i.studyId,
        createdAt: now(),
      });
      await put("deletion", {
        id: uid(),
        workspaceId: i.workspaceId,
        studyId: i.studyId,
        files: [p[3]],
        createdAt: now(),
      });
      if (study) await dirty(await requireStudy(study.id, a!));
      return respond({ interview: publicInterview(i, true) });
    });
    await cleanDeletions();
    return result;
  }
  return null;
}
