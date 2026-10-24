import { z } from "zod";
import { taskContent } from "./collection-tasks";
export const planContent = z
  .object({
    name: z.string().trim().min(3).max(160),
    reviewers: z
      .array(
        z
          .object({
            id: z.uuid(),
            days: z.number().int().min(0).max(365).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(10)
      .refine(
        (v) => new Set(v.map((r) => r.id)).size === v.length,
        "Choose each reviewer once.",
      ),
  })
  .strict();
export const planDate = taskContent.shape.dueDate.unwrap();
export type ReviewPlan = z.infer<typeof planContent> & {
  id: string;
  workspaceId: string;
  version: number;
};
export type PlanView = Omit<ReviewPlan, "workspaceId">;
export function planDates(reviewers: ReviewPlan["reviewers"], start: string) {
  planDate.parse(start);
  return reviewers.map((r) => {
    if (r.days === null) return { id: r.id, dueDate: null };
    const date = new Date(start + "T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + r.days);
    return {
      id: r.id,
      dueDate: planDate.parse(date.toISOString().slice(0, 10)),
    };
  });
}
export const planLabels = {
  en: {
    title: "Reusable review plans",
    notice:
      "Save a reviewer group with optional calendar-day offsets. Plans contain coordination details only and send no email.",
    name: "Plan name",
    days: "Days after start (blank means no deadline)",
    save: "Save plan",
    new: "New plan",
    edit: "Edit plan",
    remove: "Delete plan",
    confirm:
      "Delete this reusable plan? Existing packet requests stay unchanged.",
    choose: "Choose a review plan",
    start: "Start date",
    preview: "Preview plan",
    apply: "Apply review plan",
    cancel: "Cancel",
    ack: "Replace requested reviewers and deadlines, and reset reviewer decisions and final packet approval. Existing comments stay.",
    none: "No reusable plans yet.",
    unavailable: "Unavailable reviewer — edit this plan before applying.",
    saved: "Review plan saved",
    applied: "Review plan applied",
    noDate: "No deadline",
  },
  es: {
    title: "Planes de revisión reutilizables",
    notice:
      "Guarda un grupo de revisores con plazos opcionales en días naturales. Los planes solo contienen datos de coordinación y no envían correos.",
    name: "Nombre del plan",
    days: "Días desde el inicio (vacío significa sin plazo)",
    save: "Guardar plan",
    new: "Nuevo plan",
    edit: "Editar plan",
    remove: "Eliminar plan",
    confirm:
      "¿Eliminar este plan reutilizable? Las solicitudes existentes no cambian.",
    choose: "Elegir un plan de revisión",
    start: "Fecha de inicio",
    preview: "Vista previa del plan",
    apply: "Aplicar plan de revisión",
    cancel: "Cancelar",
    ack: "Reemplazar revisores y plazos, y reiniciar las decisiones y la aprobación final. Los comentarios se conservan.",
    none: "Aún no hay planes reutilizables.",
    unavailable: "Revisor no disponible: edita el plan antes de aplicarlo.",
    saved: "Plan guardado",
    applied: "Plan aplicado",
    noDate: "Sin plazo",
  },
  fr: {
    title: "Plans de revue réutilisables",
    notice:
      "Enregistrez un groupe de relecteurs avec des délais facultatifs en jours calendaires. Les plans ne contiennent que des données de coordination et n’envoient aucun e-mail.",
    name: "Nom du plan",
    days: "Jours après le début (vide signifie sans échéance)",
    save: "Enregistrer le plan",
    new: "Nouveau plan",
    edit: "Modifier le plan",
    remove: "Supprimer le plan",
    confirm:
      "Supprimer ce plan réutilisable ? Les demandes existantes restent inchangées.",
    choose: "Choisir un plan de revue",
    start: "Date de début",
    preview: "Aperçu du plan",
    apply: "Appliquer le plan de revue",
    cancel: "Annuler",
    ack: "Remplacer les relecteurs et échéances, et réinitialiser les décisions et l’approbation finale. Les commentaires sont conservés.",
    none: "Aucun plan réutilisable.",
    unavailable:
      "Relecteur indisponible : modifiez le plan avant de l’appliquer.",
    saved: "Plan enregistré",
    applied: "Plan appliqué",
    noDate: "Sans échéance",
  },
};
