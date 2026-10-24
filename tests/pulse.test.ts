import { test } from "node:test";
import assert from "node:assert/strict";
import { pulseFixture } from "./pulse-fixture";
import { designWarnings, pulseWaveResults, pulseCodes } from "../src/lib/pulse";
import { settings } from "../src/lib/localization";
test("Pulse reference has valid-answer KPI and participant coding denominators, never unreviewed absence", () => {
  const f = pulseFixture(),
    a = f.interview("a", 8),
    b = f.interview("b", 4, false),
    c = f.interview("c", 6);
  c.turns = c.turns.filter((t) => t.questionId !== "rating");
  a.guide.localization = { ...settings(a.guide), translations: [] };
  const ra = f.review(a),
    rb = f.review(b, false);
  ra.assignments.push({ codeId: "cost", turnId: a.id + "-choice" });
  const r = pulseWaveResults(
    f.series,
    f.wave,
    f.study,
    f.revision,
    [a, b, c],
    [ra, rb],
  );
  assert.equal(r.metrics[0].mean, 6);
  assert.equal(r.metrics[0].denominator, 2);
  assert.equal(r.metrics[0].missing, 1);
  assert.equal(r.metrics[1].options[0].count, 2);
  assert.equal(r.metrics[1].denominator, 3);
  assert.equal(r.themes[0].count, 1);
  assert.equal(r.themes[0].denominator, 2);
  assert.equal(r.themes[0].percent, 50);
  assert.equal(r.counts.unreviewed, 1);
  assert.equal(r.comparable, false);
  assert.deepEqual(r.warnings, [
    "Coding is incomplete for the current codebook version.",
  ]);
});
test("Pulse baseline tolerates trailing timely questions and flags design, audience, routing, language and moderation drift", () => {
  const f = pulseFixture(),
    g = structuredClone(f.guide);
  g.title = "Wave 2";
  g.limit = 50;
  g.questions.push({
    ...g.questions[2],
    id: "timely",
    text: "What did you think of yesterday’s campaign?",
  });
  assert.deepEqual(designWarnings(f.guide, g), []);
  for (const mutate of [
    () => {
      g.questions[0].text += " today";
    },
    () => {
      g.audience += " in France";
    },
    () => {
      g.questions.reverse();
    },
    () => {
      g.questions[0].followUps = 1;
    },
    () => {
      g.localization = { ...settings(g), sourceLanguage: "fr" };
    },
  ]) {
    mutate();
    assert.ok(designWarnings(f.guide, g).length > 0);
  }
  const i = f.interview("a", 7),
    r = pulseWaveResults(
      f.series,
      { ...f.wave, recruitment: "New panel" },
      { ...f.study, researchGuidelines: "New moderation" },
      f.revision,
      [i],
      [f.review(i)],
    );
  assert.equal(r.comparable, false);
  assert.ok(r.warnings.some((v) => v.includes("Recruitment")));
  assert.ok(r.warnings.some((v) => v.includes("guidelines")));
});
test("Pulse omits old revisions, exclusions, imports, previews, withdrawn and deleted sources; reviews are source/version bound", () => {
  const f = pulseFixture(),
    a = f.interview("a", 8),
    b = f.interview("b", 0),
    old = f.interview("old", 0),
    active = f.interview("active", 0);
  old.revisionId = "old";
  active.status = "active";
  b.excluded = true;
  const preview = { ...a, id: "preview", preview: true },
    withdrawn = { ...a, id: "withdrawn", status: "withdrawn" as const };
  const r = pulseWaveResults(
    f.series,
    f.wave,
    f.study,
    f.revision,
    [a, b, old, active, preview, withdrawn],
    [f.review(a), f.review(b)],
  );
  assert.equal(r.counts.included, 1);
  assert.equal(r.counts.otherRevisions, 1);
  assert.equal(r.counts.incomplete, 1);
  assert.equal(r.metrics[0].mean, 8);
  assert.equal(r.themes[0].denominator, 1);
  assert.equal(
    pulseWaveResults(f.series, f.wave, f.study, f.revision, [], [f.review(a)])
      .themes[0].evidence.length,
    0,
  );
  a.version++;
  assert.equal(
    pulseWaveResults(
      f.series,
      f.wave,
      f.study,
      f.revision,
      [a],
      [f.review({ ...a, version: 3 })],
    ).counts.reviewed,
    0,
  );
  const empty = pulseWaveResults(
    f.series,
    f.wave,
    f.study,
    f.revision,
    [a],
    [],
    { key: "segment", value: "Other" },
  );
  assert.equal(empty.metrics[0].mean, null);
  assert.equal(empty.themes[0].percent, null);
  assert.equal(empty.comparable, false);
});
test("Pulse codebook revisions require explicit recoding and retain prior definitions", () => {
  const f = pulseFixture(),
    a = f.interview("a", 8),
    review = f.review(a);
  f.series.codebooks.push({
    version: 2,
    createdAt: "2026-10-20",
    codes: [
      {
        id: "cost",
        name: "Cost concern",
        definition: "Only unaffordable prices.",
      },
    ],
  });
  const r = pulseWaveResults(
    f.series,
    f.wave,
    f.study,
    f.revision,
    [a],
    [review],
  );
  assert.equal(r.codebookVersion, 2);
  assert.equal(r.themes[0].denominator, 0);
  assert.ok(r.warnings.some((w) => w.includes("Prior codebook")));
  f.series.codebooks.push({ version: 3, createdAt: "2026-10-21", codes: [] });
  const noCoding = pulseWaveResults(
    f.series,
    f.wave,
    f.study,
    f.revision,
    [a],
    [review],
  );
  assert.equal(
    noCoding.comparable,
    true,
    "Removing all theme codes leaves quantitative comparisons available",
  );
  assert.deepEqual(noCoding.themes, []);
  assert.equal(
    pulseCodes.safeParse([
      { id: "x", name: "A", definition: "abc" },
      { id: "x", name: "B", definition: "xyz" },
    ]).success,
    false,
  );
});

test("Pulse flags appended screeners and rejects invalid or cross-source coding references", () => {
  const f = pulseFixture(),
    g = structuredClone(f.guide),
    i = f.interview("a", 8);
  g.questions.push({
    ...g.questions[1],
    id: "timely-screener",
    options: [{ id: "no", text: "No", rejects: true }],
  });
  assert.ok(designWarnings(f.guide, g).some((s) => s.includes("screen out")));
  const review = f.review(i);
  review.assignments[0].turnId = "deleted-turn";
  const r = pulseWaveResults(
    f.series,
    f.wave,
    f.study,
    f.revision,
    [i],
    [review],
  );
  assert.equal(r.counts.reviewed, 0);
  assert.deepEqual(r.themes[0].evidence, []);
});
