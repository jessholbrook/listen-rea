import { get } from "./db";
import { fail } from "./http";
import type { Analysis, Study } from "./domain";
import type { DOCXEvidence } from "./docx-evidence";
import {
  includedDOCXAnswers,
  validateDOCXAnswerEvidence,
  type DOCXAnswerEvidence,
} from "./docx-answers";
export async function verifyDOCXAnswers(
  s: Study,
  analysisId: string | undefined,
  entries: DOCXAnswerEvidence[] | undefined,
  sources: DOCXEvidence[],
) {
  if (!entries?.length) return;
  validateDOCXAnswerEvidence(entries, sources);
  const a = analysisId
    ? await get<Analysis>("analysis", analysisId, s.workspaceId)
    : undefined;
  if (
    !a ||
    a.studyId !== s.id ||
    a.dataVersion !== s.dataVersion ||
    JSON.stringify(includedDOCXAnswers(a.docxAnswers, a.docxEvidence || [])) !==
      JSON.stringify(entries)
  )
    fail(
      409,
      "Saved DOCX passage answers changed or were withdrawn. Create a new report.",
    );
}
