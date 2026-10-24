import type {
  ReviewInbox,
  InboxPacket,
  InboxReviewer,
} from "./team-review-inbox";
import { reviewOverdue, reviewDueMatches } from "./review-deadlines";
export type WorkloadFilters = {
  collectionId: string;
  query: string;
  load: "all" | "pending" | "overdue";
};
export const defaultWorkloadFilters: WorkloadFilters = {
  collectionId: "",
  query: "",
  load: "all",
};
export type WorkloadMember = {
  id: string;
  name: string | null;
  available: boolean;
  pending: number;
  approved: number;
  overdue: number;
  today: number;
  week: number;
  undated: number;
  blocked: number;
  nextDue: string | null;
};
export type ReviewPlanning = {
  id: string;
  packetVersion: number;
  version: number;
  signature: string;
  title: string;
  members: { id: string; name: string }[];
  reviewers: InboxReviewer[];
};
function scope(p: InboxPacket, f: WorkloadFilters) {
  const q = f.query.trim().toLocaleLowerCase();
  return (
    (!f.collectionId || p.collectionId === f.collectionId) &&
    (!q || `${p.title}\n${p.collectionTitle}`.toLocaleLowerCase().includes(q))
  );
}
export function reviewWorkload(
  data: ReviewInbox,
  f: WorkloadFilters,
  today: string,
) {
  const members = new Map<string, WorkloadMember>();
  const make = (id: string, name: string | null, available: boolean) => ({
    id,
    name,
    available,
    pending: 0,
    approved: 0,
    overdue: 0,
    today: 0,
    week: 0,
    undated: 0,
    blocked: 0,
    nextDue: null,
  });
  for (const m of data.members) members.set(m.id, make(m.id, m.name, true));
  for (const p of data.packets.filter((p) => scope(p, f)))
    for (const r of p.reviewers) {
      const m = members.get(r.id) || make(r.id, r.name, r.available);
      members.set(r.id, m);
      if (r.approvedAt) {
        m.approved++;
        continue;
      }
      m.pending++;
      if (reviewOverdue(r, today)) m.overdue++;
      if (reviewDueMatches(r, "today", today)) m.today++;
      if (reviewDueMatches(r, "week", today)) m.week++;
      if (!r.dueDate) m.undated++;
      if (p.state === "blocked" || !r.available) m.blocked++;
      if (r.dueDate && (!m.nextDue || r.dueDate < m.nextDue))
        m.nextDue = r.dueDate;
    }
  return [...members.values()]
    .filter(
      (m) =>
        f.load === "all" ||
        (f.load === "overdue" ? m.overdue > 0 : m.pending > 0),
    )
    .sort(
      (a, b) =>
        b.overdue - a.overdue ||
        b.pending - a.pending ||
        (a.nextDue || "9999").localeCompare(b.nextDue || "9999") ||
        (a.name || "").localeCompare(b.name || "") ||
        a.id.localeCompare(b.id),
    );
}
export function workloadRequests(
  data: ReviewInbox,
  f: WorkloadFilters,
  id: string,
) {
  return data.packets
    .filter(
      (p) =>
        scope(p, f) && p.reviewers.some((r) => r.id === id && !r.approvedAt),
    )
    .sort((a, b) => {
      const x = a.reviewers.find((r) => r.id === id)!,
        y = b.reviewers.find((r) => r.id === id)!;
      return (
        (x.dueDate || "9999").localeCompare(y.dueDate || "9999") ||
        Number(b.state === "blocked") - Number(a.state === "blocked") ||
        a.id.localeCompare(b.id)
      );
    });
}
export const workloadLabels = {
  en: {
    title: "Team review workload",
    tab: "Team workload",
    requests: "Review requests",
    notice:
      "Counts describe current review requests, not hours or capacity. Filter the overview to plan work; replacement choices show workspace totals at the last inbox refresh. Reassignment moves a pending request and its date, resets this packet’s reviewer decisions and final approval, and sends no email.",
    load: "Reviewer workload",
    all: "Everyone, including no pending reviews",
    pending: "With pending reviews",
    overdue: "With overdue reviews",
    approved: "Approved current reviews",
    today: "Due today",
    week: "Due in next 7 days",
    undated: "Pending without a date",
    blocked: "Blocked pending reviews",
    remaining: "Pending reviews",
    empty: "No reviewers match these filters.",
    show: "Show pending requests",
    selected: "Selected reviewer",
    none: "No pending requests in this scope.",
    reassign: "Reassign review request",
    replacement: "Replacement reviewer",
    choose: "Choose a replacement",
    workspace: "Workspace pending / overdue",
    acknowledge:
      "I understand that reviewer decisions and final approval for this packet will be reset.",
    save: "Confirm reassignment",
    cancel: "Cancel reassignment",
    saved: "Request reassigned; reviewer decisions and final approval reset.",
    noReplacement:
      "No eligible replacement is available. A replacement must be a workspace editor who is not already requested on this packet.",
    loading: "Loading current assignment…",
    unavailable: "Unavailable reviewer",
    people: "Matching reviewers",
    back: "Close pending requests",
  },
  es: {
    title: "Carga de revisiones del equipo",
    tab: "Carga del equipo",
    requests: "Solicitudes de revisión",
    notice:
      "Los recuentos describen solicitudes actuales, no horas ni capacidad. Filtra el resumen para planificar; las opciones muestran totales del espacio en la última actualización. Reasignar mueve una solicitud pendiente y su fecha, restablece las decisiones y la aprobación final del paquete y no envía correos.",
    load: "Carga del revisor",
    all: "Todos, incluidos quienes no tienen pendientes",
    pending: "Con revisiones pendientes",
    overdue: "Con revisiones vencidas",
    approved: "Revisiones actuales aprobadas",
    today: "Vencen hoy",
    week: "Vencen en los próximos 7 días",
    undated: "Pendientes sin fecha",
    blocked: "Revisiones pendientes bloqueadas",
    remaining: "Revisiones pendientes",
    empty: "Ningún revisor coincide con estos filtros.",
    show: "Ver solicitudes pendientes",
    selected: "Revisor seleccionado",
    none: "No hay solicitudes pendientes en este ámbito.",
    reassign: "Reasignar solicitud de revisión",
    replacement: "Revisor sustituto",
    choose: "Elige un sustituto",
    workspace: "Pendientes / vencidas en el espacio",
    acknowledge:
      "Entiendo que se restablecerán las decisiones de los revisores y la aprobación final de este paquete.",
    save: "Confirmar reasignación",
    cancel: "Cancelar reasignación",
    saved: "Solicitud reasignada; decisiones y aprobación final restablecidas.",
    noReplacement:
      "No hay sustitutos disponibles. Debe ser un editor del espacio que aún no esté solicitado en este paquete.",
    loading: "Cargando asignación actual…",
    unavailable: "Revisor no disponible",
    people: "Revisores coincidentes",
    back: "Cerrar solicitudes pendientes",
  },
  fr: {
    title: "Charge des revues de l’équipe",
    tab: "Charge de l’équipe",
    requests: "Demandes de revue",
    notice:
      "Les nombres décrivent les demandes actuelles, pas des heures ni une capacité. Filtrez le résumé pour planifier ; les choix affichent les totaux du dernier chargement. Réattribuer transfère une demande en attente et sa date, réinitialise les décisions et l’approbation finale du dossier et n’envoie aucun e-mail.",
    load: "Charge du relecteur",
    all: "Tous, y compris sans revue en attente",
    pending: "Avec des revues en attente",
    overdue: "Avec des revues en retard",
    approved: "Revues actuelles approuvées",
    today: "À rendre aujourd’hui",
    week: "À rendre dans les 7 prochains jours",
    undated: "En attente sans date",
    blocked: "Revues en attente bloquées",
    remaining: "Revues en attente",
    empty: "Aucun relecteur ne correspond aux filtres.",
    show: "Voir les demandes en attente",
    selected: "Relecteur sélectionné",
    none: "Aucune demande en attente dans ce périmètre.",
    reassign: "Réattribuer la demande de revue",
    replacement: "Relecteur remplaçant",
    choose: "Choisissez un remplaçant",
    workspace: "En attente / en retard dans l’espace",
    acknowledge:
      "Je comprends que les décisions des relecteurs et l’approbation finale de ce dossier seront réinitialisées.",
    save: "Confirmer la réattribution",
    cancel: "Annuler la réattribution",
    saved:
      "Demande réattribuée ; décisions et approbation finale réinitialisées.",
    noReplacement:
      "Aucun remplaçant disponible. Il doit être un éditeur de cet espace qui n’est pas déjà demandé sur ce dossier.",
    loading: "Chargement de l’attribution actuelle…",
    unavailable: "Relecteur indisponible",
    people: "Relecteurs correspondants",
    back: "Fermer les demandes en attente",
  },
};
