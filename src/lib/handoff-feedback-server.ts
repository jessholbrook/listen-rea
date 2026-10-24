import {
  recordReviewEvent,
  recordFeedbackEvent,
} from "./review-activity-records";
import { requirePlan } from "./review-plans-server";
import { planDates } from "./review-plans";
import { get, put, hash, uid, now } from "./db";
import { fail } from "./http";
import type { Actor } from "./domain";
import type { CollectionHandoff } from "./collection-handoff";
import type {
  FeedbackInput,
  HandoffFeedback,
  FeedbackView,
} from "./handoff-feedback";
export const feedbackKind = "libraryHandoffFeedback";
type Member = { id: string; name: string; role?: string };
function editable(m: Member) {
  return !m.role || ["admin", "researcher", "collaborator"].includes(m.role);
}
async function invalidate(packet: CollectionHandoff) {
  if (!packet.approvedSignature && !packet.reviewedAt) return packet;
  const p = {
    ...packet,
    version: packet.version + 1,
    updatedAt: now(),
    approvedSignature: null,
    reviewedAt: null,
  };
  await put("libraryCollectionHandoff", p);
  return p;
}
function view(
  r: HandoffFeedback | undefined,
  a: Actor,
  sig: string,
  members: Member[],
): FeedbackView {
  const reviewers = (r?.reviewerIds || []).map((id) => {
    const member = members.find((m) => m.id === id && editable(m));
    return {
      id,
      name: member?.name || null,
      available: !!member,
      dueDate: r?.deadlines?.find((d) => d.userId === id)?.dueDate || null,
      approvedAt: member
        ? r?.decisions.find((d) => d.userId === id && d.signature === sig)
            ?.at || null
        : null,
    };
  });
  return {
    version: r?.version || 0,
    members: members.filter(editable).map((m) => ({ id: m.id, name: m.name })),
    reviewers,
    comments: (r?.comments || []).map((c) => ({
      id: c.id,
      author: members.find((m) => m.id === c.authorId)?.name || null,
      body: c.body,
      createdAt: c.createdAt,
      resolvedAt: c.resolvedAt,
      resolvedBy: members.find((m) => m.id === c.resolvedBy)?.name || null,
      canDelete:
        ["admin", "researcher", "collaborator"].includes(a.role) &&
        (c.authorId === a.id || a.role === "admin"),
    })),
    userId: a.id,
    canDecide: reviewers.some((v) => v.id === a.id && v.available),
    ready:
      reviewers.every((v) => v.available && !!v.approvedAt) &&
      !r?.comments.some((c) => !c.resolvedAt),
    remainingComments: 100 - (r?.commentCount || 0),
  };
}
export async function currentHandoffFeedback(
  packet: CollectionHandoff,
  a: Actor,
  sig: string,
  members: Member[],
) {
  let r = await get<HandoffFeedback>(feedbackKind, packet.id, a.workspaceId),
    p = packet;
  if (r) {
    const decisions = r.decisions.filter(
      (d) =>
        d.signature === sig &&
        r!.reviewerIds.includes(d.userId) &&
        members.some((m) => m.id === d.userId && editable(m)),
    );
    if (r.contentSignature !== sig || decisions.length !== r.decisions.length) {
      const clearedReviewerIds = r.decisions
          .filter((d) => !decisions.some((v) => v.userId === d.userId))
          .map((d) => d.userId),
        wasFinal = !!p.reviewedAt;
      r = { ...r, contentSignature: sig, decisions, version: r.version + 1 };
      await put(feedbackKind, r);
      p = await invalidate(p);
      await recordReviewEvent(p, {
        actorId: null,
        action: "review_invalidated",
        reviewVersion: r.version,
        clearedReviewerIds,
        finalApprovalReset: wasFinal,
      });
    }
  }
  return { packet: p, review: view(r, a, sig, members), record: r };
}
export async function mutateHandoffFeedback(
  packet: CollectionHandoff,
  a: Actor,
  sig: string,
  members: Member[],
  input: FeedbackInput,
  eligible: boolean,
) {
  const current = await currentHandoffFeedback(packet, a, sig, members);
  const before = current.record,
    wasFinal = !!current.packet.reviewedAt;
  let r = current.record,
    p = current.packet;
  if (input.id !== p.id) fail(404, "Packet unavailable.");
  if (
    input.signature !== sig ||
    input.packetVersion > p.version ||
    input.version > (r?.version || 0)
  )
    fail(409, "Packet review changed. Refresh before continuing.");
  const commentKey = (requestId: string) =>
    hash(a.workspaceId + ":" + p.id + ":" + a.id + ":" + requestId);
  if (input.op === "comment") {
    if (r?.tombstones.includes(commentKey(input.requestId)))
      fail(409, "This comment request was deleted. Start a new comment.");
    const previous = r?.comments.find(
      (c) => c.authorId === a.id && c.requestId === input.requestId,
    );
    if (previous) {
      if (previous.inputHash !== hash(input.body))
        fail(409, "This comment request has different text.");
      return { packet: p, reused: true };
    }
  }
  if (input.op === "deadline") {
    if (!r?.reviewerIds.includes(input.reviewerId))
      fail(404, "Choose a requested reviewer for this packet.");
    const currentDate =
      r.deadlines?.find((d) => d.userId === input.reviewerId)?.dueDate || null;
    if (currentDate === input.dueDate) return { packet: p, reused: true };
  }
  if (input.op === "decision") {
    if (
      !r?.reviewerIds.includes(a.id) ||
      !members.some((m) => m.id === a.id && editable(m))
    )
      fail(403, "Only a requested reviewer can submit their own review.");
    const existing = r.decisions.some(
      (d) => d.userId === a.id && d.signature === sig,
    );
    if (
      existing === input.approved &&
      (!input.approved || (eligible && !r.comments.some((c) => !c.resolvedAt)))
    )
      return { packet: p, reused: true };
  }
  if (input.packetVersion !== p.version || input.version !== (r?.version || 0))
    fail(409, "Packet review changed. Refresh before continuing.");
  r = r || {
    id: p.id,
    workspaceId: a.workspaceId,
    collectionId: p.collectionId,
    version: 0,
    contentSignature: sig,
    reviewerIds: [],
    decisions: [],
    comments: [],
    tombstones: [],
    commentCount: 0,
  };
  if (input.op === "deadline") {
    r = {
      ...r,
      version: r.version + 1,
      deadlines: [
        ...(r.deadlines || []).filter((d) => d.userId !== input.reviewerId),
        ...(input.dueDate
          ? [{ userId: input.reviewerId, dueDate: input.dueDate }]
          : []),
      ],
    };
    if (JSON.stringify(r).length > 250000)
      fail(
        413,
        "This packet review is too large. Delete comments before continuing.",
      );
    await put(feedbackKind, r);
    await recordFeedbackEvent(p, a.id, input, before, r, wasFinal);
    // Scheduling metadata never changes a content decision or export approval.
    return { packet: p, reused: false };
  }
  if (input.op === "plan") {
    const plan = await requirePlan(a, input.planId, input.planVersion);
    if (
      plan.reviewers.some(
        (v) => !members.some((m) => m.id === v.id && editable(m)),
      )
    )
      fail(
        409,
        "Review plan contains unavailable reviewers. Edit it before applying.",
      );
    const dates = planDates(plan.reviewers, input.start);
    r = {
      ...r,
      reviewerIds: dates.map((v) => v.id),
      deadlines: dates
        .filter((v) => v.dueDate !== null)
        .map((v) => ({ userId: v.id, dueDate: v.dueDate! })),
      decisions: [],
    };
  } else if (input.op === "assign") {
    if (
      input.reviewerIds.some(
        (id) => !members.some((m) => m.id === id && editable(m)),
      )
    )
      fail(404, "Choose reviewers from this workspace with edit access.");
    if (
      JSON.stringify([...input.reviewerIds].sort()) ===
      JSON.stringify([...r.reviewerIds].sort())
    )
      return { packet: p, reused: true };
    r = {
      ...r,
      reviewerIds: input.reviewerIds,
      decisions: [],
      deadlines: (r.deadlines || []).filter((d) =>
        input.reviewerIds.includes(d.userId),
      ),
    };
  } else if (input.op === "reassign") {
    if (!r.reviewerIds.includes(input.fromReviewerId))
      fail(404, "Requested reviewer unavailable.");
    if (
      r.decisions.some(
        (d) => d.userId === input.fromReviewerId && d.signature === sig,
      )
    )
      fail(409, "Only a pending review request can be reassigned.");
    if (!members.some((m) => m.id === input.toReviewerId && editable(m)))
      fail(404, "Choose an editor from this workspace.");
    if (r.reviewerIds.includes(input.toReviewerId))
      fail(409, "The replacement is already requested on this packet.");
    const dueDate = r.deadlines?.find(
      (d) => d.userId === input.fromReviewerId,
    )?.dueDate;
    r = {
      ...r,
      reviewerIds: r.reviewerIds.map((id) =>
        id === input.fromReviewerId ? input.toReviewerId : id,
      ),
      decisions: [],
      deadlines: [
        ...(r.deadlines || []).filter(
          (d) =>
            d.userId !== input.fromReviewerId &&
            d.userId !== input.toReviewerId,
        ),
        ...(dueDate ? [{ userId: input.toReviewerId, dueDate }] : []),
      ],
    };
  } else if (input.op === "comment") {
    if (r.commentCount >= 100)
      fail(409, "This packet has reached its 100-comment lifetime limit.");
    r = {
      ...r,
      commentCount: r.commentCount + 1,
      decisions: [],
      comments: [
        ...r.comments,
        {
          id: uid(),
          requestId: input.requestId,
          inputHash: hash(input.body),
          authorId: a.id,
          body: input.body,
          createdAt: now(),
          resolvedAt: null,
          resolvedBy: null,
        },
      ],
    };
  } else if (input.op === "decision") {
    if (
      !r.reviewerIds.includes(a.id) ||
      !members.some((m) => m.id === a.id && editable(m))
    )
      fail(403, "Only a requested reviewer can submit their own review.");
    if (input.approved && (!eligible || r.comments.some((c) => !c.resolvedAt)))
      fail(
        409,
        "Resolve feedback and choose eligible packet contents before approving.",
      );
    const existing = r.decisions.find(
      (d) => d.userId === a.id && d.signature === sig,
    );
    if (!!existing === input.approved) return { packet: p, reused: true };
    r = {
      ...r,
      decisions: [
        ...r.decisions.filter((d) => d.userId !== a.id),
        ...(input.approved
          ? [{ userId: a.id, signature: sig, at: now() }]
          : []),
      ],
    };
  } else {
    const c = r.comments.find((c) => c.id === input.commentId);
    if (!c) fail(404, "Comment unavailable.");
    if (input.op === "delete_comment") {
      if (c.authorId !== a.id && a.role !== "admin")
        fail(403, "Only the author or an admin can delete this comment.");
      r = {
        ...r,
        comments: r.comments.filter((v) => v.id !== c.id),
        decisions: [],
        tombstones: [
          ...r.tombstones,
          hash(
            a.workspaceId + ":" + p.id + ":" + c.authorId + ":" + c.requestId,
          ),
        ],
      };
    } else {
      if (!!c.resolvedAt === input.resolved) return { packet: p, reused: true };
      r = {
        ...r,
        comments: r.comments.map((v) =>
          v.id === c.id
            ? {
                ...v,
                resolvedAt: input.resolved ? now() : null,
                resolvedBy: input.resolved ? a.id : null,
              }
            : v,
        ),
        decisions: input.resolved ? r.decisions : [],
      };
    }
  }
  r = { ...r, version: r.version + 1, contentSignature: sig };
  if (JSON.stringify(r).length > 250000)
    fail(
      413,
      "This packet review is too large. Delete comments before continuing.",
    );
  await put(feedbackKind, r);
  p = await invalidate(p);
  await recordFeedbackEvent(p, a.id, input, before, r, wasFinal);
  return { packet: p, reused: false };
}
