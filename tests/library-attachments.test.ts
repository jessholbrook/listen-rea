import test from "node:test";
import assert from "node:assert/strict";
import {
  attachmentQuestionEvidence,
  libraryAttachmentFilter,
  rankLibraryAttachments,
  validateLibraryAttachmentAnswer,
  libraryAttachmentLabels,
  type LibraryAttachmentHit,
} from "../src/lib/library-attachments";
import {
  answerLibraryAttachments,
  libraryAttachmentPayload,
  libraryAttachmentPromptVersion,
} from "../src/lib/library-attachments-ai-server";
const hit = (
  changes: Partial<LibraryAttachmentHit> = {},
): LibraryAttachmentHit => ({
  id: "a".repeat(64),
  studyId: "study",
  studyTitle: "Private title",
  interviewId: "response",
  turnId: "turn",
  revisionId: "revision",
  conceptId: "concept",
  attachmentId: "file",
  format: "pptx",
  kind: "passage",
  version: 1,
  text: "Save draft before review.",
  locator: { unit: "slide", number: 2, start: 0, end: 25 },
  reviewerName: "Private name",
  reviewedAt: "private time",
  attributes: { team: "private attribute" },
  ...changes,
});
test("attachment filters reject unknown payloads, empty selections and foreign input shapes", () => {
  assert.equal(libraryAttachmentFilter.parse({}).formats.length, 4);
  for (const bad of [
    { formats: [] },
    { kinds: [] },
    { formats: ["zip"] },
    { studyIds: ["invalid"] },
    { participantId: "x" },
    { attribute: { key: "", value: "x" } },
  ])
    assert.equal(libraryAttachmentFilter.safeParse(bad).success, false);
});
test("keyword and question retrieval intersect filters, preserve whole evidence and enforce context budgets", () => {
  const a = hit(),
    b = hit({
      id: "b".repeat(64),
      text: "Publish after approval",
      studyTitle: "Other",
    });
  assert.deepEqual(rankLibraryAttachments([a, b], "draft"), [a]);
  assert.deepEqual(attachmentQuestionEvidence([a, b], "draft", "approval"), []);
  const many = Array.from({ length: 80 }, (_, i) =>
    hit({
      id: i.toString().padStart(64, "0"),
      text: "draft " + "x".repeat(1494),
    }),
  );
  const selected = attachmentQuestionEvidence(many, "", "draft");
  assert.equal(selected.length, 26);
  assert.ok(selected.reduce((n, h) => n + h.text.length, 0) <= 40000);
  assert.equal(
    attachmentQuestionEvidence(
      many.map((h) => ({ ...h, text: "draft" })),
      "",
      "draft",
    ).length,
    30,
  );
  assert.equal(
    attachmentQuestionEvidence(
      [hit({ text: "draft".repeat(500) })],
      "",
      "draft",
    ).length,
    0,
  );
  assert.equal(selected[0].text, many[0].text);
});
test("citations require complete exact evidence identity and field; localized insufficient output discards invented prose", () => {
  const h = hit(),
    output = {
      answer: "The verified excerpt describes saving a draft.",
      citations: [{ evidenceId: h.id, quote: h.text }],
    };
  assert.deepEqual(validateLibraryAttachmentAnswer(output, [h]), output);
  for (const c of [
    { evidenceId: h.id, quote: "Save draft" },
    { evidenceId: "b".repeat(64), quote: h.text },
    { evidenceId: h.id, quote: h.text + " " },
  ])
    assert.throws(
      () => validateLibraryAttachmentAnswer({ ...output, citations: [c] }, [h]),
      /INVALID_CITATION/,
    );
  for (const lang of ["en", "es", "fr"] as const)
    assert.equal(
      validateLibraryAttachmentAnswer(
        { answer: "Invented claim", citations: [] },
        [h],
        lang,
      ).answer,
      libraryAttachmentLabels[lang].insufficient,
    );
});
test("AI receives selected typed evidence and bounded generation without private source metadata", async () => {
  const h = hit({
    kind: "observation",
    field: "correction",
    grounding: "unclear",
    ocr: true,
  });
  const payload = libraryAttachmentPayload(
    [h],
    "What does draft review show?",
    "fr",
  );
  assert.equal(payload.outputLanguage, "Français");
  assert.deepEqual(
    Object.keys(payload.evidence[0]).sort(),
    [
      "evidenceId",
      "studyId",
      "revisionId",
      "conceptId",
      "format",
      "kind",
      "version",
      "field",
      "locator",
      "ocr",
      "grounding",
      "text",
    ].sort(),
  );
  for (const secret of [
    h.studyTitle,
    h.interviewId,
    h.turnId,
    h.attachmentId,
    h.reviewerName,
    h.reviewedAt,
    "private attribute",
  ])
    assert.equal(
      JSON.stringify(payload).includes('"' + secret + '"'),
      false,
      secret,
    );
  let calls = 0;
  const result = await answerLibraryAttachments(
    [h],
    "What does draft review show?",
    "fr",
    "workspace",
    async (...args) => {
      calls++;
      assert.match(args[0], /untrusted/);
      assert.match(args[0], /researcher notes\/corrections/);
      assert.equal(args[2], "workspace");
      assert.equal(args[3], "");
      assert.equal(args[4], "library-attachment-qa");
      assert.equal(args[6]?.maxTokens, 2000);
      assert.ok(args[6]?.signal instanceof AbortSignal);
      return {
        answer: "Une observation de recherche.",
        citations: [{ evidenceId: h.id, quote: h.text }],
      };
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.promptVersion, libraryAttachmentPromptVersion);
  await assert.rejects(
    () =>
      answerLibraryAttachments(
        [h],
        "draft review?",
        "en",
        "workspace",
        async () => ({
          answer: "Invented",
          citations: [{ evidenceId: h.id, quote: "wrong" }],
        }),
      ),
    /INVALID_CITATION/,
  );
});
