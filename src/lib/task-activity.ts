export const taskActivityActions = [
  "task_created",
  "task_updated",
  "task_triaged",
  "assignee_unavailable",
] as const;
export const taskActivityFields = [
  "assignee",
  "dueDate",
  "status",
  "title",
] as const;
export type TaskActivityAction = (typeof taskActivityActions)[number];
export type TaskState = {
  assigneeId: string | null;
  dueDate: string | null;
  status: "open" | "in_progress" | "completed";
};
export type TaskEvent = {
  id: string;
  sequence: number;
  at: string;
  actorId: string | null;
  action: TaskActivityAction;
  taskVersion: number;
  before: TaskState | null;
  after: TaskState;
  titleChanged: boolean;
};
export type TaskActivity = {
  id: string;
  workspaceId: string;
  collectionId: string;
  events: TaskEvent[];
  omitted: number;
};
export type TaskEventView = Omit<TaskEvent, "actorId" | "before" | "after"> & {
  actor: { id: string; name: string | null } | null;
  before: {
    assignee: { id: string; name: string | null } | null;
    dueDate: string | null;
    status: TaskState["status"];
  } | null;
  after: {
    assignee: { id: string; name: string | null } | null;
    dueDate: string | null;
    status: TaskState["status"];
  };
  task: {
    id: string;
    collectionId: string;
    title: string;
    collectionTitle: string;
  };
};
export type TaskActivityView = {
  events: TaskEventView[];
  total: number;
  page: number;
  pages: number;
  omitted: number;
  tasks: { id: string; title: string; collectionId: string }[];
  collections: { id: string; title: string }[];
  people: { id: string; name: string | null }[];
};
export const defaultTaskActivityFilters = {
  collectionId: "",
  taskId: "",
  personId: "",
  action: "",
  field: "",
  from: "",
  to: "",
  page: 0,
};
export const taskActivityLabels = {
  en: {
    title: "Follow-up activity history",
    tasks: "Follow-up tasks",
    notice:
      "Recent task changes from this release onward. Up to 100 events per task are retained. Deleting a task, its collection or linked research removes its history. This is not a permanent audit trail.",
    refresh: "Refresh follow-up history",
    collection: "Collection",
    task: "Follow-up",
    person: "Person involved",
    action: "Action",
    field: "Changed field",
    all: "All",
    system: "Automatic validation",
    former: "Unavailable workspace member",
    unavailableTask: "Unavailable follow-up",
    unavailableCollection: "Unavailable collection",
    from: "From date",
    to: "Through date",
    before: "Before",
    after: "After",
    none: "None",
    unassigned: "Unassigned",
    titleChanged: "Task title changed; previous text is not retained.",
    matches: "Matching events",
    omitted: "Older events no longer retained",
    empty: "No follow-up activity matches these filters.",
    reset: "Reset history filters",
    previous: "Previous page",
    next: "Next page",
    page: "Page",
    open: "Open current task",
    view: "View task history",
    task_created: "Task created",
    task_updated: "Task edited",
    task_triaged: "Triage changes applied",
    assignee_unavailable: "Unavailable assignee cleared",
    assignee: "Assignment",
    dueDate: "Due date",
    status: "Task status",
    titleField: "Title",
    openStatus: "Open",
    in_progress: "In progress",
    completed: "Completed",
  },
  es: {
    title: "Historial de actividad de seguimientos",
    tasks: "Tareas de seguimiento",
    notice:
      "Cambios recientes desde esta versión. Se conservan hasta 100 eventos por tarea. Eliminar una tarea, su colección o investigación vinculada elimina su historial. No es un registro de auditoría permanente.",
    refresh: "Actualizar historial de seguimientos",
    collection: "Colección",
    task: "Seguimiento",
    person: "Persona involucrada",
    action: "Acción",
    field: "Campo modificado",
    all: "Todos",
    system: "Validación automática",
    former: "Miembro no disponible",
    unavailableTask: "Seguimiento no disponible",
    unavailableCollection: "Colección no disponible",
    from: "Desde la fecha",
    to: "Hasta la fecha",
    before: "Antes",
    after: "Después",
    none: "Ninguno",
    unassigned: "Sin asignar",
    titleChanged: "Cambió el título; no se conserva el texto anterior.",
    matches: "Eventos coincidentes",
    omitted: "Eventos anteriores ya no conservados",
    empty: "Ninguna actividad de seguimiento coincide con los filtros.",
    reset: "Restablecer filtros del historial",
    previous: "Página anterior",
    next: "Página siguiente",
    page: "Página",
    open: "Abrir tarea actual",
    view: "Ver historial de la tarea",
    task_created: "Tarea creada",
    task_updated: "Tarea editada",
    task_triaged: "Cambios de triaje aplicados",
    assignee_unavailable: "Responsable no disponible eliminado",
    assignee: "Responsable",
    dueDate: "Fecha límite",
    status: "Estado de la tarea",
    titleField: "Título",
    openStatus: "Pendiente",
    in_progress: "En curso",
    completed: "Completada",
  },
  fr: {
    title: "Historique d’activité des suivis",
    tasks: "Tâches de suivi",
    notice:
      "Changements récents depuis cette version. Jusqu’à 100 événements par tâche sont conservés. Supprimer une tâche, sa collection ou sa recherche liée efface son historique. Ce n’est pas un journal d’audit permanent.",
    refresh: "Actualiser l’historique des suivis",
    collection: "Collection",
    task: "Suivi",
    person: "Personne concernée",
    action: "Action",
    field: "Champ modifié",
    all: "Tous",
    system: "Validation automatique",
    former: "Membre indisponible",
    unavailableTask: "Suivi indisponible",
    unavailableCollection: "Collection indisponible",
    from: "Depuis le",
    to: "Jusqu’au",
    before: "Avant",
    after: "Après",
    none: "Aucun",
    unassigned: "Non attribué",
    titleChanged: "Le titre a changé ; le texte précédent n’est pas conservé.",
    matches: "Événements correspondants",
    omitted: "Anciens événements non conservés",
    empty: "Aucune activité de suivi ne correspond aux filtres.",
    reset: "Réinitialiser les filtres de l’historique",
    previous: "Page précédente",
    next: "Page suivante",
    page: "Page",
    open: "Ouvrir la tâche actuelle",
    view: "Voir l’historique de la tâche",
    task_created: "Tâche créée",
    task_updated: "Tâche modifiée",
    task_triaged: "Changements de triage appliqués",
    assignee_unavailable: "Responsable indisponible retiré",
    assignee: "Attribution",
    dueDate: "Échéance",
    status: "État de la tâche",
    titleField: "Titre",
    openStatus: "Ouverte",
    in_progress: "En cours",
    completed: "Terminée",
  },
};
