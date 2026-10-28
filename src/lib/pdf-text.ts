import type { PDFOCR } from "./pdf-ocr";
export type PDFPassage = {
  page: number;
  start: number;
  end: number;
  quote: string;
};
export type PDFText = {
  id: string;
  workspaceId: string;
  studyId: string;
  interviewId: string;
  turnId: string;
  source: string;
  digest: string;
  extractedAt: string;
  pages: string[];
  ocr?: PDFOCR[];
  history: {
    ocrPage?: number;
    ocrCorrectionVersion?: number;
    version: number;
    at: string;
    reviewer: { id: string; name: string };
    passages: PDFPassage[];
    includeInReports?: boolean;
  }[];
};
export type PDFTextView = { source: string; text: PDFText | null };

export function validPassages(pages: string[], passages: PDFPassage[]) {
  return (
    passages.every(
      (p) =>
        p.end > p.start && pages[p.page - 1]?.slice(p.start, p.end) === p.quote,
    ) &&
    new Set(passages.map((p) => `${p.page}:${p.start}:${p.end}`)).size ===
      passages.length
  );
}
