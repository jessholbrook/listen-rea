import { z } from "zod";
import { languageSchema } from "./localization";
const ids = (max: number) =>
  z
    .array(z.uuid())
    .max(max)
    .refine((a) => new Set(a).size === a.length, "Choose each item once.");
export const handoffContent = z
  .object({
    title: z.string().trim().min(3).max(160),
    summary: z.string().trim().max(8000),
    language: languageSchema,
    answerIds: ids(20),
    taskIds: ids(50),
  })
  .strict();
export const handoffCreate = handoffContent
  .extend({ requestId: z.uuid() })
  .strict();
export const handoffEdit = handoffContent
  .extend({ id: z.uuid(), version: z.number().int().positive() })
  .strict();
export const handoffReview = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    signature: z.string().regex(/^[a-f0-9]{64}$/),
    reviewed: z.boolean(),
  })
  .strict();
export type HandoffContent = z.infer<typeof handoffContent>;
export type CollectionHandoff = HandoffContent & {
  id: string;
  workspaceId: string;
  collectionId: string;
  requestId: string;
  inputHash: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  approvedSignature: string | null;
  memberInterviewIds: string[];
  briefDependencies: string[];
  answerDependencies: string[];
  taskDependencies: string[];
};
export type HandoffView = HandoffContent & {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  canExport: boolean;
};
export type HandoffDetails = {
  packet: HandoffView | null;
  feedback: import("./handoff-feedback").FeedbackView | null;
  signature: string;
  canEdit: boolean;
  preview: string;
  collection: { id: string; title: string };
  answers: {
    id: string;
    question: string;
    version: number;
    approved: boolean;
  }[];
  tasks: {
    id: string;
    title: string;
    version: number;
    status: "open" | "in_progress" | "completed";
    assignee: string | null;
    dueDate: string | null;
  }[];
};
export const handoffLabels = {
  en: {
    language: "Packet language",
    title: "Collection handoff packet",
    notice:
      "Write a researcher summary, choose approved collection findings and open follow-ups, then review the current preview before export. Changes require renewed approval. Removing captured research or tasks deletes the dependent packet, including its summary. Save drafts before changing tasks or refreshing. Downloads cannot be recalled.",
    name: "Packet title",
    summary: "Researcher summary",
    findings: "Collection findings",
    tasks: "Open follow-ups",
    create: "Create packet draft",
    save: "Save packet draft",
    refresh: "Refresh packet",
    attest:
      "I reviewed this summary, included findings, sources and follow-ups",
    approve: "Approve packet for export",
    withdraw: "Withdraw packet approval",
    approved: "Approved for export",
    draft: "Draft or changed since review",
    preview: "Current packet preview",
    md: "Download packet text",
    csv: "Download packet CSV",
    remove: "Delete packet",
    confirm: "Delete this packet and its summary?",
    saved: "Packet saved",
    reviewed: "Packet approval updated",
    deleted: "Packet deleted",
    finding: "Finding",
    task: "Follow-up",
    collection: "Collection",
    version: "Revision",
    unassigned: "Unassigned",
    due: "Due date",
    status: "Status",
    open: "Open",
    in_progress: "In progress",
    completed: "Completed",
    warning:
      "Researcher-reviewed interpretations and researcher-authored summary. Task progress is not research approval. Source matching does not establish interpretation accuracy or research completeness.",
    changed:
      "Some selected items are no longer eligible. Choose current approved findings and unfinished tasks before saving.",
    none: "No packet yet.",
  },
  es: {
    language: "Idioma del paquete",
    title: "Paquete de traspaso de colección",
    notice:
      "Escribe un resumen del investigador y elige hallazgos aprobados y tareas pendientes. Revisa la vista previa actual antes de exportar. Los cambios requieren nueva aprobación. La retirada de investigación o tareas incluidas elimina el paquete y su resumen. Guarda los borradores antes de cambiar tareas o actualizar. Las descargas no se pueden recuperar.",
    name: "Título del paquete",
    summary: "Resumen del investigador",
    findings: "Hallazgos de la colección",
    tasks: "Seguimientos pendientes",
    create: "Crear borrador del paquete",
    save: "Guardar borrador del paquete",
    refresh: "Actualizar paquete",
    attest:
      "He revisado este resumen, los hallazgos, las fuentes y los seguimientos incluidos",
    approve: "Aprobar paquete para exportación",
    withdraw: "Retirar aprobación del paquete",
    approved: "Aprobado para exportación",
    draft: "Borrador o modificado desde la revisión",
    preview: "Vista previa actual del paquete",
    md: "Descargar texto del paquete",
    csv: "Descargar CSV del paquete",
    remove: "Eliminar paquete",
    confirm: "¿Eliminar este paquete y su resumen?",
    saved: "Paquete guardado",
    reviewed: "Aprobación actualizada",
    deleted: "Paquete eliminado",
    finding: "Hallazgo",
    task: "Seguimiento",
    collection: "Colección",
    version: "Revisión",
    unassigned: "Sin asignar",
    due: "Fecha límite",
    status: "Estado",
    open: "Pendiente",
    in_progress: "En curso",
    completed: "Completada",
    warning:
      "Interpretaciones revisadas y resumen escrito por el investigador. El progreso de las tareas no aprueba la investigación. La coincidencia de fuentes no demuestra precisión ni integridad de la investigación.",
    changed:
      "Algunos elementos ya no son elegibles. Elige hallazgos aprobados y tareas pendientes antes de guardar.",
    none: "Aún no hay paquete.",
  },
  fr: {
    language: "Langue du dossier",
    title: "Dossier de transmission de collection",
    notice:
      "Rédigez un résumé et choisissez les résultats approuvés et les suivis ouverts. Relisez l’aperçu actuel avant l’export. Les changements exigent une nouvelle approbation. Le retrait de recherches ou de tâches incluses supprime le dossier et son résumé. Enregistrez les brouillons avant de modifier les tâches ou d’actualiser. Les téléchargements ne peuvent pas être rappelés.",
    name: "Titre du dossier",
    summary: "Résumé du chercheur",
    findings: "Résultats de la collection",
    tasks: "Suivis ouverts",
    create: "Créer un brouillon du dossier",
    save: "Enregistrer le brouillon",
    refresh: "Actualiser le dossier",
    attest:
      "J’ai relu ce résumé, les résultats, les sources et les suivis inclus",
    approve: "Approuver le dossier pour export",
    withdraw: "Retirer l’approbation du dossier",
    approved: "Approuvé pour export",
    draft: "Brouillon ou modifié depuis la revue",
    preview: "Aperçu actuel du dossier",
    md: "Télécharger le texte du dossier",
    csv: "Télécharger le CSV du dossier",
    remove: "Supprimer le dossier",
    confirm: "Supprimer ce dossier et son résumé ?",
    saved: "Dossier enregistré",
    reviewed: "Approbation mise à jour",
    deleted: "Dossier supprimé",
    finding: "Résultat",
    task: "Suivi",
    collection: "Collection",
    version: "Révision",
    unassigned: "Non attribué",
    due: "Échéance",
    status: "Statut",
    open: "À faire",
    in_progress: "En cours",
    completed: "Terminée",
    warning:
      "Interprétations relues et résumé rédigé par le chercheur. La progression des tâches ne valide pas la recherche. La concordance des sources ne prouve ni l’exactitude des interprétations ni l’exhaustivité de la recherche.",
    changed:
      "Certains éléments ne sont plus admissibles. Choisissez les résultats approuvés et les tâches ouvertes avant d’enregistrer.",
    none: "Aucun dossier pour le moment.",
  },
};
