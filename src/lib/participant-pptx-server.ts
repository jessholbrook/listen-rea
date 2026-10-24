import {
  pptxProbeFingerprint,
  pptxReviewFingerprint,
  pptxReviewSnapshot,
} from "./pptx-observations-server";
import { pptxAIPermissionVersion, pptxAILabels } from "./participant-pptx-ai";
import { copy } from "./participant-copy";
import { clearReporting } from "./reporting-cleanup";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, get, put, transaction, uid, now, requireStudy, dirty } from "./db";
import {
  actor,
  canEdit,
  participant,
  fail,
  respond,
  publicInterview,
  limit,
  body,
} from "./http";
import { ensureRecording, readRecording } from "./storage";
import { cleanDeletions } from "./features";
import { clearAttachmentReports } from "./attachment-evidence-server";
import { pptxBytes } from "./pptx-preparation";
import { pptxSnapshot } from "./participant-pptx";
import { conceptPresentation } from "./concept-timing";
import { videoAnswerBlocked } from "./video-once";
import { pptxTextRequest } from "./pptx-text-server";
import type { Interview } from "./domain";
import type { ParticipantPPTX, PPTXReview } from "./participant-pptx";
const versionHeader = (req: Request) =>
  z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().nonnegative())
    .parse(req.headers.get("x-interview-version"));
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
    !q.participantPPTX ||
    p?.state === "waiting" ||
    p?.state === "viewing" ||
    videoAnswerBlocked(i)
  )
    fail(409, "PPTX attachments are unavailable for this question.");
}
export async function validateParticipantPPTX(i: Interview, id?: string) {
  const draft = i.participantPPTXDraft;
  if (!draft && !id) return;
  if (
    !draft ||
    !id ||
    draft.pptx.id !== id ||
    draft.version !== i.version ||
    !i.guide.questions[i.current]?.participantPPTX ||
    !(await db
      .prepare(
        "SELECT id FROM media WHERE id=? AND interview_id=? AND turn_version=? AND kind='participant-pptx'",
      )
      .get(id, i.id, i.version))
  )
    fail(
      409,
      "Submit the attached PPTX with your answer, or remove it before continuing. Reload if this interview changed.",
    );
}
function pptxId(i: string, version: number, request: string) {
  const hex = createHash("sha256")
    .update(JSON.stringify(["participant-pptx", i, version, request]))
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export async function dispatchParticipantPPTXs(req: Request, p: string[]) {
  if (
    !["studies", "interviews"].includes(p[0]) ||
    p[2] !== "participant-pptx" ||
    ![3, 4, 5].includes(p.length)
  )
    return null;
  const owner = p[0] === "studies";
  if (owner && !p[3]) return null;
  const a = owner ? await actor() : undefined,
    s = a ? await requireStudy(p[1], a) : undefined,
    initial = owner ? undefined : await participant(req, p[1]);
  const media = () =>
    owner
      ? db
          .prepare(
            "SELECT * FROM media WHERE id=? AND study_id=? AND workspace_id=? AND kind='participant-pptx'",
          )
          .get(p[3], s!.id, a!.workspaceId)
      : db
          .prepare(
            "SELECT * FROM media WHERE id=? AND interview_id=? AND kind='participant-pptx'",
          )
          .get(p[3], initial!.id);
  if (p.length === 5) {
    if (owner && p[4] === "text") return pptxTextRequest(req, p[3], a!, s!);
    if (!owner || p[4] !== "review") fail(404, "PPTX review is unavailable.");
    if (!["GET", "PUT"].includes(req.method)) fail(405, "Method unavailable.");
    if (req.method === "PUT") canEdit(a!);
    const input =
      req.method === "PUT"
        ? z
            .object({
              source: z.string().regex(/^[a-f0-9]{64}$/),
              version: z.number().int().nonnegative(),
              quality: z.enum([
                "usable",
                "unclear",
                "irrelevant",
                "privacy_concern",
                "uncertain",
              ]),
              notes: z.string().trim().max(2000),
              probeSource: z
                .string()
                .regex(/^[a-f0-9]{64}$/)
                .optional(),
              grounding: z
                .enum([
                  "supported",
                  "unsupported",
                  "uncertain",
                  "not_applicable",
                ])
                .optional(),
              correction: z.string().trim().max(1000).optional(),
              includeInReports: z.boolean().optional().default(false),
            })
            .strict()
            .parse(await body(req))
        : undefined;
    return transaction(async () => {
      const m = await media();
      if (!m) fail(404, "Attached PPTX is unavailable.");
      const i = await get<Interview>(
          "interview",
          String(m.interview_id),
          a!.workspaceId,
        ),
        t =
          i?.studyId === s!.id
            ? i.turns.find((t) => t.participantPPTX?.id === p[3])
            : undefined;
      if (!i || !t)
        fail(409, "Submit the PPTX with an answer before reviewing it.");
      const source = pptxReviewFingerprint(i, t, m.digest),
        saved = await get<PPTXReview>(
          "participantPPTXReview",
          p[3],
          a!.workspaceId,
        );
      if (
        saved &&
        (saved.source !== source ||
          saved.interviewId !== i.id ||
          saved.turnId !== t.id)
      )
        fail(409, "The PPTX review source changed. Reload its transcript.");
      const history = saved?.history || [],
        version = history.at(-1)?.version || 0;
      // Keep the original file/answer fingerprint compatible with quality-only
      // reviews. Bind new judgments to the exact probe and prepared snapshot too.
      const probe = t.pptxProbe?.pptxId === p[3] ? t.pptxProbe : undefined,
        asked = probe?.status === "asked",
        probeSource = pptxProbeFingerprint(
          source,
          probe,
          pptxReviewSnapshot(await readRecording(p[3]), probe),
        );
      const result = { source, probeSource, probe, asked, version, history };
      if (!input) return respond(result);
      if (input.source !== source || input.version !== version)
        fail(
          409,
          "Another researcher changed this review. Reload the saved review before editing.",
        );
      if (input.probeSource !== undefined && input.probeSource !== probeSource)
        fail(
          409,
          "The PPTX question changed. Reload the saved review before editing.",
        );
      const structured =
        input.grounding !== undefined || input.correction !== undefined;
      if (structured && input.probeSource !== probeSource)
        fail(409, "Reload the PPTX question before reviewing its grounding.");
      if (structured && !input.grounding)
        fail(400, "Choose a grounding judgment for this review.");
      if (
        structured &&
        !asked &&
        (input.grounding !== "not_applicable" || input.correction)
      )
        fail(
          400,
          "Grounding and corrections require an actually asked PPTX question.",
        );
      if (structured && asked && input.grounding === "not_applicable")
        fail(400, "Choose a grounding judgment for the asked PPTX question.");
      if (
        input.includeInReports &&
        (!structured ||
          input.quality !== "usable" ||
          Math.max(input.notes.length, input.correction?.length || 0) < 3)
      )
        fail(
          400,
          "Including PPTX observations requires a usable PPTX, a current grounding review and a note or correction of at least 3 characters.",
        );
      if (history.length >= 50)
        fail(409, "This review has reached its correction history limit.");
      const next = [
        ...history,
        {
          includeInReports: input.includeInReports,
          quality: input.quality,
          notes: input.notes,
          ...(structured
            ? {
                grounding: input.grounding,
                correction: input.correction || "",
                probeSource,
                originalProbe: asked ? probe : undefined,
              }
            : {}),
          version: version + 1,
          at: now(),
          reviewer: { id: a!.id, name: a!.name },
        },
      ];
      if (input.includeInReports || history.at(-1)?.includeInReports) {
        await clearAttachmentReports(s!);
        await dirty(
          (await get<import("./domain").Study>(
            "study",
            s!.id,
            a!.workspaceId,
          ))!,
        );
      }
      await put("participantPPTXReview", {
        id: p[3],
        workspaceId: a!.workspaceId,
        studyId: s!.id,
        interviewId: i.id,
        turnId: t.id,
        source,
        history: next,
      });
      return respond({ ...result, version: version + 1, history: next });
    });
  }
  if (req.method === "GET" && p[3]) {
    if (!(await media())) fail(404, "Attached PPTX is unavailable.");
    const snapshot = pptxSnapshot.parse(
      JSON.parse((await readRecording(p[3])).toString()),
    );
    return Response.json(snapshot, {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; sandbox; frame-ancestors 'none'",
      },
    });
  }
  if (req.method === "POST" && !owner && !p[3]) {
    const i = initial!;
    limit("participant-pptx:" + i.id, 20);
    const version = versionHeader(req);
    writable(i, version);
    if (req.headers.get("x-pptx-consent") !== "yes")
      fail(400, "Confirm PPTX sharing before uploading.");
    let description: string;
    try {
      description = decodeURIComponent(
        req.headers.get("x-pptx-description") || "",
      );
    } catch {
      fail(400, "PPTX description is invalid.");
    }
    description = z.string().trim().min(3).max(500).parse(description);
    const aiHeader = z
      .enum(["yes", "no"])
      .optional()
      .parse(req.headers.get("x-pptx-ai-consent") ?? undefined);
    const aiAllowed = aiHeader === "yes";
    if (aiAllowed && !i.guide.questions[i.current].participantPPTXAI)
      fail(400, "AI PPTX permission is unavailable for this question.");
    const id = pptxId(
        i.id,
        version,
        z.uuid().parse(req.headers.get("x-upload-id")),
      ),
      pptx = await pptxBytes(req);
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
            existing.kind !== "participant-pptx" ||
            existing.interview_id !== i.id ||
            Number(existing.turn_version) !== version ||
            existing.digest !== pptx.digest ||
            current.participantPPTXDraft?.pptx.id !== id ||
            Boolean(current.participantPPTXDraft.pptx.aiPermission) !==
              aiAllowed ||
            current.participantPPTXDraft.pptx.description !== description
          )
            fail(
              409,
              "This upload attempt already contains another PPTX or description. Choose the file again.",
            );
          return respond({
            interview: publicInterview(current, true),
            pptx: current.participantPPTXDraft.pptx,
            reused: true,
          });
        }
        if (current.participantPPTXDraft)
          fail(409, "Remove the attached PPTX before choosing another.");
        if (await get("participantPPTXDeleted", id))
          fail(
            409,
            "This upload attempt is unavailable. Choose the file again.",
          );
        const count = await db
          .prepare(
            "SELECT COUNT(*) AS n FROM media WHERE interview_id=? AND kind='participant-pptx'",
          )
          .get(i.id);
        if (Number(count?.n) >= 20)
          fail(
            409,
            "This interview has reached its PPTX attachment limit. Continue without another PPTX.",
          );
        await ensureRecording(id, pptx.data, "application/json");
        written = true;
        const saved: ParticipantPPTX = {
          ...(aiAllowed
            ? {
                aiPermission: {
                  version: pptxAIPermissionVersion,
                  provider: "OpenAI" as const,
                  text: pptxAILabels[i.language || "en"].permission,
                  language: i.language || "en",
                  grantedAt: now(),
                },
              }
            : {}),
          id,
          description,
          slides: pptx.slides,
          characters: pptx.characters,
          bytes: pptx.data.length,
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
            "application/json",
            pptx.data.length,
            0,
            saved.uploadedAt,
            saved.uploadedAt,
            version,
            "participant-pptx",
            pptx.digest,
          );
        current.participantPPTXDraft = { version, pptx: saved };
        await put("interview", current);
        return respond(
          { interview: publicInterview(current, true), pptx: saved },
          201,
        );
      });
    } catch (error) {
      if (written) {
        await transaction(async () => {
          if (!(await db.prepare("SELECT id FROM media WHERE id=?").get(id))) {
            await put("participantPPTXDeleted", {
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
      const m = await media();
      if (!m) fail(404, "Attached PPTX is unavailable.");
      const i = await get<Interview>("interview", String(m.interview_id));
      if (!i) fail(404, "Interview not found.");
      if (i.pending)
        fail(
          409,
          "An answer is being saved. Wait before deleting this attachment.",
        );
      if (!owner) {
        writable(i, versionHeader(req));
        if (i.participantPPTXDraft?.pptx.id !== p[3])
          fail(
            409,
            "Submitted attachments can only be deleted by the research team.",
          );
      }
      const derived =
        i.promptPPTXId === p[3] ||
        i.turns.some(
          (t) => t.pptxProbe?.pptxId === p[3] || t.promptSourcePPTXId === p[3],
        );
      if (derived) {
        for (const t of i.turns) {
          if (t.pptxProbe?.pptxId === p[3] || t.promptSourcePPTXId === p[3]) {
            if (t.participantImage)
              await db
                .prepare(
                  "DELETE FROM documents WHERE kind='imageReview' AND id=? AND workspace_id=?",
                )
                .run(t.participantImage.id, i.workspaceId);
            if (t.participantPDF)
              await db
                .prepare(
                  "DELETE FROM documents WHERE kind IN ('participantPDFReview','participantPDFText') AND id=? AND workspace_id=?",
                )
                .run(t.participantPDF.id, i.workspaceId);
          }
          if (t.pptxProbe?.pptxId === p[3]) t.pptxProbe = undefined;
          if (t.promptSourcePPTXId === p[3]) {
            if (t.participantDOCX)
              await db
                .prepare(
                  "DELETE FROM documents WHERE kind IN ('participantDOCXReview','participantDOCXText') AND id=? AND workspace_id=?",
                )
                .run(t.participantDOCX.id, i.workspaceId);
            if (t.participantPPTX)
              await db
                .prepare(
                  "DELETE FROM documents WHERE kind IN ('participantPPTXReview','participantPPTXText') AND id=? AND workspace_id=?",
                )
                .run(t.participantPPTX.id, i.workspaceId);
            t.prompt = pptxAILabels[i.language || "en"].removed;
            t.promptSourcePPTXId = undefined;
          }
        }
        if (i.promptPPTXId === p[3]) {
          i.promptPPTXId = undefined;
          i.prompt = copy(
            i.language || "en",
            "What else would you like the research team to know about your answer?",
          );
          i.strategy = "scripted";
          i.version++;
          for (const [draft, id] of [
            [i.participantDOCXDraft, i.participantDOCXDraft?.docx.id],
            [i.participantPPTXDraft, i.participantPPTXDraft?.pptx.id],
            [i.participantPDFDraft, i.participantPDFDraft?.pdf.id],
            [i.participantImageDraft, i.participantImageDraft?.image.id],
          ] as const) {
            if (draft && id !== p[3]) {
              draft.version = i.version;
              await db
                .prepare(
                  "UPDATE media SET turn_version=? WHERE id=? AND interview_id=?",
                )
                .run(i.version, id!, i.id);
            }
          }
        }
        await db
          .prepare(
            "DELETE FROM documents WHERE workspace_id=? AND kind='responseTranslation' AND json_extract(data,'$.interviewId')=?",
          )
          .run(i.workspaceId, i.id);
        const study = await get<import("./domain").Study>(
          "study",
          i.studyId,
          i.workspaceId,
        );
        if (study) {
          await clearAttachmentReports(study);
          await clearReporting(study);
        }
      }
      if (i.participantPPTXDraft?.pptx.id === p[3])
        i.participantPPTXDraft = undefined;
      for (const t of i.turns)
        if (t.participantPPTX?.id === p[3]) {
          t.participantPPTX = undefined;
          t.participantPPTXRemovedAt = now();
        }
      await db
        .prepare(
          "DELETE FROM documents WHERE kind IN ('participantPPTXReview','participantPPTXText') AND id=? AND workspace_id=?",
        )
        .run(p[3], i.workspaceId);
      await put("interview", i);
      await db.prepare("DELETE FROM media WHERE id=?").run(p[3]);
      await put("participantPPTXDeleted", {
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
      if (s) {
        await clearAttachmentReports(s);
        await dirty(await requireStudy(s.id, a!));
      }
      return respond({ interview: publicInterview(i, true) });
    });
    await cleanDeletions();
    return result;
  }
  return null;
}
