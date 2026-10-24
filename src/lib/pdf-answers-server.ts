import { get } from "./db";
import { fail } from "./http";
import type { Analysis, Study } from "./domain";
import type { PDFEvidence } from "./pdf-evidence";
import {
  includedPDFAnswers,
  validatePDFAnswerEvidence,
  type PDFAnswerEvidence,
} from "./pdf-answers";
export async function verifyPDFAnswers(
  s: Study,
  analysisId: string | undefined,
  entries: PDFAnswerEvidence[] | undefined,
  sources: PDFEvidence[],
) {
  if (!entries?.length) return;
  validatePDFAnswerEvidence(entries, sources);
  const a = analysisId
    ? await get<Analysis>("analysis", analysisId, s.workspaceId)
    : undefined;
  if (
    !a ||
    a.studyId !== s.id ||
    a.dataVersion !== s.dataVersion ||
    JSON.stringify(includedPDFAnswers(a.pdfAnswers, a.pdfEvidence || [])) !==
      JSON.stringify(entries)
  )
    fail(
      409,
      "Saved PDF passage answers changed or were withdrawn. Create a new report.",
    );
}
