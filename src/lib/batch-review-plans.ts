import { z } from "zod";
import { planDate } from "./review-plans";
const target = z.object({ collectionId: z.uuid(), id: z.uuid() }).strict();
const batch = {
  planId: z.uuid(),
  planVersion: z.number().int().positive(),
  start: planDate,
};
const unique = (v: { id: string; collectionId: string }[]) =>
  new Set(v.map((x) => x.id)).size === v.length &&
  new Set(v.map((x) => x.collectionId)).size === v.length;
export const batchPreviewInput = z
  .object({
    ...batch,
    packets: z
      .array(target)
      .min(1)
      .max(10)
      .refine(unique, "Choose each packet and collection once."),
  })
  .strict();
export const batchApplyInput = z
  .object({
    ...batch,
    acknowledged: z.literal(true),
    packets: z
      .array(
        target
          .extend({
            packetVersion: z.number().int().positive(),
            version: z.number().int().nonnegative(),
            signature: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1)
      .max(10)
      .refine(unique, "Choose each packet and collection once."),
  })
  .strict();
export type BatchTarget = z.infer<typeof target>;
export type BatchStatus =
  "ready" | "applied" | "conflict" | "unavailable" | "forbidden" | "failed";
export type BatchPacket = BatchTarget & {
  status: BatchStatus;
  title?: string;
  packetVersion?: number;
  version?: number;
  signature?: string;
  reviewers?: {
    id: string;
    name: string | null;
    dueDate: string | null;
    approvedAt: string | null;
  }[];
  openComments?: number;
  finalApproved?: boolean;
};
export type BatchPreview = {
  plan: { id: string; version: number; name: string };
  start: string;
  reviewers: { id: string; name: string; dueDate: string | null }[];
  packets: BatchPacket[];
};
export const batchLabels = {
  en: {
    title: "Batch review planning",
    notice:
      "Choose up to 10 saved packets. Preview each packet before replacing its review requests. Packets apply independently; conflicts leave that packet unchanged. No email is sent.",
    select: "Select packet",
    selected: "Selected packets",
    clear: "Clear selection",
    preview: "Preview batch",
    apply: "Apply to ready packets",
    cancel: "Cancel preview",
    ack: "Replace reviewers and dates on ready packets, reset all reviewer decisions and final approval, and keep comments.",
    current: "Current reviewers",
    proposed: "Planned reviewers and dates",
    comments: "Open comments",
    final: "Final approval will be reset",
    ready: "Ready to apply",
    applied: "Applied",
    conflict: "Changed — refresh and preview again",
    unavailable: "Packet unavailable",
    forbidden: "Edit access unavailable",
    failed: "Outcome uncertain — refresh before continuing",
    results: "Batch results",
    finish: "Finish and refresh inbox",
    empty: "No packets match these filters.",
    none: "No saved plans. Create one inside a saved packet first.",
    interrupted:
      "If a request is interrupted, some packets may already be saved. Refresh and inspect the packets before starting a new preview.",
    approved: "Approved",
    pending: "Awaiting review",
  },
  es: {
    title: "Planificación de revisiones en lote",
    notice:
      "Elige hasta 10 paquetes guardados. Revisa cada paquete antes de reemplazar sus solicitudes. Cada paquete se aplica por separado; los conflictos no lo modifican. No se envían correos.",
    select: "Seleccionar paquete",
    selected: "Paquetes seleccionados",
    clear: "Borrar selección",
    preview: "Vista previa del lote",
    apply: "Aplicar a paquetes listos",
    cancel: "Cancelar vista previa",
    ack: "Reemplazar revisores y fechas en los paquetes listos, reiniciar decisiones y aprobación final, y conservar comentarios.",
    current: "Revisores actuales",
    proposed: "Revisores y fechas previstos",
    comments: "Comentarios abiertos",
    final: "Se reiniciará la aprobación final",
    ready: "Listo para aplicar",
    applied: "Aplicado",
    conflict: "Ha cambiado: actualiza y revisa de nuevo",
    unavailable: "Paquete no disponible",
    forbidden: "Sin acceso de edición",
    failed: "Resultado incierto: actualiza antes de continuar",
    results: "Resultados del lote",
    finish: "Terminar y actualizar bandeja",
    empty: "Ningún paquete coincide con estos filtros.",
    none: "No hay planes guardados. Crea uno dentro de un paquete guardado.",
    interrupted:
      "Si se interrumpe la solicitud, algunos paquetes podrían haberse guardado. Actualiza e inspecciona los paquetes antes de una nueva vista previa.",
    approved: "Aprobado",
    pending: "Pendiente de revisión",
  },
  fr: {
    title: "Planification des revues par lot",
    notice:
      "Choisissez jusqu’à 10 dossiers enregistrés. Vérifiez chaque dossier avant de remplacer ses demandes. Chaque dossier est traité séparément ; les conflits le laissent inchangé. Aucun e-mail n’est envoyé.",
    select: "Sélectionner le dossier",
    selected: "Dossiers sélectionnés",
    clear: "Effacer la sélection",
    preview: "Aperçu du lot",
    apply: "Appliquer aux dossiers prêts",
    cancel: "Annuler l’aperçu",
    ack: "Remplacer les relecteurs et dates des dossiers prêts, réinitialiser les décisions et l’approbation finale, et conserver les commentaires.",
    current: "Relecteurs actuels",
    proposed: "Relecteurs et échéances prévus",
    comments: "Commentaires ouverts",
    final: "L’approbation finale sera réinitialisée",
    ready: "Prêt à appliquer",
    applied: "Appliqué",
    conflict: "Modifié : actualisez et vérifiez à nouveau",
    unavailable: "Dossier indisponible",
    forbidden: "Accès en modification indisponible",
    failed: "Résultat incertain : actualisez avant de continuer",
    results: "Résultats du lot",
    finish: "Terminer et actualiser la boîte",
    empty: "Aucun dossier ne correspond aux filtres.",
    none: "Aucun plan enregistré. Créez-en un dans un dossier enregistré.",
    interrupted:
      "Si la requête est interrompue, certains dossiers peuvent déjà être enregistrés. Actualisez et vérifiez les dossiers avant un nouvel aperçu.",
    approved: "Approuvé",
    pending: "En attente de revue",
  },
};
