import test from "node:test";
import assert from "node:assert/strict";
import {
  validatePPTXObservationSynthesis,
  pptxObservationSynthesisText,
  pptxObservationSynthesisPromptVersion,
} from "../src/lib/pptx-observation-synthesis";
import { generatePPTXObservationSynthesis } from "../src/lib/pptx-observation-synthesis-server";
import { generationBody } from "../src/lib/ai";
import type { PPTXObservation } from "../src/lib/pptx-observations";
const evidence: PPTXObservation[] = [
  {
    pptxId: "pptx-one",
    interviewId: "private-response",
    turnId: "private-turn",
    source: "private-hash",
    probeSource: "private-probe-hash",
    correction: "Ask without assuming success.",
    question: {
      text: "PRIVATE-QUESTION",
      slide: 2,
      quote: "PRIVATE-PAGE-TEXT",
    },
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
          pptxId: "pptx-one",
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
    validatePPTXObservationSynthesis(content(), evidence),
    content(),
  );
  for (const c of [
    { pptxId: "foreign" },
    { reviewVersion: 1 },
    { quote: "invented words" },
  ]) {
    const bad = content();
    Object.assign(bad.findings[0].citations[0], c);
    assert.throws(() => validatePPTXObservationSynthesis(bad, evidence));
  }
  assert.throws(() => validatePPTXObservationSynthesis(content(), []));
  const whitespace = content();
  whitespace.findings[0].citations[0].quote = "   ";
  assert.throws(() =>
    validatePPTXObservationSynthesis(whitespace, [
      { ...evidence[0], notes: "Researcher   note" },
    ]),
  );
  const missing = content();
  missing.findings[0].citations = [];
  assert.throws(() => validatePPTXObservationSynthesis(missing, evidence));
  assert.deepEqual(
    validatePPTXObservationSynthesis(
      { findings: [], limitations: "No useful grounded interpretation." },
      evidence,
    ).findings,
    [],
  );
});
test("Synthesis provider payload contains only included note text/references, uses bounded non-stored text generation and saves a draft with server provenance", async () => {
  let request: any;
  const result = await generatePPTXObservationSynthesis(
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
        pptxId: "pptx-one",
        reviewVersion: 2,
        notes: evidence[0].notes,
        correction: evidence[0].correction,
        grounding: evidence[0].grounding,
      },
    ],
  });
  assert.equal(request[4], "pptx-observation-synthesis");
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
  assert.equal(result.promptVersion, pptxObservationSynthesisPromptVersion);
  assert.ok(result.generatedAt);
  assert.equal(result.reviewedBy, undefined);
});
test("Malformed or unavailable synthesis providers fail without returning findings; drafts stay out of shared text", async () => {
  await assert.rejects(
    generatePPTXObservationSynthesis(
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
    generatePPTXObservationSynthesis(
      evidence,
      "English",
      "workspace",
      "study",
      async () => ({
        findings: [
          {
            ...content().findings[0],
            citations: [
              { pptxId: "foreign", reviewVersion: 2, quote: "fabricated" },
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
    promptVersion: pptxObservationSynthesisPromptVersion,
    generatedAt: "2026-10-20T00:00:00Z",
    reviewed: false,
  };
  assert.equal(pptxObservationSynthesisText(s), "");
  assert.ok(
    pptxObservationSynthesisText({
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
    pptxId: "pptx-one",
    reviewVersion: 2,
    field: "correction",
    quote: "Ask without assuming success.",
  };
  assert.deepEqual(validatePPTXObservationSynthesis(c, evidence), c);
  const wrong = structuredClone(c);
  wrong.findings[0].citations[0].field = "notes";
  assert.throws(() => validatePPTXObservationSynthesis(wrong, evidence));
  for (const field of ["answer", "question", "grounding"]) {
    const bad = structuredClone(c);
    bad.findings[0].citations[0].field = field;
    assert.throws(() => validatePPTXObservationSynthesis(bad, evidence));
  }
  const reviewed = {
    ...c,
    model: "synthetic",
    promptVersion: pptxObservationSynthesisPromptVersion,
    generatedAt: "today",
    reviewed: true,
  };
  assert.ok(
    pptxObservationSynthesisText(reviewed, "es").includes(
      "Corrección del investigador: “Ask without assuming success.”",
    ),
  );
  assert.ok(
    pptxObservationSynthesisText(reviewed, "fr").includes(
      "Correction du chercheur: “Ask without assuming success.”",
    ),
  );
});
