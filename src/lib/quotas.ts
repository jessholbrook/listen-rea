import { z } from "zod";
import type { Interview, Guide } from "./domain";
const reserved = new Set([
  "responseid",
  "rid",
  "pid",
  "studyid",
  "handoff",
  "preview",
  "token",
  "invitationtoken",
  "invite",
  "secret",
  "authorization",
  "access_token",
  "api_key",
  "x-vercel-protection-bypass",
]);
const conditionInput = z
  .object({
    key: z.string().trim().min(1).max(100),
    value: z.string().trim().min(1).max(128),
  })
  .strict();
export const quotaRuleInput = z
  .object({
    source: z.enum(["tags", "screener"]).optional(),
    kind: z.enum(["maximum", "minimum", "exact"]).optional(),
    unit: z.enum(["count", "percent"]).optional(),
    id: z.uuid(),
    label: z.string().trim().min(1).max(100),
    enabled: z.boolean(),
    conditions: z
      .array(conditionInput)
      .min(1)
      .max(4)
      .refine(
        (v) => new Set(v.map((c) => c.key)).size === v.length,
        "Use each tag once per group.",
      ),
    limit: z.number().gt(0).max(1000),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.unit === "percent") {
      if (
        rule.limit > 100 ||
        Math.abs(rule.limit * 100 - Math.round(rule.limit * 100)) > 1e-7
      )
        ctx.addIssue({
          code: "custom",
          path: ["limit"],
          message:
            "Use a percentage above 0 and at most 100, with at most two decimal places.",
        });
    } else if (!Number.isInteger(rule.limit))
      ctx.addIssue({
        code: "custom",
        path: ["limit"],
        message: "Participant counts must be whole numbers.",
      });
    if (rule.source !== "screener")
      rule.conditions.forEach((c, index) => {
        if (
          !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(c.key) ||
          reserved.has(c.key.toLowerCase())
        )
          ctx.addIssue({
            code: "custom",
            path: ["conditions", index, "key"],
            message:
              "Choose a participant tag, not an invitation, handoff or credential field.",
          });
      });
  });

export const quotaSettingsInput = z
  .object({
    version: z.number().int().min(0),
    enabled: z.boolean(),
    requireMatch: z.boolean(),
    rules: z.array(quotaRuleInput).max(20),
  })
  .strict()
  .refine(
    (v) => new Set(v.rules.map((r) => r.id)).size === v.rules.length,
    "Group IDs must be unique.",
  )
  .refine(
    (v) => !v.enabled || v.rules.some((r) => r.enabled),
    "Enable at least one group before enabling quotas.",
  );
export type QuotaRule = z.infer<typeof quotaRuleInput>;
export type QuotaSettings = z.infer<typeof quotaSettingsInput> & {
  id: string;
  workspaceId: string;
  studyId: string;
  updatedAt?: string;
  updatedBy?: string;
};
export function matchingQuotaIds(
  rules: QuotaRule[],
  attributes: Record<string, string>,
) {
  return rules
    .filter(
      (r) =>
        r.enabled &&
        r.source !== "screener" &&
        r.conditions.every(
          (c) =>
            Object.hasOwn(attributes, c.key) && attributes[c.key] === c.value,
        ),
    )
    .map((r) => r.id);
}
export function quotaProgress(
  rules: QuotaRule[],
  sources: Interview[],
  totalLimit = 1000,
) {
  return rules.map((r) => {
    const candidates = sources.filter(
      (i) =>
        !i.preview &&
        !i.origin &&
        i.screenerQuota?.rules.some((v) => v.id === r.id),
    );
    const assigned = sources.filter(
      (i) => !i.preview && !i.origin && i.quotaRuleIds?.includes(r.id),
    );
    const active = assigned.filter((i) => i.status === "active").length;
    const complete = assigned.filter((i) => i.status === "complete").length;
    const reserved = active + complete;
    const resolution = quotaResolution(r, totalLimit);
    const bounds = quotaBounds(r, totalLimit);
    return {
      id: r.id,
      active,
      complete,
      reserved,
      resolvedCount: resolution.count,
      resolutionError: resolution.error || null,
      remaining: Math.max(0, (resolution.count ?? 0) - reserved),
      full:
        resolution.valid &&
        bounds.maximum !== null &&
        reserved >= bounds.maximum,
      needed: Math.max(0, bounds.minimum - reserved),
      completeNeeded: Math.max(0, bounds.minimum - complete),
      targetMet: resolution.valid && complete >= bounds.minimum,
      linked: new Set([...assigned, ...candidates].map((i) => i.id)).size,
      screening: candidates.filter(
        (i) => i.status === "active" && i.screenerQuota?.state === "pending",
      ).length,
      rejected: candidates.filter(
        (i) =>
          i.screenOutReason === "quota_full" &&
          i.screenerQuota?.failedIds?.includes(r.id),
      ).length,
      protected: candidates.filter(
        (i) =>
          i.screenOutReason === "quota_minimum" &&
          i.screenerQuota?.failedIds?.includes(r.id),
      ).length,
    };
  });
}
export function quotaDecision(
  settings: QuotaSettings,
  sources: Interview[],
  attributes: Record<string, string>,
  totalLimit = 1000,
) {
  if (!settings.enabled) return { allowed: true, ids: [] as string[] };
  if (
    settings.rules.some(
      (r) => r.enabled && !quotaResolution(r, totalLimit).valid,
    )
  )
    return { allowed: false, ids: [] as string[] };
  const ids = matchingQuotaIds(settings.rules, attributes),
    progress = quotaProgress(settings.rules, sources, totalLimit);
  const allowed =
    (!settings.requireMatch ||
      ids.length > 0 ||
      settings.rules.some((r) => r.enabled && r.source === "screener")) &&
    !progress.some((p) => ids.includes(p.id) && p.full) &&
    (settings.rules.some((r) => r.enabled && r.source === "screener") ||
      minimumProtection(settings, sources, ids, totalLimit).allowed);
  return { allowed, ids };
}
// Conditions become immutable once an interview has been assigned. Edits cannot
// silently reclassify prior participants or reset a used group's capacity.
export function sameQuotaConditions(a: QuotaRule, b: QuotaRule) {
  const normalize = (r: QuotaRule) =>
    JSON.stringify([
      r.source || "tags",
      [...r.conditions].sort((a, b) => a.key.localeCompare(b.key)),
    ]);
  return normalize(a) === normalize(b);
}

export type ScreenerQuotaPlan = {
  rules: QuotaRule[];
  endIndex: number;
  requireMatch: boolean;
  state: "pending" | "passed" | "bypassed" | "ineligible" | "rejected";
  failedIds?: string[];
};
export function quotaScreeners(guide: Guide) {
  const prefix = [];
  for (const q of guide.questions) {
    if (
      !["choice", "multiple"].includes(q.type) ||
      q.condition ||
      q.carryForward ||
      q.conceptId ||
      q.conceptQuestion ||
      q.task ||
      guide.sections?.find((s) => s.name === q.section)?.condition
    )
      break;
    prefix.push({
      id: q.id,
      text: q.text,
      options: q.options
        .filter((o) => !o.rejects)
        .map((o) => ({ id: o.id, text: o.text })),
    });
  }
  return prefix;
}
export function screeningPlan(
  settings: QuotaSettings,
  guide: Guide,
): ScreenerQuotaPlan | undefined {
  if (!settings.enabled) return;
  const rules = settings.rules.filter(
    (r) => r.enabled && r.source === "screener",
  );
  if (!rules.length) return;
  const prefix = quotaScreeners(guide);
  let endIndex = -1;
  for (const rule of rules)
    for (const c of rule.conditions) {
      const index = prefix.findIndex((q) => q.id === c.key);
      if (index < 0 || !prefix[index].options.some((o) => o.id === c.value))
        throw new Error(
          "Choose eligible options from the published guide’s leading choice questions for screener quotas.",
        );
      endIndex = Math.max(endIndex, index);
    }
  return {
    rules: structuredClone(rules),
    endIndex,
    requireMatch: settings.requireMatch,
    state: "pending",
  };
}
export function matchingScreenerQuotaIds(
  plan: ScreenerQuotaPlan,
  i: Interview,
) {
  return plan.rules
    .filter((r) =>
      r.conditions.every((c) => {
        const turn = i.turns.find((t) => t.questionId === c.key && !t.followUp);
        return (
          !!turn &&
          (turn.optionId === c.value ||
            (Array.isArray(turn.value) && turn.value.includes(c.value)))
        );
      }),
    )
    .map((r) => r.id);
}

export function quotaResolution(rule: QuotaRule, totalLimit: number) {
  if (rule.unit !== "percent")
    return { count: rule.limit, valid: true, error: null as string | null };
  const basisPoints = Math.round(rule.limit * 100);
  if (
    rule.limit <= 0 ||
    rule.limit > 100 ||
    Math.abs(rule.limit * 100 - basisPoints) > 1e-7
  )
    return {
      count: null,
      valid: false,
      error:
        "Use a percentage above 0 and at most 100, with at most two decimal places.",
    };
  const product = basisPoints * totalLimit;
  if (rule.kind === "exact" && product % 10000 !== 0)
    return {
      count: null,
      valid: false,
      error:
        "This exact percentage does not produce a whole participant count at the published study limit. Change the percentage, use a count, or publish a compatible limit.",
    };
  const count =
    rule.kind === "minimum"
      ? Math.ceil(product / 10000)
      : Math.floor(product / 10000);
  return { count, valid: true, error: null as string | null };
}
export function quotaBounds(rule: QuotaRule, totalLimit = 1000) {
  const count = quotaResolution(rule, totalLimit).count ?? 0;
  return {
    minimum: rule.kind === "minimum" || rule.kind === "exact" ? count : 0,
    maximum: rule.kind === "minimum" ? null : count,
  };
}
export function targetRules(settings: QuotaSettings) {
  return settings.enabled
    ? settings.rules.filter(
        (r) => r.enabled && (r.kind === "minimum" || r.kind === "exact"),
      )
    : [];
}
export function quotaTargetCapacity(
  settings: QuotaSettings,
  sources: Interview[],
  totalLimit: number,
) {
  const targets = targetRules(settings),
    screening = targets[0]?.source === "screener";
  const settled = sources.filter(
    (i) =>
      !i.preview &&
      !i.origin &&
      (i.status === "active" || i.status === "complete") &&
      !(screening && i.screenerQuota?.state === "pending"),
  );
  const deficits = targets.map((r) => ({
    id: r.id,
    needed: Math.max(
      0,
      quotaBounds(r, totalLimit).minimum -
        settled.filter((i) => i.quotaRuleIds?.includes(r.id)).length,
    ),
  }));
  const needed = deficits.reduce((n, d) => n + d.needed, 0),
    remaining = Math.max(0, totalLimit - settled.length);
  return {
    settled: settled.length,
    remaining,
    needed,
    feasible:
      !settings.rules.some(
        (r) =>
          settings.enabled &&
          r.enabled &&
          !quotaResolution(r, totalLimit).valid,
      ) && needed <= remaining,
    deficits,
  };
}
// For a disjoint partition, the sum of remaining deficits is the exact number
// of places that must remain available. Pending screeners are not yet classified.
export function minimumProtection(
  settings: QuotaSettings,
  sources: Interview[],
  ids: string[],
  totalLimit: number,
  candidateId?: string,
) {
  const targets = targetRules(settings);
  if (
    settings.rules.some(
      (r) =>
        settings.enabled && r.enabled && !quotaResolution(r, totalLimit).valid,
    )
  )
    return { allowed: false, protectedIds: targets.map((r) => r.id) };
  if (!targets.length) return { allowed: true, protectedIds: [] as string[] };
  const capacity = quotaTargetCapacity(
    settings,
    sources.filter((i) => i.id !== candidateId),
    totalLimit,
  );
  const deficits = capacity.deficits.map((d) => ({
    id: d.id,
    needed: Math.max(0, d.needed - (ids.includes(d.id) ? 1 : 0)),
  }));
  const needed = deficits.reduce((n, d) => n + d.needed, 0),
    remaining = Math.max(0, totalLimit - capacity.settled - 1);
  return {
    allowed: needed <= remaining,
    protectedIds: deficits.filter((d) => d.needed > 0).map((d) => d.id),
  };
}
export function validateQuotaTargets(
  settings: QuotaSettings,
  guide: Guide,
  sources: Interview[],
) {
  const targets = targetRules(settings);
  if (!targets.length) {
    validateQuotaAmounts(settings, guide.limit, sources);
    return;
  }
  const rules = settings.rules.filter((r) => r.enabled),
    first = rules[0];
  if (
    rules.some(
      (r) =>
        r.conditions.length !== 1 ||
        (r.source || "tags") !== (first.source || "tags") ||
        r.conditions[0].key !== first.conditions[0].key,
    ) ||
    new Set(rules.map((r) => r.conditions[0].value)).size !== rules.length
  )
    throw new Error(
      "Minimum and exact targets require distinct groups from one tag or one single-choice screening question. Disable overlapping or mixed groups first.",
    );
  if (
    first.source === "screener" &&
    guide.questions.find((q) => q.id === first.conditions[0].key)?.type !==
      "choice"
  )
    throw new Error(
      "Minimum and exact screening targets require a single-choice question, not multiple selection.",
    );
  validateQuotaAmounts(settings, guide.limit, sources);
}

export function validateQuotaAmounts(
  settings: QuotaSettings,
  totalLimit: number,
  sources: Interview[],
) {
  if (!settings.enabled) return;
  for (const r of settings.rules.filter((r) => r.enabled)) {
    const resolution = quotaResolution(r, totalLimit);
    if (!resolution.valid) throw new Error(resolution.error!);
  }
  const targets = targetRules(settings);
  if (!targets.length) return;
  if (
    targets.reduce((n, r) => n + quotaBounds(r, totalLimit).minimum, 0) >
    totalLimit
  )
    throw new Error(
      "The minimum and exact targets exceed the published study limit.",
    );
  const progress = quotaProgress(settings.rules, sources, totalLimit);
  if (
    settings.rules.some(
      (r) =>
        r.enabled &&
        r.kind === "exact" &&
        progress.find((p) => p.id === r.id)!.reserved >
          (quotaResolution(r, totalLimit).count ?? 0),
    )
  )
    throw new Error(
      "An exact target cannot be lower than its already reserved participant count.",
    );
  if (!quotaTargetCapacity(settings, sources, totalLimit).feasible)
    throw new Error(
      "There are not enough remaining study places to meet these targets. Increase the published study limit or lower the targets.",
    );
}
