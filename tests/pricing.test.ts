import test from "node:test";
import assert from "node:assert/strict";
import { guideSchema } from "../src/lib/domain";
import {
  beginPricing,
  pricingResults,
  pricingSchema,
  pricingInput,
  pricingCopy,
  pricingPrompt,
} from "../src/lib/pricing";
import { pricingInterview, runPricing } from "./pricing-fixture";
import { guideFields, applyFields } from "../src/lib/localization";
test("pricing validates ordered minor-unit ladders and isolates them from incompatible guide settings", () => {
  for (const prices of [
    [100, 100, 200],
    [200, 100, 300],
    [0, 100, 200],
    [1.5, 100, 200],
    [100, 200],
  ])
    assert.equal(
      pricingSchema.safeParse({ prices, currency: "USD", unit: "per month" })
        .success,
      false,
    );
  const i = pricingInterview();
  assert.equal(guideSchema.safeParse(i.guide).success, true);
  i.guide.questions[0].followUps = 1;
  assert.equal(guideSchema.safeParse(i.guide).success, false);
  i.guide.questions[0].followUps = 0;
  i.guide.questions[0].pricing!.currency = "JPY" as any;
  assert.equal(guideSchema.safeParse(i.guide).success, false);
});
test("all starting prices and boundaries terminate, persist on resume and preserve nonbuyers and top censoring", () => {
  for (const count of [3, 12])
    for (let highest = -1; highest < count; highest++)
      for (let start = 0; start < count; start++) {
        const i = runPricing(highest, start, true, false, count),
          s = i.pricingStates!.price;
        assert.equal(s.highest, highest);
        assert.equal(s.inconsistent, false);
        assert.equal(s.events.filter((e) => e.phase === "check").length, 1);
        assert.ok(s.events.length <= count + 1);
        const r = pricingResults([i])[0];
        assert.equal(r.counts.denominator, 1);
        assert.equal(r.counts.nonbuyers, highest < 0 ? 1 : 0);
        assert.equal(r.counts.aboveRange, highest === count - 1 ? 1 : 0);
        assert.deepEqual(
          r.points.map((p) => p.buyers),
          Array.from({ length: count }, (_, n) => (n <= highest ? 1 : 0)),
        );
      }
  const i = pricingInterview(2),
    restored = JSON.parse(JSON.stringify(i));
  beginPricing(restored, restored.guide.questions[0], () => 0);
  assert.equal(restored.pricingStates.price.start, 2);
  assert.deepEqual(
    pricingPrompt(restored, restored.guide.questions[0]),
    pricingPrompt(i, i.guide.questions[0]),
  );
  assert.throws(() =>
    pricingInput(i, i.guide.questions[0], { optionId: "maybe" }),
  );
});
test("hand-calculated reference demand/revenue retains nonbuyers and separates inconsistent, incomplete and unasked outcomes", () => {
  // Independent full response matrix: [N,N,N], [Y,N,N], [Y,Y,N], [Y,Y,Y].
  // Demand [3/4,2/4,1/4], price*demand [$7.50,$10,$7.50].
  const included = [-1, 0, 1, 2].map((h, n) => runPricing(h, n % 3));
  const inconsistent = runPricing(1, 2, true, true),
    incomplete = pricingInterview(),
    notAsked = pricingInterview();
  notAsked.pricingStates = undefined;
  const preview = runPricing(2);
  preview.preview = true;
  const excluded = runPricing(2);
  excluded.excluded = true;
  const r = pricingResults([
    ...included,
    inconsistent,
    incomplete,
    notAsked,
    preview,
    excluded,
  ])[0];
  assert.equal(r.counts.denominator, 4);
  assert.equal(r.counts.nonbuyers, 1);
  assert.equal(r.counts.inconsistent, 1);
  assert.equal(r.counts.incomplete, 1);
  assert.equal(r.counts.notAsked, 1);
  assert.deepEqual(
    r.points.map((p) => p.demand),
    [0.75, 0.5, 0.25],
  );
  assert.deepEqual(
    r.points.map((p) => p.revenuePerRespondentMinor),
    [750, 1000, 750],
  );
  assert.deepEqual(r.revenueMaxPrices, [2000]);
  for (const p of r.points) {
    assert.equal(p.observedYes + p.inferredYes, p.buyers);
    assert.equal(p.observedNo + p.inferredNo, p.denominator - p.buyers);
  }
  assert.equal(
    r.outcomes.find((o) => o.interviewId === inconsistent.id)!.highestMinor,
    null,
  );
  const other = runPricing(2);
  other.attributes.segment = "Solo";
  assert.equal(
    pricingResults([...included, other], { key: "segment", value: "Solo" })[0]
      .counts.denominator,
    1,
  );
  other.revisionId = "revision-2";
  assert.equal(pricingResults([...included, other]).length, 2);
  const nonbuyer = pricingResults([runPricing(-1)])[0];
  assert.deepEqual(nonbuyer.revenueMaxPrices, []);
  assert.ok(nonbuyer.points.every((p) => p.demand === 0));
  const empty = pricingResults([pricingInterview()])[0];
  assert.ok(
    empty.points.every(
      (p) => p.demand === null && p.revenuePerRespondentMinor === null,
    ),
  );
  // Two-person reference matrix: [Y,N,N], [Y,Y,N] gives a $10/$20 revenue tie.
  assert.deepEqual(
    pricingResults([runPricing(0), runPricing(1)])[0].revenueMaxPrices,
    [1000, 2000],
  );
});
test("pricing units translate separately while numeric design stays fixed", () => {
  const i = pricingInterview(),
    fields = guideFields(i.guide).map((f) => ({
      key: f.key,
      text: f.label.includes("price unit") ? "par mois" : f.text,
    }));
  const translated = applyFields(i.guide, fields);
  assert.equal(translated.questions[0].pricing!.unit, "par mois");
  assert.deepEqual(translated.questions[0].pricing!.prices, [1000, 2000, 3000]);
  assert.equal(pricingCopy("es").yes, "Sí");
  assert.equal(pricingCopy("fr").yes, "Oui");
});

test("pricing handles reserved question IDs and independent concept ladders", async () => {
  const { compileConceptGuide } = await import("../src/lib/concepts");
  const { applyPricing } = await import("../src/lib/pricing");
  const { advanceInterview } = await import("../src/lib/mixed");
  const i = pricingInterview();
  i.guide.questions[0].id = "__proto__";
  i.pricingStates = {};
  beginPricing(i, i.guide.questions[0], () => 0);
  assert.equal(Object.hasOwn(i.pricingStates, "__proto__"), true);
  assert.equal(JSON.parse(JSON.stringify(i)).pricingStates.__proto__.start, 0);
  i.guide.questions[0].id = "price";
  i.guide.questions[0].conceptQuestion = true;
  i.guide.conceptTest = {
    concepts: [
      { id: "a", name: "A", headline: "A", description: "First offer" },
      { id: "b", name: "B", headline: "B", description: "Second offer" },
    ],
    count: 2,
    randomizeOrder: false,
  };
  i.guide = compileConceptGuide(i.guide, () => 0).guide;
  i.pricingStates = {};
  i.turns = [];
  advanceInterview(i, -1, () => 0);
  while (i.current < i.guide.questions.length) {
    const q = i.guide.questions[i.current];
    while (i.pricingStates![q.id].phase !== "done")
      applyPricing(i, q, { optionId: "yes", answer: "skip" });
    advanceInterview(i, i.current, () => 0);
  }
  i.status = "complete";
  const r = pricingResults([i]);
  assert.equal(r.length, 2);
  assert.deepEqual(new Set(r.map((x) => x.conceptId)), new Set(["a", "b"]));
  assert.ok(
    r.every((x) => x.counts.denominator === 1 && x.counts.aboveRange === 1),
  );
});
