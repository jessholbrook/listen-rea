import test from "node:test";
import assert from "node:assert/strict";
import {
  validateDOCXSynthesis,
  docxSynthesisText,
  docxSynthesisPromptVersion,
} from "../src/lib/docx-synthesis";
import { generateDOCXSynthesis } from "../src/lib/docx-synthesis-server";
import { generationBody } from "../src/lib/ai";
import type { DOCXEvidence } from "../src/lib/docx-evidence";
const evidence: DOCXEvidence[] = [
  {
    docxId: "docx-one",
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
        paragraph: 2,
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
          docxId: "docx-one",
          verificationVersion: 2,
          paragraph: 2,
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
test("DOCX synthesis citations bind exact excerpts, prepared paragraphs, passage offsets and verification versions", () => {
  assert.deepEqual(validateDOCXSynthesis(content(), evidence), content());
  for (const change of [
    { docxId: "foreign" },
    { verificationVersion: 1 },
    { paragraph: 1 },
    { start: 11 },
    { end: 50 },
    { quote: "invented" },
    { quote: " " },
    { quote: "Save draft keeps work" },
  ]) {
    const c = content();
    Object.assign(c.findings[0].citations[0], change);
    assert.throws(() => validateDOCXSynthesis(c, evidence));
  }
  const missing = content();
  missing.findings[0].citations = [];
  assert.throws(() => validateDOCXSynthesis(missing, evidence));
  assert.throws(() => validateDOCXSynthesis(content(), []));
  assert.deepEqual(
    validateDOCXSynthesis(
      {
        findings: [],
        limitations: "No supported findings in selected passages.",
      },
      evidence,
    ).findings,
    [],
  );
});
test("DOCX provider receives only selected text and citation references with bounded non-stored generation and server provenance", async () => {
  let args: any;
  const s = await generateDOCXSynthesis(
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
        docxId: "docx-one",
        verificationVersion: 2,
        passages: evidence[0].passages,
      },
    ],
  });
  assert.equal(args[4], "docx-synthesis");
  assert.equal(args[6].maxTokens, 3000);
  assert.ok(args[6].signal instanceof AbortSignal);
  const body = generationBody(args[0], args[1], args[5], args[6]);
  assert.equal(body.store, false);
  assert.equal(JSON.stringify(body).includes("PRIVATE-"), false);
  assert.equal(JSON.stringify(body).includes("image_url"), false);
  assert.match(args[0], /untrusted data/);
  assert.equal(s.reviewed, false);
  assert.equal(s.promptVersion, docxSynthesisPromptVersion);
  assert.ok(s.generatedAt);
  assert.equal(s.reviewedBy, undefined);
});
test("Unavailable or fabricated DOCX model output cannot save findings and drafts stay out of shared text", async () => {
  await assert.rejects(
    generateDOCXSynthesis(evidence, "English", "w", "s", async () => {
      throw Error("PROVIDER_UNAVAILABLE");
    }),
  );
  await assert.rejects(
    generateDOCXSynthesis(evidence, "English", "w", "s", async () => {
      const c = content();
      c.findings[0].citations[0].paragraph = 1;
      return c;
    }),
  );
  const s = {
    ...content(),
    model: "fixture",
    promptVersion: docxSynthesisPromptVersion,
    generatedAt: "today",
    reviewed: false,
  };
  assert.equal(docxSynthesisText(s), "");
  assert.ok(
    docxSynthesisText({
      ...s,
      reviewed: true,
      reviewedBy: { id: "r", name: "Reviewer" },
      reviewedAt: "today",
    }).includes(
      "DOCX paragraph 2 · characters 11–49: “Save draft keeps work for later review.”",
    ),
  );
  assert.ok(
    docxSynthesisText({ ...s, reviewed: true }, "es").includes(
      "Párrafo del DOCX 2",
    ),
  );
});
