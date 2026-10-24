import { actor, canLaunch, body, respond, fail } from "./http";
import { get, put, interviews, requireStudy, transaction, now } from "./db";
import { retention } from "./features";
import type { Study, Guide, Interview, Revision } from "./domain";
import {
  validateQuotaAmounts,
  validateQuotaTargets,
  minimumProtection,
  quotaTargetCapacity,
  targetRules,
  quotaScreeners,
  screeningPlan,
  matchingScreenerQuotaIds,
  quotaSettingsInput,
  quotaProgress,
  quotaDecision,
  sameQuotaConditions,
  type QuotaSettings,
} from "./quotas";
export async function quotaSettings(s: Study): Promise<QuotaSettings> {
  return (
    (await get<QuotaSettings>("quotaSettings", s.id, s.workspaceId)) || {
      id: s.id,
      studyId: s.id,
      workspaceId: s.workspaceId,
      version: 0,
      enabled: false,
      requireMatch: true,
      rules: [],
    }
  );
}
// Call within the same admission transaction as the source and invitation claim.
export async function reserveQuotaIds(
  s: Study,
  attributes: Record<string, string>,
  guide: Guide,
) {
  const settings = await quotaSettings(s);
  if (!settings.enabled) return { ids: [] as string[], version: undefined };
  const sources = await interviews(s);
  try {
    validateQuotaTargets(settings, guide, sources);
  } catch {
    fail(
      409,
      "The study’s quota targets need review. Contact the research team.",
    );
  }
  const result = quotaDecision(settings, sources, attributes, guide.limit);
  if (!result.allowed)
    fail(
      409,
      "This study has no available place for your participant group. Contact the research team.",
    );
  let plan;
  try {
    plan = screeningPlan(settings, guide);
  } catch {
    fail(
      409,
      "The study’s quota screeners need review. Contact the research team.",
    );
  }
  return { ids: result.ids, version: settings.version, plan };
}
// Called in the answer commit transaction, after advancing past the frozen boundary.
export async function finishScreenerQuotas(i: Interview) {
  const plan = i.screenerQuota;
  if (i.preview || !plan || plan.state !== "pending") return;
  if (i.status === "screened_out") {
    plan.state = "ineligible";
    return;
  }
  if (i.status === "active" && i.current <= plan.endIndex) return;
  const s = await get<Study>("study", i.studyId, i.workspaceId);
  if (!s) fail(404, "Study not found.");
  const settings = await quotaSettings(s);
  if (!settings.enabled) {
    plan.state = "bypassed";
    return;
  }
  const matches = matchingScreenerQuotaIds(plan, i);
  const enabled = matches.filter((id) =>
    settings.rules.some((r) => r.id === id && r.enabled),
  );
  const sources = await interviews(s);
  const revision = await get<Revision>(
    "revision",
    s.revisionId!,
    s.workspaceId,
  );
  const totalLimit = revision?.guide.limit ?? i.guide.limit;
  if (settings.rules.some((r) => r.enabled && r.unit === "percent")) {
    try {
      validateQuotaAmounts(settings, totalLimit, sources);
    } catch {
      fail(
        409,
        "The study’s quota targets need review. Contact the research team.",
      );
    }
  }
  const progress = quotaProgress(settings.rules, sources, totalLimit);
  const full = enabled.filter((id) => progress.find((p) => p.id === id)?.full);
  if (
    full.length ||
    (plan.requireMatch && !matches.length && !i.quotaRuleIds?.length)
  ) {
    plan.state = "rejected";
    plan.failedIds = full;
    i.status = "screened_out";
    i.screenOutReason = full.length ? "quota_full" : "quota_no_match";
    i.completedAt = now();
    return;
  }
  const ids = [...new Set([...(i.quotaRuleIds || []), ...enabled])];
  const protection = minimumProtection(
    settings,
    sources,
    ids,
    totalLimit,
    i.id,
  );
  if (!protection.allowed) {
    plan.state = "rejected";
    plan.failedIds = protection.protectedIds;
    i.status = "screened_out";
    i.screenOutReason = "quota_minimum";
    i.completedAt = now();
    return;
  }
  i.quotaRuleIds = ids;
  plan.state = "passed";
}
export async function dispatchQuotas(req: Request, p: string[]) {
  if (p[0] !== "studies" || !p[1] || p[2] !== "quotas" || p.length !== 3)
    return null;
  const a = await actor(),
    s = await requireStudy(p[1], a);
  await retention();
  if (req.method === "PUT") {
    canLaunch(a);
    const input = quotaSettingsInput.parse(await body(req));
    await transaction(async () => {
      const current = await quotaSettings(s);
      if (current.version !== input.version)
        fail(409, "Quotas changed. Refresh before saving.");
      const currentStudy = await requireStudy(s.id, a);
      const revision = currentStudy.revisionId
        ? await get<Revision>(
            "revision",
            currentStudy.revisionId,
            s.workspaceId,
          )
        : undefined;
      if (
        input.enabled &&
        input.rules.some((r) => r.enabled && r.source === "screener")
      ) {
        if (!revision)
          fail(
            400,
            "Publish the screening questions before configuring screener quotas.",
          );
        try {
          screeningPlan({ ...current, ...input }, revision.guide);
        } catch (e) {
          fail(400, (e as Error).message);
        }
      }
      const sources = await interviews(s);
      if (
        input.enabled &&
        (targetRules({ ...current, ...input }).length ||
          input.rules.some((r) => r.enabled && r.unit === "percent"))
      ) {
        if (!revision)
          fail(
            400,
            "Publish a guide before enabling percentage, minimum or exact quota targets.",
          );
        try {
          validateQuotaTargets(
            { ...current, ...input },
            revision.guide,
            sources,
          );
        } catch (e) {
          fail(400, (e as Error).message);
        }
      }
      const progress = quotaProgress(
        current.rules,
        sources,
        revision?.guide.limit ?? currentStudy.draft.limit,
      );
      for (const old of current.rules) {
        const next = input.rules.find((r) => r.id === old.id);
        if (
          progress.find((p) => p.id === old.id)!.linked &&
          (!next || !sameQuotaConditions(old, next))
        )
          fail(
            409,
            "A used group's matching tags cannot change or be removed. Disable that group and add a new one.",
          );
      }
      await put("quotaSettings", {
        ...current,
        ...input,
        version: current.version + 1,
        updatedAt: now(),
        updatedBy: a.id,
      });
    });
  } else if (req.method !== "GET") fail(405, "Use GET or PUT for quotas.");
  return await transaction(async () => {
    const currentStudy = await requireStudy(s.id, a),
      settings = await quotaSettings(currentStudy),
      sources = await interviews(currentStudy);
    const revision = currentStudy.revisionId
      ? await get<Revision>(
          "revision",
          currentStudy.revisionId,
          currentStudy.workspaceId,
        )
      : undefined;
    const totalLimit = revision?.guide.limit ?? currentStudy.draft.limit;
    let configurationError: string | null = null;
    try {
      validateQuotaTargets(
        settings,
        revision?.guide || currentStudy.draft,
        sources,
      );
    } catch (e) {
      configurationError = (e as Error).message;
    }
    const capacity = quotaTargetCapacity(settings, sources, totalLimit);
    return respond({
      settings,
      totalLimit,
      basisRevisionId: currentStudy.revisionId || null,
      configurationError,
      targetCapacity: {
        ...capacity,
        feasible: !configurationError && capacity.feasible,
      },
      progress: quotaProgress(settings.rules, sources, totalLimit),
      canManage: a.role !== "collaborator",
      screeners: revision ? quotaScreeners(revision.guide) : [],
      screening: sources.filter(
        (i) =>
          !i.preview &&
          !i.origin &&
          i.status === "active" &&
          i.screenerQuota?.state === "pending",
      ).length,
      quotaScreenOuts: sources.filter(
        (i) => !i.preview && !i.origin && i.screenerQuota?.state === "rejected",
      ).length,
    });
  });
}
