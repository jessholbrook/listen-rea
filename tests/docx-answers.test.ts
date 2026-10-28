import test from "node:test";
import assert from "node:assert/strict";
import {
  includedDOCXAnswers,
  validateDOCXAnswerEvidence,
  docxAnswersText,
  type SavedDOCXAnswer,
} from "../src/lib/docx-answers";
const source: any = {
  docxId: "docx",
  verificationVersion: 2,
  source: "hash",
  digest: "digest",
  reviewerName: "Source reviewer",
  passages: [
    { paragraph: 2, start: 0, end: 25, quote: "Save draft before review." },
  ],
};
const saved = (): SavedDOCXAnswer => ({
  id: "answer",
  original: {
    question: "What should change?",
    answer: "Private original text",
    citations: [
      {
        docxId: "docx",
        verificationVersion: 2,
        paragraph: 2,
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
          docxId: "docx",
          verificationVersion: 2,
          paragraph: 2,
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
test("Only latest reviewed opt-in answers become projections; frozen sources and exact paragraph citations remain required", () => {
  const s = saved(),
    p = includedDOCXAnswers([s], [source]);
  assert.equal(p.length, 1);
  assert.equal(p[0].reviewerName, "Reviewer");
  assert.equal(p[0].edited, true);
  assert.ok(!JSON.stringify(p).includes("Private original text"));
  assert.equal((p[0] as any).history, undefined);
  validateDOCXAnswerEvidence(p, [source]);
  s.history.at(-1)!.includeInReports = false;
  assert.deepEqual(includedDOCXAnswers([s], [source]), []);
  s.history.at(-1)!.includeInReports = true;
  s.history.at(-1)!.reviewed = false;
  assert.throws(() => includedDOCXAnswers([s], [source]));
  assert.throws(() =>
    includedDOCXAnswers([saved()], [{ ...source, verificationVersion: 3 }]),
  );
  assert.throws(() =>
    includedDOCXAnswers(
      [saved()],
      [{ ...source, reviewerName: "Changed source attribution" }],
    ),
  );
  for (const patch of [{ digest: "changed" }, { revisionId: "changed" }])
    assert.throws(() =>
      includedDOCXAnswers([saved()], [{ ...source, ...patch }]),
    );
  const bad = saved();
  bad.history.at(-1)!.citations[0].paragraph = 1;
  assert.throws(() => includedDOCXAnswers([bad], [source]));
});
test("Reviewed DOCX Q&A exports localize labels, preserve question/quotes and omit private revision history", () => {
  const p = includedDOCXAnswers([saved()], [source]);
  assert.ok(
    docxAnswersText(p, "es").includes("Respuesta revisada: Reviewed wording"),
  );
  assert.ok(
    docxAnswersText(p, "fr").includes(
      "Paragraphe DOCX 2: “Save draft before review.”",
    ),
  );
  assert.ok(!docxAnswersText(p).includes("Private original text"));
  assert.ok(!docxAnswersText(p).includes("OCR"));
  assert.equal(docxAnswersText(undefined), "");
});
