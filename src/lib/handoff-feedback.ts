import { z } from "zod";
import { planDate } from "./review-plans";
import { taskContent } from "./collection-tasks";
const common = {
  id: z.uuid(),
  packetVersion: z.number().int().positive(),
  version: z.number().int().nonnegative(),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
};
export const feedbackInput = z.discriminatedUnion("op", [
  z
    .object({
      ...common,
      op: z.literal("plan"),
      planId: z.uuid(),
      planVersion: z.number().int().positive(),
      start: planDate,
      acknowledged: z.literal(true),
    })
    .strict(),
  z
    .object({
      ...common,
      op: z.literal("reassign"),
      fromReviewerId: z.uuid(),
      toReviewerId: z.uuid(),
    })
    .strict()
    .refine(
      (v) => v.fromReviewerId !== v.toReviewerId,
      "Choose a different reviewer.",
    ),
  z
    .object({
      ...common,
      op: z.literal("deadline"),
      reviewerId: z.uuid(),
      dueDate: taskContent.shape.dueDate,
    })
    .strict(),
  z
    .object({
      ...common,
      op: z.literal("assign"),
      reviewerIds: z
        .array(z.uuid())
        .max(10)
        .refine(
          (a) => new Set(a).size === a.length,
          "Choose each reviewer once.",
        ),
    })
    .strict(),
  z
    .object({
      ...common,
      op: z.literal("comment"),
      requestId: z.uuid(),
      body: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      ...common,
      op: z.literal("resolve"),
      commentId: z.uuid(),
      resolved: z.boolean(),
    })
    .strict(),
  z
    .object({ ...common, op: z.literal("decision"), approved: z.boolean() })
    .strict(),
  z
    .object({ ...common, op: z.literal("delete_comment"), commentId: z.uuid() })
    .strict(),
]);
export type FeedbackInput = z.infer<typeof feedbackInput>;
export type FeedbackComment = {
  id: string;
  requestId: string;
  inputHash: string;
  authorId: string;
  body: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
};
export type HandoffFeedback = {
  id: string;
  workspaceId: string;
  collectionId: string;
  version: number;
  contentSignature: string;
  reviewerIds: string[];
  deadlines?: { userId: string; dueDate: string }[];
  decisions: { userId: string; signature: string; at: string }[];
  comments: FeedbackComment[];
  tombstones: string[];
  commentCount: number;
};
export type FeedbackView = {
  version: number;
  members: { id: string; name: string }[];
  reviewers: {
    id: string;
    name: string | null;
    available: boolean;
    dueDate: string | null;
    approvedAt: string | null;
  }[];
  comments: {
    id: string;
    author: string | null;
    body: string;
    createdAt: string;
    resolvedAt: string | null;
    resolvedBy: string | null;
    canDelete: boolean;
  }[];
  userId: string;
  canDecide: boolean;
  ready: boolean;
  remainingComments: number;
};
export const feedbackLabels = {
  en: {
    title: "Internal handoff review",
    notice:
      "Request reviewers from this workspace. Every requested reviewer must approve the current packet, and all comments must be resolved before final packet approval. This sends no email. Save packet edits before working on review requests or comments.",
    reviewers: "Requested reviewers",
    assign: "Save review requests",
    unavailable: "Unavailable reviewer",
    pending: "Awaiting review",
    approved: "Approved current contents",
    ready: "Review complete",
    blocked: "Review or feedback still needed",
    comment: "Comment",
    add: "Add comment",
    comments: "Feedback",
    open: "Open feedback",
    resolved: "Resolved",
    resolve: "Resolve feedback",
    reopen: "Reopen feedback",
    remove: "Delete comment",
    confirm: "Delete this comment?",
    approve: "I reviewed and approve the current packet",
    withdraw: "Withdraw my review",
    former: "Former workspace member",
    saved: "Review updated",
    remaining: "Comments remaining",
    none: "No comments yet.",
  },
  es: {
    title: "Revisión interna del paquete",
    notice:
      "Solicita revisores de este espacio. Todos deben aprobar el paquete actual y todos los comentarios deben resolverse antes de la aprobación final. No se envían correos. Guarda los cambios del paquete antes de gestionar revisiones o comentarios.",
    reviewers: "Revisores solicitados",
    assign: "Guardar solicitudes de revisión",
    unavailable: "Revisor no disponible",
    pending: "Pendiente de revisión",
    approved: "Contenido actual aprobado",
    ready: "Revisión completada",
    blocked: "Faltan revisiones o comentarios por resolver",
    comment: "Comentario",
    add: "Añadir comentario",
    comments: "Comentarios",
    open: "Comentario abierto",
    resolved: "Resuelto",
    resolve: "Resolver comentario",
    reopen: "Reabrir comentario",
    remove: "Eliminar comentario",
    confirm: "¿Eliminar este comentario?",
    approve: "He revisado y apruebo el paquete actual",
    withdraw: "Retirar mi revisión",
    former: "Antiguo miembro del espacio",
    saved: "Revisión actualizada",
    remaining: "Comentarios restantes",
    none: "Aún no hay comentarios.",
  },
  fr: {
    title: "Revue interne du dossier",
    notice:
      "Demandez des relecteurs de cet espace. Tous doivent approuver le dossier actuel et tous les commentaires doivent être résolus avant l’approbation finale. Aucun e-mail n’est envoyé. Enregistrez le dossier avant de gérer les revues ou les commentaires.",
    reviewers: "Relecteurs demandés",
    assign: "Enregistrer les demandes de revue",
    unavailable: "Relecteur indisponible",
    pending: "En attente de revue",
    approved: "Contenu actuel approuvé",
    ready: "Revue terminée",
    blocked: "Revues ou commentaires encore nécessaires",
    comment: "Commentaire",
    add: "Ajouter un commentaire",
    comments: "Commentaires",
    open: "Commentaire ouvert",
    resolved: "Résolu",
    resolve: "Résoudre le commentaire",
    reopen: "Rouvrir le commentaire",
    remove: "Supprimer le commentaire",
    confirm: "Supprimer ce commentaire ?",
    approve: "J’ai relu et j’approuve le dossier actuel",
    withdraw: "Retirer ma revue",
    former: "Ancien membre de l’espace",
    saved: "Revue mise à jour",
    remaining: "Commentaires restants",
    none: "Aucun commentaire pour le moment.",
  },
};
