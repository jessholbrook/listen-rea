import { get } from "./db";
import { fail } from "./http";
import type { Analysis, Study } from "./domain";
import type { PDFObservation } from "./pdf-observations";
import {
  includedPDFObservationAnswers,
  validatePDFObservationAnswerEvidence,
  type PDFObservationAnswerEvidence,
} from "./pdf-observation-answers";
export async function verifyPDFObservationAnswers(
  s: Study,
  analysisId: string | undefined,
  entries: PDFObservationAnswerEvidence[] | undefined,
  sources: PDFObservation[],
) {
  if (!entries?.length) return;
  validatePDFObservationAnswerEvidence(entries, sources);
  const a = analysisId
    ? await get<Analysis>("analysis", analysisId, s.workspaceId)
    : undefined;
  if (
    !a ||
    a.studyId !== s.id ||
    a.dataVersion !== s.dataVersion ||
    JSON.stringify(
      includedPDFObservationAnswers(
        a.pdfObservationAnswers,
        a.pdfObservations || [],
      ),
    ) !== JSON.stringify(entries)
  )
    fail(
      409,
      "Saved PDF observation answers changed or were withdrawn. Create a new report.",
    );
}
