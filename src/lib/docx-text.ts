export type DOCXPassage = {
  paragraph: number;
  start: number;
  end: number;
  quote: string;
};
export type DOCXVerification = {
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
    passages: DOCXPassage[];
    includeInReports?: boolean;
  }[];
};
export type DOCXTextView = {
  source: string;
  digest: string;
  paragraphs: string[];
  verification: DOCXVerification | null;
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
export function validDOCXPassages(
  paragraphs: string[],
  passages: DOCXPassage[],
) {
  return (
    passages.every((p) => {
      const text = paragraphs[p.paragraph - 1];
      return (
        Number.isInteger(p.paragraph) &&
        p.paragraph >= 1 &&
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
    new Set(passages.map((p) => `${p.paragraph}:${p.start}:${p.end}`)).size ===
      passages.length
  );
}
