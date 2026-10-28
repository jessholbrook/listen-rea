import test from "node:test";
import assert from "node:assert/strict";
import {
  includedPDFObservationAnswers,
  validatePDFObservationAnswerEvidence,
  pdfObservationAnswersText,
  type SavedPDFObservationAnswer,
} from "../src/lib/pdf-observation-answers";
const source: any = {
  pdfId: "pdf",
  reviewVersion: 2,
  source: "hash",
  probeSource: "probe",
  notes: "Readable page",
  correction: "Ask without assuming success.",
  grounding: "unsupported",
  reviewerName: "Source reviewer",
};
const saved = (): SavedPDFObservationAnswer => ({
  id: "answer",
  original: {
    question: "What should change?",
    answer: "Private original text",
    citations: [
      {
        pdfId: "pdf",
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
          pdfId: "pdf",
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
    p = includedPDFObservationAnswers([s], [source]);
  assert.equal(p.length, 1);
  assert.equal(p[0].reviewerName, "Reviewer");
  assert.equal(p[0].edited, true);
  assert.ok(!JSON.stringify(p).includes("Private original text"));
  assert.equal((p[0] as any).history, undefined);
  validatePDFObservationAnswerEvidence(p, [source]);
  s.history.at(-1)!.includeInReports = false;
  assert.deepEqual(includedPDFObservationAnswers([s], [source]), []);
  s.history.at(-1)!.includeInReports = true;
  s.history.at(-1)!.reviewed = false;
  assert.throws(() => includedPDFObservationAnswers([s], [source]));
  assert.throws(() =>
    includedPDFObservationAnswers([saved()], [{ ...source, reviewVersion: 3 }]),
  );
  assert.throws(() =>
    includedPDFObservationAnswers(
      [saved()],
      [{ ...source, reviewerName: "Changed source attribution" }],
    ),
  );
  const bad = saved();
  bad.history.at(-1)!.citations[0].field = "notes";
  assert.throws(() => includedPDFObservationAnswers([bad], [source]));
});
test("Reviewed PDF Q&A exports localize labels, preserve question/quotes and omit private revision history", () => {
  const p = includedPDFObservationAnswers([saved()], [source]);
  assert.ok(
    pdfObservationAnswersText(p, "es").includes(
      "Respuesta revisada: Reviewed wording",
    ),
  );
  assert.ok(
    pdfObservationAnswersText(p, "fr").includes(
      "Correction du chercheur: “without assuming success”",
    ),
  );
  assert.ok(!pdfObservationAnswersText(p).includes("Private original text"));
  assert.equal(pdfObservationAnswersText(undefined), "");
});
