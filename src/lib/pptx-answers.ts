import { z } from "zod";
import { pptxQAInput, pptxQALabels, type PPTXQA } from "./pptx-qa";
import { validatePPTXPassageCitations } from "./pptx-synthesis";
import { type PPTXEvidence } from "./pptx-evidence";
export type PPTXAnswerRevision = z.infer<typeof pptxQAInput> & {
  version: number;
  at: string;
  editor: { id: string; name: string };
  reviewed: boolean;
  includeInReports: boolean;
};
export type SavedPPTXAnswer = {
  id: string;
  original: PPTXQA;
  sources: PPTXEvidence[];
  history: PPTXAnswerRevision[];
};
export type PPTXAnswerEvidence = {
  id: string;
  version: number;
  question: string;
  answer: string;
  citations: PPTXQA["citations"];
  sources: PPTXEvidence[];
  reviewerName: string;
  reviewedAt: string;
  model: string;
  promptVersion: string;
  generatedAt: string;
  edited: boolean;
};
export function includedPPTXAnswers(
  saved: SavedPPTXAnswer[] | undefined,
  sources: PPTXEvidence[],
): PPTXAnswerEvidence[] {
  const out: PPTXAnswerEvidence[] = [];
  for (const s of saved || []) {
    const r = s.history.at(-1);
    if (!r?.includeInReports) continue;
    if (!r.reviewed || !r.citations.length)
      throw new Error("INVALID_QA_REVIEW");
    validatePPTXPassageCitations(r.citations, sources);
    const snapshot = s.sources;
    for (const c of r.citations) {
      const frozen = snapshot.find(
        (e) =>
          e.pptxId === c.pptxId &&
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
              c.pptxId === e.pptxId &&
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
export function validatePPTXAnswerEvidence(
  entries: PPTXAnswerEvidence[] | undefined,
  sources: PPTXEvidence[],
) {
  for (const e of entries || []) {
    if (!e.citations.length) throw new Error("INVALID_QA_REVIEW");
    validatePPTXPassageCitations(e.citations, sources);
    for (const c of e.citations) {
      const frozen = e.sources.find(
        (s) =>
          s.pptxId === c.pptxId &&
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
export const pptxAnswerLabels = {
  en: {
    title: "Reviewed PPTX passage Q&A",
    notice:
      "Explicitly included, researcher-reviewed interpretations of selected PPTX excerpts. These are not participant statements or independently verified document facts and do not change sample or theme counts.",
    question: "Researcher question",
    answer: "Reviewed answer",
    reviewer: "Reviewed by",
    version: "Answer revision",
    edited: "Researcher edited",
  },
  es: {
    title: "Preguntas y respuestas revisadas sobre pasajes de PPTX",
    notice:
      "Interpretaciones de extractos seleccionados de PPTX, revisadas por el investigador e incluidas explícitamente. No son declaraciones de participantes ni hechos documentales verificados y no cambian los recuentos de muestra o temas.",
    question: "Pregunta del investigador",
    answer: "Respuesta revisada",
    reviewer: "Revisado por",
    version: "Revisión de respuesta",
    edited: "Editado por el investigador",
  },
  fr: {
    title: "Questions et réponses révisées sur les passages PPTX",
    notice:
      "Interprétations des extraits PPTX sélectionnés, révisées par un chercheur et explicitement incluses. Ce ne sont pas des déclarations de participants ni des faits documentaires vérifiés ; elles ne modifient pas les décomptes des participants ou des thèmes.",
    question: "Question du chercheur",
    answer: "Réponse révisée",
    reviewer: "Révisé par",
    version: "Révision de réponse",
    edited: "Modifié par le chercheur",
  },
};
export function pptxAnswersText(
  entries: PPTXAnswerEvidence[] | undefined,
  language: "en" | "es" | "fr" = "en",
) {
  if (!entries?.length) return "";
  const l = pptxAnswerLabels[language],
    q = pptxQALabels[language];
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
              `${q.slide} ${c.slide}: “${c.quote}” [${c.pptxId} · ${q.verification} ${c.verificationVersion} · ${q.characters} ${c.start + 1}–${c.end}]`,
          ),
          `${l.reviewer}: ${e.reviewerName} · ${e.reviewedAt} · ${l.version} ${e.version}`,
          `${e.model} · ${e.promptVersion} · ${e.generatedAt}${e.edited ? " · " + l.edited : ""}`,
        ].join("\n"),
      )
      .join("\n\n")
  );
}
