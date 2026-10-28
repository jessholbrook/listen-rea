import test from "node:test";
import assert from "node:assert/strict";
import {
  includedPPTXObservationAnswers,
  validatePPTXObservationAnswerEvidence,
  pptxObservationAnswersText,
  type SavedPPTXObservationAnswer,
} from "../src/lib/pptx-observation-answers";
const source: any = {
  pptxId: "pptx",
  reviewVersion: 2,
  source: "hash",
  probeSource: "probe",
  notes: "Readable page",
  correction: "Ask without assuming success.",
  grounding: "unsupported",
  reviewerName: "Source reviewer",
};
const saved = (): SavedPPTXObservationAnswer => ({
  id: "answer",
  original: {
    question: "What should change?",
    answer: "Private original text",
    citations: [
      {
        pptxId: "pptx",
        reviewVersion: 2,
        field: "correction",
        quote: "without assuming success",
      },
    ],
    model: "synthetic",
    promptVersion: "v1",
    generatedAt: "then",
  },
  sources: [source],
  history: [
    {
      version: 1,
      answer: "Private original text",
      citations: [],
      reviewed: false,
      includeInReports: false,
      editor: { id: "r", name: "Saver" },
      at: "then",
    },
    {
      version: 2,
      answer: "Reviewed wording",
      citations: [
        {
          pptxId: "pptx",
          reviewVersion: 2,
          field: "correction",
          quote: "without assuming success",
        },
      ],
      reviewed: true,
      includeInReports: true,
      editor: { id: "r", name: "Reviewer" },
      at: "now",
    },
  ],
});
test("Only latest reviewed opt-in answers become projections; frozen sources and exact field citations remain required", () => {
  const s = saved(),
    p = includedPPTXObservationAnswers([s], [source]);
  assert.equal(p.length, 1);
  assert.equal(p[0].reviewerName, "Reviewer");
  assert.equal(p[0].edited, true);
  assert.ok(!JSON.stringify(p).includes("Private original text"));
  assert.equal((p[0] as any).history, undefined);
  validatePPTXObservationAnswerEvidence(p, [source]);
  s.history.at(-1)!.includeInReports = false;
  assert.deepEqual(includedPPTXObservationAnswers([s], [source]), []);
  s.history.at(-1)!.includeInReports = true;
  s.history.at(-1)!.reviewed = false;
  assert.throws(() => includedPPTXObservationAnswers([s], [source]));
  assert.throws(() =>
    includedPPTXObservationAnswers(
      [saved()],
      [{ ...source, reviewVersion: 3 }],
    ),
  );
  assert.throws(() =>
    includedPPTXObservationAnswers(
      [saved()],
      [{ ...source, reviewerName: "Changed source attribution" }],
    ),
  );
  const bad = saved();
  bad.history.at(-1)!.citations[0].field = "notes";
  assert.throws(() => includedPPTXObservationAnswers([bad], [source]));
});
test("Reviewed PPTX Q&A exports localize labels, preserve question/quotes and omit private revision history", () => {
  const p = includedPPTXObservationAnswers([saved()], [source]);
  assert.ok(
    pptxObservationAnswersText(p, "es").includes(
      "Respuesta revisada: Reviewed wording",
    ),
  );
  assert.ok(
    pptxObservationAnswersText(p, "fr").includes(
      "Correction du chercheur: “without assuming success”",
    ),
  );
  assert.ok(!pptxObservationAnswersText(p).includes("Private original text"));
  assert.equal(pptxObservationAnswersText(undefined), "");
});
