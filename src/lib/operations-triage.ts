import { z } from "zod";
import { planDate } from "./review-plans";
export const triageChanges = z
  .object({
    assignee: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("keep") }).strict(),
      z.object({ mode: z.literal("clear") }).strict(),
      z.object({ mode: z.literal("set"), id: z.uuid() }).strict(),
    ]),
    dueDate: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("keep") }).strict(),
      z.object({ mode: z.literal("clear") }).strict(),
      z.object({ mode: z.literal("set"), date: planDate }).strict(),
    ]),
  })
  .strict()
  .refine(
    (v) => v.assignee.mode !== "keep" || v.dueDate.mode !== "keep",
    "Choose at least one change.",
  );
export const triageTarget = z
  .object({
    id: z.uuid(),
    collectionId: z.uuid(),
    version: z.number().int().positive(),
  })
  .strict();
export const triagePreviewInput = z
  .object({
    changes: triageChanges,
    tasks: z
      .array(triageTarget)
      .min(1)
      .max(25)
      .refine(
        (v) => new Set(v.map((t) => t.id)).size === v.length,
        "Choose each task once.",
      ),
  })
  .strict();
export const triageApplyInput = triagePreviewInput
  .extend({ acknowledged: z.literal(true) })
  .strict();
export type TriageChanges = z.infer<typeof triageChanges>;
export type TriageTarget = z.infer<typeof triageTarget>;
export type TriageStatus =
  | "ready"
  | "applied"
  | "unchanged"
  | "conflict"
  | "unavailable"
  | "forbidden"
  | "failed";
export type TriageRow = TriageTarget & {
  status: TriageStatus;
  title?: string;
  collectionTitle?: string;
  taskStatus?: "open" | "in_progress" | "completed";
  before?: {
    assignee: { id: string; name: string | null } | null;
    dueDate: string | null;
  };
  after?: {
    assignee: { id: string; name: string | null } | null;
    dueDate: string | null;
  };
};
export type TriagePreview = { changes: TriageChanges; tasks: TriageRow[] };
export const triageLabels = {
  en: {
    title: "Operations triage",
    notice:
      "Choose up to 25 follow-ups, including selections hidden by filters. Preview assignment and due-date changes before applying. Each task saves independently; conflicts leave that task unchanged.",
    reviewWarning:
      "Task changes make the collection’s handoff review stale. Reviewer decisions and final handoff approval will need review again. Research findings, task titles and task status stay unchanged.",
    select: "Select follow-up",
    selected: "Selected follow-ups",
    hidden: "Selected outside these filters",
    clear: "Clear selection",
    assignee: "Assignment change",
    due: "Due-date change",
    keep: "Keep current value",
    set: "Set a value",
    remove: "Clear current value",
    member: "New assignee",
    date: "New due date",
    preview: "Preview task changes",
    apply: "Apply to ready tasks",
    cancel: "Cancel and refresh tasks",
    ack: "Apply these assignment and date changes to ready tasks and require handoff review again.",
    before: "Current",
    after: "Proposed",
    none: "None",
    ready: "Ready to apply",
    applied: "Applied",
    unchanged: "Already matches — unchanged",
    conflict: "Changed — refresh and preview again",
    unavailable: "Task unavailable",
    forbidden: "Edit access unavailable",
    failed: "Outcome uncertain — refresh and inspect tasks",
    results: "Triage results",
    finish: "Finish and refresh tasks",
    interrupted:
      "If an apply request is interrupted, some tasks may already be saved. Refresh and inspect them before starting again. Changes are never automatically retried.",
    empty: "Select follow-ups in the list below.",
    close: "Close triage",
    open: "Triage selected follow-ups",
  },
  es: {
    title: "Triaje de operaciones",
    notice:
      "Elige hasta 25 seguimientos, incluidas selecciones ocultas por los filtros. Revisa los cambios de responsable y fecha antes de aplicarlos. Cada tarea se guarda por separado; los conflictos no la modifican.",
    reviewWarning:
      "Los cambios en tareas dejan obsoleta la revisión de entrega de la colección. Las decisiones y la aprobación final deberán revisarse de nuevo. Los hallazgos, títulos y estados de las tareas no cambian.",
    select: "Seleccionar seguimiento",
    selected: "Seguimientos seleccionados",
    hidden: "Seleccionados fuera de estos filtros",
    clear: "Borrar selección",
    assignee: "Cambio de responsable",
    due: "Cambio de fecha límite",
    keep: "Conservar valor actual",
    set: "Establecer un valor",
    remove: "Borrar valor actual",
    member: "Nuevo responsable",
    date: "Nueva fecha límite",
    preview: "Vista previa de cambios",
    apply: "Aplicar a tareas listas",
    cancel: "Cancelar y actualizar tareas",
    ack: "Aplicar estos cambios de responsable y fecha a las tareas listas y requerir otra revisión de entrega.",
    before: "Actual",
    after: "Propuesto",
    none: "Ninguno",
    ready: "Listo para aplicar",
    applied: "Aplicado",
    unchanged: "Ya coincide: sin cambios",
    conflict: "Ha cambiado: actualiza y revisa de nuevo",
    unavailable: "Tarea no disponible",
    forbidden: "Sin acceso de edición",
    failed: "Resultado incierto: actualiza e inspecciona las tareas",
    results: "Resultados del triaje",
    finish: "Terminar y actualizar tareas",
    interrupted:
      "Si se interrumpe una solicitud, algunas tareas podrían haberse guardado. Actualiza e inspecciónalas antes de volver a empezar. Los cambios no se reintentan automáticamente.",
    empty: "Selecciona seguimientos en la lista inferior.",
    close: "Cerrar triaje",
    open: "Revisar seguimientos seleccionados",
  },
  fr: {
    title: "Triage des opérations",
    notice:
      "Choisissez jusqu’à 25 suivis, y compris ceux masqués par les filtres. Vérifiez les changements de responsable et de date avant application. Chaque tâche est enregistrée séparément ; un conflit la laisse inchangée.",
    reviewWarning:
      "Les changements de tâches rendent obsolète la revue de transmission de la collection. Les décisions et l’approbation finale devront être revues. Les résultats de recherche, titres et états des tâches restent inchangés.",
    select: "Sélectionner le suivi",
    selected: "Suivis sélectionnés",
    hidden: "Sélections hors des filtres",
    clear: "Effacer la sélection",
    assignee: "Changement de responsable",
    due: "Changement d’échéance",
    keep: "Conserver la valeur actuelle",
    set: "Définir une valeur",
    remove: "Effacer la valeur actuelle",
    member: "Nouveau responsable",
    date: "Nouvelle échéance",
    preview: "Aperçu des changements",
    apply: "Appliquer aux tâches prêtes",
    cancel: "Annuler et actualiser les tâches",
    ack: "Appliquer ces changements de responsable et de date aux tâches prêtes et demander une nouvelle revue de transmission.",
    before: "Actuel",
    after: "Proposé",
    none: "Aucun",
    ready: "Prêt à appliquer",
    applied: "Appliqué",
    unchanged: "Déjà identique — inchangé",
    conflict: "Modifié — actualisez et vérifiez à nouveau",
    unavailable: "Tâche indisponible",
    forbidden: "Accès en modification indisponible",
    failed: "Résultat incertain — actualisez et inspectez les tâches",
    results: "Résultats du triage",
    finish: "Terminer et actualiser les tâches",
    interrupted:
      "Si une demande est interrompue, certaines tâches peuvent déjà être enregistrées. Actualisez et inspectez-les avant de recommencer. Les changements ne sont jamais réessayés automatiquement.",
    empty: "Sélectionnez des suivis dans la liste ci-dessous.",
    close: "Fermer le triage",
    open: "Trier les suivis sélectionnés",
  },
};
