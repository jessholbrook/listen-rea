import { createHash } from "node:crypto";
import { z } from "zod";
import { generate, aiReady, model } from "./ai";
import { readRecording } from "./storage";
import { extractPDFText } from "./pdf-text-extraction";
import { limit } from "./http";
import { now } from "./db";
import { languageNames, responseLanguage } from "./localization";
import {
  pdfAIPermissionVersion,
  pdfProbePromptVersion,
  pdfProbeSystem,
  pdfProbeOutput,
  pdfProbePages,
  usablePDFProbe,
} from "./participant-pdf-ai";
import type { Interview } from "./domain";
import type { PDFProbe } from "./participant-pdfs";
export async function participantPDFProbe(
  i: Interview,
  answer: string,
  deps = { generate, readRecording, extractPDFText, aiReady, model },
): Promise<PDFProbe | null> {
  const pdf = i.participantPDFDraft?.pdf,
    q = i.guide.questions[i.current];
  if (
    !pdf ||
    i.participantPDFDraft?.version !== i.version ||
    pdf.aiPermission?.provider !== "OpenAI" ||
    pdf.aiPermission.version !== pdfAIPermissionVersion ||
    !q?.participantPDFAI ||
    i.status !== "active"
  )
    return null;
  const provenance: Omit<PDFProbe, "status"> = {
    pdfId: pdf.id,
    permissionVersion: pdf.aiPermission.version,
    promptVersion: pdfProbePromptVersion,
    model: deps.model(),
    generatedAt: now(),
  };
  if (!deps.aiReady()) return { ...provenance, status: "unavailable" };
  try {
    limit("pdf-probe:" + i.id, 20);
    const deadline = AbortSignal.timeout(50000),
      bytes = await deps.readRecording(pdf.id);
    provenance.pdfSha256 = createHash("sha256").update(bytes).digest("hex");
    const extracted = await deps.extractPDFText(bytes),
      pages = pdfProbePages(extracted);
    provenance.contextTruncated = extracted.some((t) => t.length > 1000);
    provenance.pagesConsidered = pages.map((p) => p.page);
    if (!pages.length) return { ...provenance, status: "none" };
    const result = await deps.generate(
      pdfProbeSystem,
      {
        interviewLanguage: languageNames[responseLanguage(i)],
        goal: i.guide.goal,
        question: q.text,
        instructions: q.instructions,
        answer,
        pdfDescription: pdf.description,
        pages,
      },
      i.workspaceId,
      i.studyId,
      "pdf-probe",
      z.toJSONSchema(pdfProbeOutput),
      { maxTokens: 600, signal: deadline },
    );
    const parsed = usablePDFProbe(result, pages);
    if (!parsed) return { ...provenance, status: "rejected" };
    if (!parsed.probe) return { ...provenance, status: "none" };
    return { ...provenance, ...parsed, status: "asked" };
  } catch {
    return { ...provenance, status: "unavailable" };
  }
}
