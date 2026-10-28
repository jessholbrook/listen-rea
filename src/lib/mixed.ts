import { withoutOptionImage } from "./option-image-fields";
import { emotionInput, emotionText } from "./emotion";
import { beginCardsort } from "./cardsort";
import { beginMaxdiff } from "./maxdiff";
import { beginPricing } from "./pricing";
import {
  nextQuestion,
  type Interview,
  type Question,
  type Turn,
} from "./domain";
export const hasOptions = (q: Question) =>
  ["choice", "multiple", "ranking", "matrix"].includes(q.type);
export const scaleFor = (q: Question) =>
  q.scale || { min: 1, max: 5, lowLabel: "Low", highLabel: "High" };
export function optionsFor(i: Interview, q: Question) {
  return i.optionAssignments?.[q.id] || q.options;
}
export function advanceInterview(
  i: Interview,
  after: number,
  pick = (n: number) => Math.floor(Math.random() * n),
) {
  let current = nextQuestion(i.guide, after, i.turns);
  while (current < i.guide.questions.length) {
    const q = i.guide.questions[current];
    if (hasOptions(q)) {
      i.optionAssignments ||= {};
      if (!i.optionAssignments[q.id]) {
        let options = q.options.map((o) => ({ ...o }));
        if (q.carryForward) {
          const source = i.guide.questions.find(
            (s) => s.id === q.carryForward!.questionId,
          )!;
          const turn = i.turns.find(
            (t) => t.questionId === source.id && !t.followUp,
          );
          const selected = turn
            ? Array.isArray(turn.value)
              ? turn.value
              : [turn.optionId]
            : [];
          options = turn
            ? optionsFor(i, source)
                .filter(
                  (o) =>
                    selected.includes(o.id) ===
                    (q.carryForward!.mode === "selected"),
                )
                .map((o) => ({ ...o, rejects: false }))
            : [];
        }
        if (!["choice", "multiple", "ranking"].includes(q.type))
          options = options.map(withoutOptionImage);
        if (q.randomizeOptions)
          for (let n = options.length - 1; n > 0; n--) {
            const j = pick(n + 1);
            [options[n], options[j]] = [options[j], options[n]];
          }
        i.optionAssignments[q.id] = options;
      }
      const options = i.optionAssignments[q.id];
      if (
        !options.length ||
        (q.type === "multiple" && options.length < (q.selection?.min || 1))
      ) {
        current = nextQuestion(i.guide, current, i.turns);
        continue;
      }
    }
    i.shownQuestions ||= i.turns
      .filter((t) => !t.followUp)
      .map((t) => t.questionId);
    if (!i.shownQuestions.includes(q.id)) i.shownQuestions.push(q.id);
    i.current = current;
    i.prompt = q.text;
    if (q.type === "pricing") beginPricing(i, q, pick);
    if (q.type === "maxdiff") beginMaxdiff(i, q, pick);
    if (q.type === "cardsort") beginCardsort(i, q, pick);
    i.strategy = "guide";
    return;
  }
  i.current = current;
}
export function structuredAnswer(
  i: Interview,
  q: Question,
  input: { optionId?: string; value?: unknown },
): Pick<Turn, "answer" | "optionId" | "value" | "emotion"> {
  if (q.type === "emotion") {
    const emotion = emotionInput(input.value);
    return {
      emotion,
      answer: emotionText(
        emotion,
        i.language || i.guide.localization?.sourceLanguage || "en",
      ),
    };
  }
  const options = optionsFor(i, q),
    scale = scaleFor(q);
  const number = (v: unknown) =>
    typeof v === "number" &&
    Number.isInteger(v) &&
    v >= scale.min &&
    v <= scale.max;
  const bad = () => {
    throw new Error("INVALID_STRUCTURED_ANSWER");
  };
  if (q.type === "choice") {
    const option = options.find((o) => o.id === input.optionId);
    if (!option) return bad();
    return { answer: option.text, optionId: option.id };
  }
  if (q.type === "rating") {
    if (!number(input.value)) return bad();
    return { answer: String(input.value), value: input.value as number };
  }
  if (q.type === "multiple" || q.type === "ranking") {
    const ids = input.value;
    if (
      !Array.isArray(ids) ||
      !ids.every(
        (id) => typeof id === "string" && options.some((o) => o.id === id),
      ) ||
      new Set(ids).size !== ids.length
    )
      return bad();
    if (
      q.type === "ranking"
        ? ids.length !== options.length
        : ids.length < (q.selection?.min || 1) ||
          ids.length >
            Math.min(q.selection?.max || options.length, options.length)
    )
      return bad();
    const labels = ids.map((id) => options.find((o) => o.id === id)!.text);
    return {
      answer: labels
        .map((label, n) =>
          q.type === "ranking" ? `${n + 1}. ${label}` : label,
        )
        .join("\n"),
      value: ids,
    };
  }
  if (q.type === "matrix") {
    const cells = input.value;
    if (
      !cells ||
      typeof cells !== "object" ||
      Array.isArray(cells) ||
      Object.keys(cells).length !== options.length ||
      !options.every((o) => number((cells as Record<string, unknown>)[o.id]))
    )
      return bad();
    return {
      answer: options
        .map((o) => `${o.text}: ${(cells as Record<string, number>)[o.id]}`)
        .join("\n"),
      value: cells as Record<string, number>,
    };
  }
  return bad();
}
export function quantitativeResults(interviews: Interview[]) {
  const eligible = interviews.filter(
    (i) => i.status === "complete" && !i.preview && !i.excluded,
  );
  const groups = new Map<
    string,
    { revisionId: string; question: Question; members: Interview[] }
  >();
  for (const i of eligible)
    for (const q of i.guide.questions)
      if (
        ["rating", "ranking", "matrix", "multiple", "choice"].includes(q.type)
      ) {
        const key = JSON.stringify([
          i.revisionId,
          q.templateQuestionId || q.id,
          q.conceptId || null,
        ]);
        if (!groups.has(key))
          groups.set(key, {
            revisionId: i.revisionId,
            question: q,
            members: [],
          });
        groups.get(key)!.members.push(i);
      }
  return [...groups.values()].map(({ revisionId, question: q, members }) => {
    const answers = members.flatMap((i) => {
      const t = i.turns.find((t) => t.questionId === q.id && !t.followUp);
      return t ? [{ i, t }] : [];
    });
    const shown = members.filter(
      (i) =>
        i.shownQuestions?.includes(q.id) ||
        i.turns.some((t) => t.questionId === q.id),
    ).length;
    const values = answers
      .map(({ t }) => t.value)
      .filter((v) => typeof v === "number") as number[];
    const rows = new Map<
      string,
      {
        id: string;
        label: string;
        values: number[];
        count: number;
        exposed: number;
      }
    >();
    for (const { i, t } of answers)
      for (const o of optionsFor(i, q)) {
        if (!rows.has(o.id))
          rows.set(o.id, {
            id: o.id,
            label: o.text,
            values: [],
            count: 0,
            exposed: 0,
          });
        const r = rows.get(o.id)!;
        r.exposed++;
        if (
          q.type === "matrix" &&
          t.value &&
          !Array.isArray(t.value) &&
          typeof t.value === "object" &&
          typeof t.value[o.id] === "number"
        )
          r.values.push(t.value[o.id]);
        if (
          q.type === "ranking" &&
          Array.isArray(t.value) &&
          t.value.includes(o.id)
        )
          r.values.push(t.value.indexOf(o.id) + 1);
        if (
          t.optionId === o.id ||
          (Array.isArray(t.value) && t.value.includes(o.id))
        )
          r.count++;
      }
    return {
      revisionId,
      conceptId: q.conceptId || null,
      conceptName: q.conceptId
        ? members[0].guide.conceptTest?.concepts.find(
            (c) => c.id === q.conceptId,
          )?.name
        : null,
      questionId: q.id,
      prompt: q.text,
      type: q.type,
      eligible: members.length,
      answered: answers.length,
      notAsked: members.length - shown,
      missing: shown - answers.length,
      mean: values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : null,
      distribution: values.length
        ? Array.from(
            { length: scaleFor(q).max - scaleFor(q).min + 1 },
            (_, n) => ({
              value: n + scaleFor(q).min,
              count: values.filter((v) => v === n + scaleFor(q).min).length,
            }),
          )
        : [],
      rows: [...rows.values()].map((r) => ({
        ...r,
        mean: r.values.length
          ? r.values.reduce((a, b) => a + b, 0) / r.values.length
          : null,
      })),
    };
  });
}
