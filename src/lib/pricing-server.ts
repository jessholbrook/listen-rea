import { z } from "zod";
import { actor, respond, fail } from "./http";
import { requireStudy, interviews } from "./db";
import { retention } from "./features";
import { pricingResults } from "./pricing";
import { csv } from "./evidence";
export async function dispatchPricing(req: Request, p: string[]) {
  if (p[0] !== "studies" || !p[1] || p[2] !== "pricing") return null;
  await retention();
  const a = await actor(),
    s = await requireStudy(p[1], a);
  if (req.method !== "GET")
    fail(
      405,
      "Pricing results are read-only. Edit pricing questions in the study guide.",
    );
  const params = new URL(req.url).searchParams,
    key = params.get("attribute"),
    value = params.get("value");
  if ((key === null) !== (value === null))
    fail(400, "Provide an attribute name and exact value together.");
  const attribute =
    key !== null && value !== null
      ? z
          .object({
            key: z.string().min(1).max(100),
            value: z.string().max(500),
          })
          .parse({ key, value })
      : undefined;
  const results = pricingResults(await interviews(s), attribute);
  if (p[3] === "export") {
    const kind = z
      .enum(["curves", "responses"])
      .parse(params.get("kind") || "curves");
    let rows: string[][];
    if (kind === "curves") {
      rows = [
        [
          "study_id",
          "revision_id",
          "question_id",
          "concept_id",
          "currency",
          "unit",
          "price_minor",
          "buyers",
          "denominator",
          "demand_fraction",
          "revenue_per_respondent_minor",
          "observed_yes",
          "observed_no",
          "inferred_yes",
          "inferred_no",
          "nonbuyers",
          "incomplete",
          "inconsistent",
          "not_asked",
          "attribute",
          "attribute_value",
        ],
      ];
      for (const r of results)
        for (const p of r.points)
          rows.push([
            s.id,
            r.revisionId,
            r.questionId,
            r.conceptId || "",
            r.config.currency,
            r.config.unit,
            String(p.priceMinor),
            String(p.buyers),
            String(p.denominator),
            p.demand === null ? "" : String(p.demand),
            p.revenuePerRespondentMinor === null
              ? ""
              : String(p.revenuePerRespondentMinor),
            String(p.observedYes),
            String(p.observedNo),
            String(p.inferredYes),
            String(p.inferredNo),
            String(r.counts.nonbuyers),
            String(r.counts.incomplete),
            String(r.counts.inconsistent),
            String(r.counts.notAsked),
            key || "",
            value || "",
          ]);
    } else {
      rows = [
        [
          "study_id",
          "revision_id",
          "question_id",
          "concept_id",
          "response_id",
          "status",
          "highest_accepted_minor",
          "above_tested_range",
          "currency",
          "unit",
          "price_events",
          "reason",
          "turn_ids",
        ],
      ];
      for (const r of results)
        for (const o of r.outcomes)
          rows.push([
            s.id,
            r.revisionId,
            r.questionId,
            r.conceptId || "",
            o.interviewId,
            o.status,
            o.highestMinor === null ? "" : String(o.highestMinor),
            String(o.aboveRange),
            r.config.currency,
            r.config.unit,
            JSON.stringify(o.events),
            o.reason,
            o.turnIds.join("|"),
          ]);
    }
    return new Response(csv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="pricing-${kind}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  if (p[3]) fail(404, "Pricing route not found.");
  return respond({ results, attribute });
}
