import {
  defaultActionFilters,
  selectActionTasks,
  type ActionCenter,
  type ActionFilters,
} from "./research-action-center";
export type PinScope = "private" | "shared";
export type PinBoard = { version: number; viewIds: string[] };
export type OperationsPins = {
  private: PinBoard;
  shared: PinBoard;
  canManageShared: boolean;
};
export function followUpPriorities(data: ActionCenter, today: string) {
  const filters: Record<"today" | "unassigned" | "mine", ActionFilters> = {
    today: { ...defaultActionFilters, due: "today" },
    unassigned: { ...defaultActionFilters, assignee: "unassigned" },
    mine: { ...defaultActionFilters, assignee: "mine" },
  };
  return Object.entries(filters).map(([kind, filter]) => ({
    kind: kind as keyof typeof filters,
    filters: filter,
    count: selectActionTasks(data, filter, today).length,
  }));
}
export const operationsWorkspaceLabels = {
  en: {
    title: "Workspace launchpad",
    notice:
      "Open a current report, check follow-up priorities or pin a saved view. Personal pins can reference your private or shared views. Team pins only reference shared views and are managed by editors. Up to 12 pins per list; pinned names and settings always come from current views.",
    personal: "Your pinned views",
    team: "Team pinned views",
    empty: "No pinned views yet.",
    pinPersonal: "Pin for me",
    pinTeam: "Pin for team",
    open: "Open pinned view",
    remove: "Unpin view",
    up: "Move pin up",
    down: "Move pin down",
    quick: "Quick reports",
    workload: "Open workload report",
    activity: "Open activity report",
    priorities: "Follow-up priorities",
    today: "Due today",
    unassigned: "Unassigned unfinished tasks",
    mine: "My unfinished tasks",
    queue: "Open priority queue",
    overlap:
      "These unfinished-task queues can overlap. Dates use your local calendar. Refresh for changes from other sessions.",
    manage:
      "Choose a saved view below to pin it. Pinning never changes the saved view’s visibility or approves a report.",
  },
  es: {
    title: "Inicio del espacio",
    notice:
      "Abre un informe actual, consulta prioridades o fija una vista guardada. Los accesos personales pueden usar tus vistas privadas o compartidas. Los accesos del equipo solo usan vistas compartidas y los gestionan los editores. Hasta 12 accesos por lista; nombres y filtros proceden de las vistas actuales.",
    personal: "Tus vistas fijadas",
    team: "Vistas fijadas del equipo",
    empty: "Todavía no hay vistas fijadas.",
    pinPersonal: "Fijar para mí",
    pinTeam: "Fijar para el equipo",
    open: "Abrir vista fijada",
    remove: "Quitar acceso",
    up: "Subir acceso",
    down: "Bajar acceso",
    quick: "Informes rápidos",
    workload: "Abrir informe de carga",
    activity: "Abrir informe de actividad",
    priorities: "Prioridades de seguimiento",
    today: "Vencen hoy",
    unassigned: "Tareas sin terminar y sin asignar",
    mine: "Mis tareas sin terminar",
    queue: "Abrir lista prioritaria",
    overlap:
      "Estas listas de tareas sin terminar pueden solaparse. Las fechas usan tu calendario local. Actualiza para ver cambios de otras sesiones.",
    manage:
      "Elige una vista guardada abajo para fijarla. Fijar no cambia su visibilidad ni aprueba informes.",
  },
  fr: {
    title: "Accueil de l’espace",
    notice:
      "Ouvrez un rapport actuel, consultez les priorités ou épinglez une vue enregistrée. Les accès personnels peuvent viser vos vues privées ou partagées. Les accès d’équipe visent uniquement des vues partagées et sont gérés par les éditeurs. Jusqu’à 12 accès par liste ; noms et filtres proviennent des vues actuelles.",
    personal: "Vos vues épinglées",
    team: "Vues épinglées de l’équipe",
    empty: "Aucune vue épinglée pour le moment.",
    pinPersonal: "Épingler pour moi",
    pinTeam: "Épingler pour l’équipe",
    open: "Ouvrir la vue épinglée",
    remove: "Retirer l’accès",
    up: "Monter l’accès",
    down: "Descendre l’accès",
    quick: "Rapports rapides",
    workload: "Ouvrir le rapport de charge",
    activity: "Ouvrir le rapport d’activité",
    priorities: "Priorités de suivi",
    today: "Pour aujourd’hui",
    unassigned: "Tâches non terminées et non attribuées",
    mine: "Mes tâches non terminées",
    queue: "Ouvrir la liste prioritaire",
    overlap:
      "Ces listes de tâches non terminées peuvent se recouper. Les dates suivent votre calendrier local. Actualisez pour voir les changements des autres sessions.",
    manage:
      "Choisissez une vue enregistrée ci-dessous pour l’épingler. Épingler ne modifie pas sa visibilité et ne valide aucun rapport.",
  },
};
