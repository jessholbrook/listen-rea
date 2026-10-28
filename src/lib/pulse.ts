import { z } from "zod";
import type { Guide, Interview, Revision, Study } from "./domain";
import { settings } from "./localization";
export const pulseCodes = z
  .array(
    z.object({
      id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
      name: z.string().trim().min(1).max(100),
      definition: z.string().trim().min(3).max(1500),
    }),
  )
  .max(30)
  .refine(
    (v) => new Set(v.map((c) => c.id)).size === v.length,
    "Code IDs must be unique.",
  );
export type PulseCodebook = {
  version: number;
  codes: z.infer<typeof pulseCodes>;
  createdAt: string;
};
export type PulseWave = {
  studyId: string;
  label: string;
  date: string;
  recruitment: string;
};
export type PulseSeries = {
  id: string;
  workspaceId: string;
  name: string;
  version: number;
  createdAt: string;
  baselineRevisionId: string;
  baselineStudyId: string;
  baseline: Guide;
  guidelines: string;
  recruitment: string;
  waves: PulseWave[];
  codebooks: PulseCodebook[];
};
export type PulseReview = {
  id: string;
  workspaceId: string;
  studyId: string;
  seriesId: string;
  interviewId: string;
  sourceVersion: number;
  codebookVersion: number;
  assignments: { codeId: string; turnId: string }[];
  reviewedAt: string;
  reviewedBy: string;
};
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
export function designWarnings(b: Guide, g: Guide) {
  const flags: string[] = [];
  if (b.audience !== g.audience) flags.push("Audience definition changed.");
  if (b.goal !== g.goal || b.intro !== g.intro)
    flags.push("Research goal or introduction changed.");
  if (canonical(b.sections || []) !== canonical(g.sections || []))
    flags.push("Section screening or routing changed.");
  if (canonical(b.conceptTest || null) !== canonical(g.conceptTest || null))
    flags.push("Concept exposure changed.");
  if (canonical(settings(b)) !== canonical(settings(g)))
    flags.push("Language settings or translations changed.");
  if (
    canonical(b.questions) !==
    canonical(g.questions.slice(0, b.questions.length))
  )
    flags.push(
      "Recurring question wording, order, screening, scale, options or moderation changed.",
    );
  if (
    g.questions
      .slice(b.questions.length)
      .some((q) => q.options.some((o) => o.rejects))
  )
    flags.push(
      "A timely question can screen out participants and change the completed sample.",
    );
  return flags;
}
export function pulseWaveResults(
  series: PulseSeries,
  wave: PulseWave,
  study: Study | undefined,
  revision: Revision | undefined,
  all: Interview[],
  reviews: PulseReview[],
  segment?: { key: string; value: string },
) {
  const warnings: string[] = [];
  if (!study) warnings.push("Wave study is unavailable.");
  if (!revision) warnings.push("Wave has no published design.");
  if (revision)
    warnings.push(...designWarnings(series.baseline, revision.guide));
  if (study && (study.researchGuidelines || "") !== series.guidelines)
    warnings.push("Workspace moderation guidelines changed.");
  if (wave.recruitment !== series.recruitment)
    warnings.push("Recruitment protocol changed.");
  const inSegment = all.filter(
    (i) =>
      !i.preview &&
      !i.excluded &&
      !i.origin &&
      i.status !== "withdrawn" &&
      (!segment || i.attributes[segment.key] === segment.value),
  );
  const completed = inSegment.filter((i) => i.status === "complete");
  const sources = completed.filter((i) => i.revisionId === revision?.id);
  if (completed.length !== sources.length)
    warnings.push(
      "Other published revisions have completed responses; excluded from this comparison.",
    );
  if (
    sources.some(
      (i) =>
        (i.language || settings(i.guide).sourceLanguage) !==
        settings(series.baseline).sourceLanguage,
    )
  )
    warnings.push(
      "Responses span languages; language equivalence has not been established.",
    );
  if (
    sources.some(
      (i) =>
        !revision ||
        canonical({
          ...i.guide,
          localization: { ...settings(i.guide), translations: [] },
        }) !==
          canonical({
            ...revision.guide,
            localization: { ...settings(revision.guide), translations: [] },
          }),
    )
  )
    warnings.push(
      "Participant design differs from the published design (for example translated or compiled concepts).",
    );
  const metrics = (revision?.guide.questions || [])
    .filter(
      (q) =>
        series.baseline.questions.some((b) => b.id === q.id) &&
        ["rating", "choice"].includes(q.type),
    )
    .map((q) => {
      const turns = sources.map((i) => ({
        i,
        turn: i.turns.find(
          (t) => t.questionId === q.id && !t.followUp && !t.conceptId,
        ),
      }));
      const valid = turns.filter(
        ({ turn: t }) =>
          t &&
          (q.type === "rating"
            ? typeof t.value === "number" &&
              Number.isInteger(t.value) &&
              t.value >= (q.scale?.min ?? 1) &&
              t.value <= (q.scale?.max ?? 5)
            : q.options.some((o) => o.id === t.optionId)),
      );
      return {
        id: q.id,
        text: q.text,
        type: q.type,
        denominator: valid.length,
        missing: sources.length - valid.length,
        mean:
          q.type === "rating" && valid.length
            ? valid.reduce((sum, v) => sum + (v.turn!.value as number), 0) /
              valid.length
            : null,
        options:
          q.type === "choice"
            ? q.options.map((o) => {
                const count = valid.filter(
                  (v) => v.turn!.optionId === o.id,
                ).length;
                return {
                  id: o.id,
                  text: o.text,
                  count,
                  percent: valid.length ? (count / valid.length) * 100 : null,
                };
              })
            : [],
        sources: valid.map((v) => ({
          interviewId: v.i.id,
          turnId: v.turn!.id,
        })),
      };
    });
  const book = series.codebooks.at(-1)!;
  const eligibleReviews = sources.flatMap((i) => {
    const r = reviews.find(
      (r) =>
        r.seriesId === series.id &&
        r.interviewId === i.id &&
        r.sourceVersion === i.version &&
        r.codebookVersion === book.version,
    );
    // Only recurring answers enter coding trends. Nothing from deleted or edited sources is copied here.
    return r &&
      r.assignments.every(
        (a) =>
          book.codes.some((c) => c.id === a.codeId) &&
          i.turns.some(
            (t) =>
              t.id === a.turnId &&
              series.baseline.questions.some(
                (q) => q.id === (t.templateQuestionId || t.questionId),
              ),
          ),
      )
      ? [{ i, r }]
      : [];
  });
  if (book.codes.length && eligibleReviews.length !== sources.length)
    warnings.push("Coding is incomplete for the current codebook version.");
  if (
    book.codes.length > 0 &&
    reviews.some(
      (r) =>
        sources.some((i) => i.id === r.interviewId) &&
        r.codebookVersion !== book.version,
    )
  )
    warnings.push(
      "Prior codebook reviews exist; recode using the current definitions before comparison.",
    );
  const themes = book.codes.map((c) => {
    const matching = eligibleReviews.filter(({ r }) =>
      r.assignments.some((a) => a.codeId === c.id),
    );
    return {
      ...c,
      count: matching.length,
      denominator: eligibleReviews.length,
      percent: eligibleReviews.length
        ? (matching.length / eligibleReviews.length) * 100
        : null,
      evidence: matching.flatMap(({ i, r }) =>
        r.assignments
          .filter((a) => a.codeId === c.id)
          .map((a) => {
            const t = i.turns.find((t) => t.id === a.turnId)!;
            return {
              interviewId: i.id,
              turnId: t.id,
              prompt: t.prompt,
              answer: t.answer,
            };
          }),
      ),
    };
  });
  return {
    ...wave,
    revisionId: revision?.id || null,
    fielding: study?.fielding || "unavailable",
    warnings,
    comparable: warnings.length === 0 && sources.length > 0,
    counts: {
      complete: completed.length,
      included: sources.length,
      otherRevisions: completed.length - sources.length,
      incomplete: inSegment.filter((i) => i.status === "active").length,
      screenedOut: inSegment.filter((i) => i.status === "screened_out").length,
      reviewed: eligibleReviews.length,
      unreviewed: sources.length - eligibleReviews.length,
    },
    timely:
      revision?.guide.questions
        .slice(series.baseline.questions.length)
        .map((q) => ({ id: q.id, text: q.text })) || [],
    metrics,
    themes,
    codebookVersion: book.version,
    sources: sources.map((i) => ({
      id: i.id,
      version: i.version,
      language: i.language || settings(i.guide).sourceLanguage,
      review: eligibleReviews.find((r) => r.i.id === i.id)?.r || null,
      turns: i.turns
        .filter((t) =>
          series.baseline.questions.some(
            (q) => q.id === (t.templateQuestionId || t.questionId),
          ),
        )
        .map((t) => ({ id: t.id, prompt: t.prompt, answer: t.answer })),
    })),
  };
}
