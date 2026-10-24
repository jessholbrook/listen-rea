import test from "node:test";
import assert from "node:assert/strict";
import {
  validateDOCXObservationSynthesis,
  docxObservationSynthesisText,
  docxObservationSynthesisPromptVersion,
} from "../src/lib/docx-observation-synthesis";
import { generateDOCXObservationSynthesis } from "../src/lib/docx-observation-synthesis-server";
import { generationBody } from "../src/lib/ai";
import type { DOCXObservation } from "../src/lib/docx-observations";
const evidence: DOCXObservation[] = [
  {
    docxId: "docx-one",
    interviewId: "private-response",
    turnId: "private-turn",
    source: "private-hash",
    probeSource: "private-probe-hash",
    correction: "Ask without assuming success.",
    question: {
      text: "PRIVATE-QUESTION",
      paragraph: 2,
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
          docxId: "docx-one",
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
    validateDOCXObservationSynthesis(content(), evidence),
    content(),
  );
  for (const c of [
    { docxId: "foreign" },
    { reviewVersion: 1 },
    { quote: "invented words" },
  ]) {
    const bad = content();
    Object.assign(bad.findings[0].citations[0], c);
    assert.throws(() => validateDOCXObservationSynthesis(bad, evidence));
  }
  assert.throws(() => validateDOCXObservationSynthesis(content(), []));
  const missing = content();
  missing.findings[0].citations = [];
  assert.throws(() => validateDOCXObservationSynthesis(missing, evidence));
  assert.deepEqual(
    validateDOCXObservationSynthesis(
      { findings: [], limitations: "No useful grounded interpretation." },
      evidence,
    ).findings,
    [],
  );
});
test("Synthesis provider payload contains only included note text/references, uses bounded non-stored text generation and saves a draft with server provenance", async () => {
  let request: any;
  const result = await generateDOCXObservationSynthesis(
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
        docxId: "docx-one",
        reviewVersion: 2,
        notes: evidence[0].notes,
        correction: evidence[0].correction,
        grounding: evidence[0].grounding,
      },
    ],
  });
  assert.equal(request[4], "docx-observation-synthesis");
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
  assert.equal(result.promptVersion, docxObservationSynthesisPromptVersion);
  assert.ok(result.generatedAt);
  assert.equal(result.reviewedBy, undefined);
});
test("Malformed or unavailable synthesis providers fail without returning findings; drafts stay out of shared text", async () => {
  await assert.rejects(
    generateDOCXObservationSynthesis(
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
    generateDOCXObservationSynthesis(
      evidence,
      "English",
      "workspace",
      "study",
      async () => ({
        findings: [
          {
            ...content().findings[0],
            citations: [
              { docxId: "foreign", reviewVersion: 2, quote: "fabricated" },
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
    promptVersion: docxObservationSynthesisPromptVersion,
    generatedAt: "2026-10-20T00:00:00Z",
    reviewed: false,
  };
  assert.equal(docxObservationSynthesisText(s), "");
  assert.ok(
    docxObservationSynthesisText({
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
    docxId: "docx-one",
    reviewVersion: 2,
    field: "correction",
    quote: "Ask without assuming success.",
  };
  assert.deepEqual(validateDOCXObservationSynthesis(c, evidence), c);
  const wrong = structuredClone(c);
  wrong.findings[0].citations[0].field = "notes";
  assert.throws(() => validateDOCXObservationSynthesis(wrong, evidence));
  for (const field of ["answer", "question", "grounding"]) {
    const bad = structuredClone(c);
    bad.findings[0].citations[0].field = field;
    assert.throws(() => validateDOCXObservationSynthesis(bad, evidence));
  }
  const reviewed = {
    ...c,
    model: "synthetic",
    promptVersion: docxObservationSynthesisPromptVersion,
    generatedAt: "today",
    reviewed: true,
  };
  assert.ok(
    docxObservationSynthesisText(reviewed, "es").includes(
      "Corrección del investigador: “Ask without assuming success.”",
    ),
  );
  assert.ok(
    docxObservationSynthesisText(reviewed, "fr").includes(
      "Correction du chercheur: “Ask without assuming success.”",
    ),
  );
});
