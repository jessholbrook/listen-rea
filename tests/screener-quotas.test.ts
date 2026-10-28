import test from "node:test";
import type { Interview } from "../src/lib/domain";
import { quotaRuleInput } from "../src/lib/quotas";
import assert from "node:assert/strict";
import {
  screeningPlan,
  matchingScreenerQuotaIds,
  quotaDecision,
  quotaProgress,
  type QuotaSettings,
} from "../src/lib/quotas";
import { screenerGuide, screenerRule } from "./screener-quota-fixture";
import { emotionInterview } from "./emotion-fixture";
const settings = (...rules: QuotaSettings["rules"]): QuotaSettings => ({
  id: "s",
  studyId: "s",
  workspaceId: "w",
  version: 1,
  enabled: true,
  requireMatch: true,
  rules,
});
test("Screening boundary waits for the last referenced leading choice question, and choice/multiple matching uses canonical IDs", () => {
  assert.ok(quotaRuleInput.safeParse(screenerRule("1-uuid", "1-option")).success);
  const a = screenerRule(),
    b = screenerRule("tools", "app"),
    s = settings(a, b),
    guide = screenerGuide(),
    plan = screeningPlan(s, guide)!;
  assert.equal(plan.endIndex, 1);
  assert.equal(quotaDecision(s, [], {}).allowed, true);
  const i: Interview = {
    ...emotionInterview(),
    guide,
    turns: [
      {
        id: "1",
        questionId: "role",
        prompt: "role",
        answer: "Customer",
        optionId: "customer",
        source: "typed",
        strategy: "guide",
        followUp: false,
        createdAt: "now",
      },
      {
        id: "2",
        questionId: "tools",
        prompt: "tools",
        answer: "App",
        value: ["web", "app"],
        source: "typed",
        strategy: "guide",
        followUp: false,
        createdAt: "now",
      },
    ],
  };
  assert.deepEqual(matchingScreenerQuotaIds(plan, i), [a.id, b.id]);
  assert.equal(
    quotaProgress(s.rules, [{ ...i, screenerQuota: plan }])[0].reserved,
    0,
  );
  assert.equal(
    quotaProgress(s.rules, [{ ...i, screenerQuota: plan }])[0].screening,
    1,
  );
  assert.equal(
    quotaProgress(s.rules, [{ ...i, screenerQuota: plan }])[0].linked,
    1,
  );
});
test("Quota screeners reject unknown/rejecting options, non-leading or branched questions and disabled plans; conjunctions require every answer", () => {
  const guide = screenerGuide(),
    a = screenerRule();
  a.conditions.push({ key: "tools", value: "app" });
  const s = settings(a);
  for (const rule of [
    screenerRule("role", "ineligible"),
    screenerRule("missing", "x"),
    screenerRule("feeling", "happy"),
  ])
    assert.throws(() => screeningPlan(settings(rule), guide));
  assert.throws(() =>
    screeningPlan(settings(a), {
      ...guide,
      questions: [guide.questions[2], ...guide.questions.slice(0, 2)],
    }),
  );
  assert.throws(() =>
    screeningPlan(settings(a), {
      ...guide,
      questions: [
        guide.questions[0],
        {
          ...guide.questions[1],
          condition: { questionId: "role", optionId: "customer" },
        },
        guide.questions[2],
      ],
    }),
  );
  assert.equal(screeningPlan({ ...s, enabled: false }, guide), undefined);
  assert.equal(
    matchingScreenerQuotaIds(screeningPlan(s, guide)!, emotionInterview())
      .length,
    0,
  );
  const snapshot = screeningPlan(s, guide)!;
  a.conditions[0].value = "changed";
  assert.equal(snapshot.rules[0].conditions[0].value, "customer");
});
