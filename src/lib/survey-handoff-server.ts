import { createHmac } from "node:crypto";
import {
  actor,
  body,
  fail,
  participant,
  publicInterview,
  respond,
} from "./http";
import {
  db,
  get,
  put,
  list,
  hash,
  now,
  requireStudy,
  interviews,
  transaction,
} from "./db";
import type { Study, Interview } from "./domain";
import { csv } from "./evidence";
import { retention } from "./features";
import {
  handoffSettingsInput,
  rallySettingsInput,
  forstaSettingsInput,
  type HandoffProvider,
  handoffUrl,
  type HandoffSettings,
  type SurveyHandoff,
  type handoffAdmissionInput,
} from "./survey-handoff";
import type { z } from "zod";
type Admission = z.infer<typeof handoffAdmissionInput>;
export async function handoffSettings(
  s: Study,
  provider: HandoffProvider = "qualtrics",
): Promise<HandoffSettings> {
  const id = provider === "qualtrics" ? s.id : s.id + ":" + provider;
  return (
    (await get<HandoffSettings>("handoffSettings", id, s.workspaceId)) || {
      id,
      ...(provider !== "qualtrics" ? { provider } : {}),
      ...(provider === "rally" ? { externalStudyId: "" } : {}),
      studyId: s.id,
      workspaceId: s.workspaceId,
      version: 0,
      enabled: false,
      routes: { complete: "", screened_out: "", withdrawn: "" },
    }
  );
}
function admissionId(s: Study, input: Admission) {
  return hash(
    JSON.stringify(
      input.provider === "rally"
        ? [
            s.workspaceId,
            s.id,
            "rally",
            input.externalStudyId,
            input.responseId,
          ]
        : input.provider === "forsta"
          ? [s.workspaceId, s.id, "forsta", input.responseId]
          : [s.workspaceId, s.id, input.responseId],
    ),
  );
}
export function handoffToken(s: Study, input: Admission) {
  return createHmac("sha256", Buffer.from(input.secret, "hex"))
    .update(
      JSON.stringify(
        input.provider === "rally"
          ? [
              "rally",
              s.workspaceId,
              s.id,
              input.externalStudyId,
              input.responseId,
            ]
          : [input.provider, s.workspaceId, s.id, input.responseId],
      ),
    )
    .digest("base64url");
}
export function admissionFingerprint(
  attributes: Record<string, string>,
  language?: string,
  invitation?: string,
) {
  return hash(
    JSON.stringify({
      attributes: Object.entries(attributes).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
      language: language || "",
      invitation: invitation ? hash(invitation) : "",
    }),
  );
}
export async function recoverHandoff(
  s: Study,
  input: Admission,
  fingerprint: string,
) {
  const claim = await get<SurveyHandoff>(
    "surveyHandoff",
    admissionId(s, input),
    s.workspaceId,
  );
  if (!claim) return null;
  if (
    claim.responseDeletedAt ||
    claim.secretHash !== hash(input.secret) ||
    claim.fingerprint !== fingerprint ||
    !claim.interviewId
  )
    fail(
      409,
      "This survey response is already linked. Return to the browser where you started, or contact the research team.",
    );
  const i = await get<Interview>("interview", claim.interviewId, s.workspaceId),
    raw = handoffToken(s, input);
  if (
    !i ||
    i.preview ||
    i.studyId !== s.id ||
    i.handoffId !== claim.id ||
    i.tokenHash !== hash(raw)
  )
    fail(
      409,
      "This survey response is no longer available. Contact the research team.",
    );
  return respond({ interview: publicInterview(i, true), token: raw });
}
export async function claimHandoff(
  s: Study,
  i: Interview,
  input: Admission,
  fingerprint: string,
) {
  const settings = await handoffSettings(s, input.provider);
  if (!settings.enabled)
    fail(
      409,
      "This survey connection is unavailable. Contact the research team.",
    );
  if (
    input.provider === "rally" &&
    settings.externalStudyId !== input.externalStudyId
  )
    fail(
      400,
      "This Rally link does not match the configured studyID. Contact the research team.",
    );
  if (
    Number(
      (
        await db
          .prepare(
            "SELECT COUNT(*) AS n FROM documents WHERE kind='surveyHandoff' AND workspace_id=? AND study_id=?",
          )
          .get(s.workspaceId, s.id)
      )?.n,
    ) >= 1000
  )
    fail(409, "This study has reached its 1,000 survey handoff record limit.");
  const id = admissionId(s, input);
  if (await get("surveyHandoff", id, s.workspaceId))
    fail(
      409,
      "This survey response is already linked. Return to the browser where you started, or contact the research team.",
    );
  i.handoffId = id;
  await put("surveyHandoff", {
    id,
    workspaceId: s.workspaceId,
    studyId: s.id,
    interviewId: i.id,
    responseId: input.responseId,
    ...(input.provider === "rally"
      ? { provider: "rally" as const, externalStudyId: input.externalStudyId }
      : {}),
    ...(input.provider === "forsta" ? { provider: "forsta" as const } : {}),
    secretHash: hash(input.secret),
    fingerprint,
    configVersion: settings.version,
    routes: settings.routes,
    createdAt: now(),
  } satisfies SurveyHandoff);
}
export async function dispatchSurveyHandoff(req: Request, p: string[]) {
  if (
    p[0] === "interviews" &&
    p[1] &&
    p[2] === "survey-handoff" &&
    p.length === 3
  ) {
    if (req.method !== "GET")
      fail(405, "Read the survey destination with GET.");
    await retention();
    const i = await participant(req, p[1]);
    if (i.preview || !i.handoffId || i.status === "active")
      return respond({ destination: null });
    const s = await get<Study>("study", i.studyId, i.workspaceId);
    if (!s) return respond({ destination: null });
    const claim = await get<SurveyHandoff>(
      "surveyHandoff",
      i.handoffId,
      i.workspaceId,
    );
    if (!claim || claim.studyId !== s.id || claim.interviewId !== i.id)
      return respond({ destination: null });
    if (!(await handoffSettings(s, claim.provider || "qualtrics")).enabled)
      return respond({ destination: null });
    return respond({ destination: handoffUrl(claim, i.status) });
  }
  if (
    p[0] !== "studies" ||
    !p[1] ||
    !["survey-handoff", "rally-handoff", "forsta-handoff"].includes(p[2])
  )
    return null;
  const provider: HandoffProvider =
    p[2] === "rally-handoff"
      ? "rally"
      : p[2] === "forsta-handoff"
        ? "forsta"
        : "qualtrics";
  const a = await actor(),
    s = await requireStudy(p[1], a),
    canManage = a.role === "admin";
  await retention();
  if (req.method === "PUT" && p.length === 3) {
    if (!canManage)
      fail(403, "Only workspace admins can configure survey handoffs.");
    const input =
      provider === "rally"
        ? rallySettingsInput.parse(await body(req))
        : provider === "forsta"
          ? forstaSettingsInput.parse(await body(req))
          : handoffSettingsInput.parse(await body(req));
    await transaction(async () => {
      const current = await handoffSettings(s, provider);
      if (current.version !== input.version)
        fail(409, "The survey connection changed. Refresh before saving.");
      await put("handoffSettings", {
        ...current,
        enabled: input.enabled,
        routes: input.routes,
        ...(provider === "rally"
          ? {
              provider,
              externalStudyId:
                "externalStudyId" in input ? String(input.externalStudyId) : "",
            }
          : {}),
        version: current.version + 1,
        updatedAt: now(),
        updatedBy: a.id,
      });
    });
    return respond({ settings: await handoffSettings(s, provider) });
  }
  if (
    req.method === "GET" &&
    (p.length === 3 || (p.length === 4 && p[3] === "export"))
  ) {
    const claims = await list<SurveyHandoff>(
        "surveyHandoff",
        a.workspaceId,
        s.id,
      ),
      sources = await interviews(s);
    const rows = claims
      .filter((c) => (c.provider || "qualtrics") === provider)
      .map((c) => {
        const i = sources.find(
          (i) => i.id === c.interviewId && !i.preview && !i.origin,
        );
        return {
          responseId: c.responseDeletedAt || !i ? "" : c.responseId,
          ...(provider === "rally"
            ? {
                externalStudyId:
                  c.responseDeletedAt || !i ? "" : c.externalStudyId || "",
              }
            : {}),
          interviewId: i?.id || null,
          status: c.responseDeletedAt || !i ? "response_deleted" : i.status,
          excluded: i?.excluded || false,
          revisionId: i?.revisionId || null,
          language: i?.language || null,
          configVersion: c.configVersion,
          createdAt: c.createdAt,
          completedAt: i?.completedAt || null,
        };
      });
    if (p[3] === "export")
      return new Response(
        csv([
          [
            ...(provider === "rally"
              ? ["pid", "studyID"]
              : [provider === "forsta" ? "rid" : "ResponseID"]),
            "interview_id",
            "status",
            "excluded",
            "revision_id",
            "language",
            "config_version",
            "created_at",
            "completed_at",
          ],
          ...rows.map((r) => [
            r.responseId,
            ...(provider === "rally" ? [r.externalStudyId || ""] : []),
            r.interviewId || "",
            r.status,
            String(r.excluded),
            r.revisionId || "",
            r.language || "",
            String(r.configVersion),
            r.createdAt,
            r.completedAt || "",
          ]),
        ]),
        {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition":
              'attachment; filename="' + provider + '-handoffs.csv"',
            "Cache-Control": "private, no-store",
          },
        },
      );
    return respond({
      settings: await handoffSettings(s, provider),
      rows,
      canManage,
      recruitmentMode:
        (
          await get<{ mode: string }>(
            "recruitmentSettings",
            s.id,
            a.workspaceId,
          )
        )?.mode || "open",
    });
  }
  fail(405, "Unsupported survey handoff action.");
}
