import test from "node:test";
import assert from "node:assert/strict";
import { guideSchema, type Interview, type Turn } from "../src/lib/domain";
import {
  compileConceptGuide,
  scopeInterviews,
  conceptScopes,
} from "../src/lib/concepts";
import {
  advanceInterview,
  structuredAnswer,
  quantitativeResults,
} from "../src/lib/mixed";
import { publicInterview } from "../src/lib/http";
import { conceptGuide } from "./concept-fixture";
const make = () => {
  const result = compileConceptGuide(conceptGuide(), () => 0);
  return {
    id: "fixture",
    studyId: "study",
    workspaceId: "workspace",
    revisionId: "rev1",
    guide: result.guide,
    conceptAssignments: result.assignments,
    current: 0,
    prompt: "",
    turns: [],
    status: "active",
    preview: false,
    excluded: false,
    tokenHash: "test",
    createdAt: "now",
    consentAt: "now",
    consentVersion: "test",
    strategy: "guide",
    attributes: {},
    exclusionReason: "",
    requests: {},
    version: 0,
  } as Interview;
};
test("concept validation rejects scattered blocks, duplicate IDs, oversampling and dependencies escaping the block", () => {
  const g = conceptGuide();
  g.questions[2].conceptQuestion = false;
  assert.equal(guideSchema.safeParse(g).success, false);
  g.questions[2].conceptQuestion = true;
  g.conceptTest!.count = 3;
  assert.equal(guideSchema.safeParse(g).success, false);
  g.conceptTest!.count = 2;
  g.conceptTest!.concepts[1].id = "alpha";
  assert.equal(guideSchema.safeParse(g).success, false);
  g.conceptTest!.concepts[1].id = "beta";
  g.questions.at(-1)!.condition = { questionId: "features", optionId: "a" };
  assert.equal(guideSchema.safeParse(g).success, false);
  g.questions.at(-1)!.condition = null;
  g.conceptTest!.concepts[0].imageUrl = "https://example.test/a.png";
  assert.equal(guideSchema.safeParse(g).success, false);
  g.conceptTest!.concepts[0].imageAlt = "An accessible concept illustration";
  assert.equal(guideSchema.safeParse(g).success, true);
});
test("assignment samples without replacement, preserves source guides and rewrites per-concept routing and carry-forward", () => {
  const g = conceptGuide(),
    original = structuredClone(g);
  const result = compileConceptGuide(g, () => 0);
  assert.deepEqual(g, original);
  assert.deepEqual(result.assignments, ["beta", "alpha"]);
  assert.equal(result.guide.questions.length, 10);
  assert.equal(new Set(result.guide.questions.map((q) => q.id)).size, 10);
  for (const id of result.assignments!) {
    const qs = result.guide.questions.filter((q) => q.conceptId === id),
      rank = qs.find((q) => q.templateQuestionId === "rank")!,
      source = qs.find((q) => q.templateQuestionId === "features")!;
    assert.equal(rank.carryForward!.questionId, source.id);
    assert.equal(
      result.guide.sections!.find((s) => s.name === rank.section)!.condition
        .questionId,
      source.id,
    );
  }
  const collision = structuredClone(g);
  collision.questions[0].id = JSON.stringify(["concept", "beta", "interest"]);
  collision.questions[0].section = "Questions · Concept 1";
  const compiled = compileConceptGuide(collision, () => 0);
  assert.equal(
    new Set(compiled.guide.questions.map((q) => q.id)).size,
    compiled.guide.questions.length,
  );
  g.conceptTest!.count = 1;
  const single = compileConceptGuide(g, () => 0);
  assert.equal(single.assignments!.length, 1);
  assert.equal(single.guide.conceptTest!.concepts.length, 1);
  assert.ok(
    single.guide.questions
      .filter((q) => q.conceptQuestion)
      .every((q) => q.conceptId === single.assignments![0]),
  );
  g.conceptTest!.count = 2;
  g.conceptTest!.randomizeOrder = false;
  assert.deepEqual(compileConceptGuide(g, () => 0).assignments, [
    "alpha",
    "beta",
  ]);
});
test("concept answers, measurements and analysis scopes remain separate across repeats and refresh", () => {
  const i = make();
  advanceInterview(i, -1);
  while (i.current < i.guide.questions.length) {
    const q = i.guide.questions[i.current];
    let data: Partial<Turn>;
    if (q.type === "open")
      data = {
        answer:
          q.conceptId === "alpha"
            ? "Alpha feels useful."
            : q.conceptId === "beta"
              ? "Beta feels confusing."
              : "Shared context.",
      };
    else if (q.type === "rating")
      data = structuredAnswer(i, q, { value: q.conceptId === "alpha" ? 5 : 1 });
    else if (q.type === "multiple")
      data = structuredAnswer(i, q, {
        value: q.conceptId === "alpha" ? ["a", "b"] : ["b"],
      });
    else if (q.type === "ranking")
      data = structuredAnswer(i, q, { value: ["b", "a"] });
    else data = { answer: "Continued" };
    i.turns.push({
      id: crypto.randomUUID(),
      questionId: q.id,
      conceptId: q.conceptId,
      templateQuestionId: q.templateQuestionId,
      prompt: q.text,
      ...data,
      followUp: false,
    } as Turn);
    advanceInterview(i, i.current, () => 0);
  }
  i.status = "complete";
  const ratings = quantitativeResults([i]).filter((r) => r.type === "rating");
  assert.equal(ratings.length, 2);
  assert.equal(ratings.find((r) => r.conceptId === "alpha")!.mean, 5);
  assert.equal(ratings.find((r) => r.conceptId === "beta")!.mean, 1);
  assert.equal(
    i.turns.filter((t) => t.templateQuestionId === "rank").length,
    1,
    "The other concept must not reuse the first selection for routing",
  );
  const scoped = scopeInterviews([i], {
    revisionId: "rev1",
    conceptId: "beta",
  });
  assert.ok(scoped[0].turns.every((t) => t.conceptId === "beta"));
  assert.equal(scopeInterviews([i])[0].turns.length, 2);
  assert.equal(
    scopeInterviews([i], { revisionId: "wrong", conceptId: "alpha" }).length,
    0,
  );
  assert.equal(
    conceptScopes([i]).find((c) => c.conceptId === "beta")!.completed,
    1,
  );
  assert.equal(conceptScopes([{ ...i, excluded: true }]).length, 0);
  const resumed = JSON.parse(JSON.stringify(i));
  assert.deepEqual(resumed.conceptAssignments, i.conceptAssignments);
  assert.deepEqual(resumed.guide, i.guide);
});
test("participant payloads disclose only the current assigned stimulus", () => {
  const i = make();
  advanceInterview(i, -1);
  assert.equal(publicInterview(i, true).guide.conceptTest!.concepts.length, 0);
  i.current = 1;
  assert.equal(publicInterview(i, true).guide.conceptTest!.concepts.length, 1);
  assert.equal(
    publicInterview(i, true).guide.conceptTest!.concepts[0].id,
    "beta",
  );
  assert.equal(publicInterview(i, true).conceptAssignments, undefined);
  assert.equal(publicInterview(i).guide.conceptTest!.concepts.length, 2);
});
