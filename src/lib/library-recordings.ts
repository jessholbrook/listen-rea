import { z } from "zod";
import { recordingSection, type RecordingSection } from "./recording-sections";
import { languageSchema, type Language } from "./localization";
export const maxImportBytes = 60 * 1024 * 1024;
export const importPartBytes = 3 * 1024 * 1024;
export const maxImportDurationMs = 60 * 60 * 1000;
export const maxImportTranscript = 150000;
export const transcriptionStepMs = 5 * 60 * 1000;
export const recordingCreate = z
  .object({
    requestId: z.uuid(),
    studyId: z.uuid(),
    title: z.string().trim().min(3).max(160),
    externalId: z.string().trim().min(1).max(100),
    language: languageSchema,
    permissionConfirmed: z.literal(true),
    transcriptionPermission: z.literal(true),
  })
  .strict();
export const recordingBatchCreate = recordingCreate
  .omit({ requestId: true, title: true, externalId: true })
  .extend({
    requestId: z.uuid(),
    items: z
      .array(
        recordingCreate.pick({
          requestId: true,
          title: true,
          externalId: true,
        }),
      )
      .min(2)
      .max(10),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.items.map((i) => i.requestId)).size === v.items.length &&
      new Set(v.items.map((i) => i.externalId)).size === v.items.length,
    "Use distinct interview IDs and request IDs.",
  );
export const recordingReview = z
  .object({
    version: z.number().int().positive(),
    text: z.string().trim().min(10).max(maxImportTranscript),
    reviewed: z.boolean(),
    sections: z.array(recordingSection).max(200).optional(),
  })
  .strict();
export type LibraryRecording = {
  id: string;
  workspaceId: string;
  studyId: string;
  requestId: string;
  batchId?: string;
  inputHash: string;
  createdAt: string;
  expiresAt: string;
  version: number;
  status:
    "awaiting_upload" | "uploaded" | "transcribing" | "draft" | "imported";
  title?: string;
  externalId?: string;
  language?: Language;
  file?: {
    id: string;
    mime: string;
    bytes: number;
    digest: string;
    durationMs: number;
  };
  upload?: {
    bytes: number;
    digest: string;
    mime: string;
    fileId: string;
    parts: { id: string; bytes?: number; digest?: string }[];
  };
  job?: {
    total: number;
    completed: { text: string; model: string; generatedAt: string }[];
  };
  attempt?: { id: string; at: number };
  original?: { text: string; model: string; generatedAt: string };
  history?: {
    version: number;
    text: string;
    reviewed: boolean;
    sections?: RecordingSection[];
    at: string;
    editor: { id: string; name: string };
  }[];
  interviewId?: string;
  lastError?: "provider_or_processing";
};
// Storage identifiers and unfinished machine text are never client controls.
export function recordingView(r: LibraryRecording) {
  const { workspaceId, inputHash, requestId, attempt, upload, job, ...rest } =
    r;
  void workspaceId;
  void inputHash;
  void requestId;
  return {
    ...rest,
    ...(attempt ? { runningSince: attempt.at } : {}),
    ...(upload
      ? {
          upload: {
            bytes: upload.bytes,
            digest: upload.digest,
            mime: upload.mime,
            parts: upload.parts.map(({ bytes, digest }) => ({ bytes, digest })),
          },
        }
      : {}),
    ...(job
      ? { job: { total: job.total, completed: job.completed.length } }
      : {}),
  };
}
export const recordingLabels = {
  en: {
    resume: "Resume upload with the same file",
    progress: "Saved upload parts / transcription steps",
    pause: "Pause after the current step",
    title: "Recording transcription",
    language: "Recording language",
    notice:
      "Upload a private audio/video file up to 60 MiB and 60 minutes in resumable private parts. Transcription saves each five-minute step; keep this page open to continue, or resume later. Reselect the same file to resume an interrupted upload. The complete transcript is limited to 150,000 characters. Transcription sends audio only to OpenAI when you explicitly request it. Check the original recording, speaker text and accuracy, edit the draft, then separately approve an import. Drafts stay out of search and analysis. No automatic speaker identity, diarization or reliable timestamps are claimed. Pending recordings expire after seven days or the shorter workspace retention period.",
    permission:
      "I have permission to store and process this recording, including sending its audio to OpenAI",
    name: "Recording title",
    external: "External interview ID",
    study: "Destination study",
    file: "Audio or video file",
    upload: "Upload private recording",
    refresh: "Refresh recordings",
    open: "Review recording",
    transcribe: "Generate transcript draft",
    text: "Transcript text",
    reviewed:
      "I checked this transcript against the recording and reviewed speaker labels and accuracy",
    save: "Save transcript review",
    approve: "Approve reviewed transcript and import",
    remove: "Delete pending recording and all draft history",
    confirm:
      "Delete this pending recording, transcript and review history? This cannot be undone.",
    original: "Original machine transcript",
    history: "Transcript review history",
    source: "Original recording",
    response: "Open imported response",
    empty: "No pending recordings or import receipts.",
    draft: "Draft; excluded from research",
    imported: "Reviewed transcript imported",
    busy: "Working…",
    close: "Close recording",
    error:
      "The previous transcription attempt failed. The recording is saved; refresh and retry when the provider is available.",
    wait: "A transcription is running. Refresh after it finishes, or resume after two minutes if interrupted. Completed steps are preserved.",
    play: "Play private recording",
    receipt:
      "To erase this imported recording and its transcript, delete its response in the study. Dependent answers and briefs will also be removed.",
  },
  es: {
    resume: "Reanudar la subida con el mismo archivo",
    progress: "Partes de subida / pasos de transcripción guardados",
    pause: "Pausar después del paso actual",
    title: "Transcripción de grabaciones",
    language: "Idioma de la grabación",
    notice:
      "Suba un archivo privado de audio o vídeo de hasta 60 MiB y 60 minutos en partes privadas reanudables. Se guarda cada paso de cinco minutos; mantenga la página abierta o reanude después. Para reanudar la subida, seleccione el mismo archivo. El límite es de 150.000 caracteres. La transcripción envía solo audio a OpenAI cuando lo solicita. Revise la grabación, el texto y su precisión, edite el borrador y apruebe la importación por separado. Los borradores quedan fuera de búsquedas y análisis. No se garantizan identidades, diarización ni tiempos fiables. Las grabaciones pendientes caducan en siete días o antes según la retención del equipo.",
    permission:
      "Tengo permiso para almacenar y procesar la grabación, incluido enviar su audio a OpenAI",
    name: "Título de la grabación",
    external: "ID externo de entrevista",
    study: "Estudio de destino",
    file: "Archivo de audio o vídeo",
    upload: "Subir grabación privada",
    refresh: "Actualizar grabaciones",
    open: "Revisar grabación",
    transcribe: "Generar borrador de transcripción",
    text: "Texto de la transcripción",
    reviewed:
      "He cotejado la transcripción con la grabación y revisado hablantes y precisión",
    save: "Guardar revisión de transcripción",
    approve: "Aprobar transcripción revisada e importar",
    remove: "Eliminar grabación pendiente y todo su historial",
    confirm:
      "¿Eliminar esta grabación, transcripción e historial? No se puede deshacer.",
    original: "Transcripción automática original",
    history: "Historial de revisión",
    source: "Grabación original",
    response: "Abrir respuesta importada",
    empty: "No hay grabaciones pendientes ni recibos de importación.",
    draft: "Borrador; excluido de la investigación",
    imported: "Transcripción revisada importada",
    busy: "En curso…",
    close: "Cerrar grabación",
    error:
      "La transcripción anterior falló. La grabación está guardada; actualice y reintente cuando el proveedor esté disponible.",
    wait: "Hay una transcripción en curso. Actualice al terminar o reanude después de dos minutos si se interrumpió. Los pasos terminados se conservan.",
    play: "Reproducir grabación privada",
    receipt:
      "Para borrar la grabación importada y su transcripción, elimine su respuesta en el estudio. Se eliminarán también las respuestas e informes dependientes.",
  },
  fr: {
    resume: "Reprendre l’envoi avec le même fichier",
    progress: "Parties envoyées / étapes de transcription enregistrées",
    pause: "Suspendre après l’étape en cours",
    title: "Transcription des enregistrements",
    language: "Langue de l’enregistrement",
    notice:
      "Importez un fichier audio/vidéo privé de 60 Mio et 60 minutes maximum, en parties privées reprenables. Chaque étape de cinq minutes est enregistrée ; gardez la page ouverte ou reprenez plus tard. Resélectionnez le même fichier pour reprendre un envoi. Le texte est limité à 150 000 caractères. Seul l’audio est envoyé à OpenAI sur demande explicite. Vérifiez l’enregistrement, les locuteurs et l’exactitude, corrigez le brouillon puis approuvez séparément son importation. Les brouillons restent exclus des recherches et analyses. Aucune identité, diarisation ou synchronisation fiable n’est garantie. Les enregistrements en attente expirent après sept jours ou la durée de conservation plus courte du groupe.",
    permission:
      "J’ai l’autorisation de conserver et traiter cet enregistrement, y compris d’envoyer son audio à OpenAI",
    name: "Titre de l’enregistrement",
    external: "Identifiant externe d’entretien",
    study: "Étude de destination",
    file: "Fichier audio ou vidéo",
    upload: "Importer l’enregistrement privé",
    refresh: "Actualiser les enregistrements",
    open: "Vérifier l’enregistrement",
    transcribe: "Générer un brouillon de transcription",
    text: "Texte de la transcription",
    reviewed:
      "J’ai comparé cette transcription à l’enregistrement et vérifié les locuteurs et l’exactitude",
    save: "Enregistrer la révision",
    approve: "Approuver la transcription révisée et importer",
    remove: "Supprimer l’enregistrement en attente et tout son historique",
    confirm:
      "Supprimer cet enregistrement, sa transcription et son historique ? Cette action est irréversible.",
    original: "Transcription automatique originale",
    history: "Historique des révisions",
    source: "Enregistrement original",
    response: "Ouvrir la réponse importée",
    empty: "Aucun enregistrement en attente ni reçu d’importation.",
    draft: "Brouillon ; exclu de la recherche",
    imported: "Transcription révisée importée",
    busy: "En cours…",
    close: "Fermer l’enregistrement",
    error:
      "La transcription précédente a échoué. L’enregistrement est conservé ; actualisez puis réessayez lorsque le fournisseur est disponible.",
    wait: "Une transcription est en cours. Actualisez une fois terminée ou reprenez après deux minutes en cas d’interruption. Les étapes terminées sont conservées.",
    play: "Lire l’enregistrement privé",
    receipt:
      "Pour effacer cet enregistrement importé et sa transcription, supprimez sa réponse dans l’étude. Les réponses enregistrées et notes dépendantes seront également supprimées.",
  },
};
