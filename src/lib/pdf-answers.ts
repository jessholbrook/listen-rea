import { z } from "zod";
import { pdfQAInput, pdfQALabels, type PDFQA } from "./pdf-qa";
import { validatePDFPassageCitations } from "./pdf-synthesis";
import { pdfEvidenceLabels, type PDFEvidence } from "./pdf-evidence";
export type PDFAnswerRevision = z.infer<typeof pdfQAInput> & {
  version: number;
  at: string;
  editor: { id: string; name: string };
  reviewed: boolean;
  includeInReports: boolean;
};
export type SavedPDFAnswer = {
  id: string;
  original: PDFQA;
  sources: PDFEvidence[];
  history: PDFAnswerRevision[];
};
export type PDFAnswerEvidence = {
  id: string;
  version: number;
  question: string;
  answer: string;
  citations: PDFQA["citations"];
  sources: PDFEvidence[];
  reviewerName: string;
  reviewedAt: string;
  model: string;
  promptVersion: string;
  generatedAt: string;
  edited: boolean;
};
export function includedPDFAnswers(
  saved: SavedPDFAnswer[] | undefined,
  sources: PDFEvidence[],
): PDFAnswerEvidence[] {
  const out: PDFAnswerEvidence[] = [];
  for (const s of saved || []) {
    const r = s.history.at(-1);
    if (!r?.includeInReports) continue;
    if (!r.reviewed || !r.citations.length)
      throw new Error("INVALID_QA_REVIEW");
    validatePDFPassageCitations(r.citations, sources);
    const snapshot = s.sources;
    for (const c of r.citations) {
      const frozen = snapshot.find(
        (e) =>
          e.pdfId === c.pdfId &&
          e.verificationVersion === c.verificationVersion,
      );
      if (
        !frozen ||
        !sources.some((e) => JSON.stringify(e) === JSON.stringify(frozen))
      )
        throw new Error("INVALID_CITATION");
    }
    out.push({
      id: s.id,
      version: r.version,
      question: s.original.question,
      answer: r.answer,
      citations: structuredClone(r.citations),
      sources: structuredClone(
        snapshot.filter((e) =>
          r.citations.some(
            (c) =>
              c.pdfId === e.pdfId &&
              c.verificationVersion === e.verificationVersion,
          ),
        ),
      ),
      reviewerName: r.editor.name,
      reviewedAt: r.at,
      model: s.original.model,
      promptVersion: s.original.promptVersion,
      generatedAt: s.original.generatedAt,
      edited:
        r.answer !== s.original.answer ||
        JSON.stringify(r.citations) !== JSON.stringify(s.original.citations),
    });
  }
  return out;
}
export function validatePDFAnswerEvidence(
  entries: PDFAnswerEvidence[] | undefined,
  sources: PDFEvidence[],
) {
  for (const e of entries || []) {
    if (!e.citations.length) throw new Error("INVALID_QA_REVIEW");
    validatePDFPassageCitations(e.citations, sources);
    for (const c of e.citations) {
      const frozen = e.sources.find(
        (s) =>
          s.pdfId === c.pdfId &&
          s.verificationVersion === c.verificationVersion,
      );
      if (
        !frozen ||
        !sources.some((s) => JSON.stringify(s) === JSON.stringify(frozen))
      )
        throw new Error("INVALID_CITATION");
    }
  }
}
export const pdfAnswerLabels = {
  en: {
    title: "Reviewed PDF passage Q&A",
    notice:
      "Explicitly included, researcher-reviewed interpretations of selected PDF excerpts, including reviewed OCR. These are not participant statements or independently verified document facts and do not change sample or theme counts.",
    question: "Researcher question",
    answer: "Reviewed answer",
    reviewer: "Reviewed by",
    version: "Answer revision",
    edited: "Researcher edited",
  },
  es: {
    title: "Preguntas y respuestas revisadas sobre pasajes de PDF",
    notice:
      "Interpretaciones de extractos seleccionados de PDF, incluido OCR revisado, revisadas por el investigador e incluidas explícitamente. No son declaraciones de participantes ni hechos documentales verificados y no cambian los recuentos de muestra o temas.",
    question: "Pregunta del investigador",
    answer: "Respuesta revisada",
    reviewer: "Revisado por",
    version: "Revisión de respuesta",
    edited: "Editado por el investigador",
  },
  fr: {
    title: "Questions et réponses révisées sur les passages PDF",
    notice:
      "Interprétations des extraits PDF sélectionnés, y compris l’OCR révisé, révisées par un chercheur et explicitement incluses. Ce ne sont pas des déclarations de participants ni des faits documentaires vérifiés ; elles ne modifient pas les décomptes des participants ou des thèmes.",
    question: "Question du chercheur",
    answer: "Réponse révisée",
    reviewer: "Révisé par",
    version: "Révision de réponse",
    edited: "Modifié par le chercheur",
  },
};
export function pdfAnswersText(
  entries: PDFAnswerEvidence[] | undefined,
  language: "en" | "es" | "fr" = "en",
) {
  if (!entries?.length) return "";
  const l = pdfAnswerLabels[language],
    q = pdfQALabels[language];
  return (
    "\n\n" +
    l.title +
    "\n" +
    l.notice +
    "\n\n" +
    entries
      .map((e) =>
        [
          `${l.question}: ${e.question}`,
          `${l.answer}: ${e.answer}`,
          ...e.citations.map(
            (c) =>
              `${q.page} ${c.page}: “${c.quote}” [${c.pdfId} · ${q.verification} ${c.verificationVersion} · ${q.characters} ${c.start + 1}–${c.end}${e.sources.some((s) => s.pdfId === c.pdfId && s.ocrPages?.includes(c.page)) ? " · " + pdfEvidenceLabels[language].ocr : ""}]`,
          ),
          `${l.reviewer}: ${e.reviewerName} · ${e.reviewedAt} · ${l.version} ${e.version}`,
          `${e.model} · ${e.promptVersion} · ${e.generatedAt}${e.edited ? " · " + l.edited : ""}`,
        ].join("\n"),
      )
      .join("\n\n")
  );
}
