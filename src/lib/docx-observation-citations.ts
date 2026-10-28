import { z } from "zod";
import type { DOCXObservation } from "./docx-observations";
export const docxObservationCitation = z
  .object({
    docxId: z.string().min(1).max(100),
    reviewVersion: z.number().int().positive(),
    field: z.enum(["notes", "correction"]),
    quote: z.string().min(3).max(2000),
  })
  .strict();
export type DOCXObservationCitation = z.infer<typeof docxObservationCitation>;
export function validateDOCXObservationCitations(
  citations: DOCXObservationCitation[],
  evidence: DOCXObservation[],
) {
  for (const c of citations) {
    const e = evidence.find(
      (e) => e.docxId === c.docxId && e.reviewVersion === c.reviewVersion,
    );
    if (!e || !e[c.field].includes(c.quote))
      throw new Error("INVALID_CITATION");
  }
}
