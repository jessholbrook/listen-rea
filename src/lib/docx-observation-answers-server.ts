import { get } from "./db";
import { fail } from "./http";
import type { Analysis, Study } from "./domain";
import type { DOCXObservation } from "./docx-observations";
import {
  includedDOCXObservationAnswers,
  validateDOCXObservationAnswerEvidence,
  type DOCXObservationAnswerEvidence,
} from "./docx-observation-answers";
export async function verifyDOCXObservationAnswers(
  s: Study,
  analysisId: string | undefined,
  entries: DOCXObservationAnswerEvidence[] | undefined,
  sources: DOCXObservation[],
) {
  if (!entries?.length) return;
  validateDOCXObservationAnswerEvidence(entries, sources);
  const a = analysisId
    ? await get<Analysis>("analysis", analysisId, s.workspaceId)
    : undefined;
  if (
    !a ||
    a.studyId !== s.id ||
    a.dataVersion !== s.dataVersion ||
    JSON.stringify(
      includedDOCXObservationAnswers(
        a.docxObservationAnswers,
        a.docxObservations || [],
      ),
    ) !== JSON.stringify(entries)
  )
    fail(
      409,
      "Saved DOCX observation answers changed or were withdrawn. Create a new report.",
    );
}
