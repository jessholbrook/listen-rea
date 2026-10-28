import type { OperationsReportConfig } from "./operations-report";
import type { Language } from "./localization";
import {
  actionOverdue,
  selectActionTasks,
  defaultActionFilters,
  type ActionCenter,
  type ActionFilters,
} from "./research-action-center";
import {
  defaultInboxFilters,
  selectInboxPackets,
  type ReviewInbox,
} from "./team-review-inbox";
import type { ActivityView } from "./review-activity";
import type {
  ReviewViewConfig,
  FollowUpViewConfig,
  SavedReviewViewItem,
} from "./saved-review-views";
export type ReviewEntry = {
  language: Language;
  config?: ReviewViewConfig;
  packet?: { id: string; collectionId: string };
};
export type ActionEntry = {
  task?: { id: string; collectionId: string };
  planning?: import("./calendar-view-config").CalendarViewConfig;
  report?: Exclude<OperationsReportConfig, { kind: "unified" }>;
  mode?: "workload" | "calendar";
  language: Language;
  filters: ActionFilters;
  config?: FollowUpViewConfig;
};
export type OperationsData = {
  actions: ActionCenter;
  inbox: ReviewInbox;
  activity: ActivityView;
  views: SavedReviewViewItem[];
};
// Reuse the original authenticated projections. No stored dashboard or new authority.
export async function loadOperations(
  read: (route: string) => Promise<any>,
): Promise<OperationsData> {
  const [actions, inbox, activity, catalog] = await Promise.all([
    read("library/action-center"),
    read("library/review-inbox"),
    read("library/review-activity"),
    read("library/saved-review-views"),
  ]);
  return { actions, inbox, activity, views: catalog.views };
}
export function operationsSummary(data: OperationsData, today: string) {
  const tasks = selectActionTasks(
      data.actions,
      { ...defaultActionFilters, due: "overdue" },
      today,
    ),
    blocked = selectInboxPackets(
      data.inbox,
      {
        ...defaultInboxFilters,
        reviewer: "",
        decision: "all",
        state: "blocked",
      },
      today,
    ),
    overdue = selectInboxPackets(
      data.inbox,
      { ...defaultInboxFilters, reviewer: "", due: "overdue" },
      today,
    ),
    mine = selectInboxPackets(data.inbox, defaultInboxFilters, today),
    ready = data.inbox.packets.filter((p) => p.state === "ready");
  // Another projection may have pruned an invalid packet while requests loaded.
  const activity = data.activity.events.filter((e) =>
    data.inbox.packets.some((p) => p.id === e.packet.id),
  );
  return {
    tasks: tasks.filter((t) => actionOverdue(t, today)),
    blocked,
    overdue,
    mine,
    ready,
    activity,
  };
}
export const operationsLabels = {
  en: {
    title: "Research operations home",
    tab: "Operations home",
    language: "Operations language",
    notice:
      "A workspace overview of follow-ups and handoff reviews. Dates use your local calendar. Refresh for changes from other sessions; opening an item loads its current state.",
    refresh: "Refresh operations",
    loaded: "Overview refreshed",
    failed: "The overview could not be loaded. Refresh to try again.",
    overdueTasks: "Overdue follow-ups",
    overdueReviews: "Packets with overdue reviews",
    blocked: "Blocked review packets",
    mine: "Packets awaiting my review",
    ready: "Ready for final approval",
    tasks: "View overdue follow-ups",
    reviews: "View overdue reviews",
    blockers: "View blocked packets",
    myReviews: "View my reviews",
    final: "View ready packets",
    empty: "Nothing here right now.",
    recent: "Recent review activity",
    history: "View full activity history",
    retained:
      "Recent retained events only; deleting research removes its history.",
    saved: "Saved workspace views",
    choose: "Choose a saved view",
    apply: "Open saved view",
    manage: "Manage review views",
    unavailable:
      "Saved view changed or is unavailable. Refresh before opening it.",
    openTask: "Open follow-ups for this collection",
    openPacket: "Open packet",
    private: "Private",
    shared: "Workspace-shared",
    updated: "Loaded at",
    limit:
      "Showing up to 5 items in each preview. Open the full queue for all results.",
  },
  es: {
    title: "Inicio de operaciones de investigación",
    tab: "Inicio de operaciones",
    language: "Idioma de operaciones",
    notice:
      "Resumen de seguimientos y revisiones del espacio. Las fechas usan tu calendario local. Actualiza para ver cambios de otras sesiones; al abrir un elemento se carga su estado actual.",
    refresh: "Actualizar operaciones",
    loaded: "Resumen actualizado",
    failed: "No se pudo cargar el resumen. Actualiza para volver a intentarlo.",
    overdueTasks: "Seguimientos vencidos",
    overdueReviews: "Paquetes con revisiones vencidas",
    blocked: "Paquetes de revisión bloqueados",
    mine: "Paquetes pendientes de mi revisión",
    ready: "Listos para aprobación final",
    tasks: "Ver seguimientos vencidos",
    reviews: "Ver revisiones vencidas",
    blockers: "Ver paquetes bloqueados",
    myReviews: "Ver mis revisiones",
    final: "Ver paquetes listos",
    empty: "No hay elementos en este momento.",
    recent: "Actividad de revisión reciente",
    history: "Ver historial completo",
    retained:
      "Solo eventos recientes conservados; eliminar la investigación elimina su historial.",
    saved: "Vistas guardadas del espacio",
    choose: "Elegir una vista guardada",
    apply: "Abrir vista guardada",
    manage: "Gestionar vistas de revisión",
    unavailable:
      "La vista cambió o no está disponible. Actualiza antes de abrirla.",
    openTask: "Abrir seguimientos de esta colección",
    openPacket: "Abrir paquete",
    private: "Privada",
    shared: "Compartida con el espacio",
    updated: "Cargado a las",
    limit:
      "Se muestran hasta 5 elementos por vista previa. Abre la lista completa para ver todos los resultados.",
  },
  fr: {
    title: "Accueil des opérations de recherche",
    tab: "Accueil des opérations",
    language: "Langue des opérations",
    notice:
      "Vue d’ensemble des suivis et revues de l’espace. Les dates suivent votre calendrier local. Actualisez pour voir les changements des autres sessions ; ouvrir un élément charge son état actuel.",
    refresh: "Actualiser les opérations",
    loaded: "Vue d’ensemble actualisée",
    failed:
      "Impossible de charger la vue d’ensemble. Actualisez pour réessayer.",
    overdueTasks: "Suivis en retard",
    overdueReviews: "Dossiers avec revues en retard",
    blocked: "Dossiers de revue bloqués",
    mine: "Dossiers en attente de ma revue",
    ready: "Prêts pour l’approbation finale",
    tasks: "Voir les suivis en retard",
    reviews: "Voir les revues en retard",
    blockers: "Voir les dossiers bloqués",
    myReviews: "Voir mes revues",
    final: "Voir les dossiers prêts",
    empty: "Aucun élément pour le moment.",
    recent: "Activité de revue récente",
    history: "Voir tout l’historique",
    retained:
      "Événements récents conservés uniquement ; supprimer la recherche efface son historique.",
    saved: "Vues enregistrées de l’espace",
    choose: "Choisir une vue enregistrée",
    apply: "Ouvrir la vue enregistrée",
    manage: "Gérer les vues de revue",
    unavailable:
      "La vue a changé ou est indisponible. Actualisez avant de l’ouvrir.",
    openTask: "Ouvrir les suivis de cette collection",
    openPacket: "Ouvrir le dossier",
    private: "Privée",
    shared: "Partagée avec l’espace",
    updated: "Chargé à",
    limit:
      "Jusqu’à 5 éléments par aperçu. Ouvrez la liste complète pour voir tous les résultats.",
  },
};
