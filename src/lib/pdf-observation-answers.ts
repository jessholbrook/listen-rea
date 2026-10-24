import { z } from "zod";
import {
  pdfObservationQAInput,
  pdfObservationQALabels,
  type PDFObservationQA,
} from "./pdf-observation-qa";
import { validatePDFObservationCitations } from "./pdf-observation-citations";
import type { PDFObservation } from "./pdf-observations";
export type PDFObservationAnswerRevision = z.infer<
  typeof pdfObservationQAInput
> & {
  version: number;
  at: string;
  editor: { id: string; name: string };
  reviewed: boolean;
  includeInReports: boolean;
};
export type SavedPDFObservationAnswer = {
  id: string;
  original: PDFObservationQA;
  sources: PDFObservation[];
  history: PDFObservationAnswerRevision[];
};
export type PDFObservationAnswerEvidence = {
  id: string;
  version: number;
  question: string;
  answer: string;
  citations: PDFObservationQA["citations"];
  sources: PDFObservation[];
  reviewerName: string;
  reviewedAt: string;
  model: string;
  promptVersion: string;
  generatedAt: string;
  edited: boolean;
};
export function includedPDFObservationAnswers(
  saved: SavedPDFObservationAnswer[] | undefined,
  sources: PDFObservation[],
): PDFObservationAnswerEvidence[] {
  const out: PDFObservationAnswerEvidence[] = [];
  for (const s of saved || []) {
    const r = s.history.at(-1);
    if (!r?.includeInReports) continue;
    if (!r.reviewed || !r.citations.length)
      throw new Error("INVALID_QA_REVIEW");
    validatePDFObservationCitations(r.citations, sources);
    const snapshot = s.sources;
    for (const c of r.citations) {
      const frozen = snapshot.find(
        (e) => e.pdfId === c.pdfId && e.reviewVersion === c.reviewVersion,
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
            (c) => c.pdfId === e.pdfId && c.reviewVersion === e.reviewVersion,
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
export function validatePDFObservationAnswerEvidence(
  entries: PDFObservationAnswerEvidence[] | undefined,
  sources: PDFObservation[],
) {
  for (const e of entries || []) {
    if (!e.citations.length) throw new Error("INVALID_QA_REVIEW");
    validatePDFObservationCitations(e.citations, sources);
    for (const c of e.citations) {
      const frozen = e.sources.find(
        (s) => s.pdfId === c.pdfId && s.reviewVersion === c.reviewVersion,
      );
      if (
        !frozen ||
        !sources.some((s) => JSON.stringify(s) === JSON.stringify(frozen))
      )
        throw new Error("INVALID_CITATION");
    }
  }
}
export const pdfObservationAnswerLabels = {
  en: {
    title: "Reviewed PDF observation Q&A",
    notice:
      "Explicitly included, researcher-reviewed interpretations of PDF annotations. These are not participant statements or independently verified document facts and do not change sample or theme counts.",
    question: "Researcher question",
    answer: "Reviewed answer",
    reviewer: "Reviewed by",
    version: "Answer revision",
    edited: "Researcher edited",
  },
  es: {
    title: "Preguntas y respuestas revisadas sobre observaciones de PDF",
    notice:
      "Interpretaciones de anotaciones de PDF revisadas por el investigador e incluidas explícitamente. No son declaraciones de participantes ni hechos documentales verificados y no cambian los recuentos de muestra o temas.",
    question: "Pregunta del investigador",
    answer: "Respuesta revisada",
    reviewer: "Revisado por",
    version: "Revisión de respuesta",
    edited: "Editado por el investigador",
  },
  fr: {
    title: "Questions et réponses révisées sur les observations PDF",
    notice:
      "Interprétations des annotations PDF révisées par un chercheur et explicitement incluses. Ce ne sont pas des déclarations de participants ni des faits documentaires vérifiés ; elles ne modifient pas les décomptes des participants ou des thèmes.",
    question: "Question du chercheur",
    answer: "Réponse révisée",
    reviewer: "Révisé par",
    version: "Révision de réponse",
    edited: "Modifié par le chercheur",
  },
};
export function pdfObservationAnswersText(
  entries: PDFObservationAnswerEvidence[] | undefined,
  language: "en" | "es" | "fr" = "en",
) {
  if (!entries?.length) return "";
  const l = pdfObservationAnswerLabels[language],
    q = pdfObservationQALabels[language];
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
              `${q[c.field]}: “${c.quote}” [${c.pdfId} · ${q.review} ${c.reviewVersion}]`,
          ),
          `${l.reviewer}: ${e.reviewerName} · ${e.reviewedAt} · ${l.version} ${e.version}`,
          `${e.model} · ${e.promptVersion} · ${e.generatedAt}${e.edited ? " · " + l.edited : ""}`,
        ].join("\n"),
      )
      .join("\n\n")
  );
}
