export const activityActions = [
  "packet_created",
  "packet_edited",
  "assign",
  "reassign",
  "deadline",
  "plan",
  "reviewer_approved",
  "reviewer_withdrew",
  "comment_added",
  "comment_resolved",
  "comment_reopened",
  "comment_deleted",
  "review_invalidated",
  "final_approved",
  "final_withdrawn",
] as const;
export type ActivityAction = (typeof activityActions)[number];
export type ActivityPerson = { id: string; dueDate: string | null };
export type ReviewEvent = {
  id: string;
  sequence: number;
  at: string;
  actorId: string | null;
  action: ActivityAction;
  packetVersion: number;
  reviewVersion: number | null;
  before?: ActivityPerson[];
  after?: ActivityPerson[];
  reviewerId?: string;
  clearedReviewerIds: string[];
  finalApprovalReset: boolean;
};
export type ReviewActivity = {
  id: string;
  workspaceId: string;
  collectionId: string;
  events: ReviewEvent[];
  omitted: number;
};
export type ActivityEventView = Omit<
  ReviewEvent,
  "actorId" | "before" | "after" | "reviewerId" | "clearedReviewerIds"
> & {
  actor: { id: string; name: string | null } | null;
  before?: { id: string; name: string | null; dueDate: string | null }[];
  after?: { id: string; name: string | null; dueDate: string | null }[];
  reviewer?: { id: string; name: string | null };
  clearedReviewers: { id: string; name: string | null }[];
  packet: {
    id: string;
    collectionId: string;
    title: string;
    collectionTitle: string;
  };
};
export type ActivityView = {
  total: number;
  page: number;
  pages: number;
  events: ActivityEventView[];
  packets: { id: string; title: string }[];
  people: { id: string; name: string | null }[];
  omitted: number;
};
export const activityLabels = {
  en: {
    title: "Review activity history",
    notice:
      "New activity is recorded from this release onward. This is a recent coordination history, not a permanent audit record. Research text and comment bodies are excluded. Deleting the packet or its sources removes its history.",
    packet: "Packet",
    unavailablePacket: "Unavailable packet",
    person: "Person involved",
    action: "Action",
    all: "All",
    from: "From date",
    to: "Through date",
    before: "Before",
    after: "After",
    cleared: "Reviewer decisions reset",
    finalReset: "Final approval reset",
    system: "Automatic validation",
    former: "Unavailable workspace member",
    empty: "No activity matches these filters.",
    matches: "Matching events",
    refresh: "Refresh activity",
    omitted: "Older events no longer retained",
    retained:
      "Up to 100 recent events per packet are retained; large records may retain fewer.",
    noDate: "No deadline",
    none: "None",
    packet_created: "Packet created",
    packet_edited: "Packet edited",
    assign: "Reviewers changed",
    reassign: "Review request reassigned",
    deadline: "Review deadline changed",
    plan: "Review plan applied",
    reviewer_approved: "Reviewer approved",
    reviewer_withdrew: "Reviewer withdrew approval",
    comment_added: "Comment added",
    comment_resolved: "Comment resolved",
    comment_reopened: "Comment reopened",
    comment_deleted: "Comment deleted",
    review_invalidated: "Review invalidated by current context",
    final_approved: "Final packet approval granted",
    final_withdrawn: "Final packet approval withdrawn",
  },
  es: {
    title: "Historial de actividad de revisión",
    notice:
      "Se registra actividad nueva a partir de esta versión. Es un historial reciente de coordinación, no un registro de auditoría permanente. No incluye textos de investigación ni comentarios. Eliminar el paquete o sus fuentes elimina su historial.",
    packet: "Paquete",
    unavailablePacket: "Paquete no disponible",
    person: "Persona involucrada",
    action: "Acción",
    all: "Todas",
    from: "Desde la fecha",
    to: "Hasta la fecha",
    before: "Antes",
    after: "Después",
    cleared: "Decisiones de revisión reiniciadas",
    finalReset: "Aprobación final reiniciada",
    system: "Validación automática",
    former: "Miembro no disponible",
    empty: "Ninguna actividad coincide con estos filtros.",
    matches: "Eventos coincidentes",
    refresh: "Actualizar actividad",
    omitted: "Eventos antiguos no conservados",
    retained:
      "Se conservan hasta 100 eventos recientes por paquete; los registros grandes pueden conservar menos.",
    noDate: "Sin plazo",
    none: "Ninguno",
    packet_created: "Paquete creado",
    packet_edited: "Paquete editado",
    assign: "Revisores modificados",
    reassign: "Solicitud de revisión reasignada",
    deadline: "Plazo de revisión modificado",
    plan: "Plan de revisión aplicado",
    reviewer_approved: "Revisor aprobó",
    reviewer_withdrew: "Revisor retiró su aprobación",
    comment_added: "Comentario añadido",
    comment_resolved: "Comentario resuelto",
    comment_reopened: "Comentario reabierto",
    comment_deleted: "Comentario eliminado",
    review_invalidated: "Revisión invalidada por el contexto actual",
    final_approved: "Aprobación final del paquete concedida",
    final_withdrawn: "Aprobación final del paquete retirada",
  },
  fr: {
    title: "Historique de l’activité des revues",
    notice:
      "Les nouvelles actions sont enregistrées à partir de cette version. Il s’agit d’un historique récent de coordination, pas d’un journal d’audit permanent. Les textes de recherche et commentaires sont exclus. La suppression du dossier ou de ses sources efface son historique.",
    packet: "Dossier",
    unavailablePacket: "Dossier indisponible",
    person: "Personne concernée",
    action: "Action",
    all: "Toutes",
    from: "À partir du",
    to: "Jusqu’au",
    before: "Avant",
    after: "Après",
    cleared: "Décisions de revue réinitialisées",
    finalReset: "Approbation finale réinitialisée",
    system: "Validation automatique",
    former: "Membre indisponible",
    empty: "Aucune activité ne correspond aux filtres.",
    matches: "Événements correspondants",
    refresh: "Actualiser l’activité",
    omitted: "Anciens événements non conservés",
    retained:
      "Jusqu’à 100 événements récents par dossier sont conservés ; les grands historiques peuvent en conserver moins.",
    noDate: "Sans échéance",
    none: "Aucun",
    packet_created: "Dossier créé",
    packet_edited: "Dossier modifié",
    assign: "Relecteurs modifiés",
    reassign: "Demande de revue réattribuée",
    deadline: "Échéance de revue modifiée",
    plan: "Plan de revue appliqué",
    reviewer_approved: "Relecteur a approuvé",
    reviewer_withdrew: "Relecteur a retiré son approbation",
    comment_added: "Commentaire ajouté",
    comment_resolved: "Commentaire résolu",
    comment_reopened: "Commentaire rouvert",
    comment_deleted: "Commentaire supprimé",
    review_invalidated: "Revue invalidée par le contexte actuel",
    final_approved: "Approbation finale du dossier accordée",
    final_withdrawn: "Approbation finale du dossier retirée",
  },
};
