import {
  recordingExportHeaders,
  recordingExportFields,
  recordingRangeLabel,
} from "./recording-sections";
import {
  transcriptAnswerLabels,
  type SavedTranscriptSource,
} from "./library-transcript-answers";
import type { SemanticRetrieval } from "./library-semantic";
import { z } from "zod";
import {
  libraryAttachmentOutput,
  libraryAttachmentLabels,
  type LibraryAttachmentFilter,
  type LibraryAttachmentHit,
} from "./library-attachments";
import type { Language } from "./localization";
import { csv } from "./evidence";
export const libraryAnswerEdit = libraryAttachmentOutput
  .extend({
    version: z.number().int().positive(),
    reviewed: z.boolean(),
    includeInExports: z.boolean(),
  })
  .strict();
type TextAnswer = z.infer<typeof libraryAttachmentOutput>;
export type LibraryAnswerRevision = TextAnswer & {
  version: number;
  at: string;
  editor: { id: string; name: string };
  reviewed: boolean;
  includeInExports: boolean;
};
export type SavedLibrarySource = LibraryAttachmentHit | SavedTranscriptSource;
export type SavedLibraryAnswer = {
  scope?: "attachments" | "transcripts";
  id: string;
  workspaceId: string;
  requestId: string;
  inputHash: string;
  createdAt: string;
  createdBy: { id: string; name: string };
  filter: LibraryAttachmentFilter;
  language: Language;
  original: TextAnswer & {
    question: string;
    model: string;
    promptVersion: string;
    generatedAt: string;
    evidenceCount: number;
    searchedStudies: number;
    retrieval?: SemanticRetrieval;
  };
  sources: SavedLibrarySource[];
  dependencies: (Pick<
    SavedLibrarySource,
    | "id"
    | "studyId"
    | "interviewId"
    | "turnId"
    | "attachmentId"
    | "format"
    | "kind"
  > & { fingerprint: string })[];
  history: LibraryAnswerRevision[];
};
export function validateSavedLibraryCitations(
  answer: TextAnswer,
  sources: SavedLibrarySource[],
) {
  if (!answer.citations.length) throw new Error("LIBRARY_CITATIONS_REQUIRED");
  for (const c of answer.citations)
    if (!sources.some((s) => s.id === c.evidenceId && s.text === c.quote))
      throw new Error("INVALID_CITATION");
  if (
    new Set(answer.citations.map((c) => c.evidenceId)).size !==
    answer.citations.length
  )
    throw new Error("DUPLICATE_CITATION");
}
export const libraryAnswerLabels = {
  en: {
    title: "Saved library answers",
    save: "Ask & save draft",
    refresh: "Refresh saved answers",
    notice:
      "Save a new server-generated answer as a workspace draft. Review the answer and every source, then separately approve it for export. Originals and earlier reviews remain private. Source changes or withdrawal remove the whole saved answer, including its history. Downloads already copied cannot be recalled.",
    empty: "No saved library answers.",
    open: "Review saved answer",
    original: "Original AI answer",
    history: "Review history",
    answer: "Answer text",
    reviewed: "I reviewed this answer and its cited sources",
    include: "Approve latest reviewed revision for export",
    update: "Save review revision",
    withdraw: "Withdraw export approval",
    remove: "Delete saved answer",
    markdown: "Download reviewed text",
    csv: "Download reviewed CSV",
    close: "Close saved answer",
    draft: "Draft",
    approved: "Approved for export",
    revision: "Answer revision",
    citation: "Keep citation",
    question: "Researcher question",
    reviewer: "Reviewed by",
    edited: "Researcher edited",
    warning:
      "Researcher-reviewed interpretations of included document excerpts and observations. These are not participant statements or independently verified facts. Keyword coverage and interpretation require human review.",
    sources: "Cited evidence",
    saved: "Saved draft created. Open Saved library answers to review it.",
  },
  es: {
    title: "Respuestas guardadas de la biblioteca",
    save: "Preguntar y guardar borrador",
    refresh: "Actualizar respuestas guardadas",
    notice:
      "Guarde una nueva respuesta del servidor como borrador del equipo. Revise la respuesta y cada fuente y apruebe por separado su exportación. Los originales y revisiones anteriores siguen privados. Los cambios o la retirada de fuentes eliminan la respuesta y su historial. No se pueden recuperar descargas ya copiadas.",
    empty: "No hay respuestas guardadas.",
    open: "Revisar respuesta guardada",
    original: "Respuesta original de IA",
    history: "Historial de revisión",
    answer: "Texto de respuesta",
    reviewed: "He revisado la respuesta y sus fuentes citadas",
    include: "Aprobar la última revisión para exportación",
    update: "Guardar revisión",
    withdraw: "Retirar aprobación de exportación",
    remove: "Eliminar respuesta guardada",
    markdown: "Descargar texto revisado",
    csv: "Descargar CSV revisado",
    close: "Cerrar respuesta guardada",
    draft: "Borrador",
    approved: "Aprobada para exportación",
    revision: "Revisión de respuesta",
    citation: "Conservar cita",
    question: "Pregunta del investigador",
    reviewer: "Revisado por",
    edited: "Editado por el investigador",
    warning:
      "Interpretaciones revisadas de extractos y observaciones incluidos. No son declaraciones de participantes ni hechos verificados de forma independiente. La cobertura y la interpretación requieren revisión humana.",
    sources: "Evidencia citada",
    saved: "Borrador guardado. Abra las respuestas guardadas para revisarlo.",
  },
  fr: {
    title: "Réponses enregistrées de la bibliothèque",
    save: "Interroger et enregistrer un brouillon",
    refresh: "Actualiser les réponses enregistrées",
    notice:
      "Enregistrez une nouvelle réponse du serveur comme brouillon de l’équipe. Vérifiez la réponse et chaque source, puis approuvez séparément son exportation. Les originaux et anciennes révisions restent privés. Les changements ou retraits de sources suppriment la réponse et son historique. Les téléchargements déjà copiés ne peuvent être rappelés.",
    empty: "Aucune réponse enregistrée.",
    open: "Réviser la réponse enregistrée",
    original: "Réponse IA originale",
    history: "Historique des révisions",
    answer: "Texte de la réponse",
    reviewed: "J’ai vérifié cette réponse et ses sources citées",
    include: "Approuver la dernière révision pour exportation",
    update: "Enregistrer la révision",
    withdraw: "Retirer l’approbation d’exportation",
    remove: "Supprimer la réponse enregistrée",
    markdown: "Télécharger le texte révisé",
    csv: "Télécharger le CSV révisé",
    close: "Fermer la réponse enregistrée",
    draft: "Brouillon",
    approved: "Approuvée pour exportation",
    revision: "Révision de réponse",
    citation: "Conserver la citation",
    question: "Question du chercheur",
    reviewer: "Révisé par",
    edited: "Modifié par le chercheur",
    warning:
      "Interprétations révisées d’extraits et d’observations inclus. Ce ne sont pas des déclarations de participants ni des faits vérifiés indépendamment. La couverture et l’interprétation nécessitent une révision humaine.",
    sources: "Éléments cités",
    saved:
      "Brouillon enregistré. Ouvrez les réponses enregistrées pour le réviser.",
  },
};
export function libraryAnswerExport(
  saved: SavedLibraryAnswer,
  format: "md" | "csv",
  origin = "",
) {
  const r = saved.history.at(-1)!;
  if (!r.reviewed || !r.includeInExports)
    throw new Error("LIBRARY_EXPORT_NOT_APPROVED");
  validateSavedLibraryCitations(r, saved.sources);
  const l = libraryAnswerLabels[saved.language],
    e = libraryAttachmentLabels[saved.language],
    sources = r.citations.map((c) =>
      saved.sources.find((s) => s.id === c.evidenceId)!,
    );
  const sourceURL = (h: SavedLibrarySource) =>
    origin +
    "/?" +
    new URLSearchParams({
      study: h.studyId,
      tab: "responses",
      interview: h.interviewId,
      turn: h.turnId,
    }).toString();
  const edited =
    r.answer !== saved.original.answer ||
    JSON.stringify(r.citations) !== JSON.stringify(saved.original.citations);
  const retrieval = saved.original.retrieval;
  const provenance = [
    saved.id,
    String(r.version),
    r.editor.name,
    r.at,
    saved.original.model,
    saved.original.promptVersion,
    saved.original.generatedAt,
    edited ? l.edited : "",
  ];
  if (format === "csv")
    return csv([
      [
        "notice",
        "question",
        "answer",
        "evidence_id",
        "quote",
        "response_id",
        "turn_id",
        "attachment_id",
        "source_url",
        "study_id",
        "study_title",
        "revision_id",
        "concept_id",
        "source_type",
        "format",
        "field",
        "unit",
        "number",
        "start",
        "end",
        "ocr",
        "grounding",
        "source_review_version",
        "source_reviewer",
        "source_reviewed_at",
        "answer_id",
        "answer_version",
        "answer_reviewer",
        "answer_reviewed_at",
        "model",
        "prompt_version",
        "generated_at",
        "edited",
        "retrieval_mode",
        "retrieval_strategy",
        "embedding_model",
        "index_version",
        "transcript_source",
        "transcript_language",
        "transcript_prompt",
        ...recordingExportHeaders,
      ],
      ...sources.map((h) => [
        saved.scope === "transcripts"
          ? transcriptAnswerLabels[saved.language].warning
          : l.warning,
        saved.original.question,
        r.answer,
        h.id,
        h.text,
        h.interviewId,
        h.turnId,
        h.attachmentId,
        sourceURL(h),
        h.studyId,
        h.studyTitle,
        h.revisionId,
        h.conceptId || "",
        h.kind,
        h.format,
        h.field || "",
        h.locator?.unit || "",
        String(h.locator?.number ?? ""),
        String(h.locator?.start ?? ""),
        String(h.locator?.end ?? ""),
        h.ocr ? "true" : "",
        h.grounding || "",
        h.format === "transcript" ? "" : String(h.version),
        h.reviewerName,
        h.reviewedAt,
        ...provenance,
        retrieval?.mode || "keyword",
        retrieval?.strategy || "",
        retrieval?.model || "",
        retrieval?.version || "",
        h.format === "transcript" ? h.transcript.source : "",
        h.format === "transcript" ? h.transcript.language : "",
        h.format === "transcript" ? h.transcript.prompt : "",
        ...recordingExportFields(
          h.format === "transcript" ? h.transcript.recordingSection : undefined,
          origin,
        ),
      ]),
    ]);
  return [
    l.title,
    saved.scope === "transcripts"
      ? transcriptAnswerLabels[saved.language].warning
      : l.warning,
    retrieval
      ? `${retrieval.mode} · ${retrieval.strategy} · ${retrieval.model} · ${retrieval.version}`
      : "",
    `${l.question}: ${saved.original.question}`,
    `${l.answer}: ${r.answer}`,
    ...sources.map((h) =>
      [
        l.sources + ": " + h.text,
        `${e.original}: ${h.id}`,
        `${e.response}: ${h.interviewId} · ${h.turnId} · ${h.attachmentId}`,
        sourceURL(h),
        ...(h.format === "transcript" && h.transcript.recordingSection
          ? [
              recordingRangeLabel(h.transcript.recordingSection),
              ...recordingExportFields(
                h.transcript.recordingSection,
                origin,
              ).slice(3),
            ]
          : []),
        `${h.studyTitle} [${h.studyId}] · ${h.revisionId}${h.conceptId ? " · " + h.conceptId : ""}`,
        `${h.format.toUpperCase()} · ${h.kind === "transcript" ? transcriptAnswerLabels[saved.language].source : h.kind === "passage" ? e.passage : e.observation} · ${h.field ? e[h.field] : ""}${h.grounding ? " · " + h.grounding : ""}`,
        h.locator
          ? `${h.locator.unit === "turn" ? transcriptAnswerLabels[saved.language].turn : e[h.locator.unit]} ${h.locator.number} · ${h.locator.start}–${h.locator.end}${h.ocr ? " · " + e.ocr : ""}`
          : "",
        h.format === "transcript"
          ? `${h.transcript.source} · ${h.transcript.language} · ${h.transcript.prompt}`
          : `v${h.version} · ${h.reviewerName} · ${h.reviewedAt}`,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    `${l.reviewer}: ${r.editor.name} · ${r.at} · ${l.revision} ${r.version}`,
    `${saved.original.model} · ${saved.original.promptVersion} · ${saved.original.generatedAt}${edited ? " · " + l.edited : ""}`,
  ].join("\n\n");
}
