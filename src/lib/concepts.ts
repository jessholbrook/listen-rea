import type { Guide, Interview, Question, AnalysisScope } from "./domain";
export function compileConceptGuide(
  source: Guide,
  pick = (n: number) => Math.floor(Math.random() * n),
): { guide: Guide; assignments?: string[] } {
  const guide = structuredClone(source),
    config = guide.conceptTest;
  if (!config) return { guide };
  const pool = [...config.concepts];
  for (let n = pool.length - 1; n > 0; n--) {
    const j = pick(n + 1);
    [pool[n], pool[j]] = [pool[j], pool[n]];
  }
  const selected = pool.slice(0, config.count);
  if (!config.randomizeOrder)
    selected.sort(
      (a, b) =>
        config.concepts.findIndex((c) => c.id === a.id) -
        config.concepts.findIndex((c) => c.id === b.id),
    );
  const block = guide.questions.filter((q) => q.conceptQuestion),
    start = guide.questions.findIndex((q) => q.conceptQuestion),
    end = guide.questions.findLastIndex((q) => q.conceptQuestion);
  const ids = new Set(block.map((q) => q.id));
  const sections = guide.sections || [];
  const usedSections = new Set(
    guide.questions.filter((q) => !q.conceptQuestion).map((q) => q.section),
  );
  const generated: Question[] = [];
  const rules: NonNullable<Guide["sections"]> = [];
  for (const [n, concept] of selected.entries()) {
    const rewrite = (id: string) => {
      if (!ids.has(id)) return id;
      let derived = JSON.stringify(["concept", concept.id, id]);
      while (guide.questions.some((q) => q.id === derived))
        derived = "_" + derived;
      return derived;
    };
    const sectionNames = new Map<string, string>();
    const sectionName = (name: string) => {
      if (sectionNames.has(name)) return sectionNames.get(name)!;
      const base = `${name} · Concept ${n + 1}`;
      let derived = base,
        k = 1;
      while (usedSections.has(derived)) derived = base + ` (${k++})`;
      usedSections.add(derived);
      sectionNames.set(name, derived);
      return derived;
    };
    for (const q of block)
      generated.push({
        ...q,
        id: rewrite(q.id),
        templateQuestionId: q.id,
        conceptId: concept.id,
        section: sectionName(q.section),
        condition: q.condition
          ? { ...q.condition, questionId: rewrite(q.condition.questionId) }
          : null,
        carryForward: q.carryForward
          ? {
              ...q.carryForward,
              questionId: rewrite(q.carryForward.questionId),
            }
          : null,
      });
    for (const r of sections)
      if (block.some((q) => q.section === r.name))
        rules.push({
          name: sectionName(r.name),
          condition: {
            ...r.condition,
            questionId: rewrite(r.condition.questionId),
          },
        });
  }
  guide.questions = [
    ...guide.questions.slice(0, start),
    ...generated,
    ...guide.questions.slice(end + 1),
  ];
  guide.sections = [
    ...sections.filter((r) =>
      guide.questions.some((q) => !q.conceptId && q.section === r.name),
    ),
    ...rules,
  ];
  guide.conceptTest = { ...config, concepts: selected };
  return { guide, assignments: selected.map((c) => c.id) };
}
export function conceptFor(i: Interview, conceptId?: string) {
  return i.guide.conceptTest?.concepts.find(
    (c) => c.id === (conceptId || i.guide.questions[i.current]?.conceptId),
  );
}
export function scopeInterviews(
  interviews: Interview[],
  scope?: AnalysisScope,
) {
  return interviews
    .filter(
      (i) =>
        i.status === "complete" &&
        !i.excluded &&
        !i.preview &&
        (!scope || i.revisionId === scope.revisionId),
    )
    .map((i) => ({
      ...i,
      turns: i.turns.filter((t) =>
        scope ? t.conceptId === scope.conceptId : !t.conceptId,
      ),
    }))
    .filter((i) => i.turns.length > 0);
}
export function conceptScopes(interviews: Interview[]) {
  const scopes = new Map<
    string,
    {
      revisionId: string;
      conceptId: string;
      name: string;
      assigned: number;
      completed: number;
    }
  >();
  for (const i of interviews.filter((i) => !i.preview && !i.excluded))
    for (const id of i.conceptAssignments || []) {
      const key = JSON.stringify([i.revisionId, id]);
      if (!scopes.has(key))
        scopes.set(key, {
          revisionId: i.revisionId,
          conceptId: id,
          name: conceptFor(i, id)?.name || id,
          assigned: 0,
          completed: 0,
        });
      const row = scopes.get(key)!;
      row.assigned++;
      if (i.status === "complete" && i.turns.some((t) => t.conceptId === id))
        row.completed++;
    }
  return [...scopes.values()];
}
export function scopeQuery(scope?: AnalysisScope) {
  return scope
    ? "?" +
        new URLSearchParams({
          concept: scope.conceptId,
          revision: scope.revisionId,
        }).toString()
    : "";
}
