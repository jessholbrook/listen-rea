import type { Interview, Turn } from "./domain";
import type { ImageReviewEntry } from "./image-review";
export type AttachmentEvidence = {
  imageId: string;
  interviewId: string;
  turnId: string;
  source: string;
  revisionId: string;
  conceptId?: string;
  reviewVersion: number;
  notes: string;
  reviewerName: string;
  reviewedAt: string;
  grounding: ImageReviewEntry["grounding"];
};
// Keep both review writes and downstream evidence bound to the same source snapshot.
export function attachmentSource(i: Interview, t: Turn, digest: unknown) {
  return JSON.stringify([
    i.id,
    t.id,
    t.questionId,
    t.prompt,
    t.answer,
    t.participantImage,
    digest,
    t.imageProbe || null,
  ]);
}
export const attachmentLabels = {
  en: {
    title: "Reviewed attachment observations",
    notice:
      "Researcher observations, not participant quotations. These do not add participants or change theme counts. AI theme coding uses participant answers; any synthesis of these notes stays separate.",
    reviewer: "Reviewer",
    review: "Review",
    image: "Image",
    response: "Response",
    turn: "Turn",
    notes: "Researcher notes",
    grounding: "AI question grounding",
  },
  es: {
    title: "Observaciones revisadas de archivos adjuntos",
    notice:
      "Observaciones del equipo investigador, no citas de participantes. No añaden participantes ni cambian los recuentos de temas. La codificación de temas con IA usa las respuestas; cualquier síntesis de estas notas permanece separada.",
    reviewer: "Revisor",
    review: "Revisión",
    image: "Imagen",
    response: "Respuesta",
    turn: "Intervención",
    notes: "Notas del investigador",
    grounding: "Fundamentación de la pregunta de IA",
  },
  fr: {
    title: "Observations vérifiées des pièces jointes",
    notice:
      "Observations de l’équipe de recherche, pas des citations de participants. Elles n’ajoutent pas de participants et ne modifient pas les décomptes des thèmes. Le codage des thèmes par IA utilise les réponses ; toute synthèse de ces notes reste distincte.",
    reviewer: "Responsable de la vérification",
    review: "Révision",
    image: "Image",
    response: "Réponse",
    turn: "Tour",
    notes: "Notes de recherche",
    grounding: "Ancrage de la question IA",
  },
};
export function attachmentEvidenceText(
  entries: AttachmentEvidence[] | undefined,
  language: "en" | "es" | "fr" = "en",
) {
  if (!entries?.length) return "";
  const l = attachmentLabels[language];
  return (
    "\n\n" +
    l.title +
    "\n" +
    l.notice +
    "\n\n" +
    entries
      .map(
        (e) =>
          `${l.notes}: ${e.notes}\n${l.reviewer}: ${e.reviewerName} · ${e.reviewedAt}\n${l.image}: ${e.imageId} · ${l.review}: ${e.reviewVersion}\n${l.response}: ${e.interviewId} · ${l.turn}: ${e.turnId}\n${l.grounding}: ${e.grounding}`,
      )
      .join("\n\n")
  );
}
