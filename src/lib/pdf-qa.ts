import { z } from "zod";
import {
  pdfPassageCitation,
  validatePDFPassageCitations,
} from "./pdf-synthesis";
import type { PDFEvidence } from "./pdf-evidence";
export const pdfQAPromptVersion = "2026-10-21-pdf-qa-v1";
export const pdfQAInput = z
  .object({
    answer: z.string().trim().min(3).max(6000),
    citations: z.array(pdfPassageCitation).max(20),
  })
  .strict();
export type PDFQA = z.infer<typeof pdfQAInput> & {
  question: string;
  model: string;
  promptVersion: string;
  generatedAt: string;
};
export const pdfQALabels = {
  en: {
    title: "Ask about verified PDF passages",
    notice:
      "Ask OpenAI a question using only the passages explicitly included in this analysis, including researcher-verified OCR. Document excerpts are not interview statements or independently verified facts. Review the cited pages before relying on an answer. Ordinary answers stay in this view. Save a private draft to review it; only explicitly included reviewed answers enter reports.",
    payload:
      "Your question, selected excerpts, physical page and verification references, and OCR labels are sent. PDF files, page images, unselected text, interview answers, researcher notes, names and private history are not sent through this request.",
    question: "Your PDF passage question",
    ask: "Ask about PDF passages",
    save: "Ask and save PDF passage answer draft",
    answer: "AI answer about verified PDF passages",
    clear: "Clear PDF passage answer",
    working: "Working…",
    insufficient:
      "The included verified PDF passages do not provide enough evidence to answer this question.",
    page: "PDF page",
    verification: "Verification",
    characters: "Selected characters",
    source: "Open source response",
  },
  es: {
    title: "Preguntar sobre pasajes verificados de PDF",
    notice:
      "Haga una pregunta a OpenAI usando solo los pasajes incluidos explícitamente en este análisis, incluido el OCR verificado por un investigador. Los extractos no son declaraciones de entrevistas ni hechos verificados independientemente. Revise las páginas citadas antes de utilizar una respuesta. Las respuestas normales permanecen en esta vista. Guarde un borrador privado para revisarlo; solo las respuestas revisadas e incluidas explícitamente entran en informes.",
    payload:
      "Se envían su pregunta, los extractos seleccionados, referencias de página física y verificación y etiquetas de OCR. No se envían archivos PDF, imágenes de páginas, texto no seleccionado, respuestas de entrevistas, notas, nombres ni historial privado mediante esta solicitud.",
    question: "Su pregunta sobre pasajes de PDF",
    ask: "Preguntar sobre pasajes de PDF",
    save: "Preguntar y guardar borrador de respuesta sobre PDF",
    answer: "Respuesta de IA sobre pasajes verificados de PDF",
    clear: "Borrar respuesta sobre pasajes de PDF",
    working: "Procesando…",
    insufficient:
      "Los pasajes verificados de PDF incluidos no ofrecen suficiente evidencia para responder esta pregunta.",
    page: "Página del PDF",
    verification: "Verificación",
    characters: "Caracteres seleccionados",
    source: "Abrir respuesta de origen",
  },
  fr: {
    title: "Interroger les passages PDF vérifiés",
    notice:
      "Posez une question à OpenAI en utilisant uniquement les passages explicitement inclus dans cette analyse, y compris l’OCR vérifié par un chercheur. Ces extraits ne sont pas des déclarations d’entretien ni des faits vérifiés indépendamment. Vérifiez les pages citées avant d’utiliser une réponse. Les réponses ordinaires restent dans cette vue. Enregistrez un brouillon privé pour le réviser ; seules les réponses révisées et explicitement incluses entrent dans les rapports.",
    payload:
      "Votre question, les extraits sélectionnés, les références de page physique et de vérification et les mentions OCR sont envoyés. Les fichiers PDF, images de pages, textes non sélectionnés, réponses d’entretien, notes, noms et historique privé ne sont pas envoyés par cette requête.",
    question: "Votre question sur les passages PDF",
    ask: "Interroger les passages PDF",
    save: "Poser la question et enregistrer un brouillon PDF",
    answer: "Réponse IA sur les passages PDF vérifiés",
    clear: "Effacer la réponse sur les passages PDF",
    working: "En cours…",
    insufficient:
      "Les passages PDF vérifiés inclus ne fournissent pas assez d’éléments pour répondre à cette question.",
    page: "Page PDF",
    verification: "Vérification",
    characters: "Caractères sélectionnés",
    source: "Ouvrir la réponse source",
  },
};
export function validatePDFQA(
  input: unknown,
  evidence: PDFEvidence[],
  language: "en" | "es" | "fr" = "en",
) {
  const result = pdfQAInput.parse(input);
  validatePDFPassageCitations(result.citations, evidence);
  if (!result.citations.length)
    result.answer = pdfQALabels[language].insufficient;
  return result;
}
