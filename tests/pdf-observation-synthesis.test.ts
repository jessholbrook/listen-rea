import test from "node:test";
import assert from "node:assert/strict";
import {
  validatePDFObservationSynthesis,
  pdfObservationSynthesisText,
  pdfObservationSynthesisPromptVersion,
} from "../src/lib/pdf-observation-synthesis";
import { generatePDFObservationSynthesis } from "../src/lib/pdf-observation-synthesis-server";
import { generationBody } from "../src/lib/ai";
import type { PDFObservation } from "../src/lib/pdf-observations";
const evidence: PDFObservation[] = [
  {
    pdfId: "pdf-one",
    interviewId: "private-response",
    turnId: "private-turn",
    source: "private-hash",
    probeSource: "private-probe-hash",
    correction: "Ask without assuming success.",
    question: { text: "PRIVATE-QUESTION", page: 2, quote: "PRIVATE-PAGE-TEXT" },
    revisionId: "private-revision",
    reviewVersion: 2,
    notes: "The save label was readable, but the icon meaning was unclear.",
    reviewerName: "PRIVATE-NAME",
    reviewedAt: "2026-10-20T00:00:00Z",
    grounding: "unsupported",
  },
];
const content = () => ({
  findings: [
    {
      title: "Unclear icon meaning",
      description:
        "A researcher noted uncertainty about an icon despite a readable save label.",
      citations: [
        {
          pdfId: "pdf-one",
          reviewVersion: 2,
          field: "notes" as const,
          quote: "the icon meaning was unclear",
        },
      ],
    },
  ],
  limitations:
    "Selected researcher observations do not independently verify images or establish participant prevalence.",
});
test("Synthesis citations require exact included researcher notes and their review version; no findings is valid", () => {
  assert.deepEqual(
    validatePDFObservationSynthesis(content(), evidence),
    content(),
  );
  for (const c of [
    { pdfId: "foreign" },
    { reviewVersion: 1 },
    { quote: "invented words" },
  ]) {
    const bad = content();
    Object.assign(bad.findings[0].citations[0], c);
    assert.throws(() => validatePDFObservationSynthesis(bad, evidence));
  }
  assert.throws(() => validatePDFObservationSynthesis(content(), []));
  const missing = content();
  missing.findings[0].citations = [];
  assert.throws(() => validatePDFObservationSynthesis(missing, evidence));
  assert.deepEqual(
    validatePDFObservationSynthesis(
      { findings: [], limitations: "No useful grounded interpretation." },
      evidence,
    ).findings,
    [],
  );
});
test("Synthesis provider payload contains only included note text/references, uses bounded non-stored text generation and saves a draft with server provenance", async () => {
  let request: any;
  const result = await generatePDFObservationSynthesis(
    evidence,
    "French",
    "workspace",
    "study",
    async (...args) => {
      request = args;
      return content();
    },
  );
  assert.deepEqual(request[1], {
    reportingLanguage: "French",
    observations: [
      {
        pdfId: "pdf-one",
        reviewVersion: 2,
        notes: evidence[0].notes,
        correction: evidence[0].correction,
        grounding: evidence[0].grounding,
      },
    ],
  });
  assert.equal(request[4], "pdf-observation-synthesis");
  assert.equal(request[6].maxTokens, 3000);
  assert.ok(request[6].signal instanceof AbortSignal);
  const body = generationBody(request[0], request[1], request[5], request[6]);
  assert.equal(body.store, false);
  assert.equal(typeof body.messages[1].content, "string");
  assert.equal(JSON.stringify(body).includes("PRIVATE-NAME"), false);
  assert.equal(JSON.stringify(body).includes("private-response"), false);
  assert.equal(JSON.stringify(body).includes("image_url"), false);
  assert.equal(JSON.stringify(body).includes("PRIVATE-QUESTION"), false);
  assert.equal(JSON.stringify(body).includes("PRIVATE-PAGE-TEXT"), false);
  assert.equal(JSON.stringify(body).includes("private-probe-hash"), false);
  assert.equal(result.reviewed, false);
  assert.equal(result.promptVersion, pdfObservationSynthesisPromptVersion);
  assert.ok(result.generatedAt);
  assert.equal(result.reviewedBy, undefined);
});
test("Malformed or unavailable synthesis providers fail without returning findings; drafts stay out of shared text", async () => {
  await assert.rejects(
    generatePDFObservationSynthesis(
      evidence,
      "English",
      "workspace",
      "study",
      async () => {
        throw new Error("PROVIDER_UNAVAILABLE");
      },
    ),
  );
  await assert.rejects(
    generatePDFObservationSynthesis(
      evidence,
      "English",
      "workspace",
      "study",
      async () => ({
        findings: [
          {
            ...content().findings[0],
            citations: [
              { pdfId: "foreign", reviewVersion: 2, quote: "fabricated" },
            ],
          },
        ],
        limitations: "Unknown source",
      }),
    ),
  );
  const s = {
    ...content(),
    model: "synthetic-fixture",
    promptVersion: pdfObservationSynthesisPromptVersion,
    generatedAt: "2026-10-20T00:00:00Z",
    reviewed: false,
  };
  assert.equal(pdfObservationSynthesisText(s), "");
  assert.ok(
    pdfObservationSynthesisText({
      ...s,
      reviewed: true,
      reviewedBy: { id: "reviewer", name: "Reviewer" },
      reviewedAt: "today",
    }).includes("Researcher note: “the icon meaning was unclear”"),
  );
});

test("Correction citations bind the exact field, revision and quote; localized exports preserve field identity", () => {
  const c: any = content();
  c.findings[0].citations[0] = {
    pdfId: "pdf-one",
    reviewVersion: 2,
    field: "correction",
    quote: "Ask without assuming success.",
  };
  assert.deepEqual(validatePDFObservationSynthesis(c, evidence), c);
  const wrong = structuredClone(c);
  wrong.findings[0].citations[0].field = "notes";
  assert.throws(() => validatePDFObservationSynthesis(wrong, evidence));
  for (const field of ["answer", "question", "grounding"]) {
    const bad = structuredClone(c);
    bad.findings[0].citations[0].field = field;
    assert.throws(() => validatePDFObservationSynthesis(bad, evidence));
  }
  const reviewed = {
    ...c,
    model: "synthetic",
    promptVersion: pdfObservationSynthesisPromptVersion,
    generatedAt: "today",
    reviewed: true,
  };
  assert.ok(
    pdfObservationSynthesisText(reviewed, "es").includes(
      "Corrección del investigador: “Ask without assuming success.”",
    ),
  );
  assert.ok(
    pdfObservationSynthesisText(reviewed, "fr").includes(
      "Correction du chercheur: “Ask without assuming success.”",
    ),
  );
});
