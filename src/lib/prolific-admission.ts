import { get, hash } from "./db";
import { fail } from "./http";
import type { Study } from "./domain";
import type { ProlificConfig } from "./prolific";
import type { HandoffSettings } from "./survey-handoff";
export function prolificClaimId(
  workspaceId: string,
  studyId: string,
  externalStudyId: string,
  participantId: string,
) {
  return hash(
    JSON.stringify([
      workspaceId,
      studyId,
      "prolific",
      externalStudyId,
      participantId,
    ]),
  );
}
export async function prolificSettings(s: Study): Promise<HandoffSettings> {
  const c = await get<ProlificConfig>("prolificConfig", s.id, s.workspaceId);
  return {
    id: s.id + ":prolific",
    workspaceId: s.workspaceId,
    studyId: s.id,
    provider: "prolific",
    version: c?.version || 0,
    externalStudyId: c?.activeId || "",
    enabled: !!(
      c?.admissionsEnabled &&
      c.activeId &&
      c.revisionId === s.revisionId &&
      c.providerStatus === "ACTIVE" &&
      c.checkedAt &&
      Date.parse(c.checkedAt) > Date.now() - 86400000
    ),
    routes: {
      complete: c
        ? "https://app.prolific.com/submissions/complete?cc=" +
          encodeURIComponent(c.code)
        : "",
      screened_out: "https://app.prolific.com/",
      withdrawn: "https://app.prolific.com/",
    },
  };
}
export async function validateProlificAdmission(
  s: Study,
  externalStudyId?: string,
) {
  const settings = await prolificSettings(s);
  if (!settings.enabled || settings.externalStudyId !== externalStudyId)
    fail(
      409,
      "This Prolific study is paused, changed or awaiting reconciliation. Contact the research team.",
    );
}
// Keep the reviewed cohort's unused slots available when other recruitment paths share a study.
export async function enforceProlificReservation(s: Study, provider?: string) {
  if (provider === "prolific") return;
  const settings = await prolificSettings(s);
  if (!settings.enabled) return;
  const { list } = await import("./db");
  const cfg = (await get<ProlificConfig>(
    "prolificConfig",
    s.id,
    s.workspaceId,
  ))!;
  const sources = (
    await list<import("./domain").Interview>("interview", s.workspaceId, s.id)
  ).filter(
    (i) => !i.preview && !i.origin && ["active", "complete"].includes(i.status),
  );
  const claims = await list<import("./survey-handoff").SurveyHandoff>(
    "surveyHandoff",
    s.workspaceId,
    s.id,
  );
  const providerPlacesUsed = sources.filter((i) =>
    claims.some(
      (c) =>
        c.id === i.handoffId &&
        c.provider === "prolific" &&
        c.externalStudyId === cfg.activeId,
    ),
  ).length;
  const revision = await get<import("./domain").Revision>(
    "revision",
    cfg.revisionId,
    s.workspaceId,
  );
  if (
    revision &&
    sources.length + Math.max(0, cfg.input.places - providerPlacesUsed) >=
      revision.guide.limit
  )
    fail(
      409,
      "Remaining places are reserved for the reviewed Prolific allocation. Contact the research team.",
    );
}
