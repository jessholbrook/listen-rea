import test from "node:test";
import assert from "node:assert/strict";
import { emotionInput, emotionText, emotionCopy } from "../src/lib/emotion";
import { emotionResults } from "../src/lib/emotion-results";
import { emotionInterview, emotionResponse } from "./emotion-fixture";
import { guideSchema } from "../src/lib/domain";
import { compileConceptGuide } from "../src/lib/concepts";
import { structuredAnswer } from "../src/lib/mixed";
test("Feeling check-ins validate explicit optional self-reports without inferring or scoring emotions", () => {
  assert.deepEqual(emotionInput(["frustrated", "2", " A slow process. "]), {
    method: "self-report-v1",
    feeling: "frustrated",
    intensity: 2,
    note: "A slow process.",
  });
  assert.equal(emotionInput(["neutral", "", ""]).intensity, null);
  assert.equal(
    emotionInput(["prefer_not_to_answer", "", ""]).feeling,
    "prefer_not_to_answer",
  );
  for (const v of [
    ["sad", "1", ""],
    ["happy", "4", ""],
    ["neutral", "1", ""],
    ["prefer_not_to_answer", "", "private"],
    ["other", "", "x".repeat(2001)],
    ["happy", "", "", "extra"],
    { feeling: "happy" },
    ["happy", null, ""],
  ])
    assert.throws(() => emotionInput(v));
  const i = emotionInterview(),
    q = i.guide.questions[0];
  assert.equal(guideSchema.safeParse(i.guide).success, true);
  for (const patch of [
    { followUps: 1 },
    { options: [{ id: "x", text: "X" }] },
    { randomizeOptions: true },
    { scale: { min: 1, max: 5, lowLabel: "Low", highLabel: "High" } },
    { task: { maxSeconds: 30 } },
  ])
    assert.equal(
      guideSchema.safeParse({ ...i.guide, questions: [{ ...q, ...patch }] })
        .success,
      false,
    );
});
test("Feeling reference separates reported, declined, missing, invalid and unfinished answers", () => {
  const a = emotionResponse(["frustrated", "2", "Long wait"]),
    b = emotionResponse(["neutral", "", ""]),
    c = emotionResponse(["prefer_not_to_answer", "", ""]),
    active = emotionResponse(["happy", "3", ""]),
    missing = emotionInterview(),
    invalid = emotionResponse(["happy", "1", ""]);
  active.status = "active";
  missing.status = "complete";
  missing.shownQuestions = [];
  invalid.turns[0].answer = "Invented answer";
  const r = emotionResults([a, b, c, active, missing, invalid])[0];
  assert.equal(r.counts.complete, 5);
  assert.equal(r.counts.included, 2);
  assert.equal(r.counts.declined, 1);
  assert.equal(r.counts.notAsked, 1);
  assert.equal(r.counts.invalid, 1);
  assert.equal(r.counts.incomplete, 1);
  assert.equal(r.rows.find((v) => v.feeling === "frustrated")!.percent, 50);
  assert.equal(r.rows.find((v) => v.feeling === "neutral")!.percent, 50);
  assert.deepEqual(
    r.rows
      .find((v) => v.feeling === "frustrated")!
      .intensity.map((v) => v.count),
    [0, 1, 0],
  );
  assert.equal(r.rows.find((v) => v.feeling === "neutral")!.notApplicable, 1);
  assert.ok(emotionResults([c])[0].rows.every((row) => row.percent === null));
  assert.ok(
    !r.rows.some((v) => (v.feeling as string) === "prefer_not_to_answer"),
  );
});
test("Feeling result scopes preserve revisions, concepts, languages, exact segments and source eligibility", () => {
  const a = emotionResponse(["curious", "1", "Tell me more"]),
    b = emotionResponse(["calm", "", ""]);
  b.revisionId = "later";
  b.attributes.segment = "Solo";
  const preview = { ...a, id: "preview", preview: true },
    withdrawn = { ...a, id: "withdrawn", status: "withdrawn" as const },
    excluded = { ...a, id: "excluded", excluded: true };
  const imported = {
    ...a,
    id: "imported",
    origin: {
      kind: "external" as const,
      externalId: "external",
      title: "External",
      importedAt: a.createdAt,
      importedBy: "researcher",
      requestId: "import",
      fingerprint: "external",
      permissionConfirmed: true as const,
      transcriptReviewed: true as const,
    },
  };
  const all = [a, b, preview, withdrawn, excluded, imported];
  assert.equal(emotionResults(all).length, 2);
  assert.equal(
    emotionResults(all, { key: "segment", value: "Team" }).length,
    1,
  );
  assert.equal(
    emotionResults(all, { key: "segment", value: "Missing" }).length,
    0,
  );
  assert.equal(emotionResults(all, undefined, "fr").length, 0);
  a.turns.push({ ...a.turns[0], id: "duplicate" });
  assert.equal(emotionResults([a])[0].counts.invalid, 1);
  assert.equal(emotionResults([]).length, 0);
});
test("Feeling controls and canonical answers retain Spanish/French labels and original notes", () => {
  const report = emotionInput(["frustrated", "3", "El proceso fue lento."]);
  assert.ok(emotionText(report, "es").includes("Frustración"));
  assert.ok(emotionText(report, "fr").includes("Fortement"));
  assert.equal(
    emotionCopy("fr").labels.prefer_not_to_answer,
    "Je préfère ne pas répondre",
  );
  const i = emotionInterview();
  i.language = "es";
  i.guide.localization = {
    sourceLanguage: "es",
    reportingLanguage: "en",
    guidance: "",
    translations: [],
  };
  i.turns = [
    {
      id: "es",
      questionId: "feeling",
      prompt: "¿Cómo te sientes?",
      ...structuredAnswer(i, i.guide.questions[0], {
        value: ["frustrated", "3", "El proceso fue lento."],
      }),
      createdAt: i.createdAt,
      followUp: false,
      source: "typed",
      strategy: "guide",
    },
  ];
  i.status = "complete";
  const r = emotionResults([i], undefined, "es")[0];
  assert.equal(r.counts.included, 1);
  assert.equal(r.outcomes[0].report!.note, "El proceso fue lento.");
  assert.equal(r.languages.find((l) => l.language === "es")!.reported, 1);
});
test("Feeling questions repeat per assigned concept without blending response units", () => {
  const i = emotionInterview();
  i.guide.questions[0].conceptQuestion = true;
  i.guide.conceptTest = {
    concepts: [
      {
        id: "a",
        name: "A",
        headline: "First idea",
        description: "A description",
      },
      {
        id: "b",
        name: "B",
        headline: "Second idea",
        description: "B description",
      },
    ],
    count: 2,
    randomizeOrder: false,
  };
  i.guide = compileConceptGuide(guideSchema.parse(i.guide), () => 0).guide;
  i.turns = i.guide.questions.map((q, n) => ({
    id: String(n),
    questionId: q.id,
    templateQuestionId: q.templateQuestionId,
    conceptId: q.conceptId,
    prompt: q.text,
    ...structuredAnswer(i, q, {
      value: [n ? "uncertain" : "confident", "2", ""],
    }),
    followUp: false,
    source: "typed",
    strategy: "guide",
    createdAt: i.createdAt,
  }));
  i.status = "complete";
  const r = emotionResults([i]);
  assert.equal(r.length, 2);
  assert.deepEqual(
    r.map((v) => v.counts.included),
    [1, 1],
  );
  assert.deepEqual(
    r.map((v) => v.conceptId),
    ["a", "b"],
  );
  assert.ok(r.every((v) => v.questionId === "feeling"));
});
