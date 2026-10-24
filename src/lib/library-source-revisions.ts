import { z } from "zod";
import { recordingSection, type RecordingSection } from "./recording-sections";
import { maxImportTranscript } from "./library-recordings";
export const sourceRevisionInput = z
  .object({
    requestId: z.uuid(),
    version: z.number().int().min(0),
    sourceVersion: z.number().int().positive(),
    text: z.string().trim().min(10).max(maxImportTranscript),
    sections: z.array(recordingSection).max(200).optional(),
    reason: z.string().trim().min(3).max(1000),
    reviewed: z.boolean(),
  })
  .strict();
export type SourceReview = {
  version: number;
  text: string;
  sections?: RecordingSection[];
  reason: string;
  reviewed: boolean;
  at: string;
  editor: { id: string; name: string };
  baseSourceVersion: number;
  requestId?: string;
  inputHash?: string;
};
export type SourceRevisions = {
  id: string;
  interviewId: string;
  studyId: string;
  workspaceId: string;
  version: number;
  createdAt: string;
  history: SourceReview[];
  publications: {
    reviewVersion: number;
    sourceVersion: number;
    at: string;
    editor: { id: string; name: string };
    requestId?: string;
    inputHash?: string;
  }[];
};
export const sourceRevisionLabels = {
  en: {
    stale:
      "The source changed. Check this draft against the current source, then save a fresh review before publishing.",
    title: "Recording revisions",
    notice:
      "Save corrections as a private draft, then explicitly publish a reviewed version. Publishing replaces the current source transcript and clears dependent answers, indexes, briefs, analyses, report editions, clips and shares. The original recording stays the same. Earlier text and reviews remain private until source erasure. Restored versions require a fresh review.",
    open: "Edit imported recording",
    text: "Revised transcript",
    reason: "Reason for revision",
    reviewed:
      "I checked the revised text, speaker labels and timing against the recording",
    save: "Save private revision",
    publish: "Publish reviewed source revision",
    restore: "Restore as a new draft",
    history: "Private source revision history",
    close: "Close revision editor",
    refresh: "Reload revisions",
    draft: "Private draft; not used in research",
    published: "Published source version",
    busy: "Working…",
    saved: "Private revision saved. The current research source is unchanged.",
    done: "Source revision published. Dependent research was cleared; regenerate it from the corrected source.",
  },
  es: {
    stale:
      "La fuente cambió. Compare el borrador con la fuente actual y guarde una nueva revisión antes de publicar.",
    title: "Revisiones de grabaciones",
    notice:
      "Guarde las correcciones como borrador privado y publique por separado una versión revisada. La publicación sustituye la transcripción y elimina respuestas, índices, informes, análisis, clips y enlaces derivados. La grabación original se conserva. El texto y las revisiones anteriores siguen privados hasta borrar la fuente. Restaurar exige una nueva revisión.",
    open: "Editar grabación importada",
    text: "Transcripción revisada",
    reason: "Motivo de la revisión",
    reviewed:
      "He cotejado el texto, los hablantes y los tiempos con la grabación",
    save: "Guardar revisión privada",
    publish: "Publicar versión revisada de la fuente",
    restore: "Restaurar como nuevo borrador",
    history: "Historial privado de la fuente",
    close: "Cerrar editor de revisiones",
    refresh: "Recargar revisiones",
    draft: "Borrador privado; fuera de la investigación",
    published: "Versión publicada de la fuente",
    busy: "En curso…",
    saved: "Revisión privada guardada. La fuente de investigación sigue igual.",
    done: "Versión publicada. Se eliminó la investigación derivada; regenérela desde la fuente corregida.",
  },
  fr: {
    stale:
      "La source a changé. Comparez le brouillon à la source actuelle puis enregistrez une nouvelle vérification avant de publier.",
    title: "Révisions des enregistrements",
    notice:
      "Enregistrez les corrections en brouillon privé puis publiez séparément une version vérifiée. La publication remplace la transcription et efface réponses, index, notes, analyses, rapports, clips et liens dérivés. L’enregistrement original est conservé. Les anciens textes et révisions restent privés jusqu’à l’effacement de la source. Une restauration exige une nouvelle vérification.",
    open: "Modifier l’enregistrement importé",
    text: "Transcription révisée",
    reason: "Motif de la révision",
    reviewed:
      "J’ai comparé le texte, les locuteurs et les temps à l’enregistrement",
    save: "Enregistrer la révision privée",
    publish: "Publier la version vérifiée de la source",
    restore: "Restaurer en nouveau brouillon",
    history: "Historique privé de la source",
    close: "Fermer l’éditeur de révisions",
    refresh: "Recharger les révisions",
    draft: "Brouillon privé ; exclu de la recherche",
    published: "Version publiée de la source",
    busy: "En cours…",
    saved:
      "Révision privée enregistrée. La source de recherche reste inchangée.",
    done: "Version publiée. Les recherches dérivées ont été effacées ; régénérez-les à partir de la source corrigée.",
  },
};
