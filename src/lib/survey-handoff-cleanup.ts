import { get, put, now } from "./db";
import type { Interview } from "./domain";
import type { SurveyHandoff } from "./survey-handoff";
export async function clearResponseHandoff(i: Interview) {
  if (!i.handoffId) return;
  const claim = await get<SurveyHandoff>(
    "surveyHandoff",
    i.handoffId,
    i.workspaceId,
  );
  if (!claim || claim.studyId !== i.studyId || claim.interviewId !== i.id)
    return;
  // Keep a content-free spent-ID hash to prevent a deleted response being admitted again.
  await put("surveyHandoff", {
    ...claim,
    interviewId: undefined,
    responseId: "",
    externalStudyId: undefined,
    secretHash: undefined,
    fingerprint: undefined,
    routes: { complete: "", screened_out: "", withdrawn: "" },
    responseDeletedAt: now(),
  });
}
