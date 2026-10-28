export type ScheduledReview = {
  approvedAt: string | null;
  dueDate?: string | null;
};
export function reviewOverdue(r: ScheduledReview, today: string) {
  return !r.approvedAt && !!r.dueDate && r.dueDate < today;
}
export function reviewDueMatches(
  r: ScheduledReview,
  due: string,
  today: string,
) {
  if (!due) return true;
  if (r.approvedAt) return false;
  if (due === "undated") return !r.dueDate;
  if (!r.dueDate) return false;
  if (due === "overdue") return r.dueDate < today;
  if (due === "today") return r.dueDate === today;
  if (due !== "week") return false;
  const end = new Date(today + "T12:00:00Z");
  end.setUTCDate(end.getUTCDate() + 7);
  return r.dueDate >= today && r.dueDate < end.toISOString().slice(0, 10);
}
export const deadlineLabels = {
  en: {
    due: "Review due date",
    save: "Save due date",
    clear: "Clear due date",
    none: "No due date",
    overdue: "Overdue review",
    today: "Due today",
    week: "Next 7 days",
    undated: "No due date",
    window: "Review deadline",
    any: "Any deadline",
    next: "Next matching review deadline",
    overdueCount: "Matching overdue reviews",
    notice:
      "Due dates use your local calendar and organize pending reviews. Changing a date preserves current approvals and sends no reminder.",
  },
  es: {
    due: "Fecha límite de revisión",
    save: "Guardar fecha límite",
    clear: "Quitar fecha límite",
    none: "Sin fecha límite",
    overdue: "Revisión vencida",
    today: "Vence hoy",
    week: "Próximos 7 días",
    undated: "Sin fecha límite",
    window: "Plazo de revisión",
    any: "Cualquier plazo",
    next: "Próximo plazo de revisión coincidente",
    overdueCount: "Revisiones vencidas coincidentes",
    notice:
      "Las fechas usan tu calendario local y organizan las revisiones pendientes. Cambiar una fecha conserva las aprobaciones actuales y no envía recordatorios.",
  },
  fr: {
    due: "Date limite de revue",
    save: "Enregistrer la date limite",
    clear: "Effacer la date limite",
    none: "Sans date limite",
    overdue: "Revue en retard",
    today: "À rendre aujourd’hui",
    week: "7 prochains jours",
    undated: "Sans date limite",
    window: "Échéance de revue",
    any: "Toutes les échéances",
    next: "Prochaine échéance de revue correspondante",
    overdueCount: "Revues en retard correspondantes",
    notice:
      "Les dates suivent votre calendrier local et organisent les revues en attente. Changer une date conserve les approbations actuelles et n’envoie aucun rappel.",
  },
};
