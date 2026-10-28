import type { PDFPassage } from "./pdf-text";
export type PDFEvidence = {
  pdfId: string;
  interviewId: string;
  turnId: string;
  source: string;
  digest: string;
  revisionId: string;
  conceptId?: string;
  verificationVersion: number;
  reviewerName: string;
  reviewedAt: string;
  passages: PDFPassage[];
  ocrPages?: number[];
};
export const pdfEvidenceLabels = {
  en: {
    title: "Verified PDF passages",
    notice:
      "Document excerpts verified and explicitly included by a researcher. These are not interview quotations, do not change participant or theme counts, and reach AI only through an explicit PDF synthesis request.",
    ocr: "Researcher-verified OCR",
    page: "PDF page",
    reviewer: "Verified by",
    version: "Verification",
    response: "Response",
    turn: "Turn",
    document: "PDF",
  },
  es: {
    title: "Pasajes verificados de PDF",
    notice:
      "Extractos de documentos verificados e incluidos explícitamente por un investigador. No son citas de entrevistas, no cambian los recuentos de participantes o temas y solo se envían a la IA mediante una solicitud explícita de síntesis de PDF.",
    ocr: "OCR verificado por un investigador",
    page: "Página del PDF",
    reviewer: "Verificado por",
    version: "Verificación",
    response: "Respuesta",
    turn: "Intervención",
    document: "PDF",
  },
  fr: {
    title: "Passages PDF vérifiés",
    notice:
      "Extraits de documents vérifiés et explicitement inclus par un chercheur. Ce ne sont pas des citations d’entretien ; ils ne modifient pas les décomptes des participants ou des thèmes et ne sont transmis à l’IA que sur demande explicite de synthèse PDF.",
    ocr: "OCR vérifié par un chercheur",
    page: "Page PDF",
    reviewer: "Vérifié par",
    version: "Vérification",
    response: "Réponse",
    turn: "Tour",
    document: "PDF",
  },
};
export function pdfEvidenceText(
  entries: PDFEvidence[] | undefined,
  language: "en" | "es" | "fr" = "en",
) {
  if (!entries?.length) return "";
  const l = pdfEvidenceLabels[language];
  return (
    "\n\n" +
    l.title +
    "\n" +
    l.notice +
    "\n\n" +
    entries
      .map(
        (e) =>
          `${l.document}: ${e.pdfId}\n${l.response}: ${e.interviewId} · ${l.turn}: ${e.turnId}\n${l.reviewer}: ${e.reviewerName} · ${e.reviewedAt} · ${l.version} ${e.verificationVersion}\n` +
          e.passages
            .map(
              (p) =>
                `${l.page} ${p.page}${e.ocrPages?.includes(p.page) ? ` · ${l.ocr}` : ""}: “${p.quote}”`,
            )
            .join("\n"),
      )
      .join("\n\n")
  );
}
