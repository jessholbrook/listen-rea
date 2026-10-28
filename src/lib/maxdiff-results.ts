import type { Interview, Question } from "./domain";
import {
  maxdiffState,
  maxdiffVersion,
  maxdiffDesign,
  designDiagnostics,
} from "./maxdiff";
import type { ModelChoice } from "./maxdiff-model";
export function maxdiffResults(
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
      (q) => q.type === "maxdiff" && q.maxdiff,
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
    const c = q.maxdiff!,
      n = c.items.length,
      ids = c.items.map((i) => i.id),
      respondents: ModelChoice[][] = [];
    const outcomes = members.map((i) => {
      const s = maxdiffState(i, q),
        valid =
          s &&
          s.version === maxdiffVersion &&
          s.tasks.length === n * c.cycles &&
          s.choices.length <= s.tasks.length &&
          s.tasks.every(
            (t) =>
              t.length === c.setSize &&
              new Set(t).size === t.length &&
              t.every((id) => ids.includes(id)),
          ) &&
          s.choices.every(
            (r, t) =>
              r.best !== r.worst &&
              [r.best, r.worst].every((id) => s.tasks[t].includes(id)),
          );
      const status = !s
        ? "not_asked"
        : !valid
          ? "invalid"
          : i.status !== "complete" || s.choices.length !== s.tasks.length
            ? "incomplete"
            : "included";
      if (status === "included")
        respondents.push(
          s!.choices.map((choice, t) => ({
            set: s!.tasks[t].map((id) => ids.indexOf(id)),
            best: ids.indexOf(choice.best),
            worst: ids.indexOf(choice.worst),
          })),
        );
      return {
        interviewId: i.id,
        status,
        answered: s?.choices.length || 0,
        total: s?.tasks.length || n * c.cycles,
        turns: i.turns
          .filter((t) => t.questionId === q.id && t.maxdiff)
          .map((t) => ({ id: t.id, ...t.maxdiff! })),
        tasks: s?.tasks || [],
        choices: s?.choices || [],
      };
    });
    const rows = respondents.flat(),
      items = c.items.map((item, a) => {
        const exposures = rows.filter((r) => r.set.includes(a)).length,
          best = rows.filter((r) => r.best === a).length,
          worst = rows.filter((r) => r.worst === a).length;
        return {
          id: item.id,
          text: item.text,
          exposures,
          best,
          worst,
          net: best - worst,
          netPerExposure: exposures ? (best - worst) / exposures : null,
        };
      });
    return {
      revisionId,
      questionId: q.templateQuestionId || q.id,
      conceptId: q.conceptId || null,
      prompt: q.text,
      config: c,
      design: {
        version: maxdiffVersion,
        tasksPerRespondent: n * c.cycles,
        ...designDiagnostics(maxdiffDesign(n, c.setSize, c.cycles), n),
      },
      counts: {
        total: members.length,
        included: respondents.length,
        incomplete: outcomes.filter((o) => o.status === "incomplete").length,
        notAsked: outcomes.filter((o) => o.status === "not_asked").length,
        invalid: outcomes.filter((o) => o.status === "invalid").length,
        tasks: rows.length,
      },
      items,
      outcomes,
      respondents,
    };
  });
}
