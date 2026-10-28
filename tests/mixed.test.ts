import test from "node:test";
import assert from "node:assert/strict";
import { guideSchema, type Interview, type Turn } from "../src/lib/domain";
import {
  advanceInterview,
  optionsFor,
  structuredAnswer,
  quantitativeResults,
} from "../src/lib/mixed";
import { mixedGuide } from "./mixed-fixture";
const interview = () =>
  ({
    id: crypto.randomUUID(),
    revisionId: "revision-1",
    guide: mixedGuide(),
    current: 0,
    turns: [],
    status: "active",
    preview: false,
    excluded: false,
    studyId: "study",
    workspaceId: "workspace",
    tokenHash: "fixture",
    createdAt: new Date().toISOString(),
    consentAt: new Date().toISOString(),
    consentVersion: "test",
    prompt: "",
    strategy: "guide",
    attributes: {},
    exclusionReason: "",
    requests: {},
    version: 0,
  }) as Interview;
const answer = (i: Interview, value: unknown) => {
  const q = i.guide.questions[i.current];
  const t = {
    id: crypto.randomUUID(),
    questionId: q.id,
    prompt: q.text,
    ...structuredAnswer(i, q, { value }),
    followUp: false,
  } as Turn;
  i.turns.push(t);
  advanceInterview(i, i.current, () => 0);
  return t;
};
test("mixed guide rejects invalid scales, source cycles, duplicate rankings and incomplete matrices", () => {
  const g = mixedGuide();
  g.questions[1].scale!.max = 20;
  assert.equal(guideSchema.safeParse(g).success, false);
  g.questions[1].scale!.max = 10;
  g.questions[2].carryForward!.questionId = "rank";
  assert.equal(guideSchema.safeParse(g).success, false);
  g.questions[2].carryForward!.questionId = "source";
  g.sections![0].condition.questionId = "remaining";
  assert.equal(guideSchema.safeParse(g).success, false);
  const i = interview();
  advanceInterview(i, -1, () => 0);
  answer(i, ["a", "b"]);
  assert.throws(() =>
    structuredAnswer(i, i.guide.questions[1], { value: "5" }),
  );
  assert.throws(() => structuredAnswer(i, i.guide.questions[1], { value: 11 }));
  answer(i, 0);
  assert.throws(() =>
    structuredAnswer(i, i.guide.questions[2], { value: ["a", "a"] }),
  );
  assert.throws(() =>
    structuredAnswer(i, i.guide.questions[2], { value: ["a"] }),
  );
  answer(i, ["b", "a"]);
  assert.throws(() =>
    structuredAnswer(i, i.guide.questions[3], { value: { speed: 3 } }),
  );
  assert.throws(() =>
    structuredAnswer(i, i.guide.questions[3], {
      value: { speed: 3, clarity: 7 },
    }),
  );
});
test("randomized assignments survive serialization; carry-forward and section conditions use stable answer IDs", () => {
  const i = interview();
  advanceInterview(i, -1, () => 0);
  const order = optionsFor(i, i.guide.questions[0]).map((o) => o.id);
  assert.deepEqual(order, ["b", "c", "a"]);
  const resumed = JSON.parse(JSON.stringify(i));
  advanceInterview(resumed, -1, () => 2);
  assert.deepEqual(
    optionsFor(resumed, resumed.guide.questions[0]).map((o) => o.id),
    order,
  );
  answer(i, ["a", "b"]);
  assert.equal(i.current, 1);
  answer(i, 0);
  assert.deepEqual(
    new Set(optionsFor(i, i.guide.questions[2]).map((o) => o.id)),
    new Set(["a", "b"]),
  );
  answer(i, ["b", "a"]);
  assert.equal(i.current, 3);
  answer(i, { speed: 1, clarity: 5 });
  assert.equal(i.current, 4);
  assert.deepEqual(
    optionsFor(i, i.guide.questions[4]).map((o) => o.id),
    ["c"],
  );
  answer(i, ["c"]);
  assert.equal(i.current, 5);
  const skip = interview();
  advanceInterview(skip, -1);
  answer(skip, ["b", "c"]);
  assert.equal(skip.current, 2);
  answer(skip, ["c", "b"]);
  assert.equal(skip.current, 4);
  assert.ok(!skip.shownQuestions!.includes("matrix"));
  const all = interview();
  advanceInterview(all, -1);
  answer(all, ["a", "b", "c"]);
  answer(all, 5);
  answer(all, ["a", "b", "c"]);
  answer(all, { speed: 2, clarity: 4 });
  assert.equal(all.current, 5, "Empty unselected carry-forward should skip");
});
test("computed results use completed included respondents, exact ranks, per-item exposure and separate revisions", () => {
  const i = interview();
  advanceInterview(i, -1);
  answer(i, ["a", "b"]);
  answer(i, 0);
  answer(i, ["b", "a"]);
  answer(i, { speed: 1, clarity: 5 });
  answer(i, ["c"]);
  i.status = "complete";
  const skipped = interview();
  advanceInterview(skipped, -1);
  answer(skipped, ["b", "c"]);
  answer(skipped, ["c", "b"]);
  answer(skipped, ["a"]);
  skipped.status = "complete";
  const other = { ...i, id: "other", revisionId: "revision-2" };
  const stats = quantitativeResults([
    i,
    skipped,
    { ...i, id: "excluded", excluded: true },
    { ...i, id: "preview", preview: true },
    { ...i, id: "active", status: "active" },
    other,
  ]);
  const r = stats.find(
    (r) => r.revisionId === "revision-1" && r.questionId === "rating",
  )!;
  assert.equal(r.mean, 0);
  assert.equal(r.answered, 1);
  assert.equal(r.notAsked, 1);
  assert.equal(r.missing, 0);
  assert.equal(r.eligible, 2);
  const rank = stats.find(
    (r) => r.revisionId === "revision-1" && r.questionId === "rank",
  )!;
  assert.equal(rank.rows.find((r) => r.id === "b")!.mean, 1.5);
  assert.equal(rank.rows.find((r) => r.id === "a")!.exposed, 1);
  const matrix = stats.find(
    (r) => r.revisionId === "revision-1" && r.questionId === "matrix",
  )!;
  assert.equal(matrix.rows.find((r) => r.id === "clarity")!.mean, 5);
  assert.equal(stats.filter((r) => r.questionId === "rating").length, 2);
});
