import { get, put, uid, now } from "./db";
import type { CollectionHandoff } from "./collection-handoff";
import type { HandoffFeedback, FeedbackInput } from "./handoff-feedback";
import type {
  ReviewActivity,
  ReviewEvent,
  ActivityAction,
  ActivityPerson,
} from "./review-activity";
export const activityKind = "libraryReviewActivity";
export async function recordReviewEvent(
  packet: CollectionHandoff,
  event: Omit<ReviewEvent, "id" | "sequence" | "at" | "packetVersion">,
) {
  const old = await get<ReviewActivity>(
    activityKind,
    packet.id,
    packet.workspaceId,
  );
  const record: ReviewActivity = {
    id: packet.id,
    workspaceId: packet.workspaceId,
    collectionId: packet.collectionId,
    events: [
      ...(old?.events || []),
      {
        ...event,
        id: uid(),
        sequence: (old?.omitted || 0) + (old?.events.length || 0) + 1,
        at: now(),
        packetVersion: packet.version,
      },
    ],
    omitted: old?.omitted || 0,
  };
  while (record.events.length > 100 || JSON.stringify(record).length > 200000) {
    record.events.shift();
    record.omitted++;
  }
  await put(activityKind, record);
}
const people = (r: HandoffFeedback | undefined): ActivityPerson[] =>
  (r?.reviewerIds || []).map((id) => ({
    id,
    dueDate: r?.deadlines?.find((d) => d.userId === id)?.dueDate || null,
  }));
export async function recordFeedbackEvent(
  packet: CollectionHandoff,
  actorId: string,
  input: FeedbackInput,
  before: HandoffFeedback | undefined,
  after: HandoffFeedback,
  wasFinal: boolean,
) {
  const action: ActivityAction =
    input.op === "decision"
      ? input.approved
        ? "reviewer_approved"
        : "reviewer_withdrew"
      : input.op === "comment"
        ? "comment_added"
        : input.op === "resolve"
          ? input.resolved
            ? "comment_resolved"
            : "comment_reopened"
          : input.op === "delete_comment"
            ? "comment_deleted"
            : input.op;
  const changed = ["assign", "reassign", "plan"].includes(input.op),
    deadline = input.op === "deadline";
  await recordReviewEvent(packet, {
    actorId,
    action,
    reviewVersion: after.version,
    clearedReviewerIds: (before?.decisions || [])
      .filter((d) => !after.decisions.some((v) => v.userId === d.userId))
      .map((d) => d.userId),
    finalApprovalReset: wasFinal && !packet.reviewedAt,
    ...(changed ? { before: people(before), after: people(after) } : {}),
    ...(deadline
      ? {
          reviewerId: input.reviewerId,
          before: [
            {
              id: input.reviewerId,
              dueDate:
                before?.deadlines?.find((d) => d.userId === input.reviewerId)
                  ?.dueDate || null,
            },
          ],
          after: [{ id: input.reviewerId, dueDate: input.dueDate }],
        }
      : {}),
    ...(input.op === "decision" ? { reviewerId: actorId } : {}),
  });
}
