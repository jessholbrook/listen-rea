import {
  docxObservationCitation,
  validateDOCXObservationCitations,
} from "./docx-observation-citations";
import { z } from "zod";
import type { DOCXObservation } from "./docx-observations";
export const docxObservationSynthesisPromptVersion =
  "2026-10-21-docx-observation-synthesis-v1";
export const docxObservationSynthesisInput = z
  .object({
    findings: z
      .array(
        z
          .object({
            title: z.string().trim().min(3).max(150),
            description: z.string().trim().min(3).max(1500),
            citations: z.array(docxObservationCitation).min(1).max(10),
          })
          .strict(),
      )
      .max(6),
    limitations: z.string().trim().min(3).max(2000),
  })
  .strict();
export type DOCXObservationSynthesisContent = z.infer<
  typeof docxObservationSynthesisInput
>;
export type DOCXObservationSynthesis = DOCXObservationSynthesisContent & {
  model: string;
  promptVersion: string;
  generatedAt: string;
  reviewed: boolean;
  reviewedBy?: { id: string; name: string };
  reviewedAt?: string;
  edited?: boolean;
};
export function validateDOCXObservationSynthesis(
  input: unknown,
  evidence: DOCXObservation[],
): DOCXObservationSynthesisContent {
  const parsed = docxObservationSynthesisInput.parse(input);
  for (const finding of parsed.findings)
    validateDOCXObservationCitations(finding.citations, evidence);
  return parsed;
}
export const docxObservationSynthesisLabels = {
  en: {
    title: "Synthesis of researcher DOCX observations",
    notice:
      "Interpretations of included researcher DOCX notes and corrections, not participant statements or verified document facts. No additional participants or theme counts.",
    limits: "Synthesis limitations",
    citation: "Researcher note",
    review: "Review",
    notes: "Researcher note",
    correction: "Researcher correction",
  },
  es: {
    title: "Síntesis de observaciones de DOCX",
    notice:
      "Interpretaciones de notas y correcciones de DOCX incluidas del equipo investigador, no declaraciones de participantes ni hechos documentales verificados. No añaden participantes ni recuentos de temas.",
    limits: "Limitaciones de la síntesis",
    citation: "Nota del investigador",
    review: "Revisión",
    notes: "Nota del investigador",
    correction: "Corrección del investigador",
  },
  fr: {
    title: "Synthèse des observations de recherche sur les DOCX",
    notice:
      "Interprétations des notes et corrections DOCX incluses, pas des déclarations de participants ni des faits documentaires vérifiés. Aucun participant ni décompte de thème supplémentaire.",
    limits: "Limites de la synthèse",
    citation: "Note de recherche",
    review: "Révision",
    notes: "Note de recherche",
    correction: "Correction du chercheur",
  },
};
export function docxObservationSynthesisText(
  s: DOCXObservationSynthesis | undefined,
  language: "en" | "es" | "fr" = "en",
) {
  if (!s?.reviewed) return "";
  const l = docxObservationSynthesisLabels[language];
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
            `${l[c.field]}: “${c.quote}” [${c.docxId} · ${l.review} ${c.reviewVersion}]`,
        ),
      ]),
      l.limits,
      s.limitations,
      `${s.reviewedBy?.name || ""} · ${s.reviewedAt || ""} · ${s.model} · ${s.promptVersion}`,
    ].join("\n")
  );
}
