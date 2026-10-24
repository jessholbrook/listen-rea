import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emotionInterview } from "./emotion-fixture";
import { screenerGuide, screenerRule } from "./screener-quota-fixture";
import {
  quotaDecision,
  quotaProgress,
  minimumProtection,
  validateQuotaTargets,
  quotaTargetCapacity,
  type QuotaRule,
  type QuotaSettings,
} from "../src/lib/quotas";
const rule = (
  value: string,
  kind: QuotaRule["kind"],
  limit: number,
): QuotaRule => ({
  id: randomUUID(),
  label: value,
  enabled: true,
  kind,
  limit,
  conditions: [{ key: "segment", value }],
});
const settings = (rules: QuotaRule[]): QuotaSettings => ({
  id: "s",
  workspaceId: "w",
  studyId: "s",
  version: 1,
  enabled: true,
  requireMatch: false,
  rules,
});
const source = (ids: string[]) => ({
  ...emotionInterview(),
  quotaRuleIds: ids,
});
test("Minimum/exact decisions agree with exhaustive completion feasibility for every reachable small partition", () => {
  for (let total = 2; total <= 5; total++)
    for (let min = 1; min < total; min++) {
      const a = rule("A", "minimum", min),
        b = rule("B", "exact", 1),
        c = rule("C", "maximum", 1),
        s = settings([a, b, c]),
        groups = [a, b, c];
      // Independent oracle enumerates all ways to fill the remaining places.
      const feasible = (counts: number[]) => {
        const left = total - counts.reduce((n, v) => n + v, 0);
        if (left < 0) return false;
        for (let x = 0; x <= left; x++)
          for (let y = 0; y <= left - x; y++)
            for (let z = 0; z <= left - x - y; z++) {
              if (
                counts[0] + x >= min &&
                counts[1] + y === 1 &&
                counts[2] + z <= 1
              )
                return true;
            }
        return false;
      };
      for (let na = 0; na <= total; na++)
        for (let nb = 0; nb <= 1; nb++)
          for (let nc = 0; nc <= 1; nc++)
            for (let no = 0; no <= total; no++) {
              const counts = [na, nb, nc, no];
              if (
                !feasible(counts) ||
                counts.reduce((n, v) => n + v, 0) >= total
              )
                continue;
              const sources = counts.flatMap((n, k) =>
                Array.from({ length: n }, () =>
                  source(k < 3 ? [groups[k].id] : []),
                ),
              );
              for (let k = 0; k < 4; k++) {
                const after = [...counts];
                after[k]++;
                const decision = quotaDecision(
                  s,
                  sources,
                  { segment: k < 3 ? ["A", "B", "C"][k] : "other" },
                  total,
                );
                assert.equal(
                  decision.allowed,
                  feasible(after),
                  JSON.stringify({ total, min, counts, k }),
                );
              }
            }
    }
});
test("Target validation rejects overlaps, mixed fields/sources, multiple-select lower bounds and infeasible occupied capacity", () => {
  const a = rule("A", "minimum", 2),
    b = rule("B", "exact", 1),
    s = settings([a, b]),
    guide = { ...emotionInterview().guide, limit: 3 };
  validateQuotaTargets(s, guide, []);
  for (const rules of [
    [a, { ...b, conditions: [{ key: "country", value: "US" }] }],
    [a, { ...b, conditions: [{ key: "segment", value: "A" }] }],
    [
      a,
      { ...b, conditions: [...b.conditions, { key: "country", value: "US" }] },
    ],
    [a, { ...b, limit: 2 }],
  ])
    assert.throws(() => validateQuotaTargets(settings(rules), guide, []));
  assert.throws(() => validateQuotaTargets(s, guide, [source([])]));
  assert.throws(() =>
    validateQuotaTargets(s, guide, [source([b.id]), source([b.id])]),
  );
  const sc = { ...screenerRule("tools", "app"), kind: "minimum" as const };
  assert.throws(() =>
    validateQuotaTargets(settings([sc]), screenerGuide(), []),
  );
});
test("Minimums have no upper cap, active reservations differ from completed targets, and pending screeners are deferred without double counting", () => {
  const a = rule("A", "minimum", 1),
    s = settings([a]),
    i = source([a.id]);
  assert.equal(quotaProgress([a], [i])[0].full, false);
  assert.equal(quotaProgress([a], [i])[0].needed, 0);
  assert.equal(quotaProgress([a], [i])[0].completeNeeded, 1);
  assert.equal(quotaDecision(s, [i], { segment: "A" }, 3).allowed, true);
  const sc = { ...screenerRule(), kind: "exact" as const, limit: 1 },
    screen = settings([sc]),
    pending = {
      ...source([]),
      screenerQuota: {
        rules: [sc],
        endIndex: 0,
        requireMatch: false,
        state: "pending" as const,
      },
    };
  assert.equal(quotaTargetCapacity(screen, [pending], 1).settled, 0);
  assert.equal(
    minimumProtection(screen, [pending], [sc.id], 1, pending.id).allowed,
    true,
  );
  assert.equal(
    minimumProtection(screen, [pending], [], 1, pending.id).allowed,
    false,
  );
  assert.equal(quotaDecision(screen, [pending], {}, 1).allowed, true);
});
