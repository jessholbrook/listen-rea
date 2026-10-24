import type { Language } from "./localization";
import {
  calendarMonth,
  initialCalendarState,
  type CalendarState,
} from "./follow-up-calendar";
import {
  defaultActionFilters,
  selectActionTasks,
  type ActionCenter,
  type ActionTask,
} from "./research-action-center";
import {
  defaultInboxFilters,
  selectInboxPackets,
  matchingInboxReviewers,
  type ReviewInbox,
  type InboxPacket,
  type InboxReviewer,
} from "./team-review-inbox";
export type UnifiedPlanning = {
  actions: ActionCenter;
  reviews: ReviewInbox;
  loadedAt: string;
};
export type UnifiedFilters = Omit<CalendarState, "assignee" | "status"> & {
  kind: "all" | "tasks" | "reviews";
  person: string;
  includeFinished: boolean;
};
export function initialUnifiedFilters(today: string): UnifiedFilters {
  const { assignee: _, status: __, ...rest } = initialCalendarState(today);
  return { ...rest, kind: "all", person: "", includeFinished: false };
}
export type PlanningRow = {
  key: string;
  collectionId: string;
  collectionTitle: string;
  title: string;
  dueDate: string | null;
  personId: string | null;
  personName: string | null;
  finished: boolean;
} & (
  | { kind: "task"; task: ActionTask }
  | { kind: "review"; packet: InboxPacket; reviewer: InboxReviewer }
);
export function planningRows(
  data: UnifiedPlanning,
  f: UnifiedFilters,
  today: string,
  window = true,
): PlanningRow[] {
  const includeFinished =
    f.includeFinished && (!window || f.window === "month");
  const tasks =
    f.kind === "reviews"
      ? []
      : selectActionTasks(
          data.actions,
          {
            ...defaultActionFilters,
            collectionId: f.collectionId,
            assignee: f.person,
            status: includeFinished ? "all" : "active",
            query: f.query,
            due: window && f.window !== "month" ? f.window : "",
          },
          today,
        ).map((t) => ({
          key: "task:" + t.id,
          kind: "task" as const,
          collectionId: t.collectionId,
          collectionTitle:
            data.actions.collections.find((c) => c.id === t.collectionId)
              ?.title || "",
          title: t.title,
          dueDate: t.dueDate,
          personId: t.assigneeId,
          personName:
            data.actions.members.find((m) => m.id === t.assigneeId)?.name ||
            null,
          finished: t.status === "completed",
          task: t,
        }));
  const rf = {
    ...defaultInboxFilters,
    collectionId: f.collectionId,
    reviewer: f.person,
    decision: includeFinished ? "all" : "pending",
    query: f.query,
    due: window && f.window !== "month" ? f.window : "",
  };
  const reviews =
    f.kind === "tasks"
      ? []
      : selectInboxPackets(data.reviews, rf, today).flatMap((packet) =>
          matchingInboxReviewers(packet, data.reviews, rf, today)
            .filter(() => f.person !== "unassigned")
            .map((reviewer) => ({
              key: `review:${packet.id}:${reviewer.id}`,
              kind: "review" as const,
              collectionId: packet.collectionId,
              collectionTitle: packet.collectionTitle,
              title: packet.title,
              dueDate: reviewer.dueDate || null,
              personId: reviewer.id,
              personName: reviewer.name,
              finished: !!reviewer.approvedAt,
              packet,
              reviewer,
            })),
        );
  return [...tasks, ...reviews]
    .filter(
      (r) =>
        !window ||
        f.window !== "month" ||
        (!!r.dueDate &&
          (f.day ? r.dueDate === f.day : r.dueDate.startsWith(f.month + "-"))),
    )
    .sort(
      (a, b) =>
        Number(a.finished) - Number(b.finished) ||
        (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
        a.kind.localeCompare(b.kind) ||
        a.title.localeCompare(b.title) ||
        a.key.localeCompare(b.key),
    );
}
export function unifiedProjection(
  data: UnifiedPlanning,
  f: UnifiedFilters,
  today: string,
) {
  const all = planningRows(data, f, today, false),
    rows = planningRows(data, f, today);
  const counts = Object.fromEntries(
    calendarMonth(f.month).days.map((day) => [
      day,
      all.filter((r) => r.dueDate === day).length,
    ]),
  );
  const priorities = Object.fromEntries(
    (["overdue", "week", "undated"] as const).map((window) => [
      window,
      planningRows(
        data,
        { ...f, window, day: "", includeFinished: false },
        today,
      ).length,
    ]),
  );
  return {
    rows,
    counts,
    priorities,
    tasks: rows.filter((r) => r.kind === "task").length,
    reviews: rows.filter((r) => r.kind === "review").length,
  };
}
export const unifiedLabels: Record<
  Language,
  {
    title: string;
    tab: string;
    notice: string;
    kind: string;
    all: string;
    tasks: string;
    reviews: string;
    person: string;
    finished: string;
    refresh: string;
    empty: string;
    open: string;
    schedule: string;
    taskSchedule: string;
    preview: string;
    ack: string;
    apply: string;
    finish: string;
    cancel: string;
    before: string;
    after: string;
    saved: string;
    failed: string;
    reviewWarning: string;
    taskWarning: string;
    unavailable: string;
    loaded: string;
    clear: string;
  }
> = {
  en: {
    title: "Research planning calendar",
    tab: "Research planning",
    notice:
      "Follow-up tasks and individual reviewer requests in one calendar. Each review request counts separately. Dates use your local calendar. Unassigned filters match tasks; packets with no requested reviewers appear in the review inbox. Refresh for other sessions’ changes.",
    kind: "Work queue",
    all: "All work",
    tasks: "Follow-up tasks",
    reviews: "Review requests",
    person: "Assignee or reviewer",
    finished: "Include completed tasks and approved reviews",
    refresh: "Refresh planning",
    empty: "No work in this window.",
    open: "Open current item",
    schedule: "Schedule review deadline",
    taskSchedule: "Reschedule task deadlines",
    preview: "Preview review deadline",
    ack: "I reviewed this reviewer and the before/after deadline.",
    apply: "Apply review deadline",
    finish: "Finish and refresh planning",
    cancel: "Cancel and refresh planning",
    before: "Current deadline",
    after: "Proposed deadline",
    saved: "Review deadline saved",
    failed:
      "The outcome could not be confirmed. Refresh and inspect the current deadline before continuing. No write is retried automatically.",
    reviewWarning:
      "Changing only a review deadline preserves reviewer decisions and final approval. It sends no reminder.",
    taskWarning:
      "Task date changes make handoff review stale. Review deadlines preserve approvals. These are separate scheduling operations.",
    unavailable:
      "This exact item or reviewer is no longer available. Refresh planning.",
    loaded: "Loaded at",
    clear: "Clear review deadline",
  },
  es: {
    title: "Calendario de planificación de investigación",
    tab: "Planificación de investigación",
    notice:
      "Tareas y solicitudes individuales de revisión en un calendario. Cada solicitud cuenta por separado. Las fechas usan tu calendario local. Sin responsable solo incluye tareas; los paquetes sin revisores aparecen en la bandeja. Actualiza para ver cambios de otras sesiones.",
    kind: "Cola de trabajo",
    all: "Todo el trabajo",
    tasks: "Tareas de seguimiento",
    reviews: "Solicitudes de revisión",
    person: "Responsable o revisor",
    finished: "Incluir tareas completadas y revisiones aprobadas",
    refresh: "Actualizar planificación",
    empty: "No hay trabajo en este período.",
    open: "Abrir elemento actual",
    schedule: "Programar plazo de revisión",
    taskSchedule: "Reprogramar fechas de tareas",
    preview: "Vista previa del plazo",
    ack: "He revisado este revisor y las fechas actual y propuesta.",
    apply: "Aplicar plazo de revisión",
    finish: "Terminar y actualizar planificación",
    cancel: "Cancelar y actualizar planificación",
    before: "Plazo actual",
    after: "Plazo propuesto",
    saved: "Plazo de revisión guardado",
    failed:
      "No se pudo confirmar el resultado. Actualiza e inspecciona el plazo antes de continuar. No se reintentan cambios automáticamente.",
    reviewWarning:
      "Cambiar solo el plazo conserva decisiones y aprobación final. No envía recordatorios.",
    taskWarning:
      "Cambiar fechas de tareas deja obsoleta su revisión. Los plazos de revisión conservan aprobaciones. Son operaciones separadas.",
    unavailable:
      "El elemento o revisor exacto ya no está disponible. Actualiza la planificación.",
    loaded: "Cargado a las",
    clear: "Quitar plazo de revisión",
  },
  fr: {
    title: "Calendrier de planification de recherche",
    tab: "Planification de recherche",
    notice:
      "Tâches et demandes individuelles de revue dans un calendrier. Chaque demande compte séparément. Les dates suivent votre calendrier local. Sans responsable concerne les tâches ; les dossiers sans relecteur figurent dans la boîte de revue. Actualisez pour voir les changements des autres sessions.",
    kind: "File de travail",
    all: "Tout le travail",
    tasks: "Tâches de suivi",
    reviews: "Demandes de revue",
    person: "Responsable ou relecteur",
    finished: "Inclure les tâches terminées et revues approuvées",
    refresh: "Actualiser la planification",
    empty: "Aucun travail dans cette période.",
    open: "Ouvrir l’élément actuel",
    schedule: "Planifier l’échéance de revue",
    taskSchedule: "Replanifier les échéances des tâches",
    preview: "Aperçu de l’échéance",
    ack: "J’ai vérifié le relecteur et les échéances actuelle et proposée.",
    apply: "Appliquer l’échéance de revue",
    finish: "Terminer et actualiser",
    cancel: "Annuler et actualiser",
    before: "Échéance actuelle",
    after: "Échéance proposée",
    saved: "Échéance de revue enregistrée",
    failed:
      "Impossible de confirmer le résultat. Actualisez et vérifiez l’échéance avant de continuer. Aucune écriture n’est relancée automatiquement.",
    reviewWarning:
      "Modifier uniquement une échéance préserve les décisions et l’approbation finale. Aucun rappel n’est envoyé.",
    taskWarning:
      "Les dates des tâches rendent leur revue obsolète. Les échéances de revue préservent les validations. Ces opérations sont distinctes.",
    unavailable:
      "Cet élément exact ou ce relecteur n’est plus disponible. Actualisez la planification.",
    loaded: "Chargé à",
    clear: "Effacer l’échéance de revue",
  },
};
