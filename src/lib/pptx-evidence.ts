import type { PPTXPassage } from "./pptx-text";
export type PPTXEvidence = {
  pptxId: string;
  interviewId: string;
  turnId: string;
  source: string;
  digest: string;
  revisionId: string;
  conceptId?: string;
  verificationVersion: number;
  reviewerName: string;
  reviewedAt: string;
  passages: PPTXPassage[];
};
export const pptxEvidenceLabels = {
  en: {
    title: "Verified PPTX passages",
    notice:
      "Prepared document excerpts verified and explicitly included by a researcher. Slide numbers follow the original presentation order; this is prepared text, not a rendered slide. These are not interview quotations, do not change participant or theme counts, and can be sent to AI only through explicit synthesis or Q&A actions.",
    slide: "PPTX slide",
    characters: "characters",
    reviewer: "Verified by",
    version: "Verification",
    response: "Response",
    turn: "Turn",
    document: "PPTX",
    view: "View prepared text",
  },
  es: {
    title: "Pasajes verificados de PPTX",
    notice:
      "Extractos de documentos preparados, verificados e incluidos explícitamente por un investigador. Las diapositivas siguen el orden de la presentación original; es texto preparado, no una vista renderizada. No son citas de entrevistas, no cambian los recuentos de participantes o temas y solo se envían a la IA mediante acciones explícitas de síntesis o preguntas.",
    slide: "Diapositiva del PPTX",
    characters: "caracteres",
    reviewer: "Verificado por",
    version: "Verificación",
    response: "Respuesta",
    turn: "Intervención",
    document: "PPTX",
    view: "Ver texto preparado",
  },
  fr: {
    title: "Passages PPTX vérifiés",
    notice:
      "Extraits de documents préparés, vérifiés et explicitement inclus par un chercheur. Les diapositives suivent l’ordre de la présentation originale ; ce texte préparé n’est pas un rendu visuel. Ce ne sont pas des citations d’entretien ; ils ne modifient pas les décomptes des participants ou des thèmes et ne sont transmis à l’IA que par des actions explicites de synthèse ou de questions.",
    slide: "Diapositive PPTX",
    characters: "caractères",
    reviewer: "Vérifié par",
    version: "Vérification",
    response: "Réponse",
    turn: "Tour",
    document: "PPTX",
    view: "Voir le texte préparé",
  },
};
export function pptxEvidenceText(
  entries: PPTXEvidence[] | undefined,
  language: "en" | "es" | "fr" = "en",
) {
  if (!entries?.length) return "";
  const l = pptxEvidenceLabels[language];
  return (
    "\n\n" +
    l.title +
    "\n" +
    l.notice +
    "\n\n" +
    entries
      .map(
        (e) =>
          `${l.document}: ${e.pptxId}\n${l.response}: ${e.interviewId} · ${l.turn}: ${e.turnId}\n${l.reviewer}: ${e.reviewerName} · ${e.reviewedAt} · ${l.version} ${e.verificationVersion}\n` +
          e.passages
            .map(
              (p) =>
                `${l.slide} ${p.slide} · ${l.characters} ${p.start + 1}–${p.end}: “${p.quote}”`,
            )
            .join("\n"),
      )
      .join("\n\n")
  );
}
