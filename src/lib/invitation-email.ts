import { z } from "zod";
export const emailDraftInput = z.object({
  requestId: z.uuid(),
  invitationId: z.string().length(64),
  kind: z.enum(["invitation", "reminder"]),
  to: z.email().max(254),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .refine((v) => !/[\r\n]/.test(v)),
  message: z.string().trim().min(1).max(5000),
  link: z.string().max(2000),
});
export type EmailPayload = {
  from: string;
  reply_to: string;
  to: string[];
  subject: string;
  text: string;
};
export type InvitationEmail = {
  id: string;
  workspaceId: string;
  studyId: string;
  invitationId: string;
  kind: "invitation" | "reminder";
  version: number;
  createdAt: string;
  createdBy: string;
  state:
    "draft" | "sending" | "accepted" | "failed" | "uncertain" | "cancelled";
  sealed: string;
  fingerprint: string;
  recipientHash: string;
  firstAttemptAt?: string;
  leaseUntil?: number;
  providerKeyHash?: string;
  providerId?: string;
  acceptedAt?: string;
  delivery?: string;
  checkedAt?: string;
  attempts: number;
  error?: string;
};
export function recipientKey(workspaceId: string, email: string) {
  return JSON.stringify([workspaceId, email.trim().toLowerCase()]);
}
export function maskedEmail(email: string) {
  const [local, domain] = email.split("@");
  return local.slice(0, 1) + "***@" + domain;
}
export function emailLinkToken(link: string, origin: string, studyId: string) {
  const u = new URL(link);
  if (
    u.origin !== new URL(origin).origin ||
    u.pathname !== `/s/${studyId}` ||
    u.search ||
    u.username ||
    u.password
  )
    throw new Error("INVALID_EMAIL_LINK");
  const parts = new URLSearchParams(u.hash.slice(1));
  const token = parts.get("invite");
  if (
    [...parts.keys()].length !== 1 ||
    !token ||
    !/^[A-Za-z0-9_-]{43}$/.test(token)
  )
    throw new Error("INVALID_EMAIL_LINK");
  return token;
}
export function reminderIssue(
  kind: InvitationEmail["kind"],
  rows: InvitationEmail[],
  now = Date.now(),
) {
  const pending = rows.some((j) =>
    ["draft", "sending", "uncertain"].includes(j.state),
  );
  if (pending)
    return "Resolve or cancel the existing email draft before creating another.";
  const sent = rows.filter((j) => j.state === "accepted");
  if (kind === "invitation" && sent.length)
    return "An email invitation was already accepted. Use a reminder instead.";
  if (kind === "reminder") {
    if (!sent.some((j) => j.kind === "invitation"))
      return "Send the initial email invitation before a reminder.";
    if (sent.filter((j) => j.kind === "reminder").length >= 3)
      return "This invitation has reached its three-reminder limit.";
    const latest = Math.max(...sent.map((j) => Date.parse(j.acceptedAt!)));
    if (now - latest < 86400000)
      return "Wait at least 24 hours after the last accepted email before reminding.";
  }
  return null;
}
export function retryExpired(j: InvitationEmail, at = Date.now()) {
  return (
    !!j.firstAttemptAt && at - Date.parse(j.firstAttemptAt) >= 23 * 3600000
  );
}
export const stopDelivery = new Set(["bounced", "complained", "suppressed"]);
export const deliveryStates = new Set([
  "sent",
  "delivered",
  "delivery_delayed",
  "bounced",
  "complained",
  "suppressed",
  "failed",
  "opened",
  "clicked",
]);
