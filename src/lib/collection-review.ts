import { z } from "zod";
export type CollectionReviewState = {
  id: string;
  workspaceId: string;
  version: number;
  checkedAt: string;
  sourceStates: { interviewId: string; fingerprint: string }[];
  removedSinceCheck: number;
  signature: string;
};
export const collectionCheck = z
  .object({
    collectionVersion: z.number().int().positive(),
    reviewVersion: z.number().int().nonnegative(),
    signature: z.string().regex(/^[a-f0-9]{64}$/),
    checked: z.literal(true),
  })
  .strict();
export type CollectionDashboard = {
  collection: { id: string; title: string; version: number };
  canCheck: boolean;
  signature: string;
  reviewVersion: number;
  checkedAt: string | null;
  coverage: { total: number; cited: number; uncited: number };
  changes: {
    unchecked: number;
    added: number;
    changed: number;
    unchanged: number;
    removed: number;
  };
  interviews: {
    id: string;
    title: string;
    studyTitle: string;
    sourceVersion: number;
    approvedCitations: number;
    change: "unchecked" | "added" | "changed" | "unchanged";
  }[];
  answers: {
    id: string;
    scope: "transcripts" | "attachments";
    question: string;
    version: number;
    status: "draft" | "reviewed" | "approved";
  }[];
  briefs: {
    id: string;
    title: string;
    version: number;
    status: "outdated" | "needs_review" | "approved";
  }[];
};
export const dashboardLabels = {
  en: {
    title: "Collection review dashboard",
    notice:
      "Current included interviews and answers generated in this collection. Coverage counts interviews cited in at least one current reviewed, export-approved answer; it does not measure research completeness or interpretation accuracy. Linked briefs are shown separately and never expand coverage. Checking sources records a comparison point only; it does not approve answers, briefs or transcripts. Removed sources retain no titles or history here, only a count until the next check.",
    open: "Open review dashboard",
    refresh: "Refresh dashboard",
    coverage: "Interviews cited in approved collection answers",
    uncited: "Interviews without an approved citation",
    findings: "Collection answers",
    briefs: "Linked briefs",
    sources: "Current interviews",
    changes: "Source changes since last check",
    unchecked: "Not checked yet",
    added: "Added",
    changed: "Changed",
    unchanged: "Unchanged",
    removed: "Previously checked interviews removed",
    draft: "Needs answer review",
    reviewed: "Reviewed; export not approved",
    approved: "Approved for export",
    outdated: "Refresh pinned answers",
    needs_review: "Needs brief review",
    check: "Mark current sources checked",
    attest: "I checked the current source changes shown here",
    checked: "Last source check",
    none: "No interviews, collection answers or linked briefs to show.",
    openSource: "Review interview",
    openAnswer: "Review answer",
    openBrief: "Review brief",
    close: "Close dashboard",
    closeAnswer: "Back to dashboard",
    error:
      "The dashboard changed. Refresh and check the current sources again.",
    saved: "Source check saved. Finding approvals are unchanged.",
    emptyAnswers: "No saved answers generated in this collection.",
    emptyBriefs: "No linked briefs.",
    citations: "Approved answers citing this interview",
  },
  es: {
    title: "Panel de revisión de la colección",
    notice:
      "Entrevistas incluidas y respuestas generadas en esta colección. La cobertura cuenta entrevistas citadas en una respuesta actual revisada y aprobada para exportar; no mide integridad ni precisión. Los informes vinculados se muestran aparte y no amplían la cobertura. Comprobar fuentes solo guarda un punto de comparación; no aprueba respuestas, informes ni transcripciones. Las fuentes eliminadas conservan solo un recuento hasta la próxima comprobación.",
    open: "Abrir panel de revisión",
    refresh: "Actualizar panel",
    coverage: "Entrevistas citadas en respuestas aprobadas",
    uncited: "Entrevistas sin cita aprobada",
    findings: "Respuestas de la colección",
    briefs: "Informes vinculados",
    sources: "Entrevistas actuales",
    changes: "Cambios de fuentes desde la comprobación",
    unchecked: "Aún sin comprobar",
    added: "Añadida",
    changed: "Modificada",
    unchanged: "Sin cambios",
    removed: "Entrevistas comprobadas retiradas",
    draft: "Requiere revisión de respuesta",
    reviewed: "Revisada; exportación sin aprobar",
    approved: "Aprobada para exportar",
    outdated: "Actualizar respuestas fijadas",
    needs_review: "Requiere revisión del informe",
    check: "Marcar fuentes actuales como comprobadas",
    attest: "He comprobado los cambios de fuentes mostrados aquí",
    checked: "Última comprobación",
    none: "No hay entrevistas, respuestas ni informes que mostrar.",
    openSource: "Revisar entrevista",
    openAnswer: "Revisar respuesta",
    openBrief: "Revisar informe",
    close: "Cerrar panel",
    closeAnswer: "Volver al panel",
    error: "El panel cambió. Actualice y compruebe las fuentes de nuevo.",
    saved: "Comprobación guardada. Las aprobaciones de resultados no cambian.",
    emptyAnswers: "No hay respuestas guardadas de esta colección.",
    emptyBriefs: "No hay informes vinculados.",
    citations: "Respuestas aprobadas que citan esta entrevista",
  },
  fr: {
    title: "Tableau de révision de la collection",
    notice:
      "Entretiens inclus et réponses générées dans cette collection. La couverture compte les entretiens cités par une réponse actuelle vérifiée et approuvée pour export ; elle ne mesure ni exhaustivité ni exactitude. Les notes liées restent séparées et n’élargissent pas la couverture. Vérifier les sources enregistre un repère ; cela n’approuve ni réponses, ni notes, ni transcriptions. Seul un nombre des sources supprimées est conservé jusqu’à la prochaine vérification.",
    open: "Ouvrir le tableau de révision",
    refresh: "Actualiser le tableau",
    coverage: "Entretiens cités dans les réponses approuvées",
    uncited: "Entretiens sans citation approuvée",
    findings: "Réponses de la collection",
    briefs: "Notes liées",
    sources: "Entretiens actuels",
    changes: "Modifications des sources depuis la vérification",
    unchecked: "Pas encore vérifié",
    added: "Ajouté",
    changed: "Modifié",
    unchanged: "Inchangé",
    removed: "Entretiens vérifiés retirés",
    draft: "Réponse à vérifier",
    reviewed: "Vérifiée ; export non approuvé",
    approved: "Approuvé pour export",
    outdated: "Actualiser les réponses figées",
    needs_review: "Note à vérifier",
    check: "Marquer les sources actuelles comme vérifiées",
    attest: "J’ai vérifié les modifications des sources affichées ici",
    checked: "Dernière vérification",
    none: "Aucun entretien, réponse ou note à afficher.",
    openSource: "Vérifier l’entretien",
    openAnswer: "Vérifier la réponse",
    openBrief: "Vérifier la note",
    close: "Fermer le tableau",
    closeAnswer: "Retour au tableau",
    error: "Le tableau a changé. Actualisez et vérifiez à nouveau les sources.",
    saved:
      "Vérification enregistrée. Les approbations des résultats restent inchangées.",
    emptyAnswers: "Aucune réponse enregistrée dans cette collection.",
    emptyBriefs: "Aucune note liée.",
    citations: "Réponses approuvées citant cet entretien",
  },
};
