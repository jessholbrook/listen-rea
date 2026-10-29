import { z } from "zod";
export const reconciliationResources = [
  "study",
  "response",
  "analysis",
] as const;
export const reconciliationRef = z
  .object({
    resource: z.enum(reconciliationResources),
    studyId: z.uuid(),
    id: z.uuid(),
  })
  .strict();
export const reconciliationStart = z
  .object({
    requestId: z.uuid(),
    studyIds: z.array(z.uuid()).min(1).max(50),
    resources: z.array(z.enum(reconciliationResources)).min(1).max(3),
    pageSize: z.number().int().min(1).max(100).default(50),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      new Set(v.studyIds).size !== v.studyIds.length ||
      new Set(v.resources).size !== v.resources.length
    )
      c.addIssue({
        code: "custom",
        message: "Choose unique studies and resources.",
      });
  });
export const reconciliationCheck = z
  .object({ items: z.array(reconciliationRef).min(1).max(100) })
  .strict();
export const reconciliationCheckpoint = z
  .object({
    requestId: z.uuid(),
    version: z.number().int().positive(),
    position: z.number().int().min(0),
    pageToken: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type ReconciliationRef = z.infer<typeof reconciliationRef>;
export type ReconciliationGrant = {
  id: string;
  workspaceId: string;
  keyId: string;
  enabled: boolean;
  version: number;
  limit24h: number;
  actorId: string;
  updatedAt: string;
};
export type ReconciliationEntry = ReconciliationRef & {
  etag: string;
  confirmedEtag?: string | null;
};
export type ReconciliationRun = {
  id: string;
  workspaceId: string;
  keyId: string;
  scopeHash: string;
  studyIds: string[];
  resources: ReconciliationRef["resource"][];
  pageSize: number;
  entries: ReconciliationEntry[];
  position: number;
  version: number;
  state: "active" | "complete" | "needs_rescan";
  createdAt: string;
  expiresAt: number;
  updatedAt: string;
  checkpoints: {
    requestId: string;
    digest: string;
    version: number;
    position: number;
    state: ReconciliationRun["state"];
  }[];
};
export const reconciliationIdentity = (r: ReconciliationRef) =>
  r.resource + ":" + r.studyId + ":" + r.id;
