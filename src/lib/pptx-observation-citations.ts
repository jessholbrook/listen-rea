import { z } from "zod";
import type { PPTXObservation } from "./pptx-observations";
export const pptxObservationCitation = z
  .object({
    pptxId: z.string().min(1).max(100),
    reviewVersion: z.number().int().positive(),
    field: z.enum(["notes", "correction"]),
    quote: z
      .string()
      .min(3)
      .max(2000)
      .refine((q) => /\S/.test(q)),
  })
  .strict();
export type PPTXObservationCitation = z.infer<typeof pptxObservationCitation>;
export function validatePPTXObservationCitations(
  citations: PPTXObservationCitation[],
  evidence: PPTXObservation[],
) {
  for (const c of citations) {
    const e = evidence.find(
      (e) => e.pptxId === c.pptxId && e.reviewVersion === c.reviewVersion,
    );
    if (!e || !e[c.field].includes(c.quote))
      throw new Error("INVALID_CITATION");
  }
}
