import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAttachmentSynthesis,
  attachmentSynthesisText,
  attachmentSynthesisPromptVersion,
} from "../src/lib/attachment-synthesis";
import { generateAttachmentSynthesis } from "../src/lib/attachment-synthesis-server";
import { generationBody } from "../src/lib/ai";
import type { AttachmentEvidence } from "../src/lib/attachment-evidence";
const evidence: AttachmentEvidence[] = [
  {
    imageId: "image-one",
    interviewId: "private-response",
    turnId: "private-turn",
    source: "private-hash",
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
          imageId: "image-one",
          reviewVersion: 2,
          quote: "the icon meaning was unclear",
        },
      ],
    },
  ],
  limitations:
    "Selected researcher observations do not independently verify images or establish participant prevalence.",
});
test("Synthesis citations require exact included researcher notes and their review version; no findings is valid", () => {
  assert.deepEqual(validateAttachmentSynthesis(content(), evidence), content());
  for (const c of [
    { imageId: "foreign" },
    { reviewVersion: 1 },
    { quote: "invented words" },
  ]) {
    const bad = content();
    Object.assign(bad.findings[0].citations[0], c);
    assert.throws(() => validateAttachmentSynthesis(bad, evidence));
  }
  assert.throws(() => validateAttachmentSynthesis(content(), []));
  const missing = content();
  missing.findings[0].citations = [];
  assert.throws(() => validateAttachmentSynthesis(missing, evidence));
  assert.deepEqual(
    validateAttachmentSynthesis(
      { findings: [], limitations: "No useful grounded interpretation." },
      evidence,
    ).findings,
    [],
  );
});
test("Synthesis provider payload contains only included note text/references, uses bounded non-stored text generation and saves a draft with server provenance", async () => {
  let request: any;
  const result = await generateAttachmentSynthesis(
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
      { imageId: "image-one", reviewVersion: 2, notes: evidence[0].notes },
    ],
  });
  assert.equal(request[4], "attachment-synthesis");
  assert.equal(request[6].maxTokens, 3000);
  assert.ok(request[6].signal instanceof AbortSignal);
  const body = generationBody(request[0], request[1], request[5], request[6]);
  assert.equal(body.store, false);
  assert.equal(typeof body.messages[1].content, "string");
  assert.equal(JSON.stringify(body).includes("PRIVATE-NAME"), false);
  assert.equal(JSON.stringify(body).includes("private-response"), false);
  assert.equal(JSON.stringify(body).includes("image_url"), false);
  assert.equal(result.reviewed, false);
  assert.equal(result.promptVersion, attachmentSynthesisPromptVersion);
  assert.ok(result.generatedAt);
  assert.equal(result.reviewedBy, undefined);
});
test("Malformed or unavailable synthesis providers fail without returning findings; drafts stay out of shared text", async () => {
  await assert.rejects(
    generateAttachmentSynthesis(
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
    generateAttachmentSynthesis(
      evidence,
      "English",
      "workspace",
      "study",
      async () => ({
        findings: [
          {
            ...content().findings[0],
            citations: [
              { imageId: "foreign", reviewVersion: 2, quote: "fabricated" },
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
    promptVersion: attachmentSynthesisPromptVersion,
    generatedAt: "2026-10-20T00:00:00Z",
    reviewed: false,
  };
  assert.equal(attachmentSynthesisText(s), "");
  assert.ok(
    attachmentSynthesisText({
      ...s,
      reviewed: true,
      reviewedBy: { id: "reviewer", name: "Reviewer" },
      reviewedAt: "today",
    }).includes("Researcher note: “the icon meaning was unclear”"),
  );
});
