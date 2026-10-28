import { z } from "zod";
export const backgroundCreate = z
  .object({
    requestId: z.uuid(),
    kind: z.enum(["transcription", "render"]),
    targetId: z.uuid(),
    studyId: z.uuid(),
    version: z.number().int().positive(),
    permissionConfirmed: z.literal(true),
  })
  .strict();
export type BackgroundJob = {
  id: string;
  workspaceId: string;
  studyId: string;
  creatorId: string;
  requestId: string;
  inputHash: string;
  kind: "transcription" | "render";
  targetId: string;
  targetVersion: number;
  state: "queued" | "running" | "complete" | "failed" | "cancelled";
  version: number;
  wake: number;
  publishedWake?: number;
  dispatchPending?: boolean;
  lease?: string;
  leaseUntil?: number;
  attempts: number;
  stepAttempts: number;
  completed: number;
  total: number;
  createdAt: string;
  updatedAt: string;
  error?: "processing" | "permission" | "source_changed" | "retry_limit";
};
export const activeJob = (j: BackgroundJob) =>
  j.state === "queued" || j.state === "running";
export function backgroundView(j: BackgroundJob) {
  const {
    workspaceId,
    creatorId,
    requestId,
    inputHash,
    lease,
    leaseUntil,
    wake,
    publishedWake,
    ...v
  } = j;
  void workspaceId;
  void creatorId;
  void requestId;
  void inputHash;
  void lease;
  void leaseUntil;
  void wake;
  void publishedWake;
  return v;
}
export type BackgroundView = ReturnType<typeof backgroundView>;
export const backgroundLabels = {
  en: {
    title: "Background jobs",
    notice:
      "Transcription and rendering continue after you close this page. Refresh to see current progress. Uploads must finish first; generated transcripts still need your review.",
    refresh: "Refresh jobs",
    queued: "Queued",
    running: "Processing",
    complete: "Complete",
    failed: "Needs attention",
    cancelled: "Cancelled",
    cancel: "Cancel job",
    retry: "Retry job",
    start: "Process in background",
    attempts: "Attempts",
    pending:
      "Saved; queue delivery is pending. Retry delivery or return after scheduled recovery.",
    error: "Processing stopped. Check the source and retry explicitly.",
    dispatch: "Retry delivery",
    confirm:
      "Cancel this job? Saved transcription steps remain; an in-flight provider call may still finish, but its result will not be saved.",
    permission: "I approve background processing of this source",
    empty: "No background jobs in this scope.",
    transcription: "Recording transcription",
    render: "Video rendering",
  },
  es: {
    title: "Trabajos en segundo plano",
    notice:
      "La transcripción y el renderizado continúan al cerrar esta página. Actualiza para ver el progreso. La carga debe finalizar primero; las transcripciones requieren revisión.",
    refresh: "Actualizar trabajos",
    queued: "En cola",
    running: "Procesando",
    complete: "Completado",
    failed: "Requiere atención",
    cancelled: "Cancelado",
    cancel: "Cancelar trabajo",
    retry: "Reintentar trabajo",
    start: "Procesar en segundo plano",
    attempts: "Intentos",
    pending:
      "Guardado; entrega a la cola pendiente. Reintenta la entrega o vuelve tras la recuperación programada.",
    error:
      "El procesamiento se detuvo. Revisa la fuente y vuelve a intentarlo.",
    dispatch: "Reintentar entrega",
    confirm:
      "¿Cancelar? Se conservan los pasos guardados; un proveedor en curso puede terminar, pero su resultado no se guardará.",
    permission: "Apruebo el procesamiento en segundo plano de esta fuente",
    empty: "No hay trabajos en este ámbito.",
    transcription: "Transcripción de grabación",
    render: "Renderizado de video",
  },
  fr: {
    title: "Tâches en arrière-plan",
    notice:
      "La transcription et le rendu continuent après la fermeture de cette page. Actualisez pour voir la progression. Le téléversement doit être terminé ; les transcriptions nécessitent une révision.",
    refresh: "Actualiser les tâches",
    queued: "En attente",
    running: "Traitement",
    complete: "Terminé",
    failed: "À vérifier",
    cancelled: "Annulé",
    cancel: "Annuler la tâche",
    retry: "Réessayer la tâche",
    start: "Traiter en arrière-plan",
    attempts: "Tentatives",
    pending:
      "Enregistré ; envoi à la file en attente. Réessayez ou revenez après la récupération planifiée.",
    error: "Traitement interrompu. Vérifiez la source puis réessayez.",
    dispatch: "Réessayer l’envoi",
    confirm:
      "Annuler ? Les étapes enregistrées sont conservées ; un appel en cours peut finir, mais son résultat ne sera pas enregistré.",
    permission: "J’approuve le traitement en arrière-plan de cette source",
    empty: "Aucune tâche dans ce périmètre.",
    transcription: "Transcription d’enregistrement",
    render: "Rendu vidéo",
  },
};
