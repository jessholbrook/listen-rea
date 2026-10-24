import { transaction, db, list, get } from "./db";
import { body, canEdit, fail, respond, HttpError } from "./http";
import type { Actor } from "./domain";
import type { CollectionHandoff } from "./collection-handoff";
import {
  prepareBatchReview,
  applyBatchReview,
} from "./collection-handoff-server";
import { requirePlan } from "./review-plans-server";
import { planDates } from "./review-plans";
import {
  batchPreviewInput,
  batchApplyInput,
  type BatchPacket,
  type BatchStatus,
} from "./batch-review-plans";
function status(error: unknown): BatchStatus {
  if (error instanceof HttpError)
    return error.status === 404
      ? "unavailable"
      : error.status === 403
        ? "forbidden"
        : error.status === 409
          ? "conflict"
          : "failed";
  return "failed";
}
export async function dispatchBatchReviewPlans(
  req: Request,
  p: string[],
  a: Actor,
) {
  if (p[1] !== "review-plan-batch") return null;
  if (p.length !== 3 || !["preview", "apply"].includes(p[2]))
    fail(404, "Batch review route unavailable.");
  if (req.method !== "POST") fail(405, "Batch review requires POST.");
  canEdit(a);
  const preview = p[2] === "preview",
    input = (preview ? batchPreviewInput : batchApplyInput).parse(
      await body(req),
    );
  const setup = await transaction(async () => {
    const plan = await requirePlan(a, input.planId, input.planVersion);
    const members = await db
      .prepare(
        "SELECT id,name FROM users WHERE workspace_id=? AND role IN ('admin','researcher','collaborator')",
      )
      .all(a.workspaceId);
    if (plan.reviewers.some((r) => !members.some((m) => m.id === r.id)))
      fail(
        409,
        "Review plan contains unavailable reviewers. Edit it before applying.",
      );
    return {
      plan: { id: plan.id, version: plan.version, name: plan.name },
      start: input.start,
      reviewers: planDates(plan.reviewers, input.start).map((r) => ({
        ...r,
        name: String(members.find((m) => m.id === r.id)!.name),
      })),
    };
  });
  const packets: BatchPacket[] = [];
  for (const target of input.packets) {
    try {
      if (preview)
        packets.push(
          await prepareBatchReview(a, target.collectionId, target.id),
        );
      else {
        const expected =
          target as (typeof batchApplyInput)["_output"]["packets"][number];
        const result = await applyBatchReview(a, target.collectionId, {
          ...expected,
          op: "plan",
          planId: input.planId,
          planVersion: input.planVersion,
          start: input.start,
          acknowledged: true,
        });
        packets.push({
          id: target.id,
          collectionId: target.collectionId,
          status: "applied",
          title: result.title,
        });
      }
    } catch (error) {
      const outcome: BatchPacket = {
        id: target.id,
        collectionId: target.collectionId,
        status: status(error),
      };
      if (outcome.status === "conflict") {
        const current = await get<CollectionHandoff>(
          "libraryCollectionHandoff",
          target.id,
          a.workspaceId,
        );
        if (current?.collectionId === target.collectionId)
          outcome.title = current.title;
      }
      packets.push(outcome);
    }
  }
  // Validation of a shared source in a later packet may erase an earlier projection.
  const remaining = new Set(
    (
      await list<CollectionHandoff>("libraryCollectionHandoff", a.workspaceId)
    ).map((p) => p.id),
  );
  return respond({
    ...setup,
    packets: packets.map((p) =>
      remaining.has(p.id)
        ? p
        : { id: p.id, collectionId: p.collectionId, status: "unavailable" },
    ),
  });
}
