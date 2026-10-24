import { z } from "zod";
import {
  docxPassageCitation,
  validateDOCXPassageCitations,
} from "./docx-synthesis";
import type { DOCXEvidence } from "./docx-evidence";
export const docxQAPromptVersion = "2026-10-21-docx-qa-v1";
export const docxQAInput = z
  .object({
    answer: z.string().trim().min(3).max(6000),
    citations: z.array(docxPassageCitation).max(20),
  })
  .strict();
export type DOCXQA = z.infer<typeof docxQAInput> & {
  question: string;
  model: string;
  promptVersion: string;
  generatedAt: string;
};
export const docxQALabels = {
  en: {
    title: "Ask about verified DOCX passages",
    notice:
      "Ask OpenAI using only the excerpts explicitly included in this analysis. These are prepared document excerpts, not interview statements or independently verified facts. Check the cited paragraphs before relying on an answer. Ask for a temporary answer, or explicitly save a private draft for later review and optional report inclusion.",
    payload:
      "Your question, selected excerpts and exact paragraph/verification/character references are sent. Full documents, unselected text, interview answers, researcher notes, names and private history are not sent through this request.",
    question: "Your DOCX passage question",
    ask: "Ask about DOCX passages",
    save: "Ask and save DOCX passage answer draft",
    answer: "AI answer about verified DOCX passages",
    clear: "Clear DOCX passage answer",
    working: "Working…",
    insufficient:
      "The included verified DOCX passages do not provide enough evidence to answer this question.",
    paragraph: "DOCX paragraph",
    verification: "Verification",
    characters: "Selected characters",
    source: "Open source response",
  },
  es: {
    title: "Preguntar sobre pasajes verificados de DOCX",
    notice:
      "Haga una pregunta a OpenAI usando solo los extractos incluidos explícitamente en este análisis. Son extractos de documentos preparados, no declaraciones de entrevistas ni hechos verificados independientemente. Revise los párrafos citados antes de utilizar una respuesta. Solicite una respuesta temporal o guarde explícitamente un borrador privado para revisarlo e incluirlo opcionalmente en informes.",
    payload:
      "Se envían su pregunta, los extractos seleccionados y las referencias exactas de párrafo, verificación y caracteres. No se envían documentos completos, texto no seleccionado, respuestas de entrevistas, notas, nombres ni historial privado mediante esta solicitud.",
    question: "Su pregunta sobre pasajes de DOCX",
    ask: "Preguntar sobre pasajes de DOCX",
    save: "Preguntar y guardar borrador de respuesta DOCX",
    answer: "Respuesta de IA sobre pasajes verificados de DOCX",
    clear: "Borrar respuesta sobre pasajes de DOCX",
    working: "Procesando…",
    insufficient:
      "Los pasajes verificados de DOCX incluidos no ofrecen suficiente evidencia para responder esta pregunta.",
    paragraph: "Párrafo del DOCX",
    verification: "Verificación",
    characters: "Caracteres seleccionados",
    source: "Abrir respuesta de origen",
  },
  fr: {
    title: "Interroger les passages DOCX vérifiés",
    notice:
      "Posez une question à OpenAI en utilisant uniquement les extraits explicitement inclus dans cette analyse. Ce sont des extraits de documents préparés, pas des déclarations d’entretien ni des faits vérifiés indépendamment. Vérifiez les paragraphes cités avant d’utiliser une réponse. Demandez une réponse temporaire ou enregistrez explicitement un brouillon privé pour révision et inclusion facultative dans les rapports.",
    payload:
      "Votre question, les extraits sélectionnés et les références exactes de paragraphe, vérification et caractères sont envoyés. Les documents complets, textes non sélectionnés, réponses d’entretien, notes, noms et historique privé ne sont pas envoyés par cette requête.",
    question: "Votre question sur les passages DOCX",
    ask: "Interroger les passages DOCX",
    save: "Interroger et enregistrer un brouillon de réponse DOCX",
    answer: "Réponse IA sur les passages DOCX vérifiés",
    clear: "Effacer la réponse sur les passages DOCX",
    working: "En cours…",
    insufficient:
      "Les passages DOCX vérifiés inclus ne fournissent pas assez d’éléments pour répondre à cette question.",
    paragraph: "Paragraphe DOCX",
    verification: "Vérification",
    characters: "Caractères sélectionnés",
    source: "Ouvrir la réponse source",
  },
};
export function validateDOCXQA(
  input: unknown,
  evidence: DOCXEvidence[],
  language: "en" | "es" | "fr" = "en",
) {
  const result = docxQAInput.parse(input);
  validateDOCXPassageCitations(result.citations, evidence);
  if (!result.citations.length)
    result.answer = docxQALabels[language].insufficient;
  return result;
}
