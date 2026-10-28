import test from "node:test";
import assert from "node:assert/strict";
import {
  validatePDFSynthesis,
  pdfSynthesisText,
  pdfSynthesisPromptVersion,
} from "../src/lib/pdf-synthesis";
import { generatePDFSynthesis } from "../src/lib/pdf-synthesis-server";
import { generationBody } from "../src/lib/ai";
import type { PDFEvidence } from "../src/lib/pdf-evidence";
const evidence: PDFEvidence[] = [
  {
    pdfId: "pdf-one",
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
        page: 2,
        start: 10,
        end: 50,
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
          pdfId: "pdf-one",
          verificationVersion: 2,
          page: 2,
          start: 10,
          end: 50,
          quote: "Save draft keeps work",
        },
      ],
    },
  ],
  limitations:
    "Selected excerpts lack full document context and independent verification.",
});
test("PDF synthesis citations bind exact excerpts, physical pages, passage offsets and verification versions", () => {
  assert.deepEqual(validatePDFSynthesis(content(), evidence), content());
  for (const change of [
    { pdfId: "foreign" },
    { verificationVersion: 1 },
    { page: 1 },
    { start: 11 },
    { end: 51 },
    { quote: "invented" },
    { quote: " " },
  ]) {
    const c = content();
    Object.assign(c.findings[0].citations[0], change);
    assert.throws(() => validatePDFSynthesis(c, evidence));
  }
  const missing = content();
  missing.findings[0].citations = [];
  assert.throws(() => validatePDFSynthesis(missing, evidence));
  assert.throws(() => validatePDFSynthesis(content(), []));
  assert.deepEqual(
    validatePDFSynthesis(
      {
        findings: [],
        limitations: "No supported findings in selected passages.",
      },
      evidence,
    ).findings,
    [],
  );
});
test("PDF provider receives only selected text and citation references with bounded non-stored generation and server provenance", async () => {
  let args: any;
  const s = await generatePDFSynthesis(
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
        pdfId: "pdf-one",
        verificationVersion: 2,
        passages: evidence[0].passages,
      },
    ],
  });
  assert.equal(args[4], "pdf-synthesis");
  assert.equal(args[6].maxTokens, 3000);
  assert.ok(args[6].signal instanceof AbortSignal);
  const body = generationBody(args[0], args[1], args[5], args[6]);
  assert.equal(body.store, false);
  assert.equal(JSON.stringify(body).includes("PRIVATE-"), false);
  assert.equal(JSON.stringify(body).includes("image_url"), false);
  assert.match(args[0], /untrusted data/);
  assert.equal(s.reviewed, false);
  assert.equal(s.promptVersion, pdfSynthesisPromptVersion);
  assert.ok(s.generatedAt);
  assert.equal(s.reviewedBy, undefined);
});
test("Unavailable or fabricated PDF model output cannot save findings and drafts stay out of shared text", async () => {
  await assert.rejects(
    generatePDFSynthesis(evidence, "English", "w", "s", async () => {
      throw Error("PROVIDER_UNAVAILABLE");
    }),
  );
  await assert.rejects(
    generatePDFSynthesis(evidence, "English", "w", "s", async () => {
      const c = content();
      c.findings[0].citations[0].page = 1;
      return c;
    }),
  );
  const s = {
    ...content(),
    model: "fixture",
    promptVersion: pdfSynthesisPromptVersion,
    generatedAt: "today",
    reviewed: false,
  };
  assert.equal(pdfSynthesisText(s), "");
  assert.ok(
    pdfSynthesisText({
      ...s,
      reviewed: true,
      reviewedBy: { id: "r", name: "Reviewer" },
      reviewedAt: "today",
    }).includes("PDF page 2: “Save draft keeps work”"),
  );
  assert.ok(
    pdfSynthesisText({ ...s, reviewed: true }, "es").includes(
      "Página del PDF 2",
    ),
  );
});
