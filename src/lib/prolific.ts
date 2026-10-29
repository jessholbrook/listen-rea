import { z } from "zod";
export const prolificId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const prolificConfigInput = z
  .object({
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().min(10).max(4000),
    minutes: z.number().int().min(1).max(60),
    rewardMinor: z.number().int().min(1).max(100000),
    currency: z.enum(["USD", "GBP"]),
    places: z.number().int().min(1).max(100),
    maxCostMinor: z.number().int().min(1).max(10000000),
    microphone: z.boolean(),
    terms: z.string().trim().min(10).max(2000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.rewardMinor < v.minutes * (v.currency === "USD" ? 20 : 15))
      ctx.addIssue({
        code: "custom",
        path: ["rewardMinor"],
        message: "Use at least the recommended $12/£9 hourly rate.",
      });
    if (v.maxCostMinor < v.rewardMinor * v.places)
      ctx.addIssue({
        code: "custom",
        path: ["maxCostMinor"],
        message:
          "The cap must cover participant rewards plus provider fees and tax.",
      });
  });
export type ProlificInput = z.infer<typeof prolificConfigInput>;
export type ProlificConfig = {
  id: string;
  workspaceId: string;
  studyId: string;
  version: number;
  revisionId: string;
  input: ProlificInput;
  marker: string;
  code: string;
  payload: Record<string, unknown>;
  fingerprint: string;
  reviewedBy: string;
  reviewedAt: string;
  remoteMarker?: string;
  draftId?: string;
  activeId?: string;
  mode?: "test" | "paid";
  connectionHash?: string;
  providerStatus?: string;
  checkedAt?: string;
  admissionsEnabled: boolean;
  operationId?: string;
  quote?: {
    id: string;
    totalMinor: number;
    currency: string;
    expiresAt: number;
    remoteHash: string;
    connectionHash: string;
  };
};
export type ProlificOperation = {
  id: string;
  workspaceId: string;
  studyId: string;
  kind: "create" | "update" | "test" | "paid" | "pause";
  requestHash: string;
  configVersion: number;
  state: "sending" | "complete" | "uncertain";
  createdAt: string;
  actorId: string;
  remoteId?: string;
  resultVersion?: number;
};
export type ProlificSubmission = {
  id: string;
  workspaceId: string;
  studyId: string;
  providerId: string;
  participantId: string;
  claimId: string;
  status: string;
  payment: string;
  completedAt: string | null;
  reviewDeadline: string | null;
  checkedAt: string;
};
export const submissionInput = z.object({
  id: prolificId,
  participant_id: prolificId,
  status: z.string().max(60),
  started_at: z.iso.datetime({ offset: true }),
  completed_at: z.iso.datetime({ offset: true }).nullish(),
  payment_info: z
    .object({ status: z.enum(["pending", "paid", "failed"]).optional() })
    .nullish(),
});
export function projectedCost(value: unknown, currency: string) {
  const amount = z.object({
    amount: z.number().int().min(0).max(100000000),
    currency: z.literal(currency),
  });
  const breakdown = z.object({ rewards: amount, fees: amount, tax: amount });
  const v = z
    .object({ rewards: breakdown, bonuses: breakdown.optional() })
    .parse(value);
  return Object.values(v).reduce(
    (n, group) => n + Object.values(group).reduce((m, a) => m + a.amount, 0),
    0,
  );
}
export function prolificUrl(origin: string, studyId: string) {
  return `${origin}/s/${studyId}?handoff=prolific&PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}`;
}
export function prolificPayload(
  input: ProlificInput,
  url: string,
  project: string,
  marker: string,
  code: string,
) {
  return {
    name: input.title,
    description: input.description + "\n\n" + input.terms,
    estimated_completion_time: input.minutes,
    reward: input.rewardMinor,
    total_available_places: input.places,
    external_study_url: url,
    prolific_id_option: "url_parameters",
    project,
    metadata: marker,
    completion_codes: [
      {
        code,
        code_type: "COMPLETED",
        actions: [{ action: "MANUALLY_REVIEW" }],
      },
    ],
    device_compatibility: ["desktop"],
    peripheral_requirements: input.microphone ? ["microphone"] : [],
    filters: [],
    submissions_config: {
      max_submissions_per_participant: 1,
      auto_rejection_categories: [],
    },
  };
}
export function reviewDeadline(status: string, completedAt?: string | null) {
  if (
    status.replace(/_/g, " ") !== "AWAITING REVIEW" ||
    !completedAt ||
    !Number.isFinite(Date.parse(completedAt))
  )
    return null;
  return new Date(Date.parse(completedAt) + 21 * 86400000).toISOString();
}
