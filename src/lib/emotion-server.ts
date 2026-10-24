import { z } from "zod";
import { actor, respond, fail } from "./http";
import { requireStudy, interviews } from "./db";
import { retention } from "./features";
import { emotionResults } from "./emotion-results";
import { csv } from "./evidence";
import { languageSchema } from "./localization";
import { emotionCopy } from "./emotion";
export async function dispatchEmotion(req: Request, p: string[]) {
  if (p[0] !== "studies" || !p[1] || p[2] !== "emotions") return null;
  await retention();
  const a = await actor(),
    s = await requireStudy(p[1], a);
  if (req.method !== "GET")
    fail(
      405,
      "Feeling results are read-only. Add a feeling check-in in Study design.",
    );
  const params = new URL(req.url).searchParams,
    key = params.get("attribute"),
    value = params.get("value");
  if ((key === null) !== (value === null))
    fail(400, "Provide an attribute and exact value together.");
  const attribute =
    key !== null && value !== null
      ? z
          .object({
            key: z.string().min(1).max(100),
            value: z.string().max(500),
          })
          .parse({ key, value })
      : undefined;
  const language = params.has("language")
    ? languageSchema.parse(params.get("language"))
    : undefined;
  const results = emotionResults(await interviews(s), attribute, language);
  if (!p[3]) return respond({ results, attribute, language });
  if (p[3] !== "export") fail(404, "Feeling route not found.");
  const kind = z
    .enum(["summary", "sources"])
    .parse(params.get("kind") || "summary");
  const labels = emotionCopy("en").labels;
  let rows: string[][];
  if (kind === "summary") {
    rows = [
      [
        "study_id",
        "revision_id",
        "question_id",
        "concept_id",
        "method",
        "feeling_id",
        "feeling",
        "count",
        "reported_denominator",
        "percent",
        "slightly",
        "moderately",
        "strongly",
        "intensity_unspecified",
        "intensity_not_applicable",
        "complete",
        "declined",
        "not_asked",
        "unanswered",
        "invalid",
        "incomplete",
        "screened_out",
        "attribute",
        "attribute_value",
        "language_filter",
      ],
    ];
    for (const r of results)
      for (const row of r.rows)
        rows.push([
          s.id,
          r.revisionId,
          r.questionId,
          r.conceptId || "",
          r.method,
          row.feeling,
          labels[row.feeling],
          String(row.count),
          String(row.denominator),
          row.percent === null ? "" : String(row.percent),
          ...row.intensity.map((x) => String(x.count)),
          String(row.unspecified),
          String(row.notApplicable),
          String(r.counts.complete),
          String(r.counts.declined),
          String(r.counts.notAsked),
          String(r.counts.unanswered),
          String(r.counts.invalid),
          String(r.counts.incomplete),
          String(r.counts.screenedOut),
          key || "",
          value || "",
          language || "",
        ]);
  } else {
    rows = [
      [
        "study_id",
        "revision_id",
        "question_id",
        "concept_id",
        "method",
        "interview_id",
        "turn_id",
        "sequence",
        "recorded_at",
        "language",
        "status",
        "feeling_id",
        "intensity_ordinal",
        "note",
        "original_prompt",
        "original_answer",
        "attribute",
        "attribute_value",
        "language_filter",
      ],
    ];
    for (const r of results)
      for (const o of r.outcomes)
        rows.push([
          s.id,
          r.revisionId,
          r.questionId,
          r.conceptId || "",
          r.method,
          o.interviewId,
          o.turnId || "",
          o.sequence === null ? "" : String(o.sequence),
          o.createdAt || "",
          o.language,
          o.status,
          o.report?.feeling || "",
          o.report?.intensity == null ? "" : String(o.report.intensity),
          o.report?.note || "",
          o.prompt,
          o.answer,
          key || "",
          value || "",
          language || "",
        ]);
  }
  return new Response(csv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="feelings-${kind}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
