import type { DOCXPassage } from "./docx-text";
export type DOCXEvidence = {
  docxId: string;
  interviewId: string;
  turnId: string;
  source: string;
  digest: string;
  revisionId: string;
  conceptId?: string;
  verificationVersion: number;
  reviewerName: string;
  reviewedAt: string;
  passages: DOCXPassage[];
};
export const docxEvidenceLabels = {
  en: {
    title: "Verified DOCX passages",
    notice:
      "Prepared document excerpts verified and explicitly included by a researcher. Paragraphs refer to the prepared text, not Word pages. These are not interview quotations, do not change participant or theme counts, and reach AI only through an explicit DOCX synthesis or Q&A request.",
    paragraph: "DOCX paragraph",
    characters: "characters",
    reviewer: "Verified by",
    version: "Verification",
    response: "Response",
    turn: "Turn",
    document: "DOCX",
    view: "View prepared text",
  },
  es: {
    title: "Pasajes verificados de DOCX",
    notice:
      "Extractos de documentos preparados, verificados e incluidos explícitamente por un investigador. Los párrafos corresponden al texto preparado, no a páginas de Word. No son citas de entrevistas, no cambian los recuentos de participantes o temas y solo se envían a la IA mediante una solicitud explícita de síntesis o preguntas sobre DOCX.",
    paragraph: "Párrafo del DOCX",
    characters: "caracteres",
    reviewer: "Verificado por",
    version: "Verificación",
    response: "Respuesta",
    turn: "Intervención",
    document: "DOCX",
    view: "Ver texto preparado",
  },
  fr: {
    title: "Passages DOCX vérifiés",
    notice:
      "Extraits de documents préparés, vérifiés et explicitement inclus par un chercheur. Les paragraphes correspondent au texte préparé, pas aux pages Word. Ce ne sont pas des citations d’entretien ; ils ne modifient pas les décomptes des participants ou des thèmes et ne sont transmis à l’IA que sur demande explicite de synthèse ou de questions sur le DOCX.",
    paragraph: "Paragraphe DOCX",
    characters: "caractères",
    reviewer: "Vérifié par",
    version: "Vérification",
    response: "Réponse",
    turn: "Tour",
    document: "DOCX",
    view: "Voir le texte préparé",
  },
};
export function docxEvidenceText(
  entries: DOCXEvidence[] | undefined,
  language: "en" | "es" | "fr" = "en",
) {
  if (!entries?.length) return "";
  const l = docxEvidenceLabels[language];
  return (
    "\n\n" +
    l.title +
    "\n" +
    l.notice +
    "\n\n" +
    entries
      .map(
        (e) =>
          `${l.document}: ${e.docxId}\n${l.response}: ${e.interviewId} · ${l.turn}: ${e.turnId}\n${l.reviewer}: ${e.reviewerName} · ${e.reviewedAt} · ${l.version} ${e.verificationVersion}\n` +
          e.passages
            .map(
              (p) =>
                `${l.paragraph} ${p.paragraph} · ${l.characters} ${p.start + 1}–${p.end}: “${p.quote}”`,
            )
            .join("\n"),
      )
      .join("\n\n")
  );
}
