import {
  recordingExportHeaders,
  recordingExportFields,
  recordingRangeLabel,
} from "./recording-sections";
import { z } from "zod";
import { languageSchema, type Language } from "./localization";
import { csv } from "./evidence";
import {
  libraryAnswerExport,
  type SavedLibraryAnswer,
} from "./library-answers";
export const briefSection = z
  .object({
    answerId: z.uuid(),
    answerVersion: z.number().int().positive(),
    heading: z.string().trim().max(160).default(""),
    commentary: z.string().trim().max(4000).default(""),
  })
  .strict();
export const briefContent = z
  .object({
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().max(8000).default(""),
    language: languageSchema.default("en"),
    sections: z
      .array(briefSection)
      .min(1)
      .max(20)
      .refine(
        (s) => new Set(s.map((x) => x.answerId)).size === s.length,
        "Choose each answer once.",
      ),
  })
  .strict();
export const briefCreate = briefContent
  .extend({ requestId: z.uuid() })
  .strict();
export const briefEdit = briefContent
  .extend({
    version: z.number().int().positive(),
    reviewed: z.boolean(),
    includeInExports: z.boolean(),
  })
  .strict();
export type BriefSection = z.infer<typeof briefSection>;
export type LibraryBrief = z.infer<typeof briefContent> & {
  id: string;
  workspaceId: string;
  requestId: string;
  inputHash: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: { id: string; name: string };
  reviewed: boolean;
  includeInExports: boolean;
  dependencies: SavedLibraryAnswer["dependencies"];
  answerDependencies: string[];
};
export type BriefAnswer = Pick<
  SavedLibraryAnswer,
  "id" | "language" | "sources"
> & {
  original: Pick<
    SavedLibraryAnswer["original"],
    "question" | "model" | "promptVersion" | "generatedAt" | "retrieval"
  >;
  revision: SavedLibraryAnswer["history"][number];
};
export type BriefDetails = Omit<
  LibraryBrief,
  | "workspaceId"
  | "requestId"
  | "inputHash"
  | "dependencies"
  | "sections"
  | "answerDependencies"
> & {
  current: boolean;
  canExport: boolean;
  sections: (BriefSection & {
    state: "current" | "changed" | "unapproved";
    latestVersion: number;
    answer?: BriefAnswer;
  })[];
};
export const briefLabels = {
  en: {
    title: "Research briefs",
    working: "Working…",
    language: "Brief interface language",
    notice:
      "Assemble reviewed, export-approved saved library answers. Headings, summary and commentary are researcher writing; answer text and exact citations come from the selected review revision. Source withdrawal or answer deletion removes the whole dependent brief. Changed answers or withdrawn approval block export until refreshed and reviewed. Copied downloads cannot be recalled.",
    refresh: "Refresh briefs and answers",
    create: "Create brief draft",
    open: "Open brief",
    empty: "No research briefs.",
    eligible: "Approved saved answers",
    none: "Review and approve a saved library answer first.",
    name: "Brief title",
    summary: "Researcher summary",
    heading: "Section heading",
    commentary: "Researcher commentary",
    add: "Add answer",
    removeSection: "Remove section",
    up: "Move section up",
    down: "Move section down",
    save: "Save brief revision",
    reviewed: "I reviewed the brief and every included answer and source",
    approve: "Approve this brief revision for export",
    refreshVersions: "Use latest approved answer revisions",
    stale:
      "An answer changed or lost export approval. Refresh approved answers, use their latest revisions and review this brief again.",
    draft: "Draft",
    approved: "Approved for export",
    close: "Close brief",
    remove: "Delete brief",
    confirm: "Delete this private brief? This cannot be undone.",
    md: "Download brief text",
    csv: "Download brief CSV",
    sources: "Exact cited evidence",
    source: "Check current evidence",
    response: "Open full response",
    revision: "Brief revision",
    edited: "Brief revised by",
    warning:
      "Researcher-reviewed interpretations and researcher commentary. These are not participant statements or independently verified facts. Source matching does not establish interpretation quality, prevalence or comparable samples.",
    withdraw: "Withdraw brief export approval",
    saved: "Brief saved.",
    answerRevision: "Saved answer revision",
  },
  es: {
    title: "Informes de investigación",
    working: "En curso…",
    language: "Idioma de la interfaz del informe",
    notice:
      "Combine respuestas guardadas revisadas y aprobadas para exportación. Los títulos, el resumen y los comentarios son del investigador; las respuestas y citas exactas proceden de la revisión seleccionada. La retirada de fuentes o eliminación de respuestas elimina el informe dependiente. Los cambios o la retirada de aprobación bloquean la exportación hasta actualizar y revisar. No se pueden recuperar las descargas copiadas.",
    refresh: "Actualizar informes y respuestas",
    create: "Crear borrador de informe",
    open: "Abrir informe",
    empty: "No hay informes de investigación.",
    eligible: "Respuestas guardadas aprobadas",
    none: "Primero revise y apruebe una respuesta guardada.",
    name: "Título del informe",
    summary: "Resumen del investigador",
    heading: "Título de sección",
    commentary: "Comentario del investigador",
    add: "Añadir respuesta",
    removeSection: "Quitar sección",
    up: "Subir sección",
    down: "Bajar sección",
    save: "Guardar revisión del informe",
    reviewed: "He revisado el informe y cada respuesta y fuente incluida",
    approve: "Aprobar esta revisión para exportación",
    refreshVersions: "Usar las últimas revisiones aprobadas",
    stale:
      "Una respuesta cambió o perdió su aprobación. Actualice las respuestas aprobadas, use sus últimas revisiones y revise el informe de nuevo.",
    draft: "Borrador",
    approved: "Aprobado para exportación",
    close: "Cerrar informe",
    remove: "Eliminar informe",
    confirm: "¿Eliminar este informe privado? No se puede deshacer.",
    md: "Descargar texto del informe",
    csv: "Descargar CSV del informe",
    sources: "Evidencia citada exacta",
    source: "Comprobar evidencia actual",
    response: "Abrir respuesta completa",
    revision: "Revisión del informe",
    edited: "Informe revisado por",
    warning:
      "Interpretaciones revisadas y comentarios del investigador. No son declaraciones de participantes ni hechos verificados independientemente. La coincidencia con las fuentes no establece calidad de interpretación, prevalencia ni comparabilidad de muestras.",
    withdraw: "Retirar aprobación del informe",
    saved: "Informe guardado.",
    answerRevision: "Revisión de respuesta guardada",
  },
  fr: {
    title: "Notes de recherche",
    working: "En cours…",
    language: "Langue de l’interface de la note",
    notice:
      "Rassemblez des réponses enregistrées, révisées et approuvées pour exportation. Les titres, le résumé et les commentaires sont rédigés par le chercheur ; les réponses et citations exactes proviennent de la révision choisie. Le retrait de sources ou la suppression de réponses supprime la note dépendante. Les changements ou retraits d’approbation bloquent l’exportation jusqu’à actualisation et révision. Les téléchargements copiés ne peuvent être rappelés.",
    refresh: "Actualiser les notes et réponses",
    create: "Créer un brouillon de note",
    open: "Ouvrir la note",
    empty: "Aucune note de recherche.",
    eligible: "Réponses enregistrées approuvées",
    none: "Révisez et approuvez d’abord une réponse enregistrée.",
    name: "Titre de la note",
    summary: "Résumé du chercheur",
    heading: "Titre de section",
    commentary: "Commentaire du chercheur",
    add: "Ajouter une réponse",
    removeSection: "Retirer la section",
    up: "Monter la section",
    down: "Descendre la section",
    save: "Enregistrer la révision de la note",
    reviewed: "J’ai vérifié la note et chaque réponse et source incluse",
    approve: "Approuver cette révision pour exportation",
    refreshVersions: "Utiliser les dernières révisions approuvées",
    stale:
      "Une réponse a changé ou perdu son approbation. Actualisez les réponses approuvées, utilisez leurs dernières révisions et vérifiez à nouveau la note.",
    draft: "Brouillon",
    approved: "Approuvée pour exportation",
    close: "Fermer la note",
    remove: "Supprimer la note",
    confirm: "Supprimer cette note privée ? Cette action est irréversible.",
    md: "Télécharger le texte de la note",
    csv: "Télécharger le CSV de la note",
    sources: "Éléments cités exacts",
    source: "Vérifier la source actuelle",
    response: "Ouvrir la réponse complète",
    revision: "Révision de la note",
    edited: "Note révisée par",
    warning:
      "Interprétations révisées et commentaires du chercheur. Ce ne sont pas des déclarations de participants ni des faits vérifiés indépendamment. La correspondance des sources n’établit ni la qualité de l’interprétation, ni la prévalence, ni la comparabilité des échantillons.",
    withdraw: "Retirer l’approbation de la note",
    saved: "Note enregistrée.",
    answerRevision: "Révision de réponse enregistrée",
  },
} satisfies Record<Language, Record<string, string>>;
export function briefExport(
  b: LibraryBrief,
  answers: SavedLibraryAnswer[],
  format: "md" | "csv",
  origin = "",
) {
  if (!b.reviewed || !b.includeInExports) throw Error("BRIEF_NOT_APPROVED");
  const ordered = b.sections.map((section) => {
    const a = answers.find((a) => a.id === section.answerId);
    const r = a?.history.at(-1);
    if (
      !a ||
      !r ||
      r.version !== section.answerVersion ||
      !r.reviewed ||
      !r.includeInExports
    )
      throw Error("BRIEF_ANSWER_CHANGED");
    libraryAnswerExport(a, "md", origin);
    return { section, a, r };
  });
  const l = briefLabels[b.language];
  const text =
    format === "md"
      ? [
          l.title,
          b.title,
          l.warning,
          `${l.summary}: ${b.summary}`,
          `${l.revision}: ${b.version}`,
          `${l.edited}: ${b.updatedBy.name} · ${b.updatedAt}`,
          ...ordered.map(({ section, a }, i) =>
            [
              `${i + 1}. ${section.heading || a.original.question}`,
              `${l.commentary}: ${section.commentary}`,
              libraryAnswerExport(a, "md", origin),
            ].join("\n\n"),
          ),
        ].join("\n\n")
      : csv([
          [
            "notice",
            "brief_id",
            "brief_version",
            "brief_title",
            "brief_summary",
            "brief_reviewer",
            "brief_reviewed_at",
            "section",
            "section_heading",
            "researcher_commentary",
            "question",
            "answer",
            "answer_id",
            "answer_version",
            "answer_reviewer",
            "answer_reviewed_at",
            "evidence_id",
            "quote",
            "study_id",
            "study_title",
            "response_id",
            "turn_id",
            "attachment_id",
            "revision_id",
            "concept_id",
            "format",
            "source_type",
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
            "source_url",
            "model",
            "prompt_version",
            "generated_at",
            "retrieval_mode",
            "retrieval_strategy",
            "embedding_model",
            "index_version",
            "transcript_source",
            "transcript_language",
            "transcript_prompt",
            ...recordingExportHeaders,
          ],
          ...ordered.flatMap(({ section, a, r }, i) =>
            r.citations.map((c) => {
              const h = a.sources.find((h) => h.id === c.evidenceId)!;
              return [
                l.warning,
                b.id,
                String(b.version),
                b.title,
                b.summary,
                b.updatedBy.name,
                b.updatedAt,
                String(i + 1),
                section.heading,
                section.commentary,
                a.original.question,
                r.answer,
                a.id,
                String(r.version),
                r.editor.name,
                r.at,
                h.id,
                h.text,
                h.studyId,
                h.studyTitle,
                h.interviewId,
                h.turnId,
                h.attachmentId,
                h.revisionId,
                h.conceptId || "",
                h.format,
                h.kind,
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
                origin +
                  "/?" +
                  new URLSearchParams({
                    study: h.studyId,
                    tab: "responses",
                    interview: h.interviewId,
                    turn: h.turnId,
                  }),
                a.original.model,
                a.original.promptVersion,
                a.original.generatedAt,
                a.original.retrieval?.mode || "keyword",
                a.original.retrieval?.strategy || "",
                a.original.retrieval?.model || "",
                a.original.retrieval?.version || "",
                h.format === "transcript" ? h.transcript.source : "",
                h.format === "transcript" ? h.transcript.language : "",
                h.format === "transcript" ? h.transcript.prompt : "",
                ...recordingExportFields(
                  h.format === "transcript"
                    ? h.transcript.recordingSection
                    : undefined,
                  origin,
                ),
              ];
            }),
          ),
        ]);
  if (text.length > 1000000) throw Error("BRIEF_EXPORT_TOO_LARGE");
  return text;
}
