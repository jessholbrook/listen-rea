import test from "node:test";
import assert from "node:assert/strict";
import {
  helmert,
  contrastUtilities,
  jointLogLikelihood,
  normalDraw,
  gammaDraw,
  hyperConditional,
  chainDiagnostics,
  portfolioCoverage,
  fitHierarchical,
} from "../src/lib/maxdiff-hierarchical";
import { seeded, shares, fitMaxdiff } from "../src/lib/maxdiff-model";
import { simulatedRespondents } from "./maxdiff-fixture";
import { cardsortInterview, assignments } from "./cardsort-fixture";
import {
  beginCardsort,
  applyCardsort,
  cardsortSchema,
  validateCustomGroups,
  validateAssignments,
  cardsortPrompt,
} from "../src/lib/cardsort";
import { cardsortResults } from "../src/lib/cardsort-results";
test("hierarchical contrast basis is orthonormal and sum-zero; joint likelihood matches an independent six-pair reference", () => {
  for (let n = 4; n <= 8; n++) {
    const h = helmert(n);
    for (let k = 0; k < n - 1; k++) {
      assert.ok(Math.abs(h.reduce((s, r) => s + r[k], 0)) < 1e-12);
      for (let j = 0; j < n - 1; j++)
        assert.ok(
          Math.abs(h.reduce((s, r) => s + r[k] * r[j], 0) - (j === k ? 1 : 0)) <
            1e-12,
        );
    }
    const u = contrastUtilities(Array(n - 1).fill(0.5), h);
    assert.ok(Math.abs(u.reduce((a, b) => a + b, 0)) < 1e-12);
  }
  const row = { set: [0, 1, 2], best: 0, worst: 2 };
  assert.ok(
    Math.abs(jointLogLikelihood([0, 0, 0, 0], [row]) + Math.log(6)) < 1e-12,
  );
  const u = [1, 0, -1, 0],
    den =
      Math.exp(1) +
      Math.exp(2) +
      Math.exp(-1) +
      Math.exp(1) +
      Math.exp(-2) +
      Math.exp(-1);
  assert.ok(
    Math.abs(jointLogLikelihood(u, [row]) - (2 - Math.log(den))) < 1e-12,
  );
});
test("normal/gamma draws and the hierarchical normal-inverse-gamma update recover known analytic moments", () => {
  const random = seeded(981),
    n = 50000;
  let normal = 0,
    normal2 = 0,
    gamma = 0,
    inverse = 0,
    mu = 0,
    mu2 = 0;
  const h = hyperConditional([
    [1, -1],
    [3, 1],
  ]);
  assert.equal(h.shape, 4);
  assert.ok(Math.abs(h.scale - 3.1904761904761907) < 1e-12);
  for (let k = 0; k < n; k++) {
    const z = normalDraw(random);
    normal += z;
    normal2 += z * z;
    gamma += gammaDraw(3.5, random);
    const v = h.scale / gammaDraw(h.shape, random);
    inverse += v;
    const m = h.mean[0] + Math.sqrt(v / h.meanPrecision) * normalDraw(random);
    mu += m;
    mu2 += m * m;
  }
  assert.ok(Math.abs(normal / n) < 0.02);
  assert.ok(Math.abs(normal2 / n - 1) < 0.03);
  assert.ok(Math.abs(gamma / n - 3.5) < 0.06);
  assert.ok(Math.abs(inverse / n - h.scale / 3) < 0.025);
  assert.ok(Math.abs(mu / n - h.mean[0]) < 0.02);
  assert.ok(
    Math.abs(mu2 / n - (mu / n) ** 2 - h.scale / 3 / h.meanPrecision) < 0.035,
  );
});
test("portfolio enumeration matches the hand-calculated expected sample preference coverage", () => {
  const p = portfolioCoverage(
    [Uint16Array.from([1, 2, 4]), Uint16Array.from([1, 1, 4])],
    3,
    2,
    3,
  );
  assert.equal(p.candidateCount, 3);
  assert.deepEqual(p.candidates[0].items, [0, 2]);
  assert.ok(Math.abs(p.candidates[0].coverage - (100 * 5) / 6) < 1e-10);
  assert.ok(p.candidates.every((x) => x.coverage >= 0 && x.coverage <= 100));
});
test("sampling diagnostics reject separated chains; bounds, time budget and poor mixing never publish estimates", () => {
  const random = seeded(43),
    a = Array.from({ length: 1000 }, () => normalDraw(random) - 4),
    b = Array.from({ length: 1000 }, () => normalDraw(random) + 4);
  assert.ok(chainDiagnostics([a, b]).rhat > 2);
  const rows = simulatedRespondents(25, [0.7, 0.2, -0.3, -0.6], 123);
  assert.throws(
    () => fitHierarchical(rows.slice(0, 9), 4, 1, { size: 2, top: 1 }),
    /HB_BOUNDS/,
  );
  assert.throws(
    () => fitHierarchical(rows, 4, 1, { size: 4, top: 1 }),
    /HB_PORTFOLIO_SIZE/,
  );
  assert.throws(
    () => fitHierarchical(rows, 4, 1, { size: 2, top: 1 }, { budgetMs: -1 }),
    /HB_TIME_BUDGET/,
  );
  const failed = fitHierarchical(
    rows,
    4,
    1,
    { size: 2, top: 1 },
    { warmup: 50, draws: 100 },
  );
  assert.equal(failed.diagnostics.ready, false);
  assert.deepEqual(failed.items, []);
  assert.deepEqual(failed.individual, []);
  assert.equal(failed.portfolio, null);
});
test(
  "four-chain hierarchical estimates are reproducible, preserve individual uncertainty and normalize within the configured list",
  { timeout: 90000 },
  () => {
    const rows = simulatedRespondents(25, [0.7, 0.2, -0.3, -0.6], 123),
      a = fitHierarchical(rows, 4, 987, { size: 2, top: 1 }),
      b = fitHierarchical(rows, 4, 987, { size: 2, top: 1 });
    assert.equal(a.diagnostics.ready, true);
    assert.equal(a.individual.length, 25);
    assert.deepEqual(a.items, b.items);
    assert.deepEqual(a.portfolio, b.portfolio);
    assert.ok(Math.abs(a.items.reduce((s, i) => s + i.mean, 0) - 100) < 1e-8);
    for (const person of a.individual) {
      assert.ok(
        Math.abs(person.scores.reduce((s, i) => s + i.mean, 0) - 100) < 1e-8,
      );
      assert.ok(
        person.scores.every(
          (s) => s.low < s.high && s.low >= 0 && s.high <= 100,
        ),
      );
    }
    assert.ok(a.diagnostics.maxRhat! <= 1.1 && a.diagnostics.minESS >= 50);
    assert.equal(a.portfolio!.candidateCount, 6);
  },
);
test("open/hybrid category validation preserves closed-sort compatibility and rejects duplicate or forged categories", () => {
  const base = cardsortInterview().guide.questions[0].cardsort!;
  assert.ok(cardsortSchema.safeParse(base).success);
  // Legacy closed sorts permitted distinct Unicode encodings of a label.
  // New participant categories must not make those frozen designs unusable.
  assert.deepEqual(
    validateCustomGroups(
      {
        ...base,
        groups: [
          { id: "a", text: "Café" },
          { id: "b", text: "Cafe\u0301" },
        ],
      },
      [],
    ),
    [],
  );
  assert.equal(
    cardsortSchema.safeParse({ ...base, groups: [] }).success,
    false,
  );
  assert.ok(
    cardsortSchema.safeParse({ ...base, mode: "open", groups: [] }).success,
  );
  assert.equal(
    cardsortSchema.safeParse({ ...base, mode: "open" }).success,
    false,
  );
  const own = [{ id: "participant_test-category", text: "My category" }];
  assert.throws(() => validateCustomGroups(base, own));
  assert.throws(() =>
    validateCustomGroups({ ...base, mode: "hybrid" }, [
      ...own,
      { id: "participant_other-category", text: "my category" },
    ]),
  );
  assert.throws(() =>
    validateAssignments(
      { ...base, mode: "hybrid" },
      assignments(["unknown", null, null]),
      true,
      own,
    ),
  );
});
test("participant-defined categories retain original labels, have separate assignment counts and co-sort within each person without semantic merging", () => {
  const people = [0, 1].map((n) => {
    const i = cardsortInterview(),
      q = i.guide.questions[0];
    q.cardsort = { ...q.cardsort!, mode: "open", groups: [], askReason: false };
    i.cardsortStates = {};
    beginCardsort(i, q, (x) => x - 1);
    const own = { id: "participant_category-" + n, text: "Same visible label" };
    i.cardsortStates![q.id].customGroups = [own];
    const result = applyCardsort(i, q, {
      value: assignments([own.id, own.id, null]),
    });
    i.turns.push({
      id: "turn-" + n,
      questionId: q.id,
      prompt: q.text,
      ...result,
      followUp: false,
      createdAt: new Date().toISOString(),
      source: "typed",
      strategy: "guide",
    });
    i.status = "complete";
    assert.ok(result.answer.includes(own.text));
    assert.equal(cardsortPrompt(i, q)!.customGroups![0].text, own.text);
    return i;
  });
  const r = cardsortResults(people)[0];
  assert.equal(r.counts.included, 2);
  assert.equal(r.rows[0].custom, 2);
  assert.equal(r.rows[0].groups.length, 0);
  assert.equal(
    r.pairs.find((p) => p.cardA === "0" && p.cardB === "1")!.percent,
    100,
  );
  assert.equal(
    r.pairs.find((p) => p.cardA === "0" && p.cardB === "2")!.percent,
    null,
  );
  assert.notEqual(
    r.outcomes[0].customGroups[0].id,
    r.outcomes[1].customGroups[0].id,
  );
});
