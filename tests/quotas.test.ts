import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emotionInterview } from "./emotion-fixture";
import {
  quotaDecision,
  quotaProgress,
  quotaSettingsInput,
  sameQuotaConditions,
  type QuotaSettings,
} from "../src/lib/quotas";
const group = (key: string, value: string, limit = 2) => ({
  id: randomUUID(),
  label: value,
  enabled: true,
  limit,
  conditions: [{ key, value }],
});
const config = (...rules: QuotaSettings["rules"]): QuotaSettings => ({
  id: "s",
  workspaceId: "w",
  studyId: "s",
  version: 1,
  enabled: true,
  requireMatch: true,
  rules,
});
test("Quota reference counts active reservations and all completes, omits previews/imports/other outcomes and supports overlapping groups", () => {
  const a = group("segment", "customer"),
    b = group("country", "US", 1),
    settings = config(a, b);
  const active = { ...emotionInterview(), quotaRuleIds: [a.id] },
    complete = {
      ...emotionInterview(),
      status: "complete" as const,
      excluded: true,
      quotaRuleIds: [a.id, b.id],
    };
  const ignored = [
    { ...active, preview: true },
    { ...active, status: "withdrawn" as const },
    { ...active, status: "screened_out" as const },
    emotionInterview(),
  ];
  const p = quotaProgress(settings.rules, [active, complete, ...ignored]);
  assert.deepEqual(
    p.map((x) => [x.active, x.complete, x.reserved, x.remaining, x.full]),
    [
      [1, 1, 2, 0, true],
      [0, 1, 1, 0, true],
    ],
  );
  assert.equal(
    quotaDecision(settings, [complete], { segment: "customer", country: "US" })
      .allowed,
    false,
  );
  assert.equal(
    quotaDecision(settings, [complete], { segment: "customer", country: "CA" })
      .allowed,
    true,
  );
  assert.equal(
    quotaDecision(settings, [], { segment: "Customer" }).allowed,
    false,
  );
  assert.equal(
    quotaDecision({ ...settings, requireMatch: false }, [], {}).allowed,
    true,
  );
  assert.deepEqual(
    quotaDecision({ ...settings, enabled: false }, [active, complete], {}),
    { allowed: true, ids: [] },
  );
});
test("Quota combinations require every exact own tag and preserve stable conditions independently of ordering", () => {
  const a = group("segment", "customer");
  a.conditions.push({ key: "tier", value: "paid" });
  const settings = config(a);
  assert.deepEqual(
    quotaDecision(settings, [], { segment: "customer", tier: "paid" }).ids,
    [a.id],
  );
  assert.equal(
    quotaDecision(settings, [], { segment: "customer" }).allowed,
    false,
  );
  assert.equal(
    quotaDecision(
      settings,
      [],
      Object.create({ segment: "customer", tier: "paid" }),
    ).allowed,
    false,
  );
  assert.equal(
    sameQuotaConditions(a, { ...a, conditions: [...a.conditions].reverse() }),
    true,
  );
  assert.equal(
    sameQuotaConditions(a, {
      ...a,
      conditions: [{ key: "segment", value: "prospect" }],
    }),
    false,
  );
});
test("Quota settings reject ambiguous IDs, reserved fields, duplicate tags and invalid limits", () => {
  const a = group("segment", "customer"),
    s = config(a);
  const { id, workspaceId, studyId, ...input } = s;
  assert.ok(quotaSettingsInput.safeParse(input).success);
  for (const patch of [
    { rules: [] },
    { rules: [a, a] },
    { rules: [{ ...a, limit: 0 }] },
    { rules: [{ ...a, limit: 1.5 }] },
    { rules: [{ ...a, conditions: [{ key: "rid", value: "opaque" }] }] },
    { rules: [{ ...a, conditions: [...a.conditions, ...a.conditions] }] },
    { rules: [{ ...a, conditions: [{ key: "x", value: "" }] }] },
  ])
    assert.equal(
      quotaSettingsInput.safeParse({ ...input, ...patch }).success,
      false,
    );
});
