import type { PDFReview } from "./participant-pdfs";
export type PDFObservation = {
  pdfId: string;
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
  grounding: NonNullable<PDFReview["history"][number]["grounding"]>;
  question?: { text: string; page?: number; quote?: string };
};
export const pdfObservationLabels = {
  en: {
    title: "Researcher PDF observations",
    notice:
      "Explicitly included researcher annotations, not participant quotations or verified PDF passages. These do not change participant or theme counts and reach AI only through an explicit PDF observation synthesis or Q&A request.",
    notes: "Researcher notes",
    correction: "Researcher correction",
    reviewer: "Reviewer",
    review: "Review",
    grounding: "Question grounding",
    question: "Original asked question",
    page: "PDF page",
    response: "Response",
    turn: "Turn",
    document: "PDF",
    supported: "Supported",
    unsupported: "Unsupported",
    uncertain: "Uncertain",
    not_applicable: "Not applicable",
  },
  es: {
    title: "Observaciones del investigador sobre PDF",
    notice:
      "Anotaciones del investigador incluidas explícitamente, no citas de participantes ni pasajes verificados de PDF. No cambian los recuentos de participantes o temas y solo se envían a la IA mediante una solicitud explícita de síntesis o preguntas sobre observaciones de PDF.",
    notes: "Notas del investigador",
    correction: "Corrección del investigador",
    reviewer: "Revisor",
    review: "Revisión",
    grounding: "Fundamentación de la pregunta",
    question: "Pregunta original formulada",
    page: "Página del PDF",
    response: "Respuesta",
    turn: "Intervención",
    document: "PDF",
    supported: "Fundamentada",
    unsupported: "No fundamentada",
    uncertain: "Incierta",
    not_applicable: "No aplicable",
  },
  fr: {
    title: "Observations de recherche sur les PDF",
    notice:
      "Annotations de recherche explicitement incluses, pas des citations de participants ni des passages PDF vérifiés. Elles ne modifient pas les décomptes des participants ou des thèmes et ne sont transmises à l’IA que sur demande explicite de synthèse ou de questions sur les observations PDF.",
    notes: "Notes de recherche",
    correction: "Correction du chercheur",
    reviewer: "Responsable de la vérification",
    review: "Révision",
    grounding: "Ancrage de la question",
    question: "Question initialement posée",
    page: "Page PDF",
    response: "Réponse",
    turn: "Tour",
    document: "PDF",
    supported: "Étayée",
    unsupported: "Non étayée",
    uncertain: "Incertaine",
    not_applicable: "Sans objet",
  },
};
export function pdfObservationText(
  e: PDFObservation,
  language: "en" | "es" | "fr" = "en",
) {
  const l = pdfObservationLabels[language];
  return [
    `${l.document}: ${e.pdfId} · ${l.response}: ${e.interviewId} · ${l.turn}: ${e.turnId}`,
    `${l.reviewer}: ${e.reviewerName} · ${e.reviewedAt} · ${l.review} ${e.reviewVersion}`,
    `${l.notes}: ${e.notes}`,
    `${l.correction}: ${e.correction}`,
    `${l.grounding}: ${l[e.grounding]}`,
    ...(e.question
      ? [
          `${l.question}: ${e.question.text}`,
          `${l.page} ${e.question.page}: “${e.question.quote}”`,
        ]
      : []),
  ].join("\n");
}
export function pdfObservationsText(
  entries: PDFObservation[] | undefined,
  language: "en" | "es" | "fr" = "en",
) {
  if (!entries?.length) return "";
  const l = pdfObservationLabels[language];
  return (
    "\n\n" +
    l.title +
    "\n" +
    l.notice +
    "\n\n" +
    entries.map((e) => pdfObservationText(e, language)).join("\n\n")
  );
}
