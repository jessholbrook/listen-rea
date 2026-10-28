import { get } from "./db";
import { fail } from "./http";
import type { Analysis, Study } from "./domain";
import type { PPTXEvidence } from "./pptx-evidence";
import {
  includedPPTXAnswers,
  validatePPTXAnswerEvidence,
  type PPTXAnswerEvidence,
} from "./pptx-answers";
export async function verifyPPTXAnswers(
  s: Study,
  analysisId: string | undefined,
  entries: PPTXAnswerEvidence[] | undefined,
  sources: PPTXEvidence[],
) {
  if (!entries?.length) return;
  validatePPTXAnswerEvidence(entries, sources);
  const a = analysisId
    ? await get<Analysis>("analysis", analysisId, s.workspaceId)
    : undefined;
  if (
    !a ||
    a.studyId !== s.id ||
    a.dataVersion !== s.dataVersion ||
    JSON.stringify(includedPPTXAnswers(a.pptxAnswers, a.pptxEvidence || [])) !==
      JSON.stringify(entries)
  )
    fail(
      409,
      "Saved PPTX passage answers changed or were withdrawn. Create a new report.",
    );
}
