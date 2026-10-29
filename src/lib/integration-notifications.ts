import { z } from "zod";
export const notificationTypes = [
  "study.changed",
  "response.changed",
  "job.changed",
] as const;
export type NotificationType = (typeof notificationTypes)[number];
export function notificationUrl(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    (u.port && u.port !== "443") ||
    !u.hostname.includes(".") ||
    u.hostname.endsWith(".") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) ||
    u.hostname.includes(":") ||
    /\.(?:localhost|local|internal|test|invalid)$/.test(u.hostname)
  )
    throw Error("INVALID_NOTIFICATION_URL");
  return u.href;
}
export const notificationConfig = z
  .object({
    name: z.string().trim().min(2).max(80),
    url: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .refine((v) => {
        try {
          notificationUrl(v);
          return true;
        } catch {
          return false;
        }
      }, "Use a public HTTPS URL without credentials, query, fragment or a custom port.")
      .transform(notificationUrl),
    studyIds: z.array(z.uuid()).min(1).max(50),
    eventTypes: z.array(z.enum(notificationTypes)).min(1).max(3),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      new Set(v.studyIds).size !== v.studyIds.length ||
      new Set(v.eventTypes).size !== v.eventTypes.length
    )
      c.addIssue({
        code: "custom",
        message: "Choose unique studies and event types.",
      });
  });
export type NotificationEndpoint = z.infer<typeof notificationConfig> & {
  id: string;
  workspaceId: string;
  version: number;
  enabled: boolean;
  sealedKey: string;
  authorizedById: string;
  createdAt: string;
  updatedAt: string;
  verifiedAt?: string;
  sequence: number;
  dropped: number;
  lastDroppedAt?: string;
  rotationRequest?: string;
};
export type NotificationPayload = {
  id: string;
  type: NotificationType;
  occurredAt: string;
  sequence: number;
  data: {
    studyId: string;
    id: string;
    version: number;
    dataVersion?: number;
    revisionId?: string | null;
    fielding?: string;
    status?: string;
    kind?: string;
  };
};
export type NotificationDelivery = {
  id: string;
  workspaceId: string;
  studyId: string;
  endpointId: string;
  endpointVersion: number;
  payload?: NotificationPayload;
  eventId: string;
  eventType: NotificationType;
  state: "pending" | "sending" | "delivered" | "failed" | "cancelled";
  version: number;
  attempts: number;
  cycleAttempts: number;
  manualRetries: number;
  createdAt: string;
  updatedAt: string;
  nextAt: number;
  leaseUntil?: number;
  attemptToken?: string;
  httpStatus?: number;
  error?: "http" | "network" | "source" | "revoked" | "expired";
  manualRequest?: string;
};
export type NotificationWake = {
  id: string;
  workspaceId: string;
  generation: string;
  leaseUntil?: number;
  leaseToken?: string;
  nextAt: number;
};
export function notificationProjection(
  kind: string,
  before: any,
  after: any,
): Omit<NotificationPayload, "id" | "sequence" | "occurredAt"> | null {
  if (kind === "study") {
    const data = {
      studyId: after.id,
      id: after.id,
      version: after.version,
      dataVersion: after.dataVersion,
      revisionId: after.revisionId,
      fielding: after.fielding,
    };
    const old = before && {
      studyId: before.id,
      id: before.id,
      version: before.version,
      dataVersion: before.dataVersion,
      revisionId: before.revisionId,
      fielding: before.fielding,
    };
    return JSON.stringify(old) === JSON.stringify(data)
      ? null
      : { type: "study.changed", data };
  }
  if (
    kind === "interview" &&
    !after.preview &&
    !after.excluded &&
    after.status === "complete"
  ) {
    if (
      before &&
      !before.excluded &&
      !before.preview &&
      before.status === "complete" &&
      before.version === after.version
    )
      return null;
    return {
      type: "response.changed",
      data: {
        studyId: after.studyId,
        id: after.id,
        version: after.version,
        status: "complete",
      },
    };
  }
  if (kind === "backgroundJob" && before?.state !== after.state)
    return {
      type: "job.changed",
      data: {
        studyId: after.studyId,
        id: after.id,
        version: after.version,
        status: after.state,
        kind: after.kind,
      },
    };
  return null;
}
