import { z } from "zod";
export const taskTarget = z
  .object({ kind: z.enum(["interview", "answer", "brief"]), id: z.uuid() })
  .strict()
  .nullable();
export const taskContent = z
  .object({
    title: z.string().trim().min(3).max(160),
    assigneeId: z.uuid().nullable(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (s) =>
          s >= "2000-01-01" &&
          s <= "2100-12-31" &&
          !Number.isNaN(Date.parse(s + "T00:00:00Z")) &&
          new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s,
        "Choose a valid calendar date.",
      )
      .nullable(),
    status: z.enum(["open", "in_progress", "completed"]),
  })
  .strict();
export const taskCreate = taskContent
  .extend({ requestId: z.uuid(), target: taskTarget })
  .strict();
export const taskEdit = taskContent
  .extend({ version: z.number().int().positive() })
  .strict();
export type CollectionTask = z.infer<typeof taskContent> & {
  id: string;
  workspaceId: string;
  collectionId: string;
  requestId: string;
  inputHash: string;
  target: z.infer<typeof taskTarget>;
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
export function taskView(t: CollectionTask) {
  const { workspaceId, requestId, inputHash, ...safe } = t;
  return safe;
}
export type TaskView = ReturnType<typeof taskView>;
export type TaskPlan = {
  tasks: TaskView[];
  members: { id: string; name: string }[];
  canEdit: boolean;
};
export const taskLabels = {
  en: {
    title: "Follow-up plan",
    notice:
      "Internal tasks only. Dates are calendar dates in your local time. Completing a task does not approve research. Link research-related tasks so they are removed when that source becomes unavailable.",
    add: "Add follow-up",
    edit: "Edit task",
    task: "Task title",
    assignee: "Assignee",
    unassigned: "Unassigned",
    due: "Due date",
    status: "Status",
    open: "Open",
    in_progress: "In progress",
    completed: "Completed",
    target: "Linked research",
    general: "Collection task",
    save: "Save task",
    cancel: "Cancel",
    refresh: "Refresh tasks",
    remove: "Delete task",
    confirm: "Delete this task?",
    filter: "Show tasks",
    all: "All tasks",
    mine: "Assigned to me",
    overdue: "Overdue",
    active: "Unfinished",
    empty: "No matching tasks.",
    source: "Open linked research",
    follow: "Plan follow-up",
    saved: "Task saved",
    deleted: "Task deleted",
    done: "Completed tasks",
    count: "Total tasks",
  },
  es: {
    title: "Plan de seguimiento",
    notice:
      "Solo tareas internas. Las fechas son días de calendario en tu hora local. Completar una tarea no aprueba la investigación. Vincula las tareas con su investigación para eliminarlas cuando la fuente deje de estar disponible.",
    add: "Añadir seguimiento",
    edit: "Editar tarea",
    task: "Título de la tarea",
    assignee: "Responsable",
    unassigned: "Sin asignar",
    due: "Fecha límite",
    status: "Estado",
    open: "Pendiente",
    in_progress: "En curso",
    completed: "Completada",
    target: "Investigación vinculada",
    general: "Tarea de colección",
    save: "Guardar tarea",
    cancel: "Cancelar",
    refresh: "Actualizar tareas",
    remove: "Eliminar tarea",
    confirm: "¿Eliminar esta tarea?",
    filter: "Mostrar tareas",
    all: "Todas las tareas",
    mine: "Asignadas a mí",
    overdue: "Vencidas",
    active: "Sin terminar",
    empty: "No hay tareas coincidentes.",
    source: "Abrir investigación vinculada",
    follow: "Planificar seguimiento",
    saved: "Tarea guardada",
    deleted: "Tarea eliminada",
    done: "Tareas completadas",
    count: "Total de tareas",
  },
  fr: {
    title: "Plan de suivi",
    notice:
      "Tâches internes uniquement. Les dates sont des jours calendaires dans votre heure locale. Terminer une tâche ne valide pas la recherche. Liez les tâches à leur recherche pour les supprimer lorsque la source devient indisponible.",
    add: "Ajouter un suivi",
    edit: "Modifier la tâche",
    task: "Titre de la tâche",
    assignee: "Responsable",
    unassigned: "Non attribuée",
    due: "Échéance",
    status: "Statut",
    open: "À faire",
    in_progress: "En cours",
    completed: "Terminée",
    target: "Recherche liée",
    general: "Tâche de collection",
    save: "Enregistrer la tâche",
    cancel: "Annuler",
    refresh: "Actualiser les tâches",
    remove: "Supprimer la tâche",
    confirm: "Supprimer cette tâche ?",
    filter: "Afficher les tâches",
    all: "Toutes les tâches",
    mine: "Mes tâches",
    overdue: "En retard",
    active: "Non terminées",
    empty: "Aucune tâche correspondante.",
    source: "Ouvrir la recherche liée",
    follow: "Planifier un suivi",
    saved: "Tâche enregistrée",
    deleted: "Tâche supprimée",
    done: "Tâches terminées",
    count: "Nombre de tâches",
  },
};
