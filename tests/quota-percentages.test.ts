import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emotionInterview } from "./emotion-fixture";
import {
  quotaRuleInput,
  quotaResolution,
  quotaDecision,
  validateQuotaTargets,
  quotaProgress,
  type QuotaRule,
  type QuotaSettings,
} from "../src/lib/quotas";
const rule = (kind: QuotaRule["kind"], limit: number): QuotaRule => ({
  id: randomUUID(),
  label: "A",
  enabled: true,
  kind,
  unit: "percent",
  limit,
  conditions: [{ key: "segment", value: "A" }],
});
const settings = (rules: QuotaRule[]): QuotaSettings => ({
  id: "s",
  studyId: "s",
  workspaceId: "w",
  version: 0,
  enabled: true,
  requireMatch: false,
  rules,
});
test("Percentage rounding obeys rational maximum/minimum bounds and exact divisibility across small limits and decimal percentages", () => {
  for (let n = 1; n <= 50; n++)
    for (const pct of [0.01, 0.1, 12.5, 33.33, 50, 99.99, 100]) {
      const product = Math.round(pct * 100) * n,
        lo = quotaResolution(rule("maximum", pct), n),
        hi = quotaResolution(rule("minimum", pct), n),
        exact = quotaResolution(rule("exact", pct), n);
      assert.ok(lo.valid && hi.valid);
      assert.ok(
        lo.count! * 10000 <= product && (lo.count! + 1) * 10000 > product,
      );
      assert.ok(
        hi.count! * 10000 >= product && (hi.count! - 1) * 10000 < product,
      );
      assert.equal(exact.valid, product % 10000 === 0);
      if (exact.valid) assert.equal(exact.count! * 10000, product);
      else assert.equal(exact.count, null);
    }
  assert.equal(
    quotaResolution({ ...rule("maximum", 7), unit: undefined }, 3).count,
    7,
  );
});
test("Percentage schema and effective-count validation reject bad precision, fractional exacts and incompatible rounded lower bounds", () => {
  for (const limit of [0, -1, 100.01, 1.001, NaN, Infinity])
    assert.equal(
      quotaRuleInput.safeParse(rule("maximum", limit)).success,
      false,
    );
  assert.ok(quotaRuleInput.safeParse(rule("maximum", 0.01)).success);
  assert.equal(
    quotaRuleInput.safeParse({ ...rule("maximum", 1.5), unit: "count" })
      .success,
    false,
  );
  const a = rule("minimum", 50),
    b = {
      ...rule("minimum", 50),
      conditions: [{ key: "segment", value: "B" }],
    },
    guide = { ...emotionInterview().guide, limit: 3 };
  assert.throws(() => validateQuotaTargets(settings([a, b]), guide, []));
  assert.throws(() =>
    validateQuotaTargets(settings([rule("exact", 50)]), guide, []),
  );
  validateQuotaTargets(settings([a, b]), { ...guide, limit: 4 }, []);
});
test("Live percentage counts scale capacity protection without changing membership; zero effective maximums and exact rounding fail closed", () => {
  const a = rule("minimum", 50),
    b = { ...rule("exact", 25), conditions: [{ key: "segment", value: "B" }] },
    s = settings([a, b]);
  assert.equal(quotaDecision(s, [], { segment: "other" }, 4).allowed, true);
  const outsider = { ...emotionInterview(), quotaRuleIds: [] };
  assert.equal(
    quotaDecision(s, [outsider], { segment: "other" }, 4).allowed,
    false,
  );
  assert.equal(quotaProgress(s.rules, [], 8)[0].resolvedCount, 4);
  assert.equal(quotaProgress(s.rules, [], 8)[1].resolvedCount, 2);
  assert.equal(quotaProgress([rule("maximum", 1)], [], 3)[0].full, true);
  assert.equal(
    quotaDecision(settings([rule("maximum", 1)]), [], { segment: "A" }, 3)
      .allowed,
    false,
  );
  assert.equal(
    quotaDecision(settings([rule("exact", 50)]), [], { segment: "A" }, 3)
      .allowed,
    false,
  );
});
