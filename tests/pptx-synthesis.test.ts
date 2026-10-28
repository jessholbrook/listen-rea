import test from "node:test";
import assert from "node:assert/strict";
import {
  validatePPTXSynthesis,
  pptxSynthesisText,
  pptxSynthesisPromptVersion,
} from "../src/lib/pptx-synthesis";
import { generatePPTXSynthesis } from "../src/lib/pptx-synthesis-server";
import { generationBody } from "../src/lib/ai";
import type { PPTXEvidence } from "../src/lib/pptx-evidence";
const evidence: PPTXEvidence[] = [
  {
    pptxId: "pptx-one",
    verificationVersion: 2,
    source: "PRIVATE-HASH",
    digest: "PRIVATE-DIGEST",
    interviewId: "PRIVATE-INTERVIEW",
    turnId: "PRIVATE-TURN",
    revisionId: "PRIVATE-REVISION",
    reviewerName: "PRIVATE-NAME",
    reviewedAt: "now",
    passages: [
      {
        slide: 2,
        start: 10,
        end: 49,
        quote: "Save draft keeps work for later review.",
      },
    ],
  },
];
const content = () => ({
  findings: [
    {
      title: "Draft work can be retained",
      description:
        "The selected excerpt describes retaining draft work for later review.",
      citations: [
        {
          pptxId: "pptx-one",
          verificationVersion: 2,
          slide: 2,
          start: 10,
          end: 49,
          quote: "Save draft keeps work for later review.",
        },
      ],
    },
  ],
  limitations:
    "Selected excerpts lack full document context and independent verification.",
});
test("PPTX synthesis citations bind exact excerpts, prepared slides, passage offsets and verification versions", () => {
  assert.deepEqual(validatePPTXSynthesis(content(), evidence), content());
  for (const change of [
    { pptxId: "foreign" },
    { verificationVersion: 1 },
    { slide: 1 },
    { start: 11 },
    { end: 50 },
    { quote: "invented" },
    { quote: " " },
    { quote: "Save draft keeps work" },
  ]) {
    const c = content();
    Object.assign(c.findings[0].citations[0], change);
    assert.throws(() => validatePPTXSynthesis(c, evidence));
  }
  const missing = content();
  missing.findings[0].citations = [];
  assert.throws(() => validatePPTXSynthesis(missing, evidence));
  assert.throws(() => validatePPTXSynthesis(content(), []));
  assert.deepEqual(
    validatePPTXSynthesis(
      {
        findings: [],
        limitations: "No supported findings in selected passages.",
      },
      evidence,
    ).findings,
    [],
  );
});
test("PPTX provider receives only selected text and citation references with bounded non-stored generation and server provenance", async () => {
  let args: any;
  const s = await generatePPTXSynthesis(
    evidence,
    "French",
    "w",
    "s",
    async (...a) => {
      args = a;
      return content();
    },
  );
  assert.deepEqual(args[1], {
    reportingLanguage: "French",
    documents: [
      {
        pptxId: "pptx-one",
        verificationVersion: 2,
        passages: evidence[0].passages,
      },
    ],
  });
  assert.equal(args[4], "pptx-synthesis");
  assert.equal(args[6].maxTokens, 3000);
  assert.ok(args[6].signal instanceof AbortSignal);
  const body = generationBody(args[0], args[1], args[5], args[6]);
  assert.equal(body.store, false);
  assert.equal(JSON.stringify(body).includes("PRIVATE-"), false);
  assert.equal(JSON.stringify(body).includes("image_url"), false);
  assert.match(args[0], /untrusted data/);
  assert.equal(s.reviewed, false);
  assert.equal(s.promptVersion, pptxSynthesisPromptVersion);
  assert.ok(s.generatedAt);
  assert.equal(s.reviewedBy, undefined);
});
test("Unavailable or fabricated PPTX model output cannot save findings and drafts stay out of shared text", async () => {
  await assert.rejects(
    generatePPTXSynthesis(evidence, "English", "w", "s", async () => {
      throw Error("PROVIDER_UNAVAILABLE");
    }),
  );
  await assert.rejects(
    generatePPTXSynthesis(evidence, "English", "w", "s", async () => {
      const c = content();
      c.findings[0].citations[0].slide = 1;
      return c;
    }),
  );
  const s = {
    ...content(),
    model: "fixture",
    promptVersion: pptxSynthesisPromptVersion,
    generatedAt: "today",
    reviewed: false,
  };
  assert.equal(pptxSynthesisText(s), "");
  assert.ok(
    pptxSynthesisText({
      ...s,
      reviewed: true,
      reviewedBy: { id: "r", name: "Reviewer" },
      reviewedAt: "today",
    }).includes(
      "PPTX slide 2 · characters 11–49: “Save draft keeps work for later review.”",
    ),
  );
  assert.ok(
    pptxSynthesisText({ ...s, reviewed: true }, "es").includes(
      "Diapositiva del PPTX 2",
    ),
  );
});
