import type { Interview, Question } from "./domain";
import {
  cardsortState,
  cardsortVersion,
  cardsortMethod,
  validateCustomGroups,
  validateAssignments,
  type CardAssignment,
} from "./cardsort";
export function cardsortResults(
  interviews: Interview[],
  attribute?: { key: string; value: string },
) {
  const groups = new Map<
    string,
    { revisionId: string; question: Question; members: Interview[] }
  >();
  for (const i of interviews.filter(
    (i) =>
      !i.preview &&
      !i.excluded &&
      !i.origin &&
      (!attribute || i.attributes[attribute.key] === attribute.value),
  ))
    for (const q of i.guide.questions.filter(
      (q) => q.type === "cardsort" && q.cardsort,
    )) {
      const key = JSON.stringify([
        i.revisionId,
        q.templateQuestionId || q.id,
        q.conceptId || null,
      ]);
      if (!groups.has(key))
        groups.set(key, { revisionId: i.revisionId, question: q, members: [] });
      groups.get(key)!.members.push(i);
    }
  return [...groups.values()].map(({ revisionId, question: q, members }) => {
    const c = q.cardsort!;
    const outcomes = members.map((i) => {
      const s = cardsortState(i, q);
      let valid = false;
      if (s && s.version === cardsortMethod(c)) {
        try {
          validateCustomGroups(c, s.customGroups || []);
          validateAssignments(c, s.draft, false, s.customGroups);
          if (s.phase !== "sort")
            validateAssignments(c, s.assignments, true, s.customGroups);
          valid = true;
        } catch {}
      }
      const status = !s
        ? "not_asked"
        : !valid
          ? "invalid"
          : i.status !== "complete" || s.phase !== "done"
            ? "incomplete"
            : "included";
      return {
        interviewId: i.id,
        status,
        assignments: s?.assignments || [],
        draft: s?.draft || [],
        reason: s?.reason || "",
        customGroups: s?.customGroups || [],
        turns: i.turns
          .filter((t) => t.questionId === q.id && t.cardsort)
          .map((t) => ({ id: t.id, phase: t.cardsort!.phase })),
      };
    });
    const included = outcomes.filter((o) => o.status === "included"),
      denominator = included.length;
    const rows = c.cards.map((card) => {
      const answers = included.map((o) =>
        o.assignments.find((x) => x.cardId === card.id)!,
      );
      return {
        ...card,
        denominator,
        uncertain: answers.filter((x) => x.groupId === null).length,
        custom: answers.filter(
          (x) =>
            x.groupId !== null && !c.groups.some((g) => g.id === x.groupId),
        ).length,
        groups: c.groups.map((group) => {
          const count = answers.filter((x) => x.groupId === group.id).length;
          return {
            ...group,
            count,
            percent: denominator ? (100 * count) / denominator : null,
          };
        }),
      };
    });
    const pairs = c.cards.flatMap((a, n) =>
      c.cards.slice(n).map((b) => {
        const paired = included.flatMap((o) => {
          const x = o.assignments.find((x) => x.cardId === a.id)!,
            y = o.assignments.find((x) => x.cardId === b.id)!;
          return x.groupId !== null && y.groupId !== null
            ? [{ a: x, b: y }]
            : [];
        });
        const together = paired.filter(
          (p) => p.a.groupId === p.b.groupId,
        ).length;
        return {
          cardA: a.id,
          cardB: b.id,
          bothAssigned: paired.length,
          together,
          percent: paired.length ? (100 * together) / paired.length : null,
        };
      }),
    );
    return {
      revisionId,
      questionId: q.templateQuestionId || q.id,
      conceptId: q.conceptId || null,
      prompt: q.text,
      config: c,
      version: cardsortMethod(c),
      counts: {
        total: members.length,
        included: denominator,
        incomplete: outcomes.filter((o) => o.status === "incomplete").length,
        notAsked: outcomes.filter((o) => o.status === "not_asked").length,
        invalid: outcomes.filter((o) => o.status === "invalid").length,
      },
      rows,
      pairs,
      outcomes,
    };
  });
}
export type { CardAssignment };
