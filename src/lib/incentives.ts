import { z } from "zod";
import type { Interview } from "./domain";
export const incentiveTermsInput = z.object({
  enabled: z.boolean(),
  amountMinor: z.number().int().min(1).max(10000000),
  currency: z.enum(["USD", "EUR", "GBP", "CAD", "AUD"]),
  description: z.string().trim().min(1).max(1000),
});
export type IncentiveTerms = z.infer<typeof incentiveTermsInput>;
export type IncentiveSettings = IncentiveTerms & {
  id: string;
  workspaceId: string;
  studyId: string;
  version: number;
  updatedAt?: string;
  updatedBy?: string;
};
export type Payment = {
  amountMinor: number;
  currency: IncentiveTerms["currency"];
  method: string;
  reference: string;
  paidAt: string;
  recordedAt: string;
  recordedBy: string;
  voidedAt?: string;
};
export type IncentiveEvent = {
  action: string;
  at: string;
  by: string;
  reason: string;
  terms?: IncentiveTerms & { version: number };
  payment?: Payment;
};
export type IncentiveRecord = {
  id: string;
  workspaceId: string;
  studyId: string;
  interviewId: string;
  version: number;
  state: "pending" | "approved" | "declined" | "paid" | "voided";
  terms?: IncentiveTerms & { version: number };
  payments: Payment[];
  events: IncentiveEvent[];
  createdAt: string;
  updatedAt: string;
};
export function incentiveEligibility(i: Interview) {
  if (i.preview || i.origin)
    return "Only native participant interviews are eligible.";
  if (i.status !== "complete") return "The interview must be complete.";
  if (i.excluded) return "The response is excluded from analysis.";
  return null;
}
export function incentiveStatus(i: Interview, r?: IncentiveRecord) {
  if (r?.state === "paid") return "paid";
  if (r?.state === "declined") return "declined";
  if (r?.state === "voided") return "voided";
  if (incentiveEligibility(i)) return "ineligible";
  return r?.state === "approved" ? "approved" : "needs_review";
}
export function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(
    amountMinor / 100,
  );
}
export const incentiveActionInput = z.object({
  requestId: z.uuid(),
  version: z.number().int().min(0),
  action: z.enum(["approve", "decline", "record_payment", "void_payment"]),
  termsVersion: z.number().int().min(1).optional(),
  reason: z.string().trim().min(1).max(1000),
  payment: z
    .object({
      reference: z.string().trim().min(1).max(120),
      method: z.enum(["bank_transfer", "gift_card", "cash", "other"]),
      paidAt: z.iso.datetime({ offset: true }),
    })
    .optional(),
});
