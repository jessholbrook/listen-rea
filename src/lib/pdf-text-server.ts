import { aiReady } from "./ai";
import { generatePDFOCR, renderPDFPage } from "./pdf-ocr-server";
import {
  pdfOCRPermissionVersion,
  pdfOCRPermissionText,
  verifiedOCRRevision,
} from "./pdf-ocr";
import { pdfFingerprint } from "./pdf-evidence-server";
import { clearAttachmentReports } from "./attachment-evidence-server";
import { validPassages } from "./pdf-text";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, get, put, transaction, now, dirty, uid } from "./db";
import { body, canEdit, fail, limit, respond } from "./http";
import { readRecording } from "./storage";
import { extractPDFText } from "./pdf-text-extraction";
import type { Actor, Study, Interview } from "./domain";
import type { PDFText, PDFPassage } from "./pdf-text";
export { validPassages } from "./pdf-text";
export async function pdfTextRequest(
  req: Request,
  id: string,
  a: Actor,
  s: Study,
  ocr = false,
) {
  if (!["GET", "POST", "PUT"].includes(req.method))
    fail(405, "Method unavailable.");
  if (req.method !== "GET") canEdit(a);
  async function context() {
    const m = await db
      .prepare(
        "SELECT * FROM media WHERE id=? AND study_id=? AND workspace_id=? AND kind='participant-pdf'",
      )
      .get(id, s.id, a.workspaceId);
    if (!m) fail(404, "Attached PDF is unavailable.");
    const i = await get<Interview>(
        "interview",
        String(m.interview_id),
        a.workspaceId,
      ),
      t =
        i?.studyId === s.id
          ? i.turns.find((t) => t.participantPDF?.id === id)
          : undefined;
    if (!i || !t)
      fail(409, "Submit the PDF with an answer before extracting text.");
    const source = pdfFingerprint(i, t, m.digest);
    const saved = await get<PDFText>("participantPDFText", id, a.workspaceId);
    if (
      saved &&
      (saved.source !== source ||
        saved.interviewId !== i.id ||
        saved.turnId !== t.id)
    )
      fail(409, "The PDF source changed. Reload its transcript.");
    return { source, saved, i, t };
  }
  if (ocr) {
    if (!["POST", "PUT"].includes(req.method)) fail(405, "Method unavailable.");
    const baseInput = z.object({
      source: z.string().regex(/^[a-f0-9]{64}$/),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
      page: z.number().int().min(1).max(20),
    });
    const input = (
      req.method === "POST"
        ? baseInput
            .extend({
              permission: z.literal(true),
              permissionVersion: z.literal(pdfOCRPermissionVersion),
            })
            .strict()
        : baseInput
            .extend({
              draftId: z.uuid(),
              correctionVersion: z.number().int().nonnegative().optional(),
              reason: z.string().trim().min(3).max(1000).optional(),
              text: z.string().trim().min(1).max(12000),
              attested: z.literal(true),
              version: z.number().int().nonnegative(),
            })
            .strict()
    ).parse(await body(req));
    async function current() {
      const c = await context(),
        text = c.saved;
      if (!text)
        fail(409, "Extract native PDF text first, then select a scanned page.");
      if (input.source !== c.source || input.digest !== text.digest)
        fail(409, "PDF text changed. Reload saved verification before OCR.");
      const isCorrection =
        req.method === "PUT" &&
        "draftId" in input &&
        text.ocr?.some(
          (d) => d.id === input.draftId && d.page === input.page && d.accepted,
        );
      if (
        input.page > text.pages.length ||
        (text.pages[input.page - 1].trim() && !isCorrection)
      )
        fail(
          409,
          "OCR is available only for pages without extracted text. Existing page text cannot be replaced.",
        );
      return { ...c, text };
    }
    if (req.method === "POST") {
      limit("pdf-ocr:" + a.workspaceId, 20);
      const initial = await transaction(current);
      if (initial.text.ocr?.some((d) => d.page === input.page))
        return respond({ source: initial.source, text: initial.text });
      if (!aiReady()) fail(503, "AI is not configured. OCR is unavailable.");
      const grantedAt = now();
      const image = await renderPDFPage(await readRecording(id), input.page);
      await transaction(current);
      const result = await generatePDFOCR(image, a.workspaceId, s.id);
      return transaction(async () => {
        const c = await current();
        if (c.text.ocr?.some((d) => d.page === input.page))
          return respond({ source: c.source, text: c.text });
        c.text.ocr ||= [];
        c.text.ocr.push({
          id: uid(),
          page: input.page,
          draft: result.text,
          model: result.model,
          promptVersion: result.promptVersion,
          generatedAt: now(),
          permission: {
            version: pdfOCRPermissionVersion,
            text: pdfOCRPermissionText,
            provider: "OpenAI",
            grantedAt,
            actor: { id: a.id, name: a.name },
          },
        });
        await put("participantPDFText", c.text);
        return respond({ source: c.source, text: c.text });
      });
    }
    if (!("draftId" in input)) fail(400, "Verify the OCR draft before saving.");
    return transaction(async () => {
      const c = await current(),
        text = c.text,
        draft = text.ocr?.find(
          (d) => d.id === input.draftId && d.page === input.page,
        );
      if (!draft) fail(409, "OCR draft is unavailable. Reload.");
      const correction = Boolean(draft.accepted),
        correctionVersion = draft.corrections?.at(-1)?.version || 0;
      if (correction) {
        if (input.correctionVersion === undefined || input.reason === undefined)
          fail(
            409,
            "This OCR text is already verified. Supply its correction version and a reason to revise it.",
          );
        if (
          input.correctionVersion !== correctionVersion ||
          text.pages[input.page - 1] !== verifiedOCRRevision(draft)?.text
        )
          fail(409, "OCR correction changed. Reload saved verification.");
        if ((draft.corrections?.length || 0) >= 20)
          fail(409, "This page has reached its limit of 20 OCR corrections.");
        if (input.text === text.pages[input.page - 1])
          fail(400, "Change the OCR text before saving a correction.");
      } else if (
        input.correctionVersion !== undefined ||
        input.reason !== undefined
      )
        fail(400, "Verify the initial OCR draft before adding corrections.");
      const version = text.history.at(-1)?.version || 0;
      if (input.version !== version || text.history.length >= 50)
        fail(
          409,
          "PDF verification changed or reached its revision limit. Reload.",
        );
      if (
        text.pages.reduce((n, p) => n + p.length, 0) -
          text.pages[input.page - 1].length +
          input.text.length >
        200000
      )
        fail(422, "PDF text exceeds its total character limit.");
      const previousDigest = text.digest;
      text.pages[input.page - 1] = input.text;
      text.digest = createHash("sha256")
        .update(JSON.stringify(text.pages))
        .digest("hex");
      const revision = {
        text: input.text,
        at: now(),
        reviewer: { id: a.id, name: a.name },
        previousDigest,
        digest: text.digest,
      };
      if (correction) {
        draft.corrections ||= [];
        draft.corrections.push({
          ...revision,
          version: correctionVersion + 1,
          reason: input.reason!,
        });
        if (
          JSON.stringify(text.ocr?.flatMap((d) => d.corrections || [])).length >
          250000
        )
          fail(413, "OCR correction history exceeds this PDF’s storage limit.");
      } else draft.accepted = revision;
      // Changing the text digest invalidates all derived evidence snapshots. Keep
      // prior reviews, but require a new explicit passage review/inclusion.
      const passages = structuredClone(
        text.history.at(-1)?.passages || [],
      ).filter((p) => !correction || p.page !== input.page);
      text.history.push({
        version: version + 1,
        at: now(),
        reviewer: { id: a.id, name: a.name },
        passages,
        includeInReports: false,
        ocrPage: input.page,
        ...(correction ? { ocrCorrectionVersion: correctionVersion + 1 } : {}),
      });
      await clearAttachmentReports(s);
      await dirty((await get<Study>("study", s.id, a.workspaceId))!);
      await put("participantPDFText", text);
      return respond({ source: c.source, text });
    });
  }
  if (req.method === "GET")
    return transaction(async () => {
      const c = await context();
      return respond({ source: c.source, text: c.saved || null });
    });
  if (req.method === "POST") {
    limit("pdf-text:" + a.workspaceId, 20);
    const initial = await transaction(context);
    if (initial.saved)
      return respond({ source: initial.source, text: initial.saved });
    const pages = await extractPDFText(await readRecording(id));
    return transaction(async () => {
      const c = await context();
      if (c.source !== initial.source)
        fail(409, "The PDF source changed during extraction. Reload.");
      if (c.saved) return respond({ source: c.source, text: c.saved });
      if (pages.length !== c.t.participantPDF!.pages)
        fail(422, "PDF page count does not match the stored source.");
      const text: PDFText = {
        id,
        workspaceId: a.workspaceId,
        studyId: s.id,
        interviewId: c.i.id,
        turnId: c.t.id,
        source: c.source,
        digest: createHash("sha256")
          .update(JSON.stringify(pages))
          .digest("hex"),
        pages,
        extractedAt: now(),
        history: [],
      };
      await put("participantPDFText", text);
      return respond({ source: c.source, text });
    });
  }
  const input = z
    .object({
      source: z.string().regex(/^[a-f0-9]{64}$/),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
      version: z.number().int().nonnegative(),
      attested: z.literal(true),
      includeInReports: z.boolean().optional().default(false),
      passages: z
        .array(
          z
            .object({
              page: z.number().int().min(1).max(20),
              start: z.number().int().nonnegative(),
              end: z.number().int().positive(),
              quote: z.string().min(1).max(1000),
            })
            .strict(),
        )
        .max(10),
    })
    .strict()
    .parse(await body(req));
  return transaction(async () => {
    const c = await context(),
      text = c.saved;
    if (!text) fail(409, "Extract the PDF text first.");
    const version = text.history.at(-1)?.version || 0;
    if (
      input.source !== c.source ||
      input.digest !== text.digest ||
      input.version !== version
    )
      fail(
        409,
        "This PDF verification changed. Reload saved verification before editing.",
      );
    if (!validPassages(text.pages, input.passages))
      fail(
        400,
        "Each passage must match its exact extracted page and character range.",
      );
    if (input.includeInReports && !input.passages.length)
      fail(
        400,
        "Select at least one verified passage before including it in reports.",
      );
    if (text.history.length >= 50)
      fail(409, "PDF verification has reached its revision limit.");
    if (input.includeInReports || text.history.at(-1)?.includeInReports) {
      await clearAttachmentReports(s);
      await dirty((await get<Study>("study", s.id, a.workspaceId))!);
    }
    text.history.push({
      version: version + 1,
      at: now(),
      reviewer: { id: a.id, name: a.name },
      passages: input.passages,
      includeInReports: input.includeInReports,
    });
    await put("participantPDFText", text);
    return respond({ source: c.source, text });
  });
}
