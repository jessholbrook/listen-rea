import { z } from "zod";
import { db, get, list, put, uid, transaction } from "./db";
import { body, canEdit, fail, respond } from "./http";
import type { Actor } from "./domain";
import { planContent, type ReviewPlan } from "./review-plans";
export const planKind = "libraryReviewPlan";
export async function requirePlan(a: Actor, id: string, version: number) {
  const p = await get<ReviewPlan>(planKind, id, a.workspaceId);
  if (!p) fail(404, "Review plan unavailable.");
  if (p.version !== version)
    fail(409, "Review plan changed. Refresh and preview it again.");
  return p;
}
export async function dispatchReviewPlans(req: Request, p: string[], a: Actor) {
  if (p[1] !== "review-plans") return null;
  if (p.length !== 2 && p.length !== 3)
    fail(404, "Review plan route unavailable.");
  const item = p.length === 3;
  if (!(item ? ["PUT", "DELETE"] : ["GET", "POST"]).includes(req.method))
    fail(405, "Method unavailable.");
  if (item) z.uuid().parse(p[2]);
  if (req.method !== "GET") canEdit(a);
  const input = req.method === "GET" ? null : await body(req);
  return transaction(async () => {
    const members = (
      await db
        .prepare(
          "SELECT id,name FROM users WHERE workspace_id=? AND role IN ('admin','researcher','collaborator') ORDER BY name,id",
        )
        .all(a.workspaceId)
    ).map((m) => ({ id: String(m.id), name: String(m.name) }));
    if (req.method === "GET")
      return respond({
        plans: (await list<ReviewPlan>(planKind, a.workspaceId))
          .map(({ workspaceId: _, ...v }) => v)
          .sort(
            (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
          ),
        members,
      });
    if (req.method === "DELETE") {
      const v = z
        .object({ version: z.number().int().positive() })
        .strict()
        .parse(input);
      await requirePlan(a, p[2], v.version);
      await db
        .prepare(
          "DELETE FROM documents WHERE kind=? AND id=? AND workspace_id=?",
        )
        .run(planKind, p[2], a.workspaceId);
      return respond({ ok: true });
    }
    const v = (
      item
        ? planContent.extend({ version: z.number().int().positive() }).strict()
        : planContent
    ).parse(input);
    if (v.reviewers.some((r) => !members.some((m) => m.id === r.id)))
      fail(404, "Choose current workspace editors for every reviewer.");
    const previous = item
      ? await requirePlan(
          a,
          p[2],
          (v as typeof v & { version: number }).version,
        )
      : null;
    if (!item && (await list<ReviewPlan>(planKind, a.workspaceId)).length >= 50)
      fail(409, "This workspace has reached its 50-plan limit.");
    const record: ReviewPlan = {
      id: previous?.id || uid(),
      workspaceId: a.workspaceId,
      version: (previous?.version || 0) + 1,
      name: v.name,
      reviewers: v.reviewers,
    };
    await put(planKind, record);
    const { workspaceId: _, ...plan } = record;
    return respond({ plan });
  });
}
