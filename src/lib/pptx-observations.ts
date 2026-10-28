import type { PPTXReview } from "./participant-pptx";
export type PPTXObservation = {
  pptxId: string;
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
  grounding: NonNullable<PPTXReview["history"][number]["grounding"]>;
  question?: { text: string; slide?: number; quote?: string };
};
export const pptxObservationLabels = {
  en: {
    title: "Researcher PPTX observations",
    notice:
      "Explicitly included researcher annotations, not participant quotations or verified PPTX passages. These do not change participant or theme counts and remain separate from participant theme analysis. Explicit AI actions can interpret included notes and corrections.",
    notes: "Researcher notes",
    correction: "Researcher correction",
    reviewer: "Reviewer",
    review: "Review",
    grounding: "Question grounding",
    question: "Original asked question",
    slide: "PPTX slide",
    response: "Response",
    turn: "Turn",
    document: "PPTX",
    supported: "Supported",
    unsupported: "Unsupported",
    uncertain: "Uncertain",
    not_applicable: "Not applicable",
  },
  es: {
    title: "Observaciones del investigador sobre PPTX",
    notice:
      "Anotaciones del investigador incluidas explícitamente, no citas de participantes ni pasajes verificados de PPTX. No cambian los recuentos de participantes o temas y permanecen separadas del análisis temático de participantes. Las acciones explícitas de IA pueden interpretar las notas y correcciones incluidas.",
    notes: "Notas del investigador",
    correction: "Corrección del investigador",
    reviewer: "Revisor",
    review: "Revisión",
    grounding: "Fundamentación de la pregunta",
    question: "Pregunta original formulada",
    slide: "Diapositiva del PPTX",
    response: "Respuesta",
    turn: "Intervención",
    document: "PPTX",
    supported: "Fundamentada",
    unsupported: "No fundamentada",
    uncertain: "Incierta",
    not_applicable: "No aplicable",
  },
  fr: {
    title: "Observations de recherche sur les PPTX",
    notice:
      "Annotations de recherche explicitement incluses, pas des citations de participants ni des passages PPTX vérifiés. Elles ne modifient pas les décomptes des participants ou des thèmes et restent distinctes de l’analyse thématique des participants. Des actions explicites d’IA peuvent interpréter les notes et corrections incluses.",
    notes: "Notes de recherche",
    correction: "Correction du chercheur",
    reviewer: "Responsable de la vérification",
    review: "Révision",
    grounding: "Ancrage de la question",
    question: "Question initialement posée",
    slide: "Diapositive PPTX",
    response: "Réponse",
    turn: "Tour",
    document: "PPTX",
    supported: "Étayée",
    unsupported: "Non étayée",
    uncertain: "Incertaine",
    not_applicable: "Sans objet",
  },
};
export function pptxObservationText(
  e: PPTXObservation,
  language: "en" | "es" | "fr" = "en",
) {
  const l = pptxObservationLabels[language];
  return [
    `${l.document}: ${e.pptxId} · ${l.response}: ${e.interviewId} · ${l.turn}: ${e.turnId}`,
    `${l.reviewer}: ${e.reviewerName} · ${e.reviewedAt} · ${l.review} ${e.reviewVersion}`,
    `${l.notes}: ${e.notes}`,
    `${l.correction}: ${e.correction}`,
    `${l.grounding}: ${l[e.grounding]}`,
    ...(e.question
      ? [
          `${l.question}: ${e.question.text}`,
          `${l.slide} ${e.question.slide}: “${e.question.quote}”`,
        ]
      : []),
  ].join("\n");
}
export function pptxObservationsText(
  entries: PPTXObservation[] | undefined,
  language: "en" | "es" | "fr" = "en",
) {
  if (!entries?.length) return "";
  const l = pptxObservationLabels[language];
  return (
    "\n\n" +
    l.title +
    "\n" +
    l.notice +
    "\n\n" +
    entries.map((e) => pptxObservationText(e, language)).join("\n\n")
  );
}
