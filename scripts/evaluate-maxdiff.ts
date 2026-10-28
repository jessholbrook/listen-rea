import { maxdiffDesign } from "../src/lib/maxdiff";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { simulatedRespondents } from "../tests/maxdiff-fixture";
import {
  fitMaxdiff,
  bootstrapMaxdiff,
  shares,
  seeded,
} from "../src/lib/maxdiff-model";
const truth = [1.1, 0.7, 0.3, 0, -0.3, -0.7, -1.1],
  target = shares(truth),
  runs = [];
for (let seed = 0; seed < 20; seed++) {
  const respondents = simulatedRespondents(80, truth, 4000 + seed),
    fit = fitMaxdiff(respondents.flat(), 7),
    boot = bootstrapMaxdiff(respondents, 7, 8000 + seed);
  assert.ok(fit.converged && boot.intervals);
  const covered = boot.intervals!.filter(
    (v, k) => v.low <= target[k] && v.high >= target[k],
  ).length;
  runs.push({
    seed,
    rmse: Math.sqrt(
      fit.utilities.reduce((s, v, k) => s + (v - truth[k]) ** 2, 0) / 7,
    ),
    covered,
    intervals: 7,
    bootstrapConverged: boot.completed,
  });
}
const train = simulatedRespondents(200, truth, 173),
  test = simulatedRespondents(200, truth, 997),
  fit = fitMaxdiff(train.flat(), 7);
function loss(utilities: number[]) {
  return (
    test.flat().reduce((sum, row) => {
      const denominator = row.set
        .flatMap((a) =>
          row.set
            .filter((b) => a !== b)
            .map((b) => Math.exp(utilities[a] - utilities[b])),
        )
        .reduce((a, b) => a + b, 0);
      return (
        sum + Math.log(denominator) - utilities[row.best] + utilities[row.worst]
      );
    }, 0) / test.flat().length
  );
}
const coverage = runs.reduce((s, r) => s + r.covered, 0) / 140,
  meanRmse = runs.reduce((s, r) => s + r.rmse, 0) / 20,
  uniformLoss = loss(Array(7).fill(0)),
  fittedLoss = loss(fit.utilities);
assert.ok(coverage >= 0.8);
assert.ok(meanRmse < 0.25);
assert.ok(fittedLoss < uniformLoss * 0.9);
const random = seeded(874),
  design = maxdiffDesign(12, 5, 2),
  stressData = Array.from({ length: 500 }, () => {
    const ids = Array.from({ length: 12 }, (_, n) => n);
    for (let n = 11; n > 0; n--) {
      const b = Math.floor(random() * (n + 1));
      [ids[b], ids[n]] = [ids[n], ids[b]];
    }
    return design.map((task) => {
      const set = task.map((n) => ids[n]),
        best = set[Math.floor(random() * 5)],
        others = set.filter((n) => n !== best);
      return { set, best, worst: others[Math.floor(random() * 4)] };
    });
  });
const started = performance.now(),
  stressFit = fitMaxdiff(stressData.flat(), 12),
  stressBoot = bootstrapMaxdiff(stressData, 12, 782),
  boundedWorkload = {
    respondents: 500,
    tasks: 12000,
    bootstrapCompleted: stressBoot.completed,
    elapsedMs: Math.round(performance.now() - started),
  };
assert.ok(stressFit.converged && stressBoot.completed === 100);
mkdirSync("test-results", { recursive: true });
writeFileSync(
  "test-results/maxdiff-model-evaluation.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      passed: true,
      simulation:
        "20 seeded homogeneous joint best/worst logit datasets; 80 respondents × 7 tasks; 100 respondent bootstrap replicates",
      coverage,
      boundedWorkload,
      meanRmse,
      uniformLoss,
      fittedLoss,
      runs,
      limits:
        "Synthetic model-matched data only. This does not validate heterogeneous populations, HB equivalence, nominal coverage generally, or human research quality.",
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ coverage, meanRmse, uniformLoss, fittedLoss, passed: true }),
);
