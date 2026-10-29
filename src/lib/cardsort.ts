import { z } from "zod";
import type { Interview, Question, Turn } from "./domain";
const entry = z.object({
  id: z.string().min(1).max(100),
  text: z.string().trim().min(1).max(500),
});
export const cardsortVersion = "closed-sort-v1";
export const cardsortSchema = z
  .object({
    cards: z.array(entry).min(3).max(30),
    groups: z.array(entry).max(10),
    mode: z.enum(["closed", "open", "hybrid"]).optional(),
    randomizeCards: z.boolean().default(true),
    randomizeGroups: z.boolean().default(false),
    allowUncertain: z.boolean().default(true),
    askReason: z.boolean().default(true),
  })
  .superRefine((c, ctx) => {
    if (
      (c.mode === "open" && c.groups.length !== 0) ||
      (c.mode !== "open" && c.groups.length < 2)
    )
      ctx.addIssue({
        code: "custom",
        path: ["groups"],
        message:
          "Open sorts have no predefined groups; closed/hybrid sorts need at least two.",
      });
    for (const type of ["cards", "groups"] as const)
      if (
        new Set(c[type].map((x) => x.id)).size !== c[type].length ||
        new Set(c[type].map((x) => x.text.toLowerCase())).size !==
          c[type].length
      )
        ctx.addIssue({
          code: "custom",
          message: `Use distinct ${type} IDs and labels.`,
          path: [type],
        });
  });
export const flexibleSortVersion = "participant-sort-v2";
export const cardsortMethod = (c: { mode?: string }) =>
  c.mode && c.mode !== "closed" ? flexibleSortVersion : cardsortVersion;
export const customGroupSchema = z
  .object({
    id: z.string().regex(/^participant_[a-zA-Z0-9-]{10,80}$/),
    text: z.string().trim().min(1).max(100),
  })
  .strict();
export type CustomSortGroup = z.infer<typeof customGroupSchema>;
export type CardsortConfig = z.infer<typeof cardsortSchema>;
export const assignmentSchema = z
  .array(
    z.object({
      cardId: z.string().min(1).max(100),
      groupId: z.string().min(1).max(100).nullable(),
    }),
  )
  .max(30);
export type CardAssignment = z.infer<typeof assignmentSchema>[number];
export type CardsortState = {
  version: string;
  cardOrder: string[];
  groupOrder: string[];
  phase: "sort" | "reason" | "done";
  draft: CardAssignment[];
  assignments: CardAssignment[];
  reason: string;
  customGroups?: CustomSortGroup[];
};
export type CardsortPrompt = {
  phase: CardsortState["phase"];
  cards: CardsortConfig["cards"];
  groups: CardsortConfig["groups"];
  allowUncertain: boolean;
  draft: CardAssignment[];
  mode?: "open" | "hybrid";
  customGroups?: CustomSortGroup[];
};
export const cardsortState = (i: Interview, q: Question) =>
  Object.hasOwn(i.cardsortStates || {}, q.id)
    ? i.cardsortStates![q.id]
    : undefined;
export const cardsortCopy = (language: Interview["language"]) =>
  ({
    en: {
      choose: "Choose a group",
      uncertain: "Not sure / doesn’t fit",
      save: "Save sort draft",
      saved: "Draft saved. You can resume these placements later.",
      assigned: "cards placed",
      confirm: "Place every card, then continue to confirm your sort.",
      reason:
        "What guided your grouping choices? Were any cards difficult to place? You can type “skip” to continue.",
      savedSort: "Your confirmed sort",
      unsaved: "Placements are saved when you save the draft or continue.",
    },
    es: {
      choose: "Elige un grupo",
      uncertain: "No estoy seguro / no encaja",
      save: "Guardar borrador",
      saved: "Borrador guardado. Puedes retomar estas ubicaciones más tarde.",
      assigned: "tarjetas colocadas",
      confirm: "Coloca todas las tarjetas y continúa para confirmar.",
      reason:
        "¿Qué guio tus agrupaciones? ¿Hubo tarjetas difíciles de ubicar? Puedes escribir «omitir» para continuar.",
      savedSort: "Tu clasificación confirmada",
      unsaved: "Las ubicaciones se guardan al guardar el borrador o continuar.",
    },
    fr: {
      choose: "Choisissez un groupe",
      uncertain: "Pas sûr / ne convient pas",
      save: "Enregistrer le brouillon",
      saved:
        "Brouillon enregistré. Vous pouvez reprendre ces placements plus tard.",
      assigned: "cartes placées",
      confirm: "Placez chaque carte, puis continuez pour confirmer.",
      reason:
        "Qu’est-ce qui a guidé vos regroupements ? Certaines cartes étaient-elles difficiles à placer ? Vous pouvez écrire «passer» pour continuer.",
      savedSort: "Votre classement confirmé",
      unsaved:
        "Les placements sont enregistrés en sauvegardant le brouillon ou en continuant.",
    },
  })[language || "en"];
export function cardsortPrompt(
  i: Interview,
  q: Question,
): CardsortPrompt | undefined {
  const s = cardsortState(i, q),
    c = q.cardsort;
  if (!s || !c) return;
  return {
    phase: s.phase,
    cards: s.cardOrder.map((id) => ({ ...c.cards.find((x) => x.id === id)! })),
    groups: [
      ...s.groupOrder.map((id) => ({ ...c.groups.find((x) => x.id === id)! })),
      ...(s.customGroups || []),
    ],
    ...(c.mode && c.mode !== "closed"
      ? { mode: c.mode, customGroups: structuredClone(s.customGroups || []) }
      : {}),
    allowUncertain: c.allowUncertain,
    draft: structuredClone(s.phase === "sort" ? s.draft : s.assignments),
  };
}
export function cardsortText(i: Interview, q: Question) {
  return cardsortState(i, q)?.phase === "reason"
    ? cardsortCopy(i.language).reason
    : q.text;
}
function shuffled(ids: string[], pick: (n: number) => number) {
  const out = [...ids];
  for (let n = out.length - 1; n > 0; n--) {
    const b = pick(n + 1);
    [out[n], out[b]] = [out[b], out[n]];
  }
  return out;
}
export function beginCardsort(
  i: Interview,
  q: Question,
  pick: (n: number) => number,
) {
  const c = q.cardsort;
  if (!c) return;
  i.cardsortStates ||= {};
  if (!Object.hasOwn(i.cardsortStates, q.id))
    Object.defineProperty(i.cardsortStates, q.id, {
      enumerable: true,
      writable: true,
      configurable: true,
      value: {
        version: cardsortMethod(c),
        ...(c.mode && c.mode !== "closed" ? { customGroups: [] } : {}),
        cardOrder: c.randomizeCards
          ? shuffled(
              c.cards.map((x) => x.id),
              pick,
            )
          : c.cards.map((x) => x.id),
        groupOrder: c.randomizeGroups
          ? shuffled(
              c.groups.map((x) => x.id),
              pick,
            )
          : c.groups.map((x) => x.id),
        phase: "sort",
        draft: [],
        assignments: [],
        reason: "",
      },
    });
  i.prompt = cardsortText(i, q);
}
export function validateAssignments(
  c: CardsortConfig,
  value: unknown,
  complete: boolean,
  customGroups: CustomSortGroup[] = [],
) {
  validateCustomGroups(c, customGroups);
  const available = [...c.groups, ...customGroups];
  const parsed = assignmentSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_STRUCTURED_ANSWER");
  const a = parsed.data;
  if (
    new Set(a.map((x) => x.cardId)).size !== a.length ||
    a.some(
      (x) =>
        !c.cards.some((card) => card.id === x.cardId) ||
        (x.groupId === null
          ? !c.allowUncertain
          : !available.some((g) => g.id === x.groupId)),
    ) ||
    (complete && a.length !== c.cards.length)
  )
    throw new Error("INVALID_STRUCTURED_ANSWER");
  return a;
}
export function cardsortInput(
  i: Interview,
  q: Question,
  input: { value?: unknown; answer?: string },
) {
  const s = cardsortState(i, q);
  if (!s || s.phase === "done") throw new Error("INVALID_STRUCTURED_ANSWER");
  if (s.phase === "reason") {
    if (!input.answer?.trim()) throw new Error("INVALID_STRUCTURED_ANSWER");
    return;
  }
  return validateAssignments(q.cardsort!, input.value, true, s.customGroups);
}
export function applyCardsort(
  i: Interview,
  q: Question,
  input: { value?: unknown; answer?: string },
): Pick<Turn, "answer" | "cardsort"> {
  const assignments = cardsortInput(i, q, input),
    s = cardsortState(i, q)!;
  if (s.phase === "reason") {
    s.reason = input.answer!.trim();
    s.phase = "done";
    return { answer: s.reason, cardsort: { phase: "reason" } };
  }
  s.assignments = assignments!;
  s.draft = structuredClone(assignments!);
  s.phase = q.cardsort!.askReason ? "reason" : "done";
  i.prompt = cardsortText(i, q);
  return {
    answer: s.cardOrder
      .map((id) => {
        const a = assignments!.find((x) => x.cardId === id)!;
        return `${q.cardsort!.cards.find((x) => x.id === id)!.text} → ${a.groupId === null ? cardsortCopy(i.language).uncertain : [...q.cardsort!.groups, ...(s.customGroups || [])].find((g) => g.id === a.groupId)!.text}`;
      })
      .join("\n"),
    cardsort: { phase: "sort", assignments: structuredClone(assignments!) },
  };
}
// Form values keep opaque group IDs distinct from the explicit uncertain response.
export function cardsortFormValue(
  p: CardsortPrompt | undefined,
  value: Turn["value"],
) {
  return p
    ? Array.isArray(value)
      ? value
      : p.cards.map((card) => {
          const a = p.draft.find((x) => x.cardId === card.id);
          return !a ? "" : a.groupId === null ? "unsure" : "group:" + a.groupId;
        })
    : [];
}
export function cardsortFormAssignments(
  p: CardsortPrompt | undefined,
  value: Turn["value"],
): CardAssignment[] {
  const values = cardsortFormValue(p, value);
  return p
    ? p.cards.flatMap((card, n) =>
        values[n]
          ? [
              {
                cardId: card.id,
                groupId: values[n] === "unsure" ? null : values[n].slice(6),
              },
            ]
          : [],
      )
    : [];
}

export function validateCustomGroups(
  c: CardsortConfig,
  value: unknown,
): CustomSortGroup[] {
  const groups = z.array(customGroupSchema).max(10).parse(value);
  if (
    ((!c.mode || c.mode === "closed") && groups.length) ||
    new Set(groups.map((g) => g.id)).size !== groups.length ||
    new Set(groups.map((g) => g.text.normalize("NFC").trim().toLowerCase()))
      .size !== groups.length ||
    groups.some((g) =>
      c.groups.some(
        (p) =>
          p.text.normalize("NFC").trim().toLowerCase() ===
          g.text.normalize("NFC").trim().toLowerCase(),
      ),
    ) ||
    groups.some((g) => c.groups.some((p) => p.id === g.id))
  )
    throw Error("INVALID_STRUCTURED_ANSWER");
  return groups;
}
export const categoryCopy = {
  en: {
    newName: "New group name",
    add: "Add my group",
    rename: "Rename my group",
    remove: "Remove my group",
    label: "Your group",
    notice:
      "Create your own categories. Labels are kept exactly as you write them and are not automatically merged with other participants’ categories.",
  },
  es: {
    newName: "Nombre del nuevo grupo",
    add: "Añadir mi grupo",
    rename: "Renombrar mi grupo",
    remove: "Eliminar mi grupo",
    label: "Tu grupo",
    notice:
      "Crea tus categorías. Las etiquetas se conservan tal como las escribes y no se combinan automáticamente con las de otras personas.",
  },
  fr: {
    newName: "Nom du nouveau groupe",
    add: "Ajouter mon groupe",
    rename: "Renommer mon groupe",
    remove: "Supprimer mon groupe",
    label: "Votre groupe",
    notice:
      "Créez vos catégories. Les libellés restent tels que vous les écrivez et ne sont pas fusionnés automatiquement avec ceux des autres participants.",
  },
};
