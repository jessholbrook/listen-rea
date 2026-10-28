import test from "node:test";
import assert from "node:assert/strict";
import {
  libraryAnswerExport,
  validateSavedLibraryCitations,
  libraryAnswerEdit,
  libraryAnswerLabels,
  type SavedLibraryAnswer,
} from "../src/lib/library-answers";
import { librarySourceChanges } from "../src/lib/library-answer-lifecycle";
import type { LibraryAttachmentHit } from "../src/lib/library-attachments";
const hit: LibraryAttachmentHit = {
  id: "a".repeat(64),
  studyId: "study",
  studyTitle: "Study title",
  revisionId: "revision",
  interviewId: "response",
  turnId: "turn",
  attachmentId: "file",
  format: "pptx",
  kind: "observation",
  field: "correction",
  grounding: "unsupported",
  version: 2,
  text: "Use the draft without assuming success.",
  reviewerName: "Source reviewer",
  reviewedAt: "source-time",
  attributes: { private: "ATTRIBUTE_SENTINEL" },
};
const example = (): SavedLibraryAnswer => ({
  id: "saved",
  workspaceId: "workspace",
  requestId: "request",
  inputHash: "hash",
  createdAt: "created",
  createdBy: { id: "author", name: "Author" },
  filter: {
    studyIds: [],
    formats: ["pptx"],
    kinds: ["observation"],
    query: "",
  },
  language: "en",
  sources: [hit],
  dependencies: [],
  original: {
    question: "What does draft review show?",
    answer: "PRIVATE_ORIGINAL_SENTINEL",
    citations: [{ evidenceId: hit.id, quote: hit.text }],
    model: "model",
    promptVersion: "prompt",
    generatedAt: "generation",
    evidenceCount: 1,
    searchedStudies: 1,
  },
  history: [
    {
      version: 1,
      at: "first",
      editor: { id: "author", name: "Author" },
      answer: "PRIVATE_EARLIER_REVISION",
      citations: [{ evidenceId: hit.id, quote: hit.text }],
      reviewed: false,
      includeInExports: false,
    },
    {
      version: 2,
      at: "last",
      editor: { id: "reviewer", name: "Reviewer" },
      answer: "=Reviewed latest interpretation",
      citations: [{ evidenceId: hit.id, quote: hit.text }],
      reviewed: true,
      includeInExports: true,
    },
  ],
});
test("review exports contain latest approved text and exact typed source provenance, omit private originals/history/attributes and escape formula cells", () => {
  for (const lang of ["en", "es", "fr"] as const) {
    const s = example();
    s.language = lang;
    for (const format of ["md", "csv"] as const) {
      const out = libraryAnswerExport(s, format);
      assert.ok(out.includes(libraryAnswerLabels[lang].warning));
      assert.ok(out.includes(hit.text));
      assert.ok(out.includes("Reviewed latest interpretation"));
      for (const hidden of [
        "PRIVATE_ORIGINAL_SENTINEL",
        "PRIVATE_EARLIER_REVISION",
        "ATTRIBUTE_SENTINEL",
      ])
        assert.equal(out.includes(hidden), false, hidden);
      assert.ok(out.includes("Source reviewer") && out.includes("Reviewer"));
      if (format === "csv")
        assert.ok(out.includes("'=Reviewed latest interpretation"));
    }
  }
  const s = example();
  s.history.at(-1)!.includeInExports = false;
  assert.throws(() => libraryAnswerExport(s, "md"), /NOT_APPROVED/);
});
test("saved review citations cannot be missing, partial, duplicated, invented or moved to another field", () => {
  const valid = example().history[0];
  validateSavedLibraryCitations(valid, [hit]);
  for (const citations of [
    [],
    [{ evidenceId: hit.id, quote: "Use the draft" }],
    [{ evidenceId: "b".repeat(64), quote: hit.text }],
    [valid.citations[0], valid.citations[0]],
  ])
    assert.throws(() =>
      validateSavedLibraryCitations({ ...valid, citations }, [hit]),
    );
  assert.equal(
    libraryAnswerEdit.safeParse({
      ...valid,
      version: 2,
      at: undefined,
      editor: undefined,
    }).success,
    false,
  );
});
test("source cleanup distinguishes unrelated/private changes, verification revisions, content replacement and response eligibility", () => {
  const before = {
    id: "file",
    source: "source",
    digest: "digest",
    pages: ["same page"],
    history: [{ version: 1, includeInReports: true }],
  };
  assert.deepEqual(
    librarySourceChanges("participantPDFText", before, {
      ...before,
      ocr: [{ draft: "private" }],
    }),
    [],
  );
  assert.equal(
    librarySourceChanges("participantPDFText", before, {
      ...before,
      history: [{ version: 2, includeInReports: false }],
    })[0].kind,
    "passage",
  );
  assert.equal(
    librarySourceChanges("participantPDFText", before, {
      ...before,
      digest: "changed",
    })[0].kind,
    undefined,
  );
  assert.equal(
    librarySourceChanges("participantPPTXReview", before, { ...before })[0]
      .kind,
    "observation",
  );
  const i = {
    id: "response",
    status: "complete",
    attributes: { team: "A" },
    turns: [{ id: "turn", answer: "same", participantPPTX: { id: "file" } }],
  };
  assert.deepEqual(
    librarySourceChanges("interview", i, {
      ...i,
      tokenHash: "changed",
      turns: [...i.turns, { id: "unrelated", answer: "new" }],
    }),
    [],
  );
  assert.equal(
    librarySourceChanges("interview", i, { ...i, excluded: true })[0].field,
    "interviewId",
  );
  assert.equal(
    librarySourceChanges("interview", i, { ...i, attributes: { team: "B" } })[0]
      .field,
    "interviewId",
  );
  assert.equal(
    librarySourceChanges("interview", i, {
      ...i,
      turns: [{ ...i.turns[0], participantPPTX: undefined }],
    })[0].id,
    "turn",
  );
});
