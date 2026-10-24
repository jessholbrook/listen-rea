import { randomUUID } from "node:crypto";
import { templateGuide, type Interview, type Turn } from "../src/lib/domain";
import { advanceInterview } from "../src/lib/mixed";
import { applyMaxdiff, maxdiffDesign } from "../src/lib/maxdiff";
import { seeded, type ModelChoice } from "../src/lib/maxdiff-model";
export function maxdiffInterview() {
  const guide = templateGuide();
  guide.questions = [
    {
      ...guide.questions[1],
      id: "maxdiff",
      type: "maxdiff",
      text: "Which research features matter most?",
      followUps: 0,
      options: [],
      maxdiff: {
        items: [
          "Fast setup",
          "Clear evidence",
          "Team tools",
          "Flexible exports",
        ].map((text, n) => ({ id: String(n), text })),
        setSize: 3,
        cycles: 1,
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
  advanceInterview(i, -1, (n) => n - 1);
  return i;
}
export function completeMaxdiff() {
  const i = maxdiffInterview(),
    q = i.guide.questions[0],
    s = i.maxdiffStates![q.id];
  while (s.choices.length < s.tasks.length) {
    const task = s.tasks[s.choices.length],
      sorted = [...task].sort();
    const prompt = i.prompt,
      result = applyMaxdiff(i, q, { best: sorted[0], worst: sorted.at(-1) });
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
  }
  i.status = "complete";
  return i;
}
// Draw an ordered best/worst pair independently from the full stated joint probability table.
export function simulatedRespondents(
  n: number,
  utilities: number[],
  seed = 123,
): ModelChoice[][] {
  const random = seeded(seed),
    sets = maxdiffDesign(utilities.length, 3);
  return Array.from({ length: n }, () =>
    sets.map((set) => {
      const possibilities = set.flatMap((best) =>
          set
            .filter((worst) => worst !== best)
            .map((worst) => ({
              best,
              worst,
              weight: Math.exp(utilities[best] - utilities[worst]),
            })),
        ),
        total = possibilities.reduce((s, p) => s + p.weight, 0);
      let draw = random() * total;
      let chosen = possibilities.at(-1)!;
      for (const p of possibilities) {
        draw -= p.weight;
        if (draw <= 0) {
          chosen = p;
          break;
        }
      }
      return { set: [...set], best: chosen.best, worst: chosen.worst };
    }),
  );
}
