import type { UnifiedViewConfig } from "./unified-view-config";
import {
  planningRows,
  unifiedLabels,
  type UnifiedPlanning,
} from "./unified-planning";
import { actionLabels } from "./research-action-center";
import { inboxLabels } from "./team-review-inbox";
import { calendarLabels } from "./follow-up-calendar";
import { operationsReportLabels } from "./operations-report";
export const unifiedReportLabels = {
  en: {
    kind: "Work type",
    version: "Item version",
    reviewVersion: "Review version",
    itemId: "Task or packet ID",
    personId: "Assignee or reviewer ID",
  },
  es: {
    kind: "Tipo de trabajo",
    version: "Versión del elemento",
    reviewVersion: "Versión de revisión",
    itemId: "ID de tarea o paquete",
    personId: "ID de responsable o revisor",
  },
  fr: {
    kind: "Type de travail",
    version: "Version de l’élément",
    reviewVersion: "Version de revue",
    itemId: "ID de tâche ou dossier",
    personId: "ID du responsable ou relecteur",
  },
};
export function unifiedReportContent(
  data: UnifiedPlanning,
  config: UnifiedViewConfig,
  today: string,
  reviewVersions: Map<string, number>,
) {
  const f = config.filters,
    l = unifiedLabels[config.language],
    a = actionLabels[config.language],
    il = inboxLabels[config.language],
    c = calendarLabels[config.language],
    r = operationsReportLabels[config.language],
    u = unifiedReportLabels[config.language];
  const collection = [
    ...data.actions.collections,
    ...data.reviews.collections,
  ].find((v) => v.id === f.collectionId);
  const person = [...data.actions.members, ...data.reviews.members].find(
    (v) => v.id === f.person,
  );
  const metadata = [
    [l.kind, l[f.kind]],
    [
      a.collection,
      f.collectionId
        ? `${collection?.title || a.unavailableCollection} (${f.collectionId})`
        : a.allCollections,
    ],
    [
      l.person,
      f.person === "mine"
        ? a.mine
        : f.person === "unassigned"
          ? a.unassigned
          : f.person
            ? `${person?.name || a.unavailableAssignee} (${f.person})`
            : a.allAssignees,
    ],
    [a.query, f.query || r.all],
    [l.finished, f.includeFinished ? r.yes : r.no],
    [a.due, f.window === "month" ? c.monthView : a[f.window]],
    [c.month, f.month],
    [a.dueDate, f.day || r.all],
  ];
  const headers = [
    u.kind,
    a.dueDate,
    a.collection,
    a.titleField,
    l.person,
    a.status,
    il.state,
    a.overdue,
    u.version,
    u.reviewVersion,
    r.collectionId,
    u.itemId,
    u.personId,
  ];
  const rows = planningRows(data, f, today).map((row) => [
    row.kind === "task" ? l.tasks : l.reviews,
    row.dueDate || a.undated,
    row.collectionTitle,
    row.title,
    row.personName || (row.personId ? il.unavailableReviewer : a.unassigned),
    row.kind === "task"
      ? a[row.task.status]
      : row.finished
        ? il.approved
        : il.pending,
    row.kind === "review" ? il[row.packet.state] : "—",
    !row.finished && row.dueDate && row.dueDate < today ? r.yes : r.no,
    row.kind === "task" ? row.task.version : row.packet.version,
    row.kind === "review" ? reviewVersions.get(row.packet.id) || 0 : "—",
    row.collectionId,
    row.kind === "task" ? row.task.id : row.packet.id,
    row.personId || "",
  ]);
  return { metadata, headers, rows };
}
