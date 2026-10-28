import { get } from "./db";
import { fail } from "./http";
import type { Analysis, Study } from "./domain";
import type { PPTXObservation } from "./pptx-observations";
import {
  includedPPTXObservationAnswers,
  validatePPTXObservationAnswerEvidence,
  type PPTXObservationAnswerEvidence,
} from "./pptx-observation-answers";
export async function verifyPPTXObservationAnswers(
  s: Study,
  analysisId: string | undefined,
  entries: PPTXObservationAnswerEvidence[] | undefined,
  sources: PPTXObservation[],
) {
  if (!entries?.length) return;
  validatePPTXObservationAnswerEvidence(entries, sources);
  const a = analysisId
    ? await get<Analysis>("analysis", analysisId, s.workspaceId)
    : undefined;
  if (
    !a ||
    a.studyId !== s.id ||
    a.dataVersion !== s.dataVersion ||
    JSON.stringify(
      includedPPTXObservationAnswers(
        a.pptxObservationAnswers,
        a.pptxObservations || [],
      ),
    ) !== JSON.stringify(entries)
  )
    fail(
      409,
      "Saved PPTX observation answers changed or were withdrawn. Create a new report.",
    );
}
