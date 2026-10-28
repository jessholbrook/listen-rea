import { randomUUID } from "node:crypto";
import { templateGuide, type Interview, type Turn } from "../src/lib/domain";
import { advanceInterview } from "../src/lib/mixed";
import { applyPricing } from "../src/lib/pricing";
export function pricingInterview(
  start = 1,
  askReason = true,
  count = 3,
): Interview {
  const guide = templateGuide();
  guide.questions = [
    {
      ...guide.questions[1],
      id: "price",
      type: "pricing",
      text: "An Echo Lab subscription for research teams.",
      followUps: 0,
      options: [],
      pricing: {
        prices: Array.from({ length: count }, (_, n) => (n + 1) * 1000),
        currency: "USD",
        unit: "per month",
        askReason,
      },
    },
  ];
  const i: Interview = {
    id: randomUUID(),
    studyId: "study",
    workspaceId: "workspace",
    revisionId: "revision-1",
    tokenHash: "fixture",
    preview: false,
    status: "active",
    createdAt: new Date().toISOString(),
    consentAt: new Date().toISOString(),
    consentVersion: "v1",
    guide,
    current: 0,
    prompt: "",
    strategy: "guide",
    turns: [],
    attributes: { segment: "Team" },
    excluded: false,
    exclusionReason: "",
    requests: {},
    version: 0,
  };
  advanceInterview(i, -1, () => start);
  return i;
}
export function runPricing(
  highest: number,
  start = 1,
  askReason = true,
  flipCheck = false,
  count = 3,
) {
  const i = pricingInterview(start, askReason, count),
    q = i.guide.questions[0];
  let attempts = 0;
  while (i.pricingStates![q.id].phase !== "done") {
    if (attempts++ > 20) throw new Error("Ladder did not terminate");
    const s = i.pricingStates![q.id],
      phase = s.phase,
      prompt = i.prompt,
      buy = s.index <= highest;
    const result = applyPricing(
      i,
      q,
      phase === "reason"
        ? { answer: "The value fits our team budget." }
        : {
            optionId: (phase === "check" && flipCheck ? !buy : buy)
              ? "yes"
              : "no",
          },
    );
    i.turns.push({
      id: randomUUID(),
      questionId: q.id,
      prompt,
      ...result,
      followUp: false,
      createdAt: new Date().toISOString(),
      source: "typed",
      strategy: "guide",
    } as Turn);
    i.version++;
  }
  i.status = "complete";
  return i;
}
