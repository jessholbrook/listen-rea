import { z } from "zod";
import {
  pptxObservationCitation,
  validatePPTXObservationCitations,
} from "./pptx-observation-citations";
import type { PPTXObservation } from "./pptx-observations";
export const pptxObservationQAPromptVersion =
  "2026-10-21-pptx-observation-qa-v1";
export const pptxObservationQAInput = z
  .object({
    answer: z.string().trim().min(3).max(6000),
    citations: z.array(pptxObservationCitation).max(20),
  })
  .strict();
export type PPTXObservationQA = z.infer<typeof pptxObservationQAInput> & {
  question: string;
  model: string;
  promptVersion: string;
  generatedAt: string;
};
export const pptxObservationQALabels = {
  en: {
    title: "Ask about researcher PPTX observations",
    notice:
      "Answers interpret included researcher notes and corrections, not participant statements or verified document facts. Review the cited fields before using an answer. Ordinary answers stay in this view. Ask and save a private draft to review it; only explicitly included reviewed answers enter reports.",
    question: "Your PPTX observation question",
    ask: "Ask about PPTX observations",
    answer: "AI answer about researcher annotations",
    insufficient:
      "The included researcher PPTX observations do not provide enough evidence to answer this question.",
    notes: "Researcher note",
    correction: "Researcher correction",
    review: "Review",
    clear: "Clear PPTX observation answer",
  },
  es: {
    title: "Preguntar sobre observaciones de PPTX",
    notice:
      "Las respuestas interpretan notas y correcciones incluidas del investigador, no declaraciones de participantes ni hechos documentales verificados. Revise los campos citados antes de usar una respuesta. Las respuestas normales permanecen en esta vista. Guarde un borrador privado para revisarlo; solo las respuestas revisadas e incluidas explícitamente entran en informes.",
    question: "Su pregunta sobre observaciones de PPTX",
    ask: "Preguntar sobre observaciones de PPTX",
    answer: "Respuesta de IA sobre anotaciones del investigador",
    insufficient:
      "Las observaciones de PPTX incluidas del investigador no ofrecen suficiente evidencia para responder esta pregunta.",
    notes: "Nota del investigador",
    correction: "Corrección del investigador",
    review: "Revisión",
    clear: "Borrar respuesta sobre observaciones de PPTX",
  },
  fr: {
    title: "Interroger les observations de recherche sur les PPTX",
    notice:
      "Les réponses interprètent les notes et corrections de recherche incluses, pas des déclarations de participants ni des faits documentaires vérifiés. Vérifiez les champs cités avant d’utiliser une réponse. Les réponses ordinaires restent dans cette vue. Enregistrez un brouillon privé pour le réviser ; seules les réponses révisées et explicitement incluses entrent dans les rapports.",
    question: "Votre question sur les observations PPTX",
    ask: "Interroger les observations PPTX",
    answer: "Réponse IA sur les annotations de recherche",
    insufficient:
      "Les observations de recherche PPTX incluses ne fournissent pas assez d’éléments pour répondre à cette question.",
    notes: "Note de recherche",
    correction: "Correction du chercheur",
    review: "Révision",
    clear: "Effacer la réponse sur les observations PPTX",
  },
};
export function validatePPTXObservationQA(
  input: unknown,
  evidence: PPTXObservation[],
  language: "en" | "es" | "fr" = "en",
) {
  const result = pptxObservationQAInput.parse(input);
  validatePPTXObservationCitations(result.citations, evidence);
  if (!result.citations.length)
    result.answer = pptxObservationQALabels[language].insufficient;
  return result;
}
