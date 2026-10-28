import { z } from "zod";
const uniqueIds = (max: number) =>
  z
    .array(z.uuid())
    .max(max)
    .refine((v) => new Set(v).size === v.length, "Choose each item once.");
export const collectionContent = z
  .object({
    title: z.string().trim().min(3).max(160),
    interviewIds: uniqueIds(200).default([]),
    briefIds: uniqueIds(30).default([]),
  })
  .strict();
export const collectionCreate = collectionContent
  .extend({ requestId: z.uuid() })
  .strict();
export const collectionEdit = collectionContent
  .extend({ version: z.number().int().positive() })
  .strict();
export type LibraryCollection = z.infer<typeof collectionContent> & {
  id: string;
  workspaceId: string;
  requestId: string;
  inputHash: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type CollectionView = Omit<
  LibraryCollection,
  "workspaceId" | "requestId" | "inputHash"
>;
export function collectionView(c: LibraryCollection): CollectionView {
  const { workspaceId, requestId, inputHash, ...view } = c;
  void workspaceId;
  void requestId;
  void inputHash;
  return view;
}
export const collectionLabels = {
  en: {
    title: "Research Library collections",
    language: "Collection interface language",
    notice:
      "Group existing included interviews and briefs without copying their content. Collections share your workspace’s access; they are not separate permission boundaries. Search and ask use only explicitly selected interviews, never brief text or its underlying sources. An empty collection returns no evidence. Changing interview membership or deleting a collection removes its generated saved answers and dependent briefs; original interviews and other linked briefs remain. Withdrawn/deleted interviews and removed briefs disappear from membership automatically.",
    name: "Collection title",
    sources: "Interviews in this collection",
    briefs: "Briefs in this collection",
    create: "Create collection",
    save: "Save collection changes",
    remove: "Delete collection",
    confirm:
      "Delete this collection and its generated saved answers and dependent briefs? Original interviews and other linked briefs remain.",
    open: "Open collection",
    new: "New collection",
    refresh: "Refresh collections and members",
    search: "Search this collection",
    openSource: "Open interview",
    openBrief: "Open linked brief",
    empty: "No collections yet.",
    all: "All included interviews",
    scope: "Collection to search",
    missing: "Collection changed or is unavailable. Refresh before saving.",
    saved: "Collection saved.",
    close: "Close collection",
    none: "No members selected; collection searches return no evidence.",
  },
  es: {
    title: "Colecciones de Research Library",
    language: "Idioma de la interfaz de colecciones",
    notice:
      "Agrupe entrevistas incluidas e informes sin copiar su contenido. Las colecciones comparten el acceso del equipo; no son permisos separados. Las búsquedas y preguntas solo usan las entrevistas seleccionadas, nunca el texto de los informes ni sus fuentes. Una colección vacía no devuelve evidencia. Cambiar las entrevistas o eliminar la colección borra sus respuestas generadas y los informes dependientes; conserva entrevistas originales y otros informes vinculados. Los elementos retirados o eliminados desaparecen automáticamente.",
    name: "Título de la colección",
    sources: "Entrevistas de esta colección",
    briefs: "Informes de esta colección",
    create: "Crear colección",
    save: "Guardar cambios de la colección",
    remove: "Eliminar colección",
    confirm:
      "¿Eliminar la colección, sus respuestas generadas y los informes dependientes? Se conservan las entrevistas originales y otros informes vinculados.",
    open: "Abrir colección",
    new: "Nueva colección",
    refresh: "Actualizar colecciones y miembros",
    search: "Buscar en esta colección",
    openSource: "Abrir entrevista",
    openBrief: "Abrir informe vinculado",
    empty: "No hay colecciones.",
    all: "Todas las entrevistas incluidas",
    scope: "Colección para buscar",
    missing:
      "La colección cambió o no está disponible. Actualice antes de guardar.",
    saved: "Colección guardada.",
    close: "Cerrar colección",
    none: "Sin miembros seleccionados; las búsquedas no devolverán evidencia.",
  },
  fr: {
    title: "Collections de Research Library",
    language: "Langue de l’interface des collections",
    notice:
      "Regroupez entretiens inclus et notes sans copier leur contenu. Les collections partagent l’accès de l’espace ; elles ne définissent pas de permissions distinctes. Recherches et questions utilisent uniquement les entretiens sélectionnés, jamais les notes ni leurs sources. Une collection vide ne renvoie aucune preuve. Modifier les entretiens ou supprimer la collection efface ses réponses générées et les notes dépendantes ; les entretiens originaux et autres notes liées sont conservés. Les éléments retirés ou supprimés disparaissent automatiquement.",
    name: "Titre de la collection",
    sources: "Entretiens de cette collection",
    briefs: "Notes de cette collection",
    create: "Créer une collection",
    save: "Enregistrer les modifications de la collection",
    remove: "Supprimer la collection",
    confirm:
      "Supprimer la collection, ses réponses générées et les notes dépendantes ? Les entretiens originaux et autres notes liées sont conservés.",
    open: "Ouvrir la collection",
    new: "Nouvelle collection",
    refresh: "Actualiser collections et membres",
    search: "Rechercher dans cette collection",
    openSource: "Ouvrir l’entretien",
    openBrief: "Ouvrir la note liée",
    empty: "Aucune collection.",
    all: "Tous les entretiens inclus",
    scope: "Collection à rechercher",
    missing:
      "La collection a changé ou est indisponible. Actualisez avant d’enregistrer.",
    saved: "Collection enregistrée.",
    close: "Fermer la collection",
    none: "Aucun membre sélectionné ; les recherches ne renverront aucune preuve.",
  },
};
