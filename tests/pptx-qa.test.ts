import test from "node:test";
import assert from "node:assert/strict";
import {
  validatePPTXQA,
  pptxQALabels,
  pptxQAPromptVersion,
} from "../src/lib/pptx-qa";
import { answerPPTXQuestion } from "../src/lib/pptx-qa-server";
import { generationBody } from "../src/lib/ai";
import type { PPTXEvidence } from "../src/lib/pptx-evidence";
const evidence: PPTXEvidence[] = [
  {
    pptxId: "pptx-one",
    verificationVersion: 3,
    source: "PRIVATE-SOURCE",
    digest: "PRIVATE-DIGEST",
    interviewId: "PRIVATE-INTERVIEW",
    turnId: "PRIVATE-TURN",
    revisionId: "PRIVATE-REVISION",
    reviewerName: "PRIVATE-NAME",
    reviewedAt: "PRIVATE-TIME",
    passages: [
      { slide: 1, start: 10, end: 31, quote: "A draft can be saved." },
      { slide: 2, start: 40, end: 65, quote: "Save draft before review." },
    ],
  },
];
const answer = () => ({
  answer: "The selected excerpt says to save the draft before review.",
  citations: [
    {
      pptxId: "pptx-one",
      verificationVersion: 3,
      slide: 2,
      start: 40,
      end: 65,
      quote: "Save draft before review.",
    },
  ],
});
test("PPTX passage Q&A citations require exact document, verification, prepared slide and selected character reference", () => {
  assert.deepEqual(validatePPTXQA(answer(), evidence), answer());
  for (const patch of [
    { pptxId: "foreign" },
    { verificationVersion: 2 },
    { slide: 1 },
    { start: 41 },
    { end: 64 },
    { quote: "invented" },
    { quote: " " },
    { quote: "Save draft" },
  ]) {
    const bad = answer();
    Object.assign(bad.citations[0], patch);
    assert.throws(() => validatePPTXQA(bad, evidence));
  }
  assert.throws(() => validatePPTXQA(answer(), []));
  const both = answer();
  both.citations.push({
    pptxId: "pptx-one",
    verificationVersion: 3,
    slide: 1,
    start: 10,
    end: 31,
    quote: "A draft can be saved.",
  });
  assert.equal(validatePPTXQA(both, evidence).citations.length, 2);
});
test("Uncited PPTX passage answers become localized insufficiency, suppressing unsupported claims", () => {
  for (const language of ["en", "es", "fr"] as const) {
    const r = validatePPTXQA(
      { answer: "Everyone successfully used the product.", citations: [] },
      evidence,
      language,
    );
    assert.equal(r.answer, pptxQALabels[language].insufficient);
    assert.deepEqual(r.citations, []);
  }
});
test("PPTX question provider gets only selected prepared excerpts, question and references with bounded non-stored generation", async () => {
  let args: any;
  const question = "What should happen before review?";
  const input = structuredClone(evidence);
  (input[0].passages[0] as any).privateExtra = "PRIVATE-EXTRA";
  const r = await answerPPTXQuestion(
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
        pptxId: "pptx-one",
        verificationVersion: 3,
        passages: evidence[0].passages,
      },
    ],
  });
  assert.equal(args[4], "pptx-qa");
  assert.equal(args[6].maxTokens, 2000);
  assert.ok(args[6].signal instanceof AbortSignal);
  const request = generationBody(args[0], args[1], args[5], args[6]);
  assert.equal(request.store, false);
  assert.equal(typeof request.messages[1].content, "string");
  assert.ok(!JSON.stringify(request).includes("PRIVATE-"));
  assert.ok(!JSON.stringify(request).includes("image_url"));
  assert.match(args[0], /untrusted data/);
  assert.match(args[0], /prepared-text/);
  assert.equal(r.promptVersion, pptxQAPromptVersion);
  assert.equal(r.question, question);
  assert.ok(r.generatedAt);
  assert.equal((r as any).reviewed, undefined);
});
test("Invalid or unavailable providers do not return answers or forge server provenance", async () => {
  await assert.rejects(
    answerPPTXQuestion(
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
      answerPPTXQuestion(
        evidence,
        "What should happen?",
        "en",
        "w",
        "s",
        async () => value,
      ),
    );
});
