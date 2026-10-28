import type { DOCXReview } from "./participant-docx";
export type DOCXObservation = {
  docxId: string;
  interviewId: string;
  turnId: string;
  source: string;
  probeSource: string;
  revisionId: string;
  conceptId?: string;
  reviewVersion: number;
  reviewerName: string;
  reviewedAt: string;
  notes: string;
  correction: string;
  grounding: NonNullable<DOCXReview["history"][number]["grounding"]>;
  question?: { text: string; paragraph?: number; quote?: string };
};
export const docxObservationLabels = {
  en: {
    title: "Researcher DOCX observations",
    notice:
      "Explicitly included researcher annotations, not participant quotations or verified DOCX passages. These do not change participant or theme counts and remain separate from automated analysis.",
    notes: "Researcher notes",
    correction: "Researcher correction",
    reviewer: "Reviewer",
    review: "Review",
    grounding: "Question grounding",
    question: "Original asked question",
    paragraph: "DOCX paragraph",
    response: "Response",
    turn: "Turn",
    document: "DOCX",
    supported: "Supported",
    unsupported: "Unsupported",
    uncertain: "Uncertain",
    not_applicable: "Not applicable",
  },
  es: {
    title: "Observaciones del investigador sobre DOCX",
    notice:
      "Anotaciones del investigador incluidas explícitamente, no citas de participantes ni pasajes verificados de DOCX. No cambian los recuentos de participantes o temas y permanecen separadas del análisis automatizado.",
    notes: "Notas del investigador",
    correction: "Corrección del investigador",
    reviewer: "Revisor",
    review: "Revisión",
    grounding: "Fundamentación de la pregunta",
    question: "Pregunta original formulada",
    paragraph: "Párrafo del DOCX",
    response: "Respuesta",
    turn: "Intervención",
    document: "DOCX",
    supported: "Fundamentada",
    unsupported: "No fundamentada",
    uncertain: "Incierta",
    not_applicable: "No aplicable",
  },
  fr: {
    title: "Observations de recherche sur les DOCX",
    notice:
      "Annotations de recherche explicitement incluses, pas des citations de participants ni des passages DOCX vérifiés. Elles ne modifient pas les décomptes des participants ou des thèmes et restent distinctes de l’analyse automatisée.",
    notes: "Notes de recherche",
    correction: "Correction du chercheur",
    reviewer: "Responsable de la vérification",
    review: "Révision",
    grounding: "Ancrage de la question",
    question: "Question initialement posée",
    paragraph: "Paragraphe DOCX",
    response: "Réponse",
    turn: "Tour",
    document: "DOCX",
    supported: "Étayée",
    unsupported: "Non étayée",
    uncertain: "Incertaine",
    not_applicable: "Sans objet",
  },
};
export function docxObservationText(
  e: DOCXObservation,
  language: "en" | "es" | "fr" = "en",
) {
  const l = docxObservationLabels[language];
  return [
    `${l.document}: ${e.docxId} · ${l.response}: ${e.interviewId} · ${l.turn}: ${e.turnId}`,
    `${l.reviewer}: ${e.reviewerName} · ${e.reviewedAt} · ${l.review} ${e.reviewVersion}`,
    `${l.notes}: ${e.notes}`,
    `${l.correction}: ${e.correction}`,
    `${l.grounding}: ${l[e.grounding]}`,
    ...(e.question
      ? [
          `${l.question}: ${e.question.text}`,
          `${l.paragraph} ${e.question.paragraph}: “${e.question.quote}”`,
        ]
      : []),
  ].join("\n");
}
export function docxObservationsText(
  entries: DOCXObservation[] | undefined,
  language: "en" | "es" | "fr" = "en",
) {
  if (!entries?.length) return "";
  const l = docxObservationLabels[language];
  return (
    "\n\n" +
    l.title +
    "\n" +
    l.notice +
    "\n\n" +
    entries.map((e) => docxObservationText(e, language)).join("\n\n")
  );
}
