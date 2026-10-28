import test from "node:test";
import assert from "node:assert/strict";
import { guideSchema, type Turn } from "../src/lib/domain";
import {
  beginCardsort,
  cardsortPrompt,
  validateAssignments,
  applyCardsort,
  cardsortFormAssignments,
  cardsortCopy,
} from "../src/lib/cardsort";
import { cardsortResults } from "../src/lib/cardsort-results";
import { guideFields, applyFields } from "../src/lib/localization";
import {
  cardsortInterview,
  completeCardsort,
  assignments,
} from "./cardsort-fixture";
import { compileConceptGuide } from "../src/lib/concepts";
import { advanceInterview } from "../src/lib/mixed";
test("card-sort schema and assignments require unique known cards/groups and explicit uncertainty", () => {
  const i = cardsortInterview(),
    q = i.guide.questions[0],
    c = q.cardsort!;
  assert.equal(guideSchema.safeParse(i.guide).success, true);
  for (const bad of [
    [{ cardId: "0", groupId: "missing" }],
    [{ cardId: "missing", groupId: "team" }],
    [
      { cardId: "0", groupId: "team" },
      { cardId: "0", groupId: "research" },
    ],
  ])
    assert.throws(() => validateAssignments(c, bad, false));
  assert.throws(() => validateAssignments(c, assignments(["team"]), true));
  assert.equal(validateAssignments(c, assignments(["team"]), false).length, 1);
  c.allowUncertain = false;
  assert.throws(() =>
    validateAssignments(c, assignments([null, "team", "research"]), true),
  );
  c.allowUncertain = true;
  c.groups[1].text = c.groups[0].text;
  assert.equal(guideSchema.safeParse(i.guide).success, false);
  c.groups[1].text = "Research";
  q.followUps = 1;
  assert.equal(guideSchema.safeParse(i.guide).success, false);
});
test("saved randomized order/drafts resume unchanged, arbitrary IDs are safe, and confirmation is immutable", () => {
  const i = cardsortInterview(),
    q = i.guide.questions[0];
  i.cardsortStates!.sort.draft = assignments(["team"]);
  const restored = JSON.parse(JSON.stringify(i));
  beginCardsort(restored, restored.guide.questions[0], () => 0);
  assert.deepEqual(restored.cardsortStates, i.cardsortStates);
  assert.deepEqual(
    cardsortFormAssignments(cardsortPrompt(restored, q), undefined),
    assignments(["team"]),
  );
  q.cardsort!.groups[0].id = "unsure";
  const p = cardsortPrompt(i, q)!;
  const values = p.cards.map((_, n) => (n === 0 ? "group:unsure" : "unsure"));
  const decoded = cardsortFormAssignments(p, values);
  assert.equal(decoded[0].groupId, "unsure");
  assert.equal(decoded[1].groupId, null);
  q.cardsort!.groups[0].id = "team";
  const result = applyCardsort(i, q, {
    value: assignments(["team", "team", "research"]),
    answer: "forged",
  });
  assert.ok(!result.answer.includes("forged"));
  assert.equal(i.cardsortStates!.sort.phase, "reason");
  assert.throws(() =>
    applyCardsort(i, q, {
      value: assignments(["team", "team", "team"]),
      answer: "",
    }),
  );
  applyCardsort(i, q, { answer: "skip" });
  assert.throws(() => applyCardsort(i, q, { answer: "changed" }));
  q.id = "__proto__";
  i.cardsortStates = {};
  beginCardsort(i, q, () => 0);
  assert.ok(Object.hasOwn(i.cardsortStates, q.id));
});
test("hand-calculated assignment and co-sort denominators keep uncertainty separate from shared categories", () => {
  const people = [
    completeCardsort(assignments(["team", "team", "research"])),
    completeCardsort(assignments(["team", "research", null])),
    completeCardsort(assignments([null, null, "research"])),
  ];
  const incomplete = cardsortInterview(),
    notAsked = cardsortInterview(),
    preview = completeCardsort(assignments(["team", "team", "team"])),
    excluded = completeCardsort(assignments(["team", "team", "team"]));
  notAsked.cardsortStates = undefined;
  preview.preview = true;
  excluded.excluded = true;
  const r = cardsortResults([
    ...people,
    incomplete,
    notAsked,
    preview,
    excluded,
  ])[0];
  assert.equal(r.counts.included, 3);
  assert.equal(r.counts.incomplete, 1);
  assert.equal(r.counts.notAsked, 1);
  assert.deepEqual(
    r.rows.map((c) => [c.groups[0].count, c.groups[1].count, c.uncertain]),
    [
      [2, 0, 1],
      [1, 1, 1],
      [0, 2, 1],
    ],
  );
  for (const card of r.rows)
    assert.equal(
      card.groups.reduce((s, g) => s + g.count, card.uncertain),
      3,
    );
  const pair = r.pairs.find((p) => p.cardA === "0" && p.cardB === "1")!;
  assert.deepEqual(
    [pair.together, pair.bothAssigned, pair.percent],
    [1, 2, 50],
  );
  assert.equal(
    r.pairs.find((p) => p.cardA === "0" && p.cardB === "2")!.percent,
    0,
  );
  const allUncertain = cardsortResults([
    completeCardsort(assignments([null, null, null])),
  ])[0];
  assert.ok(allUncertain.rows.every((c) => c.uncertain === 1));
  assert.ok(
    allUncertain.pairs.every((p) => p.bothAssigned === 0 && p.percent === null),
  );
  const empty = cardsortResults([cardsortInterview()])[0];
  assert.ok(empty.rows.every((c) => c.groups.every((g) => g.percent === null)));
  people[0].attributes.segment = "Solo";
  assert.equal(
    cardsortResults(people, { key: "segment", value: "Solo" })[0].counts
      .included,
    1,
  );
  people[0].revisionId = "revision-2";
  assert.equal(cardsortResults(people).length, 2);
});
test("translated card/group labels preserve IDs and repeated concepts have independent sort state and results", () => {
  const i = cardsortInterview(),
    q = i.guide.questions[0];
  const translated = applyFields(
    i.guide,
    guideFields(i.guide).map((f) => ({
      key: f.key,
      text: f.label.includes("card sort") ? "FR " + f.text : f.text,
    })),
  );
  assert.ok(
    translated.questions[0].cardsort!.cards.every((c) =>
      c.text.startsWith("FR "),
    ),
  );
  assert.deepEqual(
    translated.questions[0].cardsort!.groups.map((g) => g.id),
    q.cardsort!.groups.map((g) => g.id),
  );
  assert.equal(cardsortCopy("es").choose, "Elige un grupo");
  q.conceptQuestion = true;
  i.guide.conceptTest = {
    concepts: [
      { id: "a", name: "A", headline: "A", description: "First concept" },
      { id: "b", name: "B", headline: "B", description: "Second concept" },
    ],
    count: 2,
    randomizeOrder: false,
  };
  i.guide = compileConceptGuide(i.guide, () => 0).guide;
  i.cardsortStates = {};
  i.turns = [];
  advanceInterview(i, -1, () => 0);
  while (i.current < i.guide.questions.length) {
    const q = i.guide.questions[i.current];
    for (const input of [
      { value: assignments(["team", "research", null]), answer: "" },
      { answer: "skip" },
    ]) {
      const result = applyCardsort(i, q, input);
      i.turns.push({
        id: crypto.randomUUID(),
        questionId: q.id,
        prompt: i.prompt,
        ...result,
      } as Turn);
    }
    advanceInterview(i, i.current, () => 0);
  }
  i.status = "complete";
  const r = cardsortResults([i]);
  assert.equal(r.length, 2);
  assert.deepEqual(new Set(r.map((x) => x.conceptId)), new Set(["a", "b"]));
  assert.ok(r.every((x) => x.counts.included === 1));
});
