import {
  defaultActionFilters,
  selectActionTasks,
  type ActionCenter,
  type ActionFilters,
} from "./research-action-center";
export const workloadMetrics = [
  "active",
  "open",
  "in_progress",
  "completed",
  "overdue",
  "today",
  "week",
  "undated",
] as const;
export type WorkloadMetric = (typeof workloadMetrics)[number];
export type FollowUpScope = { collectionId: string; query: string };
export const defaultFollowUpScope: FollowUpScope = {
  collectionId: "",
  query: "",
};
export function workloadQueueFilters(
  scope: FollowUpScope,
  assignee: string,
  metric: WorkloadMetric,
): ActionFilters {
  return {
    ...defaultActionFilters,
    ...scope,
    assignee,
    ...(["overdue", "today", "week", "undated"].includes(metric)
      ? { due: metric }
      : { status: metric }),
  };
}
export function followUpWorkload(
  data: ActionCenter,
  scope: FollowUpScope,
  today: string,
) {
  // Use the original queue selector for every count and drill-down, including local-date semantics.
  const empty = () =>
    Object.fromEntries(workloadMetrics.map((metric) => [metric, 0])) as Record<
      WorkloadMetric,
      number
    >;
  const members = new Map(
    data.members.map((m) => [
      m.id,
      { id: m.id, name: m.name, counts: empty() },
    ]),
  );
  // An unexpected stale assignee stays an exact, unavailable scope rather than being dropped or widened.
  for (const t of data.tasks)
    if (t.assigneeId && !members.has(t.assigneeId))
      members.set(t.assigneeId, {
        id: t.assigneeId,
        name: "",
        counts: empty(),
      });
  members.set("unassigned", { id: "unassigned", name: "", counts: empty() });
  const totals = empty();
  for (const metric of workloadMetrics) {
    const tasks = selectActionTasks(
      data,
      workloadQueueFilters(scope, "", metric),
      today,
    );
    totals[metric] = tasks.length;
    for (const task of tasks)
      members.get(task.assigneeId || "unassigned")!.counts[metric]++;
  }
  const rows = [...members.values()];
  rows.sort(
    (a, b) =>
      b.counts.overdue - a.counts.overdue ||
      b.counts.active - a.counts.active ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
  return { totals, rows };
}
export const followUpWorkloadLabels = {
  en: {
    title: "Follow-up workload",
    notice:
      "Current tasks by assignee, including unassigned work. Counts describe tasks, not people’s capacity. Due windows use your local calendar; the next 7 days includes today. Completed tasks are counted separately. Refresh to see changes from other sessions.",
    scope: "Workload scope",
    query: "Search workload task titles",
    rows: "Show assignees",
    all: "Everyone, including zero tasks",
    active: "With unfinished tasks",
    overdue: "With overdue tasks",
    totals: "Workspace totals",
    people: "Assignee breakdown",
    empty: "No assignees match this view.",
    matching: "Matching assignees",
    open: "Open filtered tasks",
    unavailable: "Unavailable assignee",
    reset: "Reset workload filters",
    page: "Assignee page",
    previous: "Previous assignees",
    next: "Next assignees",
  },
  es: {
    title: "Carga de seguimientos",
    notice:
      "Tareas actuales por responsable, incluidas las que no tienen asignación. Los recuentos describen tareas, no la capacidad de las personas. Los plazos usan tu calendario local; los próximos 7 días incluyen hoy. Las completadas se cuentan por separado. Actualiza para ver cambios de otras sesiones.",
    scope: "Alcance de la carga",
    query: "Buscar títulos de tareas de seguimiento",
    rows: "Mostrar responsables",
    all: "Todo el equipo, incluso sin tareas",
    active: "Con tareas sin terminar",
    overdue: "Con tareas vencidas",
    totals: "Totales del espacio",
    people: "Desglose por responsable",
    empty: "Ningún responsable coincide con esta vista.",
    matching: "Responsables coincidentes",
    open: "Abrir tareas filtradas",
    unavailable: "Responsable no disponible",
    reset: "Restablecer filtros de carga",
    page: "Página de responsables",
    previous: "Responsables anteriores",
    next: "Responsables siguientes",
  },
  fr: {
    title: "Charge des suivis",
    notice:
      "Tâches actuelles par responsable, y compris les tâches non attribuées. Les nombres décrivent des tâches, pas la capacité des personnes. Les échéances suivent votre calendrier local ; les 7 prochains jours incluent aujourd’hui. Les tâches terminées sont comptées séparément. Actualisez pour voir les changements des autres sessions.",
    scope: "Périmètre de la charge",
    query: "Rechercher un titre de tâche de suivi",
    rows: "Afficher les responsables",
    all: "Toute l’équipe, même sans tâches",
    active: "Avec des tâches non terminées",
    overdue: "Avec des tâches en retard",
    totals: "Totaux de l’espace",
    people: "Répartition par responsable",
    empty: "Aucun responsable ne correspond à cette vue.",
    matching: "Responsables correspondants",
    open: "Ouvrir les tâches filtrées",
    unavailable: "Responsable indisponible",
    reset: "Réinitialiser les filtres de charge",
    page: "Page des responsables",
    previous: "Responsables précédents",
    next: "Responsables suivants",
  },
};
