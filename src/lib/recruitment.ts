import { z } from "zod";
import { languageSchema, type Language } from "./localization";
import type { Interview } from "./domain";
export const participantAttributes = z
  .record(z.string().min(1).max(100), z.string().max(500))
  .refine(
    (v) => Object.keys(v).length <= 20,
    "Use at most 20 participant tags.",
  );
export const invitationBatchInput = z
  .object({
    requestId: z.uuid(),
    secret: z.string().regex(/^[0-9a-f]{64}$/),
    expiresAt: z.iso.datetime({ offset: true }),
    language: languageSchema.optional(),
    recipients: z
      .array(
        z.object({
          reference: z.string().trim().min(1).max(100),
          attributes: participantAttributes.default({}),
        }),
      )
      .min(1)
      .max(50),
    replace: z
      .object({ id: z.string().length(64), version: z.number().int().min(1) })
      .optional(),
  })
  .superRefine((v, c) => {
    if (
      new Set(v.recipients.map((r) => referenceKey(r.reference))).size !==
      v.recipients.length
    )
      c.addIssue({
        code: "custom",
        message: "Participant references must be unique in a batch.",
      });
    if (v.replace && v.recipients.length !== 1)
      c.addIssue({
        code: "custom",
        message: "Replace one unused invitation at a time.",
      });
  });
export const referenceKey = (reference: string) =>
  reference.normalize("NFKC").trim().toLowerCase();
export type RecruitmentSettings = {
  id: string;
  workspaceId: string;
  studyId: string;
  version: number;
  mode: "open" | "invitation_only";
  updatedAt?: string;
  updatedBy?: string;
};
export type ParticipantInvitation = {
  id: string;
  workspaceId: string;
  studyId: string;
  batchId: string;
  version: number;
  reference: string;
  attributes: Record<string, string>;
  language?: Language;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  createdBy: string;
  sharedAt?: string;
  revokedAt?: string;
  redactedAt?: string;
  claimedAt?: string;
  interviewId?: string;
  responseDeletedAt?: string;
  replacedBy?: string;
};
export type InvitationBatch = {
  id: string;
  workspaceId: string;
  studyId: string;
  fingerprint: string;
  ids: string[];
  createdAt: string;
};
export function redactInvitation(
  v: ParticipantInvitation,
  at: string,
): ParticipantInvitation {
  return {
    ...v,
    reference: "",
    attributes: {},
    redactedAt: v.redactedAt || at,
    revokedAt: v.revokedAt || at,
    updatedAt: at,
    version: v.version + 1,
  };
}
export function invitationView(
  v: ParticipantInvitation,
  i?: Interview,
  at = Date.now(),
) {
  const linkStatus = v.claimedAt
    ? "claimed"
    : v.revokedAt
      ? "revoked"
      : Date.parse(v.expiresAt) <= at
        ? "expired"
        : "valid";
  const status =
    v.responseDeletedAt || (v.claimedAt && !i)
      ? "response_deleted"
      : i
        ? i.status === "active"
          ? "in_progress"
          : i.status
        : v.replacedBy
          ? "replaced"
          : v.revokedAt
            ? "revoked"
            : linkStatus === "expired"
              ? "expired"
              : v.sharedAt
                ? "marked_shared"
                : "ready";
  return {
    id: v.id,
    version: v.version,
    reference: v.redactedAt ? "" : v.reference,
    attributes: v.redactedAt ? {} : v.attributes,
    language: v.language || null,
    createdAt: v.createdAt,
    expiresAt: v.expiresAt,
    sharedAt: v.sharedAt || null,
    revokedAt: v.revokedAt || null,
    redactedAt: v.redactedAt || null,
    claimedAt: v.claimedAt || null,
    responseDeletedAt: v.responseDeletedAt || null,
    replacedBy: v.replacedBy || null,
    status,
    linkStatus,
    response: i
      ? {
          id: i.id,
          status: i.status,
          excluded: i.excluded,
          createdAt: i.createdAt,
          completedAt: i.completedAt || null,
        }
      : null,
  };
}
export type InvitationView = ReturnType<typeof invitationView>;
