import test from "node:test";
import assert from "node:assert/strict";
import {
  sampleTimes,
  verifiedVisualOutput,
  validateObservation,
  verifiedVisualAnswer,
  type VisualSource,
  type VisualObservation,
} from "../src/lib/visual";
const src: VisualSource = {
  mediaId: "media",
  interviewId: "person",
  turnId: "turn",
  revisionId: "rev",
  captureId: null,
  offsetMs: 0,
  durationMs: 4000,
  prompt: "Find support",
  account: "I looked for the help page.",
  origin: "external_video",
  language: "en",
  sourceFingerprint: "source",
};
test("visual proposals use only sampled frames and derive their timestamp from evidence", () => {
  assert.deepEqual(sampleTimes(0, 3000, 3), [500, 1500, 2500]);
  assert.throws(() => sampleTimes(0, 31000, 3), /VISUAL_RANGE/);
  assert.throws(() => sampleTimes(0, 3000, 7), /VISUAL_RANGE/);
  const frames = [
      { id: "frame-1", requestMs: 500, atMs: 500, digest: "one", bytes: 100 },
      { id: "frame-2", requestMs: 2000, atMs: 2000, digest: "two", bytes: 100 },
    ],
    o = {
      description: "A support heading is visible.",
      interpretation: "",
      uncertainty: "Only sampled states are available.",
      tag: "visible_change",
      frameIds: ["frame-1", "frame-2"],
    };
  assert.equal(
    verifiedVisualOutput({ observations: [o] }, frames)[0].atMs,
    2000,
  );
  assert.throws(
    () =>
      verifiedVisualOutput(
        { observations: [{ ...o, frameIds: ["forged"] }] },
        frames,
      ),
    /INVALID_VISUAL_EVIDENCE/,
  );
  assert.throws(
    () =>
      verifiedVisualOutput(
        { observations: [{ ...o, frameIds: ["frame-1"] }] },
        frames,
      ),
    /INVALID_VISUAL_EVIDENCE/,
  );
});
test("visual review validates time, exact participant account and confirmed-only Q&A citations", () => {
  const input = {
    atMs: 2000,
    description: "A support heading is visible.",
    interpretation: "May be relevant to the task.",
    uncertainty: "No click is observable.",
    tag: "visible_content" as const,
    status: "confirmed" as const,
    reviewed: true,
    claim: {
      quote: "looked for the help page",
      relation: "context" as const,
      note: "A post-task written account, not a narration transcript.",
    },
  };
  assert.equal(validateObservation(input, src).atMs, 2000);
  assert.throws(
    () => validateObservation({ ...input, atMs: 4000 }, src),
    /VISUAL_RANGE/,
  );
  assert.throws(
    () => validateObservation({ ...input, reviewed: false }, src),
    /VISUAL_REVIEW/,
  );
  assert.throws(
    () =>
      validateObservation(
        { ...input, claim: { ...input.claim, quote: "I clicked twice" } },
        src,
      ),
    /INVALID_CITATION/,
  );
  const observation = { ...input, id: "observation" } as VisualObservation;
  assert.equal(
    verifiedVisualAnswer(
      {
        answer: "Support is visible.",
        citations: [{ observationId: "observation", quote: "support heading" }],
      },
      [observation],
    ).citations.length,
    1,
  );
  assert.throws(
    () =>
      verifiedVisualAnswer(
        {
          answer: "",
          citations: [
            { observationId: "observation", quote: "support heading" },
          ],
        },
        [{ ...observation, status: "pending" }],
      ),
    /INVALID_VISUAL_EVIDENCE/,
  );
  assert.throws(
    () =>
      verifiedVisualAnswer(
        {
          answer: "",
          citations: [{ observationId: "foreign", quote: "support heading" }],
        },
        [observation],
      ),
    /INVALID_VISUAL_EVIDENCE/,
  );
});

test("screen-state questions reject unsupported behavioral metrics in supported languages", async () => {
  const { unsupportedVisualQuestion } = await import("../src/lib/visual");
  for (const question of [
    "How many clicks did they make?",
    "Did they succeed at the task?",
    "How long did the task take?",
    "Combien de clics ?",
    "Quel est le taux de réussite ?",
    "¿Cuántos clics hizo?",
    "¿Cuál fue el éxito de la tarea?",
  ])
    assert.equal(unsupportedVisualQuestion(question), true, question);
  for (const question of [
    "Which heading is visible?",
    "Quel bouton est visible ?",
    "¿Qué título aparece?",
  ])
    assert.equal(unsupportedVisualQuestion(question), false, question);
});
