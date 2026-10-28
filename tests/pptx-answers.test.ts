import test from "node:test";
import assert from "node:assert/strict";
import {
  includedPPTXAnswers,
  validatePPTXAnswerEvidence,
  pptxAnswersText,
  type SavedPPTXAnswer,
} from "../src/lib/pptx-answers";
const source: any = {
  pptxId: "pptx",
  verificationVersion: 2,
  source: "hash",
  digest: "digest",
  reviewerName: "Source reviewer",
  passages: [
    { slide: 2, start: 0, end: 25, quote: "Save draft before review." },
  ],
};
const saved = (): SavedPPTXAnswer => ({
  id: "answer",
  original: {
    question: "What should change?",
    answer: "Private original text",
    citations: [
      {
        pptxId: "pptx",
        verificationVersion: 2,
        slide: 2,
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
          pptxId: "pptx",
          verificationVersion: 2,
          slide: 2,
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
test("Only latest reviewed opt-in answers become projections; frozen sources and exact slide citations remain required", () => {
  const s = saved(),
    p = includedPPTXAnswers([s], [source]);
  assert.equal(p.length, 1);
  assert.equal(p[0].reviewerName, "Reviewer");
  assert.equal(p[0].edited, true);
  assert.ok(!JSON.stringify(p).includes("Private original text"));
  assert.equal((p[0] as any).history, undefined);
  validatePPTXAnswerEvidence(p, [source]);
  s.history.at(-1)!.includeInReports = false;
  assert.deepEqual(includedPPTXAnswers([s], [source]), []);
  s.history.at(-1)!.includeInReports = true;
  s.history.at(-1)!.reviewed = false;
  assert.throws(() => includedPPTXAnswers([s], [source]));
  assert.throws(() =>
    includedPPTXAnswers([saved()], [{ ...source, verificationVersion: 3 }]),
  );
  assert.throws(() =>
    includedPPTXAnswers(
      [saved()],
      [{ ...source, reviewerName: "Changed source attribution" }],
    ),
  );
  for (const patch of [{ digest: "changed" }, { revisionId: "changed" }])
    assert.throws(() =>
      includedPPTXAnswers([saved()], [{ ...source, ...patch }]),
    );
  const bad = saved();
  bad.history.at(-1)!.citations[0].slide = 1;
  assert.throws(() => includedPPTXAnswers([bad], [source]));
});
test("Reviewed PPTX Q&A exports localize labels, preserve question/quotes and omit private revision history", () => {
  const p = includedPPTXAnswers([saved()], [source]);
  assert.ok(
    pptxAnswersText(p, "es").includes("Respuesta revisada: Reviewed wording"),
  );
  assert.ok(
    pptxAnswersText(p, "fr").includes(
      "Diapositive PPTX 2: “Save draft before review.”",
    ),
  );
  assert.ok(!pptxAnswersText(p).includes("Private original text"));
  assert.ok(!pptxAnswersText(p).includes("OCR"));
  assert.equal(pptxAnswersText(undefined), "");
});
