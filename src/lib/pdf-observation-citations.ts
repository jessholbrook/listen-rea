import { z } from "zod";
import type { PDFObservation } from "./pdf-observations";
export const pdfObservationCitation = z
  .object({
    pdfId: z.string().min(1).max(100),
    reviewVersion: z.number().int().positive(),
    field: z.enum(["notes", "correction"]),
    quote: z.string().min(3).max(2000),
  })
  .strict();
export type PDFObservationCitation = z.infer<typeof pdfObservationCitation>;
export function validatePDFObservationCitations(
  citations: PDFObservationCitation[],
  evidence: PDFObservation[],
) {
  for (const c of citations) {
    const e = evidence.find(
      (e) => e.pdfId === c.pdfId && e.reviewVersion === c.reviewVersion,
    );
    if (!e || !e[c.field].includes(c.quote))
      throw new Error("INVALID_CITATION");
  }
}
