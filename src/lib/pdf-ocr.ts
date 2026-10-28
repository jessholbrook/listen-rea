import { z } from "zod";
export const pdfOCRPermissionVersion = "2026-10-21-pdf-ocr-v1";
export const pdfOCRPermissionText =
  "I authorize sending an image of this selected PDF page to OpenAI to transcribe its visible text. I have permission to process this page and will verify the draft against the PDF before using it.";
export const pdfOCROutput = z.object({ text: z.string().max(12000) }).strict();
export type PDFOCR = {
  id: string;
  page: number;
  draft: string;
  model: string;
  promptVersion: string;
  generatedAt: string;
  permission: {
    version: string;
    text: string;
    provider: "OpenAI";
    grantedAt: string;
    actor: { id: string; name: string };
  };
  corrections?: (NonNullable<PDFOCR["accepted"]> & {
    version: number;
    reason: string;
  })[];
  accepted?: {
    text: string;
    at: string;
    reviewer: { id: string; name: string };
    previousDigest: string;
    digest: string;
  };
};

export function verifiedOCRRevision(ocr: PDFOCR | undefined) {
  return ocr?.corrections?.at(-1) || ocr?.accepted;
}
