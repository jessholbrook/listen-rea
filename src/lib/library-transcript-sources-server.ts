import { hash } from "./db";
import { transcriptLibraryCorpus } from "./library-transcript-corpus";
import type { SavedLibraryAnswer } from "./library-answers";
import type { SavedTranscriptSource } from "./library-transcript-answers";
import type { LibraryHit, LibraryCitation } from "./library";
import type { Actor } from "./domain";
export const transcriptTurnID = (
  h: Pick<LibraryHit, "studyId" | "interviewId" | "turnId">,
) => hash(JSON.stringify(["transcript", h.studyId, h.interviewId, h.turnId]));
export function transcriptDependency(h: LibraryHit) {
  return {
    id: transcriptTurnID(h),
    studyId: h.studyId,
    interviewId: h.interviewId,
    turnId: h.turnId,
    attachmentId: "",
    format: "transcript" as const,
    kind: "transcript" as const,
    fingerprint: hash(JSON.stringify(h)),
  };
}
export function freezeTranscriptSources(
  citations: LibraryCitation[],
  evidence: LibraryHit[],
  corpus: Awaited<ReturnType<typeof transcriptLibraryCorpus>>,
) {
  const sources: SavedTranscriptSource[] = [];
  for (const c of citations) {
    const h = evidence.find(
      (h) =>
        h.studyId === c.studyId &&
        h.interviewId === c.interviewId &&
        h.turnId === c.turnId &&
        h.quote.includes(c.quote),
    );
    const full = corpus.hits.find(
      (h) =>
        h.studyId === c.studyId &&
        h.interviewId === c.interviewId &&
        h.turnId === c.turnId,
    );
    if (!h || !full || c.quote.length > 2000 || c.quote.trim().length < 3)
      throw Error("INVALID_CITATION");
    const chunkStart = h.semanticStart ?? full.quote.indexOf(h.quote);
    if (
      chunkStart < 0 ||
      full.quote.slice(chunkStart, chunkStart + h.quote.length) !== h.quote
    )
      throw Error("INVALID_CITATION");
    const start = chunkStart + h.quote.indexOf(c.quote),
      end = start + c.quote.length;
    const number =
      corpus.responses
        .find((i) => i.id === h.interviewId)!
        .turns.findIndex((t) => t.id === h.turnId) + 1;
    const s: SavedTranscriptSource = {
      id: hash(JSON.stringify([transcriptTurnID(full), start, end])),
      studyId: full.studyId,
      studyTitle: full.studyTitle,
      interviewId: full.interviewId,
      turnId: full.turnId,
      revisionId: full.revisionId,
      ...(full.conceptId ? { conceptId: full.conceptId } : {}),
      attachmentId: "",
      format: "transcript",
      kind: "transcript",
      version: 0,
      text: c.quote,
      locator: { unit: "turn", number, start, end },
      transcript: {
        source: full.source,
        language: full.language || "en",
        prompt: full.prompt,
        ...(full.recordingSection
          ? { recordingSection: full.recordingSection }
          : {}),
      },
      reviewerName: "",
      reviewedAt: "",
      attributes: full.attributes,
    };
    if (!sources.some((h) => h.id === s.id)) sources.push(s);
  }
  if (!sources.length) throw Error("LIBRARY_CITATIONS_REQUIRED");
  return sources;
}
export async function transcriptAnswerCurrent(a: Actor, s: SavedLibraryAnswer) {
  const dependencies = s.dependencies;
  if (!dependencies?.length || s.sources.some((h) => h.format !== "transcript"))
    return false;
  const c = await transcriptLibraryCorpus(a, {
    studyIds: [...new Set(dependencies.map((d) => d.studyId))],
    collectionId: s.filter.collectionId,
    query: "",
  });
  if (
    dependencies.some(
      (d) =>
        !c.hits.some(
          (h) =>
            transcriptTurnID(h) === d.id &&
            hash(JSON.stringify(h)) === d.fingerprint,
        ),
    )
  )
    return false;
  return s.sources.every((source) => {
    if (source.format !== "transcript") return false;
    const h = c.hits.find(
      (h) =>
        h.studyId === source.studyId &&
        h.interviewId === source.interviewId &&
        h.turnId === source.turnId,
    );
    return (
      !!h &&
      h.quote.slice(source.locator.start, source.locator.end) === source.text &&
      c.responses
        .find((i) => i.id === h.interviewId)!
        .turns.findIndex((t) => t.id === h.turnId) +
        1 ===
        source.locator.number &&
      h.studyTitle === source.studyTitle &&
      h.revisionId === source.revisionId &&
      h.prompt === source.transcript.prompt &&
      JSON.stringify(h.recordingSection) ===
        JSON.stringify(source.transcript.recordingSection) &&
      h.source === source.transcript.source &&
      (h.language || "en") === source.transcript.language
    );
  });
}
