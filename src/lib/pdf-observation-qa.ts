import { z } from "zod";
import {
  pdfObservationCitation,
  validatePDFObservationCitations,
} from "./pdf-observation-citations";
import type { PDFObservation } from "./pdf-observations";
export const pdfObservationQAPromptVersion = "2026-10-21-pdf-observation-qa-v1";
export const pdfObservationQAInput = z
  .object({
    answer: z.string().trim().min(3).max(6000),
    citations: z.array(pdfObservationCitation).max(20),
  })
  .strict();
export type PDFObservationQA = z.infer<typeof pdfObservationQAInput> & {
  question: string;
  model: string;
  promptVersion: string;
  generatedAt: string;
};
export const pdfObservationQALabels = {
  en: {
    title: "Ask about researcher PDF observations",
    notice:
      "Answers interpret included researcher notes and corrections, not participant statements or verified document facts. Review the cited fields before using an answer. Ordinary answers stay in this view. Ask and save a private draft to review it; only explicitly included reviewed answers enter reports.",
    question: "Your PDF observation question",
    ask: "Ask about PDF observations",
    answer: "AI answer about researcher annotations",
    insufficient:
      "The included researcher PDF observations do not provide enough evidence to answer this question.",
    notes: "Researcher note",
    correction: "Researcher correction",
    review: "Review",
    clear: "Clear PDF observation answer",
  },
  es: {
    title: "Preguntar sobre observaciones de PDF",
    notice:
      "Las respuestas interpretan notas y correcciones incluidas del investigador, no declaraciones de participantes ni hechos documentales verificados. Revise los campos citados antes de usar una respuesta. Las respuestas normales permanecen en esta vista. Guarde un borrador privado para revisarlo; solo las respuestas revisadas e incluidas explícitamente entran en informes.",
    question: "Su pregunta sobre observaciones de PDF",
    ask: "Preguntar sobre observaciones de PDF",
    answer: "Respuesta de IA sobre anotaciones del investigador",
    insufficient:
      "Las observaciones de PDF incluidas del investigador no ofrecen suficiente evidencia para responder esta pregunta.",
    notes: "Nota del investigador",
    correction: "Corrección del investigador",
    review: "Revisión",
    clear: "Borrar respuesta sobre observaciones de PDF",
  },
  fr: {
    title: "Interroger les observations de recherche sur les PDF",
    notice:
      "Les réponses interprètent les notes et corrections de recherche incluses, pas des déclarations de participants ni des faits documentaires vérifiés. Vérifiez les champs cités avant d’utiliser une réponse. Les réponses ordinaires restent dans cette vue. Enregistrez un brouillon privé pour le réviser ; seules les réponses révisées et explicitement incluses entrent dans les rapports.",
    question: "Votre question sur les observations PDF",
    ask: "Interroger les observations PDF",
    answer: "Réponse IA sur les annotations de recherche",
    insufficient:
      "Les observations de recherche PDF incluses ne fournissent pas assez d’éléments pour répondre à cette question.",
    notes: "Note de recherche",
    correction: "Correction du chercheur",
    review: "Révision",
    clear: "Effacer la réponse sur les observations PDF",
  },
};
export function validatePDFObservationQA(
  input: unknown,
  evidence: PDFObservation[],
  language: "en" | "es" | "fr" = "en",
) {
  const result = pdfObservationQAInput.parse(input);
  validatePDFObservationCitations(result.citations, evidence);
  if (!result.citations.length)
    result.answer = pdfObservationQALabels[language].insufficient;
  return result;
}
