import { z } from "zod";
export const tremendousId = z.string().regex(/^[A-Z0-9]{4,20}$/);
export const tremendousPlanInput = z
  .object({
    productId: tremendousId,
    maxValueMinor: z.number().int().min(1).max(1000000),
    note: z.string().trim().min(5).max(1000),
  })
  .strict();
export type TremendousPlan = z.infer<typeof tremendousPlanInput> & {
  id: string;
  workspaceId: string;
  studyId: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
};
export type TremendousOrder = {
  id: string;
  workspaceId: string;
  studyId: string;
  interviewId: string;
  environment: "sandbox";
  externalId: string;
  connectionHash: string;
  incentiveVersion: number;
  planVersion: number;
  amountMinor: number;
  productId: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  state:
    "submitting" | "unknown" | "insufficient_funds" | "rejected" | "observed";
  orderId?: string;
  rewardId?: string;
  orderStatus?: string;
  deliveryStatus?: string;
  totalMinor?: number;
  paymentCurrency?: string;
  lastSyncedAt?: string;
  lastReadAt?: string;
  readVersion?: number;
  claimCount?: number;
  lastClaimAt?: string;
};
export function minorUnits(n: number) {
  const rounded = Math.round(n * 100);
  if (
    !Number.isFinite(n) ||
    n < 0 ||
    Math.abs(n * 100 - rounded) > 0.00001 ||
    !Number.isSafeInteger(rounded)
  )
    throw Error("INVALID_PROVIDER_AMOUNT");
  return rounded;
}
// Parse only the fields we need. Never copy recipient information or redeemable links.
export function orderProjection(value: unknown, expected: TremendousOrder) {
  const result = z
    .object({
      order: z.object({
        id: tremendousId,
        external_id: z.string(),
        status: z.string().min(1).max(80),
        payment: z
          .object({ total: z.number(), currency_code: z.string().max(8) })
          .optional(),
        rewards: z
          .array(
            z.object({
              id: tremendousId,
              order_id: tremendousId.optional(),
              value: z.object({
                denomination: z.number(),
                currency_code: z.string(),
              }),
              delivery: z.object({
                method: z.literal("LINK"),
                status: z.string().max(80).optional(),
              }),
            }),
          )
          .length(1),
      }),
    })
    .parse(value).order;
  const reward = result.rewards[0];
  if (
    result.external_id !== expected.externalId ||
    minorUnits(reward.value.denomination) !== expected.amountMinor ||
    reward.value.currency_code !== "USD" ||
    (expected.orderId && result.id !== expected.orderId) ||
    (expected.rewardId && reward.id !== expected.rewardId) ||
    (reward.order_id && reward.order_id !== result.id)
  )
    throw Error("TREMENDOUS_ORDER_MISMATCH");
  return {
    orderId: result.id,
    rewardId: reward.id,
    orderStatus: result.status,
    deliveryStatus: reward.delivery.status || "UNKNOWN",
    totalMinor: result.payment ? minorUnits(result.payment.total) : undefined,
    paymentCurrency: result.payment?.currency_code,
  };
}
export function sandboxRewardUrl(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.hostname !== "testflight.tremendous.com" ||
    u.port ||
    u.username ||
    u.password ||
    !/^\/rewards\/payout\/[A-Za-z0-9_-]+$/.test(u.pathname) ||
    u.search ||
    u.hash
  )
    throw Error("INVALID_REWARD_LINK");
  return u.href;
}
