import type { Interview, Question } from "./domain";
import {
  emotionSchema,
  emotionText,
  feelings,
  type EmotionAnswer,
} from "./emotion";
import type { Language } from "./localization";
export function emotionResults(
  interviews: Interview[],
  attribute?: { key: string; value: string },
  language?: Language,
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
      i.status !== "withdrawn" &&
      (!attribute || i.attributes[attribute.key] === attribute.value) &&
      (!language ||
        (i.language || i.guide.localization?.sourceLanguage || "en") ===
          language),
  )) {
    for (const q of i.guide.questions.filter((q) => q.type === "emotion")) {
      const key = JSON.stringify([
        i.revisionId,
        q.templateQuestionId || q.id,
        q.conceptId || null,
      ]);
      if (!groups.has(key))
        groups.set(key, { revisionId: i.revisionId, question: q, members: [] });
      groups.get(key)!.members.push(i);
    }
  }
  return [...groups.values()].map(({ revisionId, question: q, members }) => {
    const outcomes = members.map((i) => {
      const language =
        i.language || i.guide.localization?.sourceLanguage || "en";
      const turns = i.turns.filter((t) => t.questionId === q.id && !t.followUp);
      const turn = turns.length === 1 ? turns[0] : undefined;
      const parsed = emotionSchema.safeParse(turn?.emotion);
      const valid =
        parsed.success && turn?.answer === emotionText(parsed.data, language);
      const report: EmotionAnswer | null = valid ? parsed.data! : null;
      const shown = i.shownQuestions?.includes(q.id) || turns.length > 0;
      const status =
        i.status !== "complete"
          ? i.status === "screened_out"
            ? "screened_out"
            : "incomplete"
          : turns.length > 0 && !valid
            ? "invalid"
            : !turn
              ? shown
                ? "unanswered"
                : "not_asked"
              : report?.feeling === "prefer_not_to_answer"
                ? "declined"
                : "reported";
      return {
        interviewId: i.id,
        language,
        status,
        report,
        turnId: turn?.id || null,
        prompt: turn?.prompt || q.text,
        answer: turn?.answer || "",
        createdAt: turn?.createdAt || null,
        sequence: turn ? i.turns.findIndex((t) => t.id === turn.id) + 1 : null,
      };
    });
    const included = outcomes.filter((o) => o.status === "reported"),
      denominator = included.length;
    return {
      revisionId,
      questionId: q.templateQuestionId || q.id,
      conceptId: q.conceptId || null,
      question: q.text,
      method: "self-report-v1",
      counts: {
        complete: members.filter((i) => i.status === "complete").length,
        included: denominator,
        declined: outcomes.filter((o) => o.status === "declined").length,
        incomplete: outcomes.filter((o) => o.status === "incomplete").length,
        screenedOut: outcomes.filter((o) => o.status === "screened_out").length,
        notAsked: outcomes.filter((o) => o.status === "not_asked").length,
        unanswered: outcomes.filter((o) => o.status === "unanswered").length,
        invalid: outcomes.filter((o) => o.status === "invalid").length,
      },
      rows: feelings
        .filter((f) => f !== "prefer_not_to_answer")
        .map((feeling) => {
          const selected = included.filter(
            (o) => o.report!.feeling === feeling,
          );
          return {
            feeling,
            count: selected.length,
            denominator,
            percent: denominator ? (selected.length / denominator) * 100 : null,
            intensity: [1, 2, 3].map((level) => ({
              level,
              count: selected.filter((o) => o.report!.intensity === level)
                .length,
            })),
            unspecified:
              feeling === "neutral"
                ? 0
                : selected.filter((o) => o.report!.intensity === null).length,
            notApplicable: feeling === "neutral" ? selected.length : 0,
          };
        }),
      languages: (["en", "es", "fr"] as const).map((language) => ({
        language,
        complete: outcomes.filter(
          (o) =>
            o.language === language &&
            [
              "reported",
              "declined",
              "not_asked",
              "unanswered",
              "invalid",
            ].includes(o.status),
        ).length,
        reported: included.filter((o) => o.language === language).length,
        declined: outcomes.filter(
          (o) => o.language === language && o.status === "declined",
        ).length,
      })),
      outcomes,
    };
  });
}
