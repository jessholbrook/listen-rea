import { z } from "zod";
import { guideSchema, type Guide } from "./domain";
export const automationOperations = [
  "create",
  "edit",
  "publish",
  "fielding",
] as const;
export const automationChange = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create"), guide: guideSchema }).strict(),
  z
    .object({
      operation: z.literal("edit"),
      studyId: z.uuid(),
      fingerprint: z.string().length(64),
      guide: guideSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("publish"),
      studyId: z.uuid(),
      fingerprint: z.string().length(64),
    })
    .strict(),
  z
    .object({
      operation: z.literal("fielding"),
      studyId: z.uuid(),
      fingerprint: z.string().length(64),
      state: z.enum(["active", "paused", "closed"]),
    })
    .strict(),
]);
export const automationProposal = z
  .object({
    requestId: z.uuid(),
    reason: z.string().trim().min(3).max(1000),
    change: automationChange,
  })
  .strict();
export type AutomationProposal = z.infer<typeof automationProposal>;
export type AutomationGrant = {
  id: string;
  workspaceId: string;
  keyId: string;
  enabled: boolean;
  operations: (typeof automationOperations)[number][];
  version: number;
  updatedAt: string;
  actorId: string;
};
export type AutomationStudy = {
  id: string;
  title: string;
  version: number;
  dataVersion: number;
  revisionId: string | null;
  fielding: string;
  guide: Guide;
  fingerprint: string;
};
export type AutomationPlan = {
  id: string;
  workspaceId: string;
  studyId?: string;
  keyId: string;
  keyVersion: number;
  grantVersion: number;
  proposal: AutomationProposal;
  before?: AutomationStudy;
  published?: {
    revisionId: string;
    title: string;
    questionCount: number;
    limit: number;
    guide: Guide;
  };
  state: "pending" | "applied" | "rejected";
  version: number;
  createdAt: string;
  expiresAt: number;
  decision?: {
    requestId: string;
    hash: string;
    actorId: string;
    actorName: string;
    at: string;
  };
  result?: {
    studyId: string;
    version: number;
    fielding: string;
    revisionId: string | null;
  };
};
