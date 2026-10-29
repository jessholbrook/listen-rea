import { hierarchicalRequest } from "./maxdiff-hierarchical-server";
import { z } from "zod";
import { actor, canEdit, body, respond, fail, limit } from "./http";
import { requireStudy, interviews, hash, now } from "./db";
import { retention } from "./features";
import { maxdiffResults } from "./maxdiff-results";
import {
  fitMaxdiff,
  bootstrapMaxdiff,
  seedFor,
  modelVersion,
  ridge,
} from "./maxdiff-model";
import { csv } from "./evidence";
const scopeSchema = z.object({
  revisionId: z.string().min(1).max(100),
  questionId: z.string().min(1).max(100),
  conceptId: z.string().max(100).nullable().default(null),
});
export async function dispatchMaxdiff(req: Request, p: string[]) {
  if (p[0] !== "studies" || !p[1] || p[2] !== "maxdiff") return null;
  await retention();
  const a = await actor(),
    s = await requireStudy(p[1], a),
    params = new URL(req.url).searchParams,
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
  const hierarchical = await hierarchicalRequest(req, p, a, s, attribute);
  if (hierarchical) return hierarchical;
  const results = maxdiffResults(await interviews(s), attribute),
    fingerprint = (r: (typeof results)[number]) =>
      hash(
        JSON.stringify({
          version: modelVersion,
          attribute,
          scope: [r.revisionId, r.questionId, r.conceptId],
          config: r.config,
          outcomes: r.outcomes,
        }),
      );
  if (!p[3] && req.method === "GET")
    return respond({
      results: results.map(({ respondents, ...r }) => ({
        ...r,
        sourceFingerprint: fingerprint({ ...r, respondents }),
      })),
      attribute,
    });
  if (p[3] === "export" && req.method === "GET") {
    const kind = z
      .enum(["counts", "tasks"])
      .parse(params.get("kind") || "counts");
    let rows: string[][];
    if (kind === "counts") {
      rows = [
        [
          "study_id",
          "revision_id",
          "question_id",
          "concept_id",
          "item_id",
          "label",
          "exposures",
          "best",
          "worst",
          "net_count",
          "net_per_exposure",
          "included_respondents",
          "incomplete",
          "not_asked",
          "invalid",
          "design_version",
          "attribute",
          "attribute_value",
        ],
      ];
      for (const r of results)
        for (const item of r.items)
          rows.push([
            s.id,
            r.revisionId,
            r.questionId,
            r.conceptId || "",
            item.id,
            item.text,
            String(item.exposures),
            String(item.best),
            String(item.worst),
            String(item.net),
            item.netPerExposure === null ? "" : String(item.netPerExposure),
            String(r.counts.included),
            String(r.counts.incomplete),
            String(r.counts.notAsked),
            String(r.counts.invalid),
            r.design.version,
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
          "task_number",
          "reached",
          "answered",
          "shown_item_ids",
          "best_id",
          "worst_id",
          "turn_id",
          "design_version",
        ],
      ];
      for (const r of results)
        for (const o of r.outcomes)
          for (const [n, task] of o.tasks.entries())
            rows.push([
              s.id,
              r.revisionId,
              r.questionId,
              r.conceptId || "",
              o.interviewId,
              o.status,
              String(n + 1),
              String(n <= o.answered),
              String(n < o.answered),
              JSON.stringify(task),
              o.choices[n]?.best || "",
              o.choices[n]?.worst || "",
              o.turns.find((t) => t.task === n + 1)?.id || "",
              r.design.version,
            ]);
    }
    return new Response(csv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="maxdiff-${kind}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  if (p[3] === "model" && req.method === "POST") {
    canEdit(a);
    limit("maxdiff-model:" + a.workspaceId, 4);
    const input = scopeSchema
        .extend({ sourceFingerprint: z.string().length(64) })
        .parse(await body(req)),
      r = results.find(
        (r) =>
          r.revisionId === input.revisionId &&
          r.questionId === input.questionId &&
          r.conceptId === input.conceptId,
      );
    if (!r) fail(404, "MaxDiff result scope not found.");
    const sourceFingerprint = fingerprint(r);
    if (input.sourceFingerprint !== sourceFingerprint)
      fail(409, "Responses changed. Refresh MaxDiff results before fitting.");
    if (!r.respondents.length)
      fail(400, "Complete at least one included MaxDiff interview first.");
    if (r.respondents.length > 500 || r.respondents.flat().length > 12000)
      fail(
        413,
        "This release supports at most 500 respondents and 12,000 tasks per fit.",
      );
    const fit = fitMaxdiff(r.respondents.flat(), r.items.length);
    if (!fit.converged)
      fail(
        422,
        "The pooled model did not converge. Inspect counts or try a different sample.",
      );
    const seed = seedFor(sourceFingerprint),
      bootstrap = bootstrapMaxdiff(r.respondents, r.items.length, seed),
      computedAt = now();
    const fresh = maxdiffResults(await interviews(s), attribute).find(
      (x) =>
        x.revisionId === r.revisionId &&
        x.questionId === r.questionId &&
        x.conceptId === r.conceptId,
    );
    if (!fresh || fingerprint(fresh) !== sourceFingerprint)
      fail(409, "Responses changed during fitting. Refresh and try again.");
    const items = r.items.map((item, k) => ({
      ...item,
      utility: fit.utilities[k],
      score: fit.scores[k],
      interval: bootstrap.intervals?.[k] || null,
    }));
    const rows = [
      [
        "study_id",
        "revision_id",
        "question_id",
        "concept_id",
        "item_id",
        "label",
        "utility",
        "relative_preference_score",
        "bootstrap_low",
        "bootstrap_high",
        "included_respondents",
        "method",
        "ridge",
        "bootstrap_requested",
        "bootstrap_completed",
        "seed",
        "source_fingerprint",
        "computed_at",
        "attribute",
        "attribute_value",
      ],
    ];
    for (const item of items)
      rows.push([
        s.id,
        r.revisionId,
        r.questionId,
        r.conceptId || "",
        item.id,
        item.text,
        String(item.utility),
        String(item.score),
        item.interval ? String(item.interval.low) : "",
        item.interval ? String(item.interval.high) : "",
        String(r.counts.included),
        modelVersion,
        String(ridge),
        String(bootstrap.requested),
        String(bootstrap.completed),
        String(seed),
        sourceFingerprint,
        computedAt,
        key || "",
        value || "",
      ]);
    return respond({
      model: {
        method: modelVersion,
        ridge,
        sourceFingerprint,
        computedAt,
        seed,
        bootstrap: {
          requested: bootstrap.requested,
          completed: bootstrap.completed,
          reason: bootstrap.reason,
        },
        fit: {
          converged: fit.converged,
          iterations: fit.iterations,
          gradient: fit.gradient,
        },
        items,
      },
      csv: csv(rows),
    });
  }
  fail(404, "MaxDiff route not found.");
}
