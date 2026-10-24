import {
  pdfObservationCitation,
  validatePDFObservationCitations,
} from "./pdf-observation-citations";
import { z } from "zod";
import type { PDFObservation } from "./pdf-observations";
export const pdfObservationSynthesisPromptVersion =
  "2026-10-20-pdf-observation-synthesis-v1";
export const pdfObservationSynthesisInput = z
  .object({
    findings: z
      .array(
        z
          .object({
            title: z.string().trim().min(3).max(150),
            description: z.string().trim().min(3).max(1500),
            citations: z.array(pdfObservationCitation).min(1).max(10),
          })
          .strict(),
      )
      .max(6),
    limitations: z.string().trim().min(3).max(2000),
  })
  .strict();
export type PDFObservationSynthesisContent = z.infer<
  typeof pdfObservationSynthesisInput
>;
export type PDFObservationSynthesis = PDFObservationSynthesisContent & {
  model: string;
  promptVersion: string;
  generatedAt: string;
  reviewed: boolean;
  reviewedBy?: { id: string; name: string };
  reviewedAt?: string;
  edited?: boolean;
};
export function validatePDFObservationSynthesis(
  input: unknown,
  evidence: PDFObservation[],
): PDFObservationSynthesisContent {
  const parsed = pdfObservationSynthesisInput.parse(input);
  for (const finding of parsed.findings)
    validatePDFObservationCitations(finding.citations, evidence);
  return parsed;
}
export const pdfObservationSynthesisLabels = {
  en: {
    title: "Synthesis of researcher PDF observations",
    notice:
      "Interpretations of included researcher PDF notes and corrections, not participant statements or verified document facts. No additional participants or theme counts.",
    limits: "Synthesis limitations",
    citation: "Researcher note",
    review: "Review",
    notes: "Researcher note",
    correction: "Researcher correction",
  },
  es: {
    title: "Síntesis de observaciones de PDF",
    notice:
      "Interpretaciones de notas y correcciones de PDF incluidas del equipo investigador, no declaraciones de participantes ni hechos documentales verificados. No añaden participantes ni recuentos de temas.",
    limits: "Limitaciones de la síntesis",
    citation: "Nota del investigador",
    review: "Revisión",
    notes: "Nota del investigador",
    correction: "Corrección del investigador",
  },
  fr: {
    title: "Synthèse des observations de recherche sur les PDF",
    notice:
      "Interprétations des notes et corrections PDF incluses, pas des déclarations de participants ni des faits documentaires vérifiés. Aucun participant ni décompte de thème supplémentaire.",
    limits: "Limites de la synthèse",
    citation: "Note de recherche",
    review: "Révision",
    notes: "Note de recherche",
    correction: "Correction du chercheur",
  },
};
export function pdfObservationSynthesisText(
  s: PDFObservationSynthesis | undefined,
  language: "en" | "es" | "fr" = "en",
) {
  if (!s?.reviewed) return "";
  const l = pdfObservationSynthesisLabels[language];
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
            `${l[c.field]}: “${c.quote}” [${c.pdfId} · ${l.review} ${c.reviewVersion}]`,
        ),
      ]),
      l.limits,
      s.limitations,
      `${s.reviewedBy?.name || ""} · ${s.reviewedAt || ""} · ${s.model} · ${s.promptVersion}`,
    ].join("\n")
  );
}
