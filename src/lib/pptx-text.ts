export type PPTXPassage = {
  slide: number;
  start: number;
  end: number;
  quote: string;
};
export type PPTXVerification = {
  id: string;
  workspaceId: string;
  studyId: string;
  interviewId: string;
  turnId: string;
  source: string;
  digest: string;
  history: {
    version: number;
    at: string;
    reviewer: { id: string; name: string };
    passages: PPTXPassage[];
    includeInReports?: boolean;
  }[];
};
export type PPTXTextView = {
  source: string;
  digest: string;
  slides: string[];
  verification: PPTXVerification | null;
};

// Offsets use the prepared snapshot's UTF-16 code units, like textarea selection.
// Reject boundaries inside a surrogate pair so a citation remains readable.
function boundary(text: string, offset: number) {
  return !(
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[offset])
  );
}
export function validPPTXPassages(slides: string[], passages: PPTXPassage[]) {
  return (
    passages.every((p) => {
      const text = slides[p.slide - 1];
      return (
        Number.isInteger(p.slide) &&
        p.slide >= 1 &&
        text !== undefined &&
        Number.isInteger(p.start) &&
        Number.isInteger(p.end) &&
        p.start >= 0 &&
        p.end > p.start &&
        p.end <= text.length &&
        Boolean(p.quote.trim()) &&
        p.quote.length <= 1000 &&
        text.slice(p.start, p.end) === p.quote &&
        boundary(text, p.start) &&
        boundary(text, p.end)
      );
    }) &&
    new Set(passages.map((p) => `${p.slide}:${p.start}:${p.end}`)).size ===
      passages.length
  );
}
