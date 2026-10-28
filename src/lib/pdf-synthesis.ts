import { z } from "zod";
import type { PDFEvidence } from "./pdf-evidence";
export const pdfPassageCitation = z
  .object({
    pdfId: z.string().min(1).max(100),
    verificationVersion: z.number().int().positive(),
    page: z.number().int().min(1).max(20),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    quote: z
      .string()
      .min(1)
      .max(1000)
      .refine((q) => /\S/.test(q)),
  })
  .strict();
export const pdfSynthesisPromptVersion = "2026-10-20-pdf-synthesis-v1";
export const pdfSynthesisInput = z
  .object({
    findings: z
      .array(
        z
          .object({
            title: z.string().trim().min(3).max(150),
            description: z.string().trim().min(3).max(1500),
            citations: z.array(pdfPassageCitation).min(1).max(10),
          })
          .strict(),
      )
      .max(6),
    limitations: z.string().trim().min(3).max(2000),
  })
  .strict();
export type PDFSynthesisContent = z.infer<typeof pdfSynthesisInput>;
export type PDFSynthesis = PDFSynthesisContent & {
  model: string;
  promptVersion: string;
  generatedAt: string;
  reviewed: boolean;
  reviewedBy?: { id: string; name: string };
  reviewedAt?: string;
  edited?: boolean;
};
export function validatePDFSynthesis(
  input: unknown,
  evidence: PDFEvidence[],
): PDFSynthesisContent {
  const parsed = pdfSynthesisInput.parse(input);
  validatePDFPassageCitations(
    parsed.findings.flatMap((f) => f.citations),
    evidence,
  );
  return parsed;
}
export const pdfSynthesisLabels = {
  en: {
    title: "Synthesis of verified PDF passages",
    notice:
      "AI interpretations of selected, researcher-verified document excerpts. These are not interview statements or independently verified facts and do not change participant or theme counts.",
    limits: "PDF synthesis limitations",
    citation: "PDF page",
    review: "Verification",
  },
  es: {
    title: "Síntesis de pasajes verificados de PDF",
    notice:
      "Interpretaciones de IA de extractos seleccionados y verificados por un investigador. No son declaraciones de entrevistas ni hechos verificados independientemente y no cambian los recuentos de participantes o temas.",
    limits: "Limitaciones de la síntesis de PDF",
    citation: "Página del PDF",
    review: "Verificación",
  },
  fr: {
    title: "Synthèse des passages PDF vérifiés",
    notice:
      "Interprétations par IA d’extraits sélectionnés et vérifiés par un chercheur. Ce ne sont pas des déclarations d’entretien ni des faits vérifiés indépendamment ; elles ne modifient pas les décomptes des participants ou des thèmes.",
    limits: "Limites de la synthèse PDF",
    citation: "Page PDF",
    review: "Vérification",
  },
};
export function pdfSynthesisText(
  s: PDFSynthesis | undefined,
  language: "en" | "es" | "fr" = "en",
) {
  if (!s?.reviewed) return "";
  const l = pdfSynthesisLabels[language];
  return (
    "\n\n" +
    [
      l.title,
      l.notice,
      ...s.findings.flatMap((f) => [
        f.title,
        f.description,
        ...f.citations.map(
          (c) =>
            `${l.citation} ${c.page}: “${c.quote}” [${c.pdfId} · ${l.review} ${c.verificationVersion}]`,
        ),
      ]),
      l.limits,
      s.limitations,
      `${s.reviewedBy?.name || ""} · ${s.reviewedAt || ""} · ${s.model} · ${s.promptVersion}`,
    ].join("\n")
  );
}

export function validatePDFPassageCitations(
  citations: z.infer<typeof pdfPassageCitation>[],
  evidence: PDFEvidence[],
) {
  for (const c of citations) {
    const e = evidence.find(
      (e) =>
        e.pdfId === c.pdfId && e.verificationVersion === c.verificationVersion,
    );
    if (
      !e ||
      !e.passages.some(
        (p) =>
          p.page === c.page &&
          p.start === c.start &&
          p.end === c.end &&
          p.quote.includes(c.quote),
      )
    )
      throw new Error("INVALID_CITATION");
  }
}
