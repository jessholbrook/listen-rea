import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  fitHierarchical,
  helmert,
  contrastUtilities,
  jointLogLikelihood,
  normalDraw,
} from "../src/lib/maxdiff-hierarchical";
import {
  fitMaxdiff,
  seeded,
  shares,
  type ModelChoice,
} from "../src/lib/maxdiff-model";
// Independent ordered-pair generator; no production choice/design sampler is used.
function sample(u: number[], random: () => number): ModelChoice {
  const set = [0, 1, 2, 3].sort(() => 0);
  const omitted = Math.floor(random() * 4);
  set.splice(omitted, 1);
  const pairs = set.flatMap((best) =>
    set
      .filter((worst) => worst !== best)
      .map((worst) => ({ best, worst, weight: Math.exp(u[best] - u[worst]) })),
  );
  let x = random() * pairs.reduce((s, p) => s + p.weight, 0);
  let chosen = pairs.at(-1)!;
  for (const p of pairs) {
    x -= p.weight;
    if (x <= 0) {
      chosen = p;
      break;
    }
  }
  return { set, best: chosen.best, worst: chosen.worst };
}
const runs = [];
for (let run = 0; run < 5; run++) {
  const random = seeded(40000 + run),
    truth = Array.from({ length: 30 }, () =>
      contrastUtilities(
        [
          0.4 + 1.1 * normalDraw(random),
          -0.2 + 1.1 * normalDraw(random),
          0.1 + 1.1 * normalDraw(random),
        ],
        helmert(4),
      ),
    );
  const train = truth.map((u) =>
      Array.from({ length: 16 }, () => sample(u, random)),
    ),
    test = truth.map((u) => Array.from({ length: 8 }, () => sample(u, random)));
  const fit = fitHierarchical(train, 4, 80000 + run, { size: 2, top: 1 });
  if (!fit.diagnostics.ready) {
    runs.push({ run, ready: false, diagnostics: fit.diagnostics });
    continue;
  }
  const pooled = fitMaxdiff(train.flat(), 4),
    loss = (individual: boolean) =>
      test.reduce(
        (sum, rows, r) =>
          sum -
          jointLogLikelihood(
            individual
              ? fit.individual[r].utilities.map((x) => x.mean)
              : pooled.utilities,
            rows,
          ),
        0,
      ) / test.flat().length;
  const target = Array.from(
    { length: 4 },
    (_, k) => truth.reduce((s, u) => s + shares(u)[k], 0) / truth.length,
  );
  const covered = fit.items.filter(
    (v, k) => v.low <= target[k] && v.high >= target[k],
  ).length;
  runs.push({
    run,
    ready: true,
    diagnostics: fit.diagnostics,
    covered,
    items: 4,
    posteriorMeanUtilityHeldOutLoss: loss(true),
    pooledHeldOutLoss: loss(false),
  });
}
const accepted = runs.filter((r) => r.ready),
  individual =
    accepted.reduce((s, r) => s + r.posteriorMeanUtilityHeldOutLoss!, 0) /
    accepted.length,
  pooled =
    accepted.reduce((s, r) => s + r.pooledHeldOutLoss!, 0) / accepted.length;
assert.ok(
  accepted.length >= 4,
  "Most model-matched reference datasets must pass diagnostics",
);
assert.ok(
  individual < pooled,
  "Individual posterior-mean utilities should improve held-out predictions in this heterogeneous reference",
);
mkdirSync("test-results", { recursive: true });
writeFileSync(
  "test-results/hierarchical-maxdiff-evaluation.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      passed: true,
      reference:
        "30 heterogeneous respondents, 4 items, 16 training and 8 held-out tasks per respondent; independently enumerated ordered-pair draws",
      runs,
      meanHeldOutLoss: { individual, pooled },
      limitations:
        "Five synthetic model-matched references do not validate real-study accuracy, population coverage or equivalence with another vendor’s HB model.",
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    passed: true,
    accepted: accepted.length,
    meanHeldOutLoss: { individual, pooled },
  }),
);
