import test from "node:test";
import assert from "node:assert/strict";
import { conceptGuide } from "./concept-fixture";
import { templateGuide, guideSchema } from "../src/lib/domain";
import {
  adviseGuide,
  applyAudience,
  audienceSchema,
} from "../src/lib/workflow";

test("saved audience routing is self-contained, remapped, and preserves destination concept routing", () => {
  const source = templateGuide("Audience source"),
    first = structuredClone(source.questions[0]);
  const second = {
    ...structuredClone(first),
    id: "follow",
    text: "Which team are you on?",
    condition: { questionId: first.id, optionId: "yes" },
  };
  second.section = "Conditional screener";
  const audience = audienceSchema.parse({
    name: "Research teams",
    description: source.audience,
    questions: [first, second],
    sections: [
      {
        name: second.section,
        condition: { questionId: first.id, optionId: "yes" },
      },
    ],
  });
  assert.equal(
    audienceSchema.safeParse({ ...audience, questions: [second] }).success,
    false,
  );
  assert.equal(
    audienceSchema.safeParse({ ...audience, questions: [source.questions[1]] })
      .success,
    false,
  );
  const destination = conceptGuide(),
    before = structuredClone(destination);
  let n = 0;
  const result = applyAudience(destination, audience, () => "imported-" + ++n);
  assert.equal(
    result.questions[1].condition?.questionId,
    result.questions[0].id,
  );
  assert.notEqual(result.questions[0].id, first.id);
  assert.equal(
    result.sections?.[0].condition.questionId,
    result.questions[0].id,
  );
  assert.equal(result.sections?.[0].name, result.questions[1].section);
  assert.deepEqual(result.questions.slice(2), destination.questions);
  assert.deepEqual(destination, before);
  assert.ok(guideSchema.safeParse(result).success);
});

test("advisor distinguishes invalid configuration from wording suggestions without editing the guide", () => {
  const g = templateGuide("Advisor review");
  g.questions[1].text = "Don't you agree this is useful? And why?";
  g.questions[2].text = g.questions[1].text;
  g.questions[3].condition = { questionId: "missing", optionId: "missing" };
  const before = structuredClone(g),
    advice = adviseGuide(g);
  assert.ok(
    advice.some(
      (a) => a.level === "error" && a.questionId === g.questions[3].id,
    ),
  );
  assert.ok(advice.some((a) => a.id === "leading-" + g.questions[1].id));
  assert.ok(advice.some((a) => a.id === "compound-" + g.questions[1].id));
  assert.ok(advice.some((a) => a.id === "repeat-" + g.questions[2].id));
  assert.deepEqual(g, before);
});
