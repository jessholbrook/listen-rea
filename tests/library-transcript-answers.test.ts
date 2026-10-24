import test from "node:test";
import assert from "node:assert/strict";
import {
  freezeTranscriptSources,
  transcriptDependency,
} from "../src/lib/library-transcript-sources-server";
import {
  libraryAnswerExport,
  type SavedLibraryAnswer,
} from "../src/lib/library-answers";
import { transcriptAnswerLabels } from "../src/lib/library-transcript-answers";
test("transcript citation freezing retains exact chunk offsets and original speaker context, rejects out-of-excerpt quotes, and exports only approved typed provenance", () => {
  const text = "Participant: Keep the draft. ".repeat(100),
    start = 500,
    quote = text.slice(start, start + 1500);
  const h = {
    studyId: "study",
    studyTitle: "Study",
    interviewId: "response",
    turnId: "turn",
    revisionId: "revision",
    prompt: "Question context",
    quote: text,
    source: "external" as const,
    sourceTitle: "PRIVATE_TITLE",
    externalId: "PRIVATE_IDENTIFIER",
    attributes: { secret: "PRIVATE_ATTRIBUTE" },
    language: "es" as const,
  };
  const evidence = {
    ...h,
    quote,
    semanticStart: start,
    semanticEnd: start + 1500,
    semanticChunkId: "chunk",
  };
  const citation = {
    studyId: h.studyId,
    interviewId: h.interviewId,
    turnId: h.turnId,
    quote: quote.slice(100, 200),
  };
  const corpus: any = {
    hits: [h],
    responses: [
      { id: h.interviewId, turns: [{ id: "earlier" }, { id: h.turnId }] },
    ],
  };
  const sources = freezeTranscriptSources([citation], [evidence], corpus);
  assert.equal(sources[0].locator.start, start + quote.indexOf(citation.quote));
  assert.equal(
    text.slice(sources[0].locator.start, sources[0].locator.end),
    citation.quote,
  );
  assert.equal(sources[0].locator.number, 2);
  assert.equal(sources[0].transcript.source, "external");
  assert.throws(
    () =>
      freezeTranscriptSources(
        [{ ...citation, quote: "not supplied" }],
        [evidence],
        corpus,
      ),
    /INVALID_CITATION/,
  );
  assert.equal(
    JSON.stringify(transcriptDependency(h)).includes("Participant:"),
    false,
  );
  const s: SavedLibraryAnswer = {
    id: "saved",
    workspaceId: "private-workspace",
    scope: "transcripts",
    requestId: "private-request",
    inputHash: "hash",
    createdAt: "date",
    createdBy: { id: "creator", name: "Creator" },
    filter: { studyIds: [], query: "", formats: ["pdf"], kinds: ["passage"] },
    language: "en",
    sources,
    dependencies: [transcriptDependency(h)],
    original: {
      answer: "PRIVATE_AI_ORIGINAL",
      citations: sources.map((h) => ({ evidenceId: h.id, quote: h.text })),
      question: "Draft workflow?",
      model: "marked-fixture",
      promptVersion: "prompt",
      generatedAt: "date",
      evidenceCount: 1,
      searchedStudies: 1,
    },
    history: [
      {
        answer: "=Researcher-reviewed finding",
        citations: sources.map((h) => ({ evidenceId: h.id, quote: h.text })),
        version: 2,
        at: "review-date",
        editor: { id: "reviewer", name: "Reviewer" },
        reviewed: true,
        includeInExports: true,
      },
    ],
  };
  for (const language of ["en", "es", "fr"] as const) {
    s.language = language;
    for (const format of ["md", "csv"] as const) {
      const output = libraryAnswerExport(s, format);
      for (const shown of [
        citation.quote,
        transcriptAnswerLabels[language].warning,
        "Question context",
        "external",
        "es",
      ])
        assert.ok(output.includes(shown));
      for (const hidden of [
        "PRIVATE_AI_ORIGINAL",
        "PRIVATE_TITLE",
        "PRIVATE_IDENTIFIER",
        "PRIVATE_ATTRIBUTE",
        "private-workspace",
      ])
        assert.equal(output.includes(hidden), false);
      if (format === "csv")
        assert.ok(output.includes("'=Researcher-reviewed finding"));
    }
  }
});
