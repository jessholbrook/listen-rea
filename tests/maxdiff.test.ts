import test from "node:test";
import assert from "node:assert/strict";
import { guideSchema } from "../src/lib/domain";
import {
  maxdiffDesign,
  designDiagnostics,
  beginMaxdiff,
  maxdiffPrompt,
  maxdiffInput,
  applyMaxdiff,
} from "../src/lib/maxdiff";
import { maxdiffResults } from "../src/lib/maxdiff-results";
import {
  fitMaxdiff,
  modelObjective,
  bootstrapMaxdiff,
  shares,
} from "../src/lib/maxdiff-model";
import {
  maxdiffInterview,
  completeMaxdiff,
  simulatedRespondents,
} from "./maxdiff-fixture";
import { guideFields, applyFields } from "../src/lib/localization";
test("MaxDiff cyclic designs balance item exposure and remain connected for every supported shape", () => {
  for (let n = 4; n <= 12; n++)
    for (let k = 3; k <= Math.min(5, n - 1); k++)
      for (const cycles of [1, 2]) {
        const tasks = maxdiffDesign(n, k, cycles),
          d = designDiagnostics(tasks, n);
        assert.equal(tasks.length, n * cycles);
        assert.ok(d.connected);
        assert.ok(d.exposures.every((e) => e === k * cycles));
        assert.ok(tasks.every((t) => new Set(t).size === k));
      }
  const fano = designDiagnostics(maxdiffDesign(7, 3), 7);
  assert.equal(fano.pairMin, 1);
  assert.equal(fano.pairMax, 1);
  const four = designDiagnostics(maxdiffDesign(4, 3), 4);
  assert.equal(four.pairMin, 2);
  assert.equal(four.pairMax, 2);
  assert.throws(() => maxdiffDesign(4, 4));
});
test("MaxDiff schema, saved task ordering, strict choices, localized labels and reserved IDs remain valid", () => {
  const i = maxdiffInterview(),
    q = i.guide.questions[0];
  assert.equal(guideSchema.safeParse(i.guide).success, true);
  q.followUps = 1;
  assert.equal(guideSchema.safeParse(i.guide).success, false);
  q.followUps = 0;
  q.maxdiff!.items[1].text = q.maxdiff!.items[0].text;
  assert.equal(guideSchema.safeParse(i.guide).success, false);
  q.maxdiff!.items[1].text = "Evidence";
  const restored = JSON.parse(JSON.stringify(i));
  beginMaxdiff(restored, restored.guide.questions[0], () => 0);
  assert.deepEqual(restored.maxdiffStates, i.maxdiffStates);
  const p = maxdiffPrompt(i, q)!;
  assert.throws(() =>
    maxdiffInput(i, q, { best: p.items[0].id, worst: p.items[0].id }),
  );
  assert.throws(() =>
    maxdiffInput(i, q, { best: "unshown", worst: p.items[1].id }),
  );
  const applied = applyMaxdiff(i, q, {
    best: p.items[0].id,
    worst: p.items[1].id,
  });
  assert.equal(applied.maxdiff!.task, 1);
  assert.equal(maxdiffPrompt(i, q)!.task, 2);
  const fields = guideFields(i.guide).map((f) => ({
      key: f.key,
      text: f.label.includes("MaxDiff item:") ? "FR " + f.text : f.text,
    })),
    translated = applyFields(i.guide, fields);
  assert.ok(
    translated.questions[0].maxdiff!.items.every((x) =>
      x.text.startsWith("FR "),
    ),
  );
  assert.deepEqual(
    translated.questions[0].maxdiff!.items.map((x) => x.id),
    q.maxdiff!.items.map((x) => x.id),
  );
  q.id = "__proto__";
  i.maxdiffStates = {};
  beginMaxdiff(i, q, () => 0);
  assert.ok(Object.hasOwn(i.maxdiffStates, q.id));
});
test("descriptive counts use completed people and actual exposures with revision, concept and segment scope", () => {
  const included = completeMaxdiff(),
    incomplete = maxdiffInterview(),
    notAsked = maxdiffInterview(),
    preview = completeMaxdiff(),
    excluded = completeMaxdiff();
  notAsked.maxdiffStates = undefined;
  preview.preview = true;
  excluded.excluded = true;
  const r = maxdiffResults([
    included,
    incomplete,
    notAsked,
    preview,
    excluded,
  ])[0];
  assert.equal(r.counts.included, 1);
  assert.equal(r.counts.incomplete, 1);
  assert.equal(r.counts.notAsked, 1);
  assert.equal(r.counts.tasks, 4);
  assert.ok(r.items.every((x) => x.exposures === 3));
  assert.deepEqual(
    r.items.map((x) => [x.best, x.worst]),
    [
      [3, 0],
      [1, 0],
      [0, 1],
      [0, 3],
    ],
  );
  const other = completeMaxdiff();
  other.attributes.segment = "Solo";
  other.revisionId = "revision-2";
  assert.equal(maxdiffResults([included, other]).length, 2);
  assert.equal(
    maxdiffResults([included, other], { key: "segment", value: "Solo" })[0]
      .counts.included,
    1,
  );
  other.revisionId = included.revisionId;
  other.guide.questions[0].conceptId = "concept-b";
  assert.equal(maxdiffResults([included, other]).length, 2);
});
test("joint best-worst objective derivatives match independent finite differences and uniform pairs give uniform utilities", () => {
  const rows = simulatedRespondents(10, [0.6, 0.2, -0.2, -0.6]).flat(),
    u = [0.4, 0.1, -0.2, -0.3],
    e = modelObjective(u, rows),
    eps = 1e-5;
  for (let a = 0; a < 4; a++) {
    const plus = [...u],
      minus = [...u];
    plus[a] += eps;
    minus[a] -= eps;
    const ep = modelObjective(plus, rows),
      em = modelObjective(minus, rows);
    assert.ok(Math.abs((ep.loss - em.loss) / (2 * eps) - e.gradient[a]) < 1e-5);
    for (let b = 0; b < 4; b++)
      assert.ok(
        Math.abs(
          (ep.gradient[b] - em.gradient[b]) / (2 * eps) - e.hessian[b][a],
        ) < 1e-5,
      );
  }
  const uniform = maxdiffDesign(4, 3).flatMap((set) =>
    set.flatMap((best) =>
      set
        .filter((worst) => worst !== best)
        .map((worst) => ({ set, best, worst })),
    ),
  );
  const fit = fitMaxdiff(uniform, 4);
  assert.ok(fit.converged);
  assert.deepEqual(fit.scores, [25, 25, 25, 25]);
  assert.ok(Math.abs(fit.loss - uniform.length * Math.log(6)) < 1e-8);
  assert.throws(() => fitMaxdiff([{ set: [0, 1, 2], best: 0, worst: 0 }], 4));
});
test(
  "pooled model recovers simulated utilities and bootstrap ranges shrink with more respondents",
  { timeout: 90000 },
  () => {
    const truth = [1.1, 0.7, 0.3, 0, -0.3, -0.7, -1.1],
      large = simulatedRespondents(200, truth, 742),
      small = simulatedRespondents(35, truth, 170),
      fit = fitMaxdiff(large.flat(), 7);
    assert.ok(fit.converged);
    assert.ok(
      Math.sqrt(
        fit.utilities.reduce((s, u, k) => s + (u - truth[k]) ** 2, 0) / 7,
      ) < 0.2,
    );
    assert.ok(Math.abs(fit.utilities.reduce((a, b) => a + b, 0)) < 1e-6);
    assert.ok(Math.abs(fit.scores.reduce((a, b) => a + b, 0) - 100) < 1e-8);
    const lo = bootstrapMaxdiff(small, 7, 912),
      hi = bootstrapMaxdiff(large, 7, 913);
    assert.ok(lo.intervals && hi.intervals);
    const width = (v: NonNullable<typeof hi.intervals>) =>
      v.reduce((s, r) => s + r.high - r.low, 0);
    assert.ok(width(hi.intervals!) < width(lo.intervals!));
    assert.deepEqual(bootstrapMaxdiff(large, 7, 913), hi);
    const target = shares(truth);
    assert.ok(
      hi.intervals!.filter((v, k) => v.low <= target[k] && v.high >= target[k])
        .length >= 5,
    );
    assert.equal(bootstrapMaxdiff(large.slice(0, 3), 7, 1).intervals, null);
  },
);
