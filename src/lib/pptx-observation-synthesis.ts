import {
  pptxObservationCitation,
  validatePPTXObservationCitations,
} from "./pptx-observation-citations";
import { z } from "zod";
import type { PPTXObservation } from "./pptx-observations";
export const pptxObservationSynthesisPromptVersion =
  "2026-10-21-pptx-observation-synthesis-v1";
export const pptxObservationSynthesisInput = z
  .object({
    findings: z
      .array(
        z
          .object({
            title: z.string().trim().min(3).max(150),
            description: z.string().trim().min(3).max(1500),
            citations: z.array(pptxObservationCitation).min(1).max(10),
          })
          .strict(),
      )
      .max(6),
    limitations: z.string().trim().min(3).max(2000),
  })
  .strict();
export type PPTXObservationSynthesisContent = z.infer<
  typeof pptxObservationSynthesisInput
>;
export type PPTXObservationSynthesis = PPTXObservationSynthesisContent & {
  model: string;
  promptVersion: string;
  generatedAt: string;
  reviewed: boolean;
  reviewedBy?: { id: string; name: string };
  reviewedAt?: string;
  edited?: boolean;
};
export function validatePPTXObservationSynthesis(
  input: unknown,
  evidence: PPTXObservation[],
): PPTXObservationSynthesisContent {
  const parsed = pptxObservationSynthesisInput.parse(input);
  for (const finding of parsed.findings)
    validatePPTXObservationCitations(finding.citations, evidence);
  return parsed;
}
export const pptxObservationSynthesisLabels = {
  en: {
    title: "Synthesis of researcher PPTX observations",
    notice:
      "Interpretations of included researcher PPTX notes and corrections, not participant statements or verified document facts. No additional participants or theme counts.",
    limits: "Synthesis limitations",
    citation: "Researcher note",
    review: "Review",
    notes: "Researcher note",
    correction: "Researcher correction",
  },
  es: {
    title: "Síntesis de observaciones de PPTX",
    notice:
      "Interpretaciones de notas y correcciones de PPTX incluidas del equipo investigador, no declaraciones de participantes ni hechos documentales verificados. No añaden participantes ni recuentos de temas.",
    limits: "Limitaciones de la síntesis",
    citation: "Nota del investigador",
    review: "Revisión",
    notes: "Nota del investigador",
    correction: "Corrección del investigador",
  },
  fr: {
    title: "Synthèse des observations de recherche sur les PPTX",
    notice:
      "Interprétations des notes et corrections PPTX incluses, pas des déclarations de participants ni des faits documentaires vérifiés. Aucun participant ni décompte de thème supplémentaire.",
    limits: "Limites de la synthèse",
    citation: "Note de recherche",
    review: "Révision",
    notes: "Note de recherche",
    correction: "Correction du chercheur",
  },
};
export function pptxObservationSynthesisText(
  s: PPTXObservationSynthesis | undefined,
  language: "en" | "es" | "fr" = "en",
) {
  if (!s?.reviewed) return "";
  const l = pptxObservationSynthesisLabels[language];
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
            `${l[c.field]}: “${c.quote}” [${c.pptxId} · ${l.review} ${c.reviewVersion}]`,
        ),
      ]),
      l.limits,
      s.limitations,
      `${s.reviewedBy?.name || ""} · ${s.reviewedAt || ""} · ${s.model} · ${s.promptVersion}`,
    ].join("\n")
  );
}
