import { z } from "zod";
import {
  pptxObservationQAInput,
  pptxObservationQALabels,
  type PPTXObservationQA,
} from "./pptx-observation-qa";
import { validatePPTXObservationCitations } from "./pptx-observation-citations";
import type { PPTXObservation } from "./pptx-observations";
export type PPTXObservationAnswerRevision = z.infer<
  typeof pptxObservationQAInput
> & {
  version: number;
  at: string;
  editor: { id: string; name: string };
  reviewed: boolean;
  includeInReports: boolean;
};
export type SavedPPTXObservationAnswer = {
  id: string;
  original: PPTXObservationQA;
  sources: PPTXObservation[];
  history: PPTXObservationAnswerRevision[];
};
export type PPTXObservationAnswerEvidence = {
  id: string;
  version: number;
  question: string;
  answer: string;
  citations: PPTXObservationQA["citations"];
  sources: PPTXObservation[];
  reviewerName: string;
  reviewedAt: string;
  model: string;
  promptVersion: string;
  generatedAt: string;
  edited: boolean;
};
export function includedPPTXObservationAnswers(
  saved: SavedPPTXObservationAnswer[] | undefined,
  sources: PPTXObservation[],
): PPTXObservationAnswerEvidence[] {
  const out: PPTXObservationAnswerEvidence[] = [];
  for (const s of saved || []) {
    const r = s.history.at(-1);
    if (!r?.includeInReports) continue;
    if (!r.reviewed || !r.citations.length)
      throw new Error("INVALID_QA_REVIEW");
    validatePPTXObservationCitations(r.citations, sources);
    const snapshot = s.sources;
    for (const c of r.citations) {
      const frozen = snapshot.find(
        (e) => e.pptxId === c.pptxId && e.reviewVersion === c.reviewVersion,
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
            (c) => c.pptxId === e.pptxId && c.reviewVersion === e.reviewVersion,
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
export function validatePPTXObservationAnswerEvidence(
  entries: PPTXObservationAnswerEvidence[] | undefined,
  sources: PPTXObservation[],
) {
  for (const e of entries || []) {
    if (!e.citations.length) throw new Error("INVALID_QA_REVIEW");
    validatePPTXObservationCitations(e.citations, sources);
    for (const c of e.citations) {
      const frozen = e.sources.find(
        (s) => s.pptxId === c.pptxId && s.reviewVersion === c.reviewVersion,
      );
      if (
        !frozen ||
        !sources.some((s) => JSON.stringify(s) === JSON.stringify(frozen))
      )
        throw new Error("INVALID_CITATION");
    }
  }
}
export const pptxObservationAnswerLabels = {
  en: {
    title: "Reviewed PPTX observation Q&A",
    notice:
      "Explicitly included, researcher-reviewed interpretations of PPTX annotations. These are not participant statements or independently verified document facts and do not change sample or theme counts.",
    question: "Researcher question",
    answer: "Reviewed answer",
    reviewer: "Reviewed by",
    version: "Answer revision",
    edited: "Researcher edited",
  },
  es: {
    title: "Preguntas y respuestas revisadas sobre observaciones de PPTX",
    notice:
      "Interpretaciones de anotaciones de PPTX revisadas por el investigador e incluidas explícitamente. No son declaraciones de participantes ni hechos documentales verificados y no cambian los recuentos de muestra o temas.",
    question: "Pregunta del investigador",
    answer: "Respuesta revisada",
    reviewer: "Revisado por",
    version: "Revisión de respuesta",
    edited: "Editado por el investigador",
  },
  fr: {
    title: "Questions et réponses révisées sur les observations PPTX",
    notice:
      "Interprétations des annotations PPTX révisées par un chercheur et explicitement incluses. Ce ne sont pas des déclarations de participants ni des faits documentaires vérifiés ; elles ne modifient pas les décomptes des participants ou des thèmes.",
    question: "Question du chercheur",
    answer: "Réponse révisée",
    reviewer: "Révisé par",
    version: "Révision de réponse",
    edited: "Modifié par le chercheur",
  },
};
export function pptxObservationAnswersText(
  entries: PPTXObservationAnswerEvidence[] | undefined,
  language: "en" | "es" | "fr" = "en",
) {
  if (!entries?.length) return "";
  const l = pptxObservationAnswerLabels[language],
    q = pptxObservationQALabels[language];
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
              `${q[c.field]}: “${c.quote}” [${c.pptxId} · ${q.review} ${c.reviewVersion}]`,
          ),
          `${l.reviewer}: ${e.reviewerName} · ${e.reviewedAt} · ${l.version} ${e.version}`,
          `${e.model} · ${e.promptVersion} · ${e.generatedAt}${e.edited ? " · " + l.edited : ""}`,
        ].join("\n"),
      )
      .join("\n\n")
  );
}
