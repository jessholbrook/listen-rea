import { z } from "zod";
import {
  pptxPassageCitation,
  validatePPTXPassageCitations,
} from "./pptx-synthesis";
import type { PPTXEvidence } from "./pptx-evidence";
export const pptxQAPromptVersion = "2026-10-21-pptx-qa-v1";
export const pptxQAInput = z
  .object({
    answer: z.string().trim().min(3).max(6000),
    citations: z.array(pptxPassageCitation).max(20),
  })
  .strict();
export type PPTXQA = z.infer<typeof pptxQAInput> & {
  question: string;
  model: string;
  promptVersion: string;
  generatedAt: string;
};
export const pptxQALabels = {
  en: {
    title: "Ask about verified PPTX passages",
    notice:
      "Ask OpenAI using only the excerpts explicitly included in this analysis. These are prepared document excerpts, not interview statements or independently verified facts. Check the cited slides before relying on an answer. Ask for a temporary answer, or explicitly save a private draft for later review and optional report inclusion.",
    payload:
      "Your question, selected excerpts and exact slide/verification/character references are sent. Full documents, unselected text, interview answers, researcher notes, names and private history are not sent through this request.",
    question: "Your PPTX passage question",
    ask: "Ask about PPTX passages",
    save: "Ask and save PPTX passage answer draft",
    answer: "AI answer about verified PPTX passages",
    clear: "Clear PPTX passage answer",
    working: "Working…",
    insufficient:
      "The included verified PPTX passages do not provide enough evidence to answer this question.",
    slide: "PPTX slide",
    verification: "Verification",
    characters: "Selected characters",
    source: "Open source response",
  },
  es: {
    title: "Preguntar sobre pasajes verificados de PPTX",
    notice:
      "Haga una pregunta a OpenAI usando solo los extractos incluidos explícitamente en este análisis. Son extractos de documentos preparados, no declaraciones de entrevistas ni hechos verificados independientemente. Revise las diapositivas citadas antes de utilizar una respuesta. Solicite una respuesta temporal o guarde explícitamente un borrador privado para revisarlo e incluirlo opcionalmente en informes.",
    payload:
      "Se envían su pregunta, los extractos seleccionados y las referencias exactas de diapositiva, verificación y caracteres. No se envían documentos completos, texto no seleccionado, respuestas de entrevistas, notas, nombres ni historial privado mediante esta solicitud.",
    question: "Su pregunta sobre pasajes de PPTX",
    ask: "Preguntar sobre pasajes de PPTX",
    save: "Preguntar y guardar borrador de respuesta PPTX",
    answer: "Respuesta de IA sobre pasajes verificados de PPTX",
    clear: "Borrar respuesta sobre pasajes de PPTX",
    working: "Procesando…",
    insufficient:
      "Los pasajes verificados de PPTX incluidos no ofrecen suficiente evidencia para responder esta pregunta.",
    slide: "Diapositiva del PPTX",
    verification: "Verificación",
    characters: "Caracteres seleccionados",
    source: "Abrir respuesta de origen",
  },
  fr: {
    title: "Interroger les passages PPTX vérifiés",
    notice:
      "Posez une question à OpenAI en utilisant uniquement les extraits explicitement inclus dans cette analyse. Ce sont des extraits de documents préparés, pas des déclarations d’entretien ni des faits vérifiés indépendamment. Vérifiez les diapositives citées avant d’utiliser une réponse. Demandez une réponse temporaire ou enregistrez explicitement un brouillon privé pour révision et inclusion facultative dans les rapports.",
    payload:
      "Votre question, les extraits sélectionnés et les références exactes de diapositive, vérification et caractères sont envoyés. Les documents complets, textes non sélectionnés, réponses d’entretien, notes, noms et historique privé ne sont pas envoyés par cette requête.",
    question: "Votre question sur les passages PPTX",
    ask: "Interroger les passages PPTX",
    save: "Interroger et enregistrer un brouillon de réponse PPTX",
    answer: "Réponse IA sur les passages PPTX vérifiés",
    clear: "Effacer la réponse sur les passages PPTX",
    working: "En cours…",
    insufficient:
      "Les passages PPTX vérifiés inclus ne fournissent pas assez d’éléments pour répondre à cette question.",
    slide: "Diapositive PPTX",
    verification: "Vérification",
    characters: "Caractères sélectionnés",
    source: "Ouvrir la réponse source",
  },
};
export function validatePPTXQA(
  input: unknown,
  evidence: PPTXEvidence[],
  language: "en" | "es" | "fr" = "en",
) {
  const result = pptxQAInput.parse(input);
  validatePPTXPassageCitations(result.citations, evidence);
  if (!result.citations.length)
    result.answer = pptxQALabels[language].insufficient;
  return result;
}
