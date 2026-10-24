import type { Language } from "./localization";
import {
  defaultActionFilters,
  selectActionTasks,
  type ActionCenter,
  type ActionFilters,
} from "./research-action-center";
export type CalendarState = {
  month: string;
  day: string;
  window: "month" | "overdue" | "week" | "undated";
  collectionId: string;
  assignee: string;
  status: string;
  query: string;
};
export function initialCalendarState(today: string): CalendarState {
  return {
    month: today.slice(0, 7),
    day: "",
    window: "month",
    collectionId: "",
    assignee: "",
    status: "active",
    query: "",
  };
}
// Date-only arithmetic stays in UTC; viewer-local today is supplied separately.
export function calendarMonth(month: string) {
  const first = new Date(month + "-01T12:00:00Z");
  const days = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12),
  ).getUTCDate();
  return {
    offset: (first.getUTCDay() + 6) % 7,
    days: Array.from(
      { length: days },
      (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
    ),
  };
}
export function moveCalendarMonth(month: string, delta: number) {
  const date = new Date(month + "-01T12:00:00Z");
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}
export function calendarProjection(
  data: ActionCenter,
  state: CalendarState,
  today: string,
) {
  const scope: ActionFilters = {
    ...defaultActionFilters,
    collectionId: state.collectionId,
    assignee: state.assignee,
    status: state.status,
    query: state.query,
  };
  const scoped = selectActionTasks(data, scope, today);
  const counts = Object.fromEntries(
    calendarMonth(state.month).days.map((day) => [
      day,
      scoped.filter((t) => t.dueDate === day).length,
    ]),
  );
  const rows =
    state.window === "month"
      ? scoped.filter(
          (t) =>
            !!t.dueDate &&
            (state.day
              ? t.dueDate === state.day
              : t.dueDate.startsWith(state.month + "-")),
        )
      : selectActionTasks(data, { ...scope, due: state.window }, today);
  // Priority counts always mean unfinished work, even when completed tasks are shown.
  const priorities = Object.fromEntries(
    (["overdue", "today", "week", "undated"] as const).map((due) => [
      due,
      selectActionTasks(data, { ...scope, status: "active", due }, today)
        .length,
    ]),
  );
  return { rows, counts, priorities };
}
export function calendarDateLabel(
  day: string,
  language: Language,
  month = false,
) {
  return new Intl.DateTimeFormat(language, {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    ...(month ? {} : { day: "numeric" as const }),
  }).format(new Date(day + "T12:00:00Z"));
}
export const calendarLabels = {
  en: {
    title: "Follow-up calendar",
    notice:
      "Plan due dates using your local calendar. Counts follow the collection, assignee and status filters; priority counts show unfinished work. Refresh for changes from other sessions.",
    month: "Calendar month",
    previous: "Previous month",
    next: "Next month",
    current: "Current month",
    whole: "Show whole month",
    reschedule: "Reschedule due dates",
    close: "Close rescheduling",
    open: "Open task",
    agenda: "Tasks in this window",
    empty: "No tasks in this window.",
    priorities: "Unfinished priorities",
    scope: "Calendar filters",
    dateOnly:
      "Only due dates change. Assignments, task titles and progress stay as they are.",
    monthView: "Month view",
  },
  es: {
    title: "Calendario de seguimientos",
    notice:
      "Planifica fechas con tu calendario local. Los recuentos siguen los filtros de colección, responsable y estado; las prioridades muestran tareas sin terminar. Actualiza para ver cambios de otras sesiones.",
    month: "Mes del calendario",
    previous: "Mes anterior",
    next: "Mes siguiente",
    current: "Mes actual",
    whole: "Mostrar todo el mes",
    reschedule: "Reprogramar fechas de entrega",
    close: "Cerrar reprogramación",
    open: "Abrir tarea",
    agenda: "Tareas en este período",
    empty: "No hay tareas en este período.",
    priorities: "Prioridades sin terminar",
    scope: "Filtros del calendario",
    dateOnly:
      "Solo cambian las fechas de entrega. Se conservan responsables, títulos y progreso.",
    monthView: "Vista mensual",
  },
  fr: {
    title: "Calendrier des suivis",
    notice:
      "Planifiez les échéances selon votre calendrier local. Les nombres suivent les filtres de collection, responsable et statut ; les priorités montrent le travail inachevé. Actualisez pour voir les changements des autres sessions.",
    month: "Mois du calendrier",
    previous: "Mois précédent",
    next: "Mois suivant",
    current: "Mois actuel",
    whole: "Afficher tout le mois",
    reschedule: "Replanifier les échéances",
    close: "Fermer la replanification",
    open: "Ouvrir la tâche",
    agenda: "Tâches de cette période",
    empty: "Aucune tâche dans cette période.",
    priorities: "Priorités inachevées",
    scope: "Filtres du calendrier",
    dateOnly:
      "Seules les échéances changent. Les responsables, titres et états restent identiques.",
    monthView: "Vue mensuelle",
  },
};
