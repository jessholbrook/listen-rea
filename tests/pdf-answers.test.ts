import test from "node:test";
import assert from "node:assert/strict";
import {
  includedPDFAnswers,
  validatePDFAnswerEvidence,
  pdfAnswersText,
  type SavedPDFAnswer,
} from "../src/lib/pdf-answers";
const source: any = {
  pdfId: "pdf",
  verificationVersion: 2,
  source: "hash",
  digest: "digest",
  reviewerName: "Source reviewer",
  ocrPages: [2],
  passages: [
    { page: 2, start: 0, end: 25, quote: "Save draft before review." },
  ],
};
const saved = (): SavedPDFAnswer => ({
  id: "answer",
  original: {
    question: "What should change?",
    answer: "Private original text",
    citations: [
      {
        pdfId: "pdf",
        verificationVersion: 2,
        page: 2,
        start: 0,
        end: 25,
        quote: "Save draft before review.",
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
          verificationVersion: 2,
          page: 2,
          start: 0,
          end: 25,
          quote: "Save draft before review.",
        },
      ],
      reviewed: true,
      includeInReports: true,
      editor: { id: "r", name: "Reviewer" },
      at: "now",
    },
  ],
});
test("Only latest reviewed opt-in answers become projections; frozen sources and exact physical-page citations remain required", () => {
  const s = saved(),
    p = includedPDFAnswers([s], [source]);
  assert.equal(p.length, 1);
  assert.equal(p[0].reviewerName, "Reviewer");
  assert.equal(p[0].edited, true);
  assert.ok(!JSON.stringify(p).includes("Private original text"));
  assert.equal((p[0] as any).history, undefined);
  validatePDFAnswerEvidence(p, [source]);
  s.history.at(-1)!.includeInReports = false;
  assert.deepEqual(includedPDFAnswers([s], [source]), []);
  s.history.at(-1)!.includeInReports = true;
  s.history.at(-1)!.reviewed = false;
  assert.throws(() => includedPDFAnswers([s], [source]));
  assert.throws(() =>
    includedPDFAnswers([saved()], [{ ...source, verificationVersion: 3 }]),
  );
  assert.throws(() =>
    includedPDFAnswers(
      [saved()],
      [{ ...source, reviewerName: "Changed source attribution" }],
    ),
  );
  for (const patch of [{ digest: "changed" }, { ocrPages: [] }])
    assert.throws(() =>
      includedPDFAnswers([saved()], [{ ...source, ...patch }]),
    );
  const bad = saved();
  bad.history.at(-1)!.citations[0].page = 1;
  assert.throws(() => includedPDFAnswers([bad], [source]));
});
test("Reviewed PDF Q&A exports localize labels, preserve question/quotes and omit private revision history", () => {
  const p = includedPDFAnswers([saved()], [source]);
  assert.ok(
    pdfAnswersText(p, "es").includes("Respuesta revisada: Reviewed wording"),
  );
  assert.ok(
    pdfAnswersText(p, "fr").includes("Page PDF 2: “Save draft before review.”"),
  );
  assert.ok(!pdfAnswersText(p).includes("Private original text"));
  assert.match(pdfAnswersText(p), /Researcher-verified OCR/);
  assert.equal(pdfAnswersText(undefined), "");
});
