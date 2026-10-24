import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  briefContent,
  briefExport,
  briefLabels,
  type LibraryBrief,
} from "../src/lib/library-briefs";
import type { SavedLibraryAnswer } from "../src/lib/library-answers";
const examples = () => {
  const id = randomUUID();
  const a: SavedLibraryAnswer = {
    id,
    workspaceId: "private-workspace",
    requestId: "private-request",
    inputHash: "private-input",
    createdAt: "created",
    createdBy: { id: "private-user", name: "Author" },
    filter: { studyIds: [], query: "", formats: ["pptx"], kinds: ["passage"] },
    language: "en",
    dependencies: [],
    original: {
      question: "What does this slide show?",
      answer: "PRIVATE_AI_ORIGINAL",
      citations: [],
      model: "original-model",
      promptVersion: "prompt-v1",
      generatedAt: "generated",
      evidenceCount: 1,
      searchedStudies: 1,
      retrieval: {
        mode: "semantic",
        strategy: "hybrid-rrf-v1",
        model: "text-embedding-3-small",
        version: "index-v1",
        indexed: 1,
        eligible: 1,
        partial: false,
      },
    },
    sources: [
      {
        id: "evidence",
        studyId: "study",
        studyTitle: "Study",
        revisionId: "revision",
        interviewId: "response",
        turnId: "turn",
        attachmentId: "file",
        format: "pptx",
        kind: "passage",
        text: "Save draft before review.",
        version: 1,
        reviewerName: "Source reviewer",
        reviewedAt: "source-time",
        locator: { unit: "slide", number: 2, start: 0, end: 25 },
        attributes: { private: "PRIVATE_ATTRIBUTE" },
      },
    ],
    history: [
      {
        answer: "PRIVATE_EARLIER_REVIEW",
        citations: [],
        version: 1,
        at: "old-time",
        editor: { id: "old", name: "Old" },
        reviewed: false,
        includeInExports: false,
      },
      {
        answer: "Reviewed, exact interpretation",
        citations: [
          { evidenceId: "evidence", quote: "Save draft before review." },
        ],
        version: 2,
        at: "review-time",
        editor: { id: "reviewer", name: "Reviewer" },
        reviewed: true,
        includeInExports: true,
      },
    ],
  };
  const b: LibraryBrief = {
    ...briefContent.parse({
      title: "=Brief, title",
      summary: 'Summary with "quoted" text',
      sections: [
        {
          answerId: id,
          answerVersion: 2,
          heading: "Heading",
          commentary: "=Separate researcher commentary",
        },
      ],
    }),
    id: randomUUID(),
    workspaceId: a.workspaceId,
    requestId: randomUUID(),
    inputHash: "hash",
    version: 3,
    createdAt: "created",
    updatedAt: "brief-time",
    updatedBy: { id: "brief-editor", name: "Brief reviewer" },
    reviewed: true,
    includeInExports: true,
    dependencies: [],
    answerDependencies: [a.id],
  };
  return { a, b };
};
test("combined exports retain exact source/provenance and researcher attribution in EN/ES/FR, escape CSV and omit private originals/history/metadata", () => {
  const { a, b } = examples();
  for (const language of ["en", "es", "fr"] as const) {
    b.language = language;
    for (const format of ["md", "csv"] as const) {
      const text = briefExport(b, [a], format, "https://example.test");
      for (const expected of [
        briefLabels[language].warning,
        "Save draft before review.",
        "Reviewed, exact interpretation",
        "Separate researcher commentary",
        "Brief reviewer",
        "Source reviewer",
        "text-embedding-3-small",
        "hybrid-rrf-v1",
        "?study=study",
      ])
        assert.ok(text.includes(expected), expected);
      for (const hidden of [
        "PRIVATE_AI_ORIGINAL",
        "PRIVATE_EARLIER_REVIEW",
        "PRIVATE_ATTRIBUTE",
        "private-workspace",
        "private-request",
        "private-input",
      ])
        assert.equal(text.includes(hidden), false);
      if (format === "csv") {
        assert.ok(text.includes("'=Brief, title"));
        assert.ok(text.includes("'=Separate researcher commentary"));
        assert.ok(text.includes('""quoted""'));
      }
    }
  }
});
test("brief contracts enforce pinned approved revisions, exact citations, strict fields, section uniqueness and export size/review gates", () => {
  const { a, b } = examples();
  const input = { title: b.title, sections: b.sections };
  assert.equal(
    briefContent.safeParse({
      ...input,
      sections: [...b.sections, ...b.sections],
    }).success,
    false,
  );
  assert.equal(
    briefContent.safeParse({ ...input, sources: [] }).success,
    false,
  );
  assert.equal(
    briefContent.safeParse({
      ...input,
      sections: Array.from({ length: 21 }, () => ({
        ...b.sections[0],
        answerId: randomUUID(),
      })),
    }).success,
    false,
  );
  assert.throws(
    () => briefExport({ ...b, reviewed: false }, [a], "md"),
    /NOT_APPROVED/,
  );
  assert.throws(() => briefExport(b, [], "md"), /ANSWER_CHANGED/);
  assert.throws(
    () =>
      briefExport(
        { ...b, sections: b.sections.map((s) => ({ ...s, answerVersion: 1 })) },
        [a],
        "md",
      ),
    /ANSWER_CHANGED/,
  );
  a.history.at(-1)!.includeInExports = false;
  assert.throws(() => briefExport(b, [a], "csv"), /ANSWER_CHANGED/);
  a.history.at(-1)!.includeInExports = true;
  a.history.at(-1)!.citations[0].quote = "invented";
  assert.throws(() => briefExport(b, [a], "md"), /INVALID_CITATION/);
});
