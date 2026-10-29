import { z } from "zod";
import { canEdit, body, fail, limit, respond } from "./http";
import { db, hash, interviews, requireStudy, now } from "./db";
import type { Actor, Study } from "./domain";
import { maxdiffResults } from "./maxdiff-results";
import {
  fitHierarchical,
  hierarchicalVersion,
  hbPrior,
} from "./maxdiff-hierarchical";
import { seedFor, modelVersion } from "./maxdiff-model";
import { csv } from "./evidence";
const request = z
  .object({
    revisionId: z.string().min(1).max(100),
    questionId: z.string().min(1).max(100),
    conceptId: z.string().max(100).nullable().default(null),
    sourceFingerprint: z.string().length(64),
    portfolioSize: z.number().int().min(1).max(4),
    topItems: z.number().int().min(1).max(3),
  })
  .strict();
export async function hierarchicalRequest(
  req: Request,
  p: string[],
  a: Actor,
  s: Study,
  attribute: { key: string; value: string } | undefined,
) {
  if (p[3] !== "hierarchical") return null;
  if (req.method !== "POST" || p.length > 5 || (p[4] && p[4] !== "export"))
    fail(405, "Use POST for hierarchical model previews and reviewed exports.");
  canEdit(a);
  const exporting = p[4] === "export",
    input = (
      exporting
        ? request.extend({
            signature: z.string().length(64),
            reviewed: z.literal(true),
            format: z.enum(["summary", "individual", "portfolio"]),
          })
        : request
    ).parse(await body(req));
  const select = async () =>
    maxdiffResults(
      await interviews(await requireStudy(s.id, a)),
      attribute,
    ).find(
      (r) =>
        r.revisionId === input.revisionId &&
        r.questionId === input.questionId &&
        r.conceptId === input.conceptId,
    );
  const fingerprint = (r: NonNullable<Awaited<ReturnType<typeof select>>>) =>
    hash(
      JSON.stringify({
        version: modelVersion,
        attribute,
        scope: [r.revisionId, r.questionId, r.conceptId],
        config: r.config,
        outcomes: r.outcomes,
      }),
    );
  const r = await select();
  if (!r) fail(404, "MaxDiff result scope unavailable.");
  const sourceFingerprint = fingerprint(r);
  if (sourceFingerprint !== input.sourceFingerprint)
    fail(409, "Responses changed. Refresh MaxDiff results first.");
  if (
    r.respondents.length < 10 ||
    r.respondents.length > 100 ||
    r.items.length > 8 ||
    r.counts.tasks > 1600
  )
    fail(
      413,
      "The hierarchical pilot supports 10–100 complete respondents, 4–8 items and at most 1,600 tasks per fit. Counts and the pooled model remain available.",
    );
  if (input.portfolioSize >= r.items.length || input.topItems >= r.items.length)
    fail(
      400,
      "Choose portfolio size and top-item threshold below the full item count.",
    );
  const signature = hash(
    JSON.stringify([
      a.id,
      a.workspaceId,
      a.role,
      sourceFingerprint,
      hierarchicalVersion,
      input.portfolioSize,
      input.topItems,
      hbPrior,
    ]),
  );
  if (exporting && "signature" in input && input.signature !== signature)
    fail(
      409,
      "Model settings or access changed. Generate and review a fresh preview.",
    );
  limit("maxdiff-hierarchical:" + a.workspaceId, 4);
  let fit: ReturnType<typeof fitHierarchical>;
  try {
    fit = fitHierarchical(
      r.respondents,
      r.items.length,
      seedFor(
        JSON.stringify([
          hierarchicalVersion,
          hbPrior,
          r.items.length,
          r.respondents,
        ]),
      ),
      { size: input.portfolioSize, top: input.topItems },
    );
  } catch (e) {
    if ((e as Error).message === "HB_TIME_BUDGET")
      fail(
        422,
        "Sampling exceeded its time budget. Narrow the sample; no estimates were published.",
      );
    throw e;
  }
  const fresh = await select(),
    member = await db
      .prepare("SELECT workspace_id,role FROM users WHERE id=?")
      .get(a.id);
  if (
    !member ||
    member.workspace_id !== a.workspaceId ||
    member.role !== a.role
  )
    fail(409, "Access changed during sampling. Refresh before continuing.");
  if (!fresh || fingerprint(fresh) !== sourceFingerprint)
    fail(409, "Responses changed during sampling. Refresh before continuing.");
  const ids = r.outcomes
    .filter((o) => o.status === "included")
    .map((o) => o.interviewId);
  const model = {
    method: fit.method,
    prior: fit.prior,
    basis: fit.basis,
    seed: fit.seed,
    computedAt: now(),
    sourceFingerprint,
    signature,
    diagnostics: fit.diagnostics,
    items: fit.items.map((score, k) => ({
      id: r.items[k].id,
      text: r.items[k].text,
      score,
    })),
    individual: fit.individual.map((x, i) => ({
      interviewId: ids[i],
      items: x.scores.map((score, k) => ({
        id: r.items[k].id,
        text: r.items[k].text,
        utility: x.utilities[k],
        score,
      })),
    })),
    portfolio: fit.portfolio
      ? {
          size: fit.portfolio.size,
          top: fit.portfolio.top,
          candidateCount: fit.portfolio.candidateCount,
          candidates: fit.portfolio.candidates.map((c) => ({
            ...c,
            items: c.items.map((k) => ({
              id: r.items[k].id,
              text: r.items[k].text,
            })),
          })),
        }
      : null,
  };
  if (!exporting) return respond({ model });
  if (!model.diagnostics.ready)
    fail(
      422,
      "Sampling diagnostics did not pass. Scores and portfolio exports are withheld.",
    );
  const format = "format" in input ? input.format : "summary";
  const rows: string[][] = [
    [
      "study_id",
      "revision_id",
      "question_id",
      "concept_id",
      "response_id",
      "item_or_portfolio_ids",
      "label",
      "utility_mean",
      "utility_low",
      "utility_high",
      "score_or_coverage_mean",
      "score_or_coverage_low",
      "score_or_coverage_high",
      "method",
      "seed",
      "source_fingerprint",
      "chains",
      "warmup",
      "draws_per_chain",
      "max_split_folded_rhat",
      "min_ess",
      "included_respondents",
      "portfolio_size",
      "top_items_per_person",
      "prior_shape",
      "prior_scale",
      "prior_kappa",
      "segment_attribute",
      "segment_value",
    ],
  ];
  const add = (
    id: string,
    item: string,
    label: string,
    u: { mean: number; low: number; high: number } | null,
    v: { mean: number; low: number; high: number },
  ) =>
    rows.push([
      s.id,
      r.revisionId,
      r.questionId,
      r.conceptId || "",
      id,
      item,
      label,
      u ? String(u.mean) : "",
      u ? String(u.low) : "",
      u ? String(u.high) : "",
      String(v.mean),
      String(v.low),
      String(v.high),
      fit.method,
      String(fit.seed),
      sourceFingerprint,
      String(fit.diagnostics.chains),
      String(fit.diagnostics.warmup),
      String(fit.diagnostics.draws),
      String(fit.diagnostics.maxRhat),
      String(fit.diagnostics.minESS),
      String(r.counts.included),
      String(input.portfolioSize),
      String(input.topItems),
      String(hbPrior.shape),
      String(hbPrior.scale),
      String(hbPrior.kappa),
      attribute?.key || "",
      attribute?.value || "",
    ]);
  if (format === "individual")
    for (const person of model.individual)
      for (const item of person.items)
        add(person.interviewId, item.id, item.text, item.utility, item.score);
  else if (format === "portfolio")
    for (const candidate of model.portfolio!.candidates)
      add(
        "",
        JSON.stringify(candidate.items.map((i) => i.id)),
        candidate.items.map((i) => i.text).join(" | "),
        null,
        { mean: candidate.coverage, low: candidate.low, high: candidate.high },
      );
  else
    for (const item of model.items)
      add("", item.id, item.text, null, item.score);
  return new Response(csv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="maxdiff-hierarchical-${format}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
