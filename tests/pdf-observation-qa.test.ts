import test from "node:test";
import assert from "node:assert/strict";
import {
  validatePDFObservationQA,
  pdfObservationQALabels,
  pdfObservationQAPromptVersion,
} from "../src/lib/pdf-observation-qa";
import { answerPDFObservationQuestion } from "../src/lib/pdf-observation-qa-server";
import { generationBody } from "../src/lib/ai";
import type { PDFObservation } from "../src/lib/pdf-observations";
const evidence: PDFObservation[] = [
  {
    pdfId: "pdf-one",
    reviewVersion: 3,
    notes:
      "The reviewer found a readable page but an unsupported assumption of success.",
    correction: "Ask what the page means without assuming success.",
    grounding: "unsupported",
    interviewId: "PRIVATE-RESPONSE",
    turnId: "PRIVATE-TURN",
    source: "PRIVATE-SOURCE",
    probeSource: "PRIVATE-PROBE",
    revisionId: "PRIVATE-REVISION",
    reviewerName: "PRIVATE-REVIEWER",
    reviewedAt: "PRIVATE-TIME",
    question: { text: "PRIVATE-QUESTION", page: 2, quote: "PRIVATE-PAGE" },
  },
];
const answer = () => ({
  answer: "The researcher recommends avoiding an assumption of success.",
  citations: [
    {
      pdfId: "pdf-one",
      reviewVersion: 3,
      field: "correction" as const,
      quote: "without assuming success",
    },
  ],
});
test("PDF observation answers cite the exact included field and revision; foreign, stale, invented and cross-field citations are rejected", () => {
  assert.deepEqual(validatePDFObservationQA(answer(), evidence), answer());
  for (const patch of [
    { pdfId: "foreign" },
    { reviewVersion: 2 },
    { field: "notes" },
    { field: "answer" },
    { field: "grounding" },
    { quote: "invented statement" },
  ]) {
    const bad = answer();
    Object.assign(bad.citations[0], patch);
    assert.throws(() => validatePDFObservationQA(bad, evidence));
  }
  assert.throws(() => validatePDFObservationQA(answer(), []));
  const both = answer();
  both.citations.push({
    pdfId: "pdf-one",
    reviewVersion: 3,
    field: "notes" as any,
    quote: "unsupported assumption of success",
  });
  assert.equal(validatePDFObservationQA(both, evidence).citations.length, 2);
});
test("Uncited answers become localized insufficiency messages rather than unsupported claims", () => {
  for (const language of ["en", "es", "fr"] as const) {
    const r = validatePDFObservationQA(
      {
        answer:
          "The participants were successful; this unsupported claim must not escape.",
        citations: [],
      },
      evidence,
      language,
    );
    assert.equal(r.answer, pdfObservationQALabels[language].insufficient);
    assert.deepEqual(r.citations, []);
  }
});
test("Question requests transmit only explicit question, included annotation fields and references, with bounded non-stored generation and server provenance", async () => {
  let request: any;
  const question = "What concern did the reviewer identify?";
  const r = await answerPDFObservationQuestion(
    evidence,
    question,
    "fr",
    "workspace",
    "study",
    async (...args) => {
      request = args;
      return answer();
    },
  );
  assert.deepEqual(request[1], {
    reportingLanguage: "Français",
    observations: [
      {
        pdfId: "pdf-one",
        reviewVersion: 3,
        notes: evidence[0].notes,
        correction: evidence[0].correction,
        grounding: "unsupported",
      },
    ],
    question,
  });
  assert.equal(request[4], "pdf-observation-qa");
  assert.equal(request[6].maxTokens, 2000);
  assert.ok(request[6].signal instanceof AbortSignal);
  const body = generationBody(request[0], request[1], request[5], request[6]);
  assert.equal(body.store, false);
  assert.equal(typeof body.messages[1].content, "string");
  assert.ok(!JSON.stringify(body).includes("PRIVATE-"));
  assert.ok(!JSON.stringify(body).includes("image_url"));
  assert.equal(r.question, question);
  assert.equal(r.promptVersion, pdfObservationQAPromptVersion);
  assert.ok(r.generatedAt);
  assert.equal((r as any).reviewed, undefined);
});
test("Unavailable or invalid providers do not return an answer, and provider metadata cannot replace server provenance", async () => {
  await assert.rejects(
    answerPDFObservationQuestion(
      evidence,
      "What did the reviewer say?",
      "en",
      "w",
      "s",
      async () => {
        throw new Error("PROVIDER_UNAVAILABLE");
      },
    ),
  );
  for (const output of [
    { ...answer(), model: "forged" },
    {
      ...answer(),
      citations: [{ ...answer().citations[0], quote: "invented" }],
    },
    { ...answer(), citations: Array(21).fill(answer().citations[0]) },
  ])
    await assert.rejects(
      answerPDFObservationQuestion(
        evidence,
        "What did the reviewer say?",
        "en",
        "w",
        "s",
        async () => output,
      ),
    );
});
