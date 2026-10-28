import test from "node:test";
import assert from "node:assert/strict";
import {
  validatePDFQA,
  pdfQALabels,
  pdfQAPromptVersion,
} from "../src/lib/pdf-qa";
import { answerPDFQuestion } from "../src/lib/pdf-qa-server";
import { generationBody } from "../src/lib/ai";
import type { PDFEvidence } from "../src/lib/pdf-evidence";
const evidence: PDFEvidence[] = [
  {
    pdfId: "pdf-one",
    verificationVersion: 3,
    source: "PRIVATE-SOURCE",
    digest: "PRIVATE-DIGEST",
    interviewId: "PRIVATE-INTERVIEW",
    turnId: "PRIVATE-TURN",
    revisionId: "PRIVATE-REVISION",
    reviewerName: "PRIVATE-NAME",
    reviewedAt: "PRIVATE-TIME",
    ocrPages: [2],
    passages: [
      { page: 1, start: 10, end: 35, quote: "A draft can be saved." },
      { page: 2, start: 40, end: 65, quote: "Save draft before review." },
    ],
  },
];
const answer = () => ({
  answer: "The selected excerpt says to save the draft before review.",
  citations: [
    {
      pdfId: "pdf-one",
      verificationVersion: 3,
      page: 2,
      start: 40,
      end: 65,
      quote: "Save draft before review.",
    },
  ],
});
test("PDF passage Q&A citations require exact document, verification, physical page and selected character reference", () => {
  assert.deepEqual(validatePDFQA(answer(), evidence), answer());
  for (const patch of [
    { pdfId: "foreign" },
    { verificationVersion: 2 },
    { page: 1 },
    { start: 41 },
    { end: 64 },
    { quote: "invented" },
    { quote: " " },
  ]) {
    const bad = answer();
    Object.assign(bad.citations[0], patch);
    assert.throws(() => validatePDFQA(bad, evidence));
  }
  assert.throws(() => validatePDFQA(answer(), []));
  const both = answer();
  both.citations.push({
    pdfId: "pdf-one",
    verificationVersion: 3,
    page: 1,
    start: 10,
    end: 35,
    quote: "draft can be saved",
  });
  assert.equal(validatePDFQA(both, evidence).citations.length, 2);
});
test("Uncited PDF passage answers become localized insufficiency, suppressing unsupported claims", () => {
  for (const language of ["en", "es", "fr"] as const) {
    const r = validatePDFQA(
      { answer: "Everyone successfully used the product.", citations: [] },
      evidence,
      language,
    );
    assert.equal(r.answer, pdfQALabels[language].insufficient);
    assert.deepEqual(r.citations, []);
  }
});
test("PDF question provider gets only selected native/OCR excerpts, question and references with bounded non-stored generation", async () => {
  let args: any;
  const question = "What should happen before review?";
  const input = structuredClone(evidence);
  (input[0].passages[0] as any).privateExtra = "PRIVATE-EXTRA";
  const r = await answerPDFQuestion(
    input,
    question,
    "fr",
    "w",
    "s",
    async (...a) => {
      args = a;
      return answer();
    },
  );
  assert.deepEqual(args[1], {
    reportingLanguage: "Français",
    question,
    documents: [
      {
        pdfId: "pdf-one",
        verificationVersion: 3,
        passages: evidence[0].passages.map((p) => ({
          ...p,
          textOrigin:
            p.page === 2 ? "researcher-verified OCR" : "native extraction",
        })),
      },
    ],
  });
  assert.equal(args[4], "pdf-qa");
  assert.equal(args[6].maxTokens, 2000);
  assert.ok(args[6].signal instanceof AbortSignal);
  const request = generationBody(args[0], args[1], args[5], args[6]);
  assert.equal(request.store, false);
  assert.equal(typeof request.messages[1].content, "string");
  assert.ok(!JSON.stringify(request).includes("PRIVATE-"));
  assert.ok(!JSON.stringify(request).includes("image_url"));
  assert.match(args[0], /untrusted data/);
  assert.match(args[0], /OCR/);
  assert.equal(r.promptVersion, pdfQAPromptVersion);
  assert.equal(r.question, question);
  assert.ok(r.generatedAt);
  assert.equal((r as any).reviewed, undefined);
});
test("Invalid or unavailable providers do not return answers or forge server provenance", async () => {
  await assert.rejects(
    answerPDFQuestion(
      evidence,
      "What should happen?",
      "en",
      "w",
      "s",
      async () => {
        throw Error("PROVIDER_UNAVAILABLE");
      },
    ),
  );
  for (const value of [
    { ...answer(), model: "forged" },
    {
      ...answer(),
      citations: [{ ...answer().citations[0], quote: "invented" }],
    },
    { ...answer(), citations: Array(21).fill(answer().citations[0]) },
    { ...answer(), answer: "x".repeat(6001) },
  ])
    await assert.rejects(
      answerPDFQuestion(
        evidence,
        "What should happen?",
        "en",
        "w",
        "s",
        async () => value,
      ),
    );
});
