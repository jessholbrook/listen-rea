import { z } from "zod";
import {
  docxObservationQAInput,
  docxObservationQALabels,
  type DOCXObservationQA,
} from "./docx-observation-qa";
import { validateDOCXObservationCitations } from "./docx-observation-citations";
import type { DOCXObservation } from "./docx-observations";
export type DOCXObservationAnswerRevision = z.infer<
  typeof docxObservationQAInput
> & {
  version: number;
  at: string;
  editor: { id: string; name: string };
  reviewed: boolean;
  includeInReports: boolean;
};
export type SavedDOCXObservationAnswer = {
  id: string;
  original: DOCXObservationQA;
  sources: DOCXObservation[];
  history: DOCXObservationAnswerRevision[];
};
export type DOCXObservationAnswerEvidence = {
  id: string;
  version: number;
  question: string;
  answer: string;
  citations: DOCXObservationQA["citations"];
  sources: DOCXObservation[];
  reviewerName: string;
  reviewedAt: string;
  model: string;
  promptVersion: string;
  generatedAt: string;
  edited: boolean;
};
export function includedDOCXObservationAnswers(
  saved: SavedDOCXObservationAnswer[] | undefined,
  sources: DOCXObservation[],
): DOCXObservationAnswerEvidence[] {
  const out: DOCXObservationAnswerEvidence[] = [];
  for (const s of saved || []) {
    const r = s.history.at(-1);
    if (!r?.includeInReports) continue;
    if (!r.reviewed || !r.citations.length)
      throw new Error("INVALID_QA_REVIEW");
    validateDOCXObservationCitations(r.citations, sources);
    const snapshot = s.sources;
    for (const c of r.citations) {
      const frozen = snapshot.find(
        (e) => e.docxId === c.docxId && e.reviewVersion === c.reviewVersion,
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
            (c) => c.docxId === e.docxId && c.reviewVersion === e.reviewVersion,
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
export function validateDOCXObservationAnswerEvidence(
  entries: DOCXObservationAnswerEvidence[] | undefined,
  sources: DOCXObservation[],
) {
  for (const e of entries || []) {
    if (!e.citations.length) throw new Error("INVALID_QA_REVIEW");
    validateDOCXObservationCitations(e.citations, sources);
    for (const c of e.citations) {
      const frozen = e.sources.find(
        (s) => s.docxId === c.docxId && s.reviewVersion === c.reviewVersion,
      );
      if (
        !frozen ||
        !sources.some((s) => JSON.stringify(s) === JSON.stringify(frozen))
      )
        throw new Error("INVALID_CITATION");
    }
  }
}
export const docxObservationAnswerLabels = {
  en: {
    title: "Reviewed DOCX observation Q&A",
    notice:
      "Explicitly included, researcher-reviewed interpretations of DOCX annotations. These are not participant statements or independently verified document facts and do not change sample or theme counts.",
    question: "Researcher question",
    answer: "Reviewed answer",
    reviewer: "Reviewed by",
    version: "Answer revision",
    edited: "Researcher edited",
  },
  es: {
    title: "Preguntas y respuestas revisadas sobre observaciones de DOCX",
    notice:
      "Interpretaciones de anotaciones de DOCX revisadas por el investigador e incluidas explícitamente. No son declaraciones de participantes ni hechos documentales verificados y no cambian los recuentos de muestra o temas.",
    question: "Pregunta del investigador",
    answer: "Respuesta revisada",
    reviewer: "Revisado por",
    version: "Revisión de respuesta",
    edited: "Editado por el investigador",
  },
  fr: {
    title: "Questions et réponses révisées sur les observations DOCX",
    notice:
      "Interprétations des annotations DOCX révisées par un chercheur et explicitement incluses. Ce ne sont pas des déclarations de participants ni des faits documentaires vérifiés ; elles ne modifient pas les décomptes des participants ou des thèmes.",
    question: "Question du chercheur",
    answer: "Réponse révisée",
    reviewer: "Révisé par",
    version: "Révision de réponse",
    edited: "Modifié par le chercheur",
  },
};
export function docxObservationAnswersText(
  entries: DOCXObservationAnswerEvidence[] | undefined,
  language: "en" | "es" | "fr" = "en",
) {
  if (!entries?.length) return "";
  const l = docxObservationAnswerLabels[language],
    q = docxObservationQALabels[language];
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
              `${q[c.field]}: “${c.quote}” [${c.docxId} · ${q.review} ${c.reviewVersion}]`,
          ),
          `${l.reviewer}: ${e.reviewerName} · ${e.reviewedAt} · ${l.version} ${e.version}`,
          `${e.model} · ${e.promptVersion} · ${e.generatedAt}${e.edited ? " · " + l.edited : ""}`,
        ].join("\n"),
      )
      .join("\n\n")
  );
}
