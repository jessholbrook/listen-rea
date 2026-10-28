import { unifiedViewConfig } from "./unified-view-config";
import { z } from "zod";
import { calendarViewConfig } from "./calendar-view-config";
export { calendarViewConfig } from "./calendar-view-config";
import { planDate } from "./review-plans";
import { activityActions } from "./review-activity";
import { followUpViewConfig } from "./follow-up-view-config";
import { operationsReportConfig } from "./operations-report-config";
export { followUpViewConfig } from "./follow-up-view-config";
const idOrEmpty = z.union([z.uuid(), z.literal("")]);
const text = z.string().max(160);
const inbox = z
  .object({
    collectionId: idOrEmpty,
    reviewer: z.union([idOrEmpty, z.enum(["mine", "unassigned"])]),
    decision: z.enum(["pending", "approved", "all"]),
    state: z.enum(["", "blocked", "awaiting", "ready", "exported"]),
    query: text,
    due: z.enum(["", "overdue", "today", "week", "undated"]),
  })
  .strict();
const workload = z
  .object({
    collectionId: idOrEmpty,
    query: text,
    load: z.enum(["all", "pending", "overdue"]),
  })
  .strict();
const activity = z
  .object({
    packetId: idOrEmpty,
    personId: z.union([idOrEmpty, z.literal("system")]),
    action: z.union([z.enum(activityActions), z.literal("")]),
    from: z.union([planDate, z.literal("")]),
    to: z.union([planDate, z.literal("")]),
  })
  .strict()
  .refine(
    (v) => !v.from || !v.to || v.to >= v.from,
    "Choose an end date on or after the start date.",
  );
export const reviewViewConfig = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("requests"), filters: inbox }).strict(),
  z
    .object({
      kind: z.literal("workload"),
      filters: workload,
      selected: z.uuid().nullable(),
    })
    .strict(),
  z.object({ kind: z.literal("activity"), filters: activity }).strict(),
]);
export const savedReportViewConfig = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("report_unified"),
      report: operationsReportConfig.options[3],
    })
    .strict(),
  z
    .object({
      kind: z.literal("report_calendar"),
      report: operationsReportConfig.options[2],
    })
    .strict(),
  z
    .object({
      kind: z.literal("report_workload"),
      report: operationsReportConfig.options[0],
    })
    .strict(),
  z
    .object({
      kind: z.literal("report_activity"),
      report: operationsReportConfig.options[1],
    })
    .strict(),
]);
export type SavedReportViewConfig = z.infer<typeof savedReportViewConfig>;
export const savedViewConfig = z.union([
  reviewViewConfig,
  followUpViewConfig,
  savedReportViewConfig,
  calendarViewConfig,
  unifiedViewConfig,
]);
export type SavedViewConfig = z.infer<typeof savedViewConfig>;
export type FollowUpViewConfig = z.infer<typeof followUpViewConfig>;
export const reviewViewContent = z
  .object({
    name: z.string().trim().min(3).max(120),
    visibility: z.enum(["private", "shared"]),
    config: savedViewConfig,
  })
  .strict();
export type ReviewViewConfig = z.infer<typeof reviewViewConfig>;
export type SavedReviewView = z.infer<typeof reviewViewContent> & {
  id: string;
  workspaceId: string;
  ownerId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type SavedReviewViewItem = z.infer<typeof reviewViewContent> & {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; name: string | null };
  canManage: boolean;
  canChangeVisibility: boolean;
};
export type SavedReviewViewList = {
  views: SavedReviewViewItem[];
  canShare: boolean;
};
export const savedViewLabels = {
  en: {
    unifiedTitle: "Saved combined planning views",
    unifiedNotice:
      "Save the combined work queue, person, month/day, language and report time zone. Fixed dates stay fixed; priority queues use the current date. Opening loads current results without task selections, scheduling drafts or report approval.",
    calendarTitle: "Saved planning views",
    calendarNotice:
      "Save calendar filters, language and report time zone. Months and selected days stay fixed; overdue and next-seven-day windows use the current date. Applying loads current results without restoring selections or report approval.",
    title: "Saved review views",
    followUpTitle: "Saved follow-up views",
    reportTitle: "Saved reporting views",
    reportNotice:
      "Save these filters, language and report time zone for reuse. Shared views are visible to everyone in this workspace. Applying a view loads current results; generate and review a fresh report before downloading.",
    notice:
      "Save a name and filter values for reuse. Private presets belong to you; shared presets are visible to everyone in this workspace. Applying a preset refreshes current results.",
    choose: "Choose a saved view",
    private: "Private",
    shared: "Workspace-shared",
    visibility: "Visibility",
    name: "View name",
    save: "Save current view",
    update: "Update from current filters",
    apply: "Apply saved view",
    copy: "Save private copy",
    remove: "Delete saved view",
    confirm:
      "Delete this saved view? Your current filters and research stay unchanged.",
    cancel: "Cancel",
    refresh: "Refresh saved views",
    empty: "No saved views for this screen.",
    saved: "Saved view updated",
    applied: "Saved filters applied",
    copied: "Private copy saved",
    copyPrefix: "Copy of ",
    replace:
      "Saving replaces this preset’s name, visibility and filters with the current view.",
    changed: "This saved view changed. Refresh saved views before applying it.",
    former: "Former workspace member",
    owner: "Created by",
  },
  es: {
    unifiedTitle: "Vistas de planificación conjunta guardadas",
    unifiedNotice:
      "Guarda la cola conjunta, persona, mes/día, idioma y zona del informe. Las fechas fijas se conservan; las prioridades usan la fecha actual. Al abrir se cargan resultados actuales sin selecciones, borradores de programación ni aprobación del informe.",
    calendarTitle: "Vistas de planificación guardadas",
    calendarNotice:
      "Guarda filtros, idioma y zona horaria del informe. Los meses y días elegidos permanecen fijos; vencidos y próximos siete días usan la fecha actual. Al aplicar se cargan resultados actuales sin selecciones ni aprobación del informe.",
    title: "Vistas de revisión guardadas",
    followUpTitle: "Vistas de seguimiento guardadas",
    reportTitle: "Vistas de informes guardadas",
    reportNotice:
      "Guarda los filtros, idioma y zona horaria para reutilizarlos. Las vistas compartidas son visibles para todo el espacio. Al aplicar una vista se cargan resultados actuales; genera y revisa otro informe antes de descargarlo.",
    notice:
      "Guarda un nombre y filtros para reutilizarlos. Las vistas privadas son personales; las compartidas son visibles para todo el espacio. Aplicarlas actualiza los resultados actuales.",
    choose: "Elegir una vista guardada",
    private: "Privada",
    shared: "Compartida con el espacio",
    visibility: "Visibilidad",
    name: "Nombre de la vista",
    save: "Guardar vista actual",
    update: "Actualizar con los filtros actuales",
    apply: "Aplicar vista guardada",
    copy: "Guardar copia privada",
    remove: "Eliminar vista guardada",
    confirm:
      "¿Eliminar esta vista guardada? Los filtros actuales y la investigación se conservan.",
    cancel: "Cancelar",
    refresh: "Actualizar vistas guardadas",
    empty: "No hay vistas guardadas para esta pantalla.",
    saved: "Vista guardada actualizada",
    applied: "Filtros guardados aplicados",
    copied: "Copia privada guardada",
    copyPrefix: "Copia de ",
    replace:
      "Guardar reemplaza el nombre, la visibilidad y los filtros de esta vista con la vista actual.",
    changed:
      "La vista ha cambiado. Actualiza las vistas guardadas antes de aplicarla.",
    former: "Antiguo miembro del espacio",
    owner: "Creada por",
  },
  fr: {
    unifiedTitle: "Vues de planification combinée enregistrées",
    unifiedNotice:
      "Enregistrez la file combinée, la personne, le mois/jour, la langue et le fuseau du rapport. Les dates fixes restent fixes ; les priorités utilisent la date actuelle. L’ouverture charge les résultats actuels sans sélection, brouillon ni validation du rapport.",
    calendarTitle: "Vues de planification enregistrées",
    calendarNotice:
      "Enregistrez les filtres, la langue et le fuseau du rapport. Les mois et jours choisis restent fixes ; les retards et sept prochains jours utilisent la date actuelle. L’application charge les résultats actuels sans sélection ni validation du rapport.",
    title: "Vues de revue enregistrées",
    followUpTitle: "Vues de suivi enregistrées",
    reportTitle: "Vues de rapport enregistrées",
    reportNotice:
      "Enregistrez les filtres, la langue et le fuseau horaire pour les réutiliser. Les vues partagées sont visibles dans tout l’espace. Leur application charge les résultats actuels ; générez et vérifiez un nouveau rapport avant de télécharger.",
    notice:
      "Enregistrez un nom et des filtres pour les réutiliser. Les vues privées vous appartiennent ; les vues partagées sont visibles dans tout l’espace. Leur application actualise les résultats actuels.",
    choose: "Choisir une vue enregistrée",
    private: "Privée",
    shared: "Partagée avec l’espace",
    visibility: "Visibilité",
    name: "Nom de la vue",
    save: "Enregistrer la vue actuelle",
    update: "Actualiser avec les filtres actuels",
    apply: "Appliquer la vue enregistrée",
    copy: "Enregistrer une copie privée",
    remove: "Supprimer la vue enregistrée",
    confirm:
      "Supprimer cette vue enregistrée ? Les filtres actuels et la recherche restent inchangés.",
    cancel: "Annuler",
    refresh: "Actualiser les vues enregistrées",
    empty: "Aucune vue enregistrée pour cet écran.",
    saved: "Vue enregistrée mise à jour",
    applied: "Filtres enregistrés appliqués",
    copied: "Copie privée enregistrée",
    copyPrefix: "Copie de ",
    replace:
      "L’enregistrement remplace le nom, la visibilité et les filtres par ceux de la vue actuelle.",
    changed:
      "Cette vue a changé. Actualisez les vues enregistrées avant de l’appliquer.",
    former: "Ancien membre de l’espace",
    owner: "Créée par",
  },
};
