import { z } from "zod";
import { db, get, list, put, hash, now, transaction, requireStudy } from "./db";
import { actor, body, fail, participant, respond, limit } from "./http";
import type { Actor, Interview, Study } from "./domain";
import { incentiveEligibility, type IncentiveRecord } from "./incentives";
import { csv } from "./evidence";
import {
  tremendousPlanInput,
  orderProjection,
  sandboxRewardUrl,
  type TremendousPlan,
  type TremendousOrder,
} from "./tremendous";
import {
  tremendousTransport,
  TremendousProviderError,
  type TremendousTransport,
} from "./tremendous-provider";
export const tremendousOrderKey = (
  workspaceId: string,
  studyId: string,
  interviewId: string,
) =>
  hash(
    JSON.stringify(["tremendous-sandbox", workspaceId, studyId, interviewId]),
  );
async function admin(a: Actor) {
  const row = await db
    .prepare("SELECT workspace_id,role FROM users WHERE id=?")
    .get(a.id);
  if (row?.workspace_id !== a.workspaceId || row.role !== "admin")
    fail(
      403,
      "Current workspace admin access is required for sandbox rewards.",
    );
}
async function connection(workspaceId: string, provider: TremendousTransport) {
  const b = provider.binding(workspaceId);
  if (!b)
    fail(
      503,
      "Tremendous sandbox is not connected. Live payouts are unavailable.",
    );
  const orgs = z
    .object({ organizations: z.array(z.object({ id: z.string() })).length(1) })
    .parse(await provider.request(workspaceId, "organizations"));
  if (orgs.organizations[0].id !== b.organizationId)
    fail(
      409,
      "The sandbox organization does not match this workspace connection.",
    );
  return b;
}
async function approved(s: Study, id: string) {
  const i = await get<Interview>("interview", id, s.workspaceId),
    r = await get<IncentiveRecord>("incentiveRecord", id, s.workspaceId);
  if (!i || i.studyId !== s.id) fail(404, "Participant response not found.");
  if (!i.invitationId || i.handoffId || incentiveEligibility(i))
    fail(
      409,
      "Sandbox rewards require a completed, included native interview from our own invitation. Panel and survey handoffs are excluded.",
    );
  if (
    !r ||
    r.studyId !== s.id ||
    r.state !== "approved" ||
    r.terms?.currency !== "USD" ||
    r.payments.some((p) => !p.voidedAt)
  )
    fail(
      409,
      "A current approved USD incentive with no active manual payment is required.",
    );
  return { i, r };
}
async function current(s: Study, o: TremendousOrder) {
  const { r } = await approved(s, o.interviewId);
  if (
    r.version !== o.incentiveVersion ||
    r.terms!.amountMinor !== o.amountMinor
  )
    fail(
      409,
      "Incentive approval changed. The sandbox claim is held; reconcile the existing order, never issue a replacement.",
    );
}
function safeOrder(o: TremendousOrder) {
  const { connectionHash, ...safe } = o;
  return { ...safe, redemptionStatus: "not_observed" };
}
async function syncOrder(o: TremendousOrder, provider: TremendousTransport) {
  const b = await connection(o.workspaceId, provider);
  if (b.hash !== o.connectionHash)
    fail(
      409,
      "Sandbox credentials or organization changed. Reconnect the original binding before reconciliation.",
    );
  let readVersion = 0;
  await transaction(async () => {
    const existing = await get<TremendousOrder>(
        "tremendousOrder",
        o.id,
        o.workspaceId,
      ),
      source = await get<Interview>("interview", o.interviewId, o.workspaceId);
    if (!existing || !source || source.studyId !== o.studyId) return;
    readVersion = (existing.readVersion || 0) + 1;
    await put("tremendousOrder", {
      ...existing,
      readVersion,
      lastReadAt: now(),
    });
  });
  if (!readVersion) return false;
  const projection = orderProjection(
    await provider.request(o.workspaceId, "orders/" + o.externalId),
    o,
  );
  let committed = false;
  await transaction(async () => {
    const existing = await get<TremendousOrder>(
        "tremendousOrder",
        o.id,
        o.workspaceId,
      ),
      source = await get<Interview>("interview", o.interviewId, o.workspaceId);
    if (
      !existing ||
      !source ||
      source.studyId !== o.studyId ||
      existing.readVersion !== readVersion
    )
      return;
    committed = true;
    // Never overwrite another reconciler/claim's metadata, nor restore an erased source.
    await put("tremendousOrder", {
      ...existing,
      ...projection,
      state: "observed",
      lastSyncedAt: now(),
      updatedAt: now(),
    });
  });
  return committed;
}
export async function syncTremendousStudy(
  studyId: string,
  workspaceId: string,
  provider = tremendousTransport,
) {
  const s = await get<Study>("study", studyId, workspaceId);
  if (!s) return;
  const orders = (
    await list<TremendousOrder>("tremendousOrder", workspaceId, studyId)
  )
    .filter(
      (o) =>
        !(!o.orderId && ["insufficient_funds", "rejected"].includes(o.state)),
    )
    .filter(
      (o) =>
        o.state !== "submitting" ||
        Date.now() - Date.parse(o.updatedAt) >= 60000,
    )
    .sort((a, b) =>
      (a.lastReadAt || a.lastSyncedAt || a.createdAt).localeCompare(
        b.lastReadAt || b.lastSyncedAt || b.createdAt,
      ),
    );
  let checked = 0,
    unresolved = 0;
  for (const o of orders.slice(0, 5)) {
    try {
      if (await syncOrder(o, provider)) checked++;
    } catch {
      unresolved++;
    }
  }
  if (unresolved)
    fail(
      409,
      "Some sandbox outcomes remain unresolved. No new order was issued. Reconcile again or inspect the existing reference in Tremendous.",
    );
  return { checked, remaining: Math.max(0, orders.length - 5) };
}
export async function dispatchTremendous(
  req: Request,
  p: string[],
  provider: TremendousTransport = tremendousTransport,
  internalActor?: Actor,
) {
  const participantRoute =
    p[0] === "interviews" &&
    p[1] &&
    p[2] === "sandbox-reward" &&
    p.length === 3;
  if (participantRoute) {
    if (req.method !== "GET" && req.method !== "POST")
      fail(405, "Unsupported reward claim action.");
    const i = await participant(req, p[1]),
      s = await get<Study>("study", i.studyId, i.workspaceId);
    if (!s) fail(404, "Study not found.");
    const id = tremendousOrderKey(i.workspaceId, i.studyId, i.id),
      o = await get<TremendousOrder>("tremendousOrder", id, i.workspaceId);
    const headers = {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    };
    if (!o)
      return Response.json(
        {
          available: false,
          offered:
            !!i.invitationId &&
            !i.handoffId &&
            !!(await get("tremendousPlan", s.id, s.workspaceId)),
          environment: "sandbox",
        },
        { headers },
      );
    await current(s, o);
    if (req.method === "GET")
      return Response.json(
        {
          offered: true,
          available:
            !!provider.binding(i.workspaceId) &&
            o.state === "observed" &&
            o.orderStatus === "EXECUTED",
          environment: "sandbox",
          amountMinor: o.amountMinor,
          currency: "USD",
        },
        { headers },
      );
    z.object({ consent: z.literal(true) })
      .strict()
      .parse(await body(req));
    limit("tremendous-claim:" + o.id, 5);
    if (o.state !== "observed" || o.orderStatus !== "EXECUTED" || !o.rewardId)
      fail(409, "The sandbox reward is not ready. Refresh its status later.");
    if (!(await syncOrder(o, provider)))
      fail(
        409,
        "A newer reconciliation or erasure superseded this claim. Refresh again.",
      );
    let fresh!: TremendousOrder;
    await transaction(async () => {
      const v = await get<TremendousOrder>(
        "tremendousOrder",
        id,
        i.workspaceId,
      );
      if (!v || v.orderStatus !== "EXECUTED" || v.rewardId !== o.rewardId)
        fail(409, "Sandbox reward unavailable.");
      await current(s, v);
      fresh = v;
    });
    const result = z
      .object({
        reward: z.object({ id: z.string(), link: z.string().max(2000) }),
      })
      .parse(
        await provider.request(
          i.workspaceId,
          "rewards/" + fresh.rewardId + "/generate_link",
          "POST",
        ),
      );
    if (result.reward.id !== fresh.rewardId)
      fail(502, "The provider returned a different reward.");
    const url = sandboxRewardUrl(result.reward.link);
    await transaction(async () => {
      const v = await get<TremendousOrder>(
        "tremendousOrder",
        id,
        i.workspaceId,
      );
      if (!v) fail(404, "Sandbox reward unavailable.");
      await current(s, v);
      await put("tremendousOrder", {
        ...v,
        claimCount: (v.claimCount || 0) + 1,
        lastClaimAt: now(),
      });
    });
    return Response.json({ url, environment: "sandbox" }, { headers });
  }
  if (p[0] !== "studies" || !p[1] || p[2] !== "tremendous") return null;
  const a = internalActor || (await actor()),
    s = await requireStudy(p[1], a);
  if (req.method === "GET" && p.length <= 4) {
    const plan = await get<TremendousPlan>(
        "tremendousPlan",
        s.id,
        a.workspaceId,
      ),
      orders = await list<TremendousOrder>(
        "tremendousOrder",
        a.workspaceId,
        s.id,
      ),
      records = await list<IncentiveRecord>(
        "incentiveRecord",
        a.workspaceId,
        s.id,
      ),
      sources = await list<Interview>("interview", a.workspaceId, s.id);
    if (p[3] === "export")
      return new Response(
        csv([
          [
            "environment",
            "response_id",
            "external_id",
            "state",
            "amount_minor",
            "currency",
            "order_id",
            "reward_id",
            "order_status",
            "delivery_status",
            "provider_total_minor",
            "provider_currency",
            "redemption_status",
            "claim_count",
            "last_synced_at",
          ],
          ...orders.map((o) => [
            "sandbox",
            o.interviewId,
            o.externalId,
            o.state,
            String(o.amountMinor),
            "USD",
            o.orderId || "",
            o.rewardId || "",
            o.orderStatus || "",
            o.deliveryStatus || "",
            o.totalMinor === undefined ? "" : String(o.totalMinor),
            o.paymentCurrency || "",
            "not_observed",
            String(o.claimCount || 0),
            o.lastSyncedAt || "",
          ]),
        ]),
        {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="sandbox-rewards.csv"',
            "Cache-Control": "private, no-store",
          },
        },
      );
    if (p.length !== 3) fail(404, "Reward route not found.");
    const eligible = records
      .filter(
        (r) =>
          r.state === "approved" &&
          r.terms?.currency === "USD" &&
          !r.payments.some((v) => !v.voidedAt),
      )
      .filter((r) => {
        const i = sources.find((i) => i.id === r.interviewId);
        return i && i.invitationId && !i.handoffId && !incentiveEligibility(i);
      })
      .map((r) => ({
        interviewId: r.interviewId,
        incentiveVersion: r.version,
        amountMinor: r.terms!.amountMinor,
        currency: "USD",
      }));
    return respond({
      plan: plan || null,
      orders: orders.map(safeOrder),
      eligible,
      connected: !!provider.binding(a.workspaceId),
      canManage: a.role === "admin",
      environment: "sandbox",
      livePayoutsEnabled: false,
      reservedMinor: orders.reduce((n, o) => n + o.amountMinor, 0),
    });
  }
  await admin(a);
  if (req.method === "PUT" && p.length === 3) {
    const input = z
      .object({
        version: z.number().int().min(0),
        plan: tremendousPlanInput,
        reviewed: z.literal(true),
      })
      .strict()
      .parse(await body(req));
    await transaction(async () => {
      await admin(a);
      const existing = await get<TremendousPlan>(
          "tremendousPlan",
          s.id,
          a.workspaceId,
        ),
        orders = await list<TremendousOrder>(
          "tremendousOrder",
          a.workspaceId,
          s.id,
        );
      if ((existing?.version || 0) !== input.version)
        fail(409, "Reward plan changed. Refresh before reviewing.");
      if (
        orders.reduce((n, o) => n + o.amountMinor, 0) > input.plan.maxValueMinor
      )
        fail(409, "The sandbox budget cannot be below reserved face value.");
      await put("tremendousPlan", {
        ...input.plan,
        id: s.id,
        studyId: s.id,
        workspaceId: a.workspaceId,
        version: input.version + 1,
        updatedAt: now(),
        updatedBy: a.name,
      });
    });
    return respond({ ok: true });
  }
  if (req.method !== "POST" || p.length !== 4)
    fail(405, "Unsupported sandbox reward action.");
  if (p[3] === "verify") {
    await connection(a.workspaceId, provider);
    return respond({ verified: true, environment: "sandbox" });
  }
  if (p[3] === "sync") {
    await connection(a.workspaceId, provider);
    const result = await syncTremendousStudy(s.id, a.workspaceId, provider);
    return respond({ ok: true, ...result });
  }
  if (p[3] !== "order" && p[3] !== "retry")
    fail(404, "Reward action not found.");
  const input = z
    .object({
      interviewId: z.uuid(),
      incentiveVersion: z.number().int().positive(),
      planVersion: z.number().int().positive(),
      reviewed: z.literal(true),
    })
    .strict()
    .parse(await body(req));
  // Refuse unconfigured actions before journaling or dispatching provider requests.
  const b = await connection(a.workspaceId, provider),
    id = tremendousOrderKey(a.workspaceId, s.id, input.interviewId);
  const plan = await get<TremendousPlan>("tremendousPlan", s.id, a.workspaceId);
  if (!plan || plan.version !== input.planVersion)
    fail(409, "Review the current sandbox reward plan.");
  const { r } = await approved(s, input.interviewId);
  if (r.version !== input.incentiveVersion)
    fail(409, "Incentive approval changed. Refresh before ordering.");
  const product = z
    .object({
      product: z.object({
        id: z.string(),
        category: z.literal("merchant_card"),
        currency_codes: z.array(z.string()),
        skus: z.array(
          z.object({
            min: z.number().nonnegative(),
            max: z.number().nonnegative(),
            currency_code: z.string(),
          }),
        ),
        countries: z.array(z.object({ abbr: z.string() })),
      }),
    })
    .parse(
      await provider.request(a.workspaceId, "products/" + plan.productId),
    ).product;
  const amount = r.terms!.amountMinor / 100;
  if (
    product.id !== plan.productId ||
    !product.currency_codes.includes("USD") ||
    !product.countries.some((c) => c.abbr === "US") ||
    !product.skus.some(
      (v) => v.currency_code === "USD" && v.min <= amount && amount <= v.max,
    )
  )
    fail(
      409,
      "Select a US merchant gift card supporting the approved USD amount.",
    );
  let order!: TremendousOrder,
    dispatch = false;
  await transaction(async () => {
    await admin(a);
    const freshPlan = await get<TremendousPlan>(
        "tremendousPlan",
        s.id,
        a.workspaceId,
      ),
      { r } = await approved(s, input.interviewId);
    if (
      freshPlan?.version !== input.planVersion ||
      r.version !== input.incentiveVersion ||
      provider.binding(a.workspaceId)?.hash !== b.hash
    )
      fail(409, "The reviewed source, plan or sandbox connection changed.");
    const old = await get<TremendousOrder>(
      "tremendousOrder",
      id,
      a.workspaceId,
    );
    if (old) {
      if (
        old.connectionHash !== b.hash ||
        old.incentiveVersion !== input.incentiveVersion ||
        old.planVersion !== input.planVersion
      )
        fail(
          409,
          "This obligation already has a sandbox order. Reconcile it; do not issue a replacement.",
        );
      order = old;
      if (p[3] !== "retry") return;
      if (!["insufficient_funds", "rejected"].includes(old.state))
        fail(
          409,
          "Only a definitively rejected order can be retried. Resolve unknown outcomes with provider reads.",
        );
      order = { ...old, state: "submitting", updatedAt: now() };
    } else {
      if (p[3] === "retry") fail(404, "No sandbox order to retry.");
      if (await get("tremendousSpent", id, a.workspaceId))
        fail(
          409,
          "This sandbox obligation has already been reserved or erased.",
        );
      const orders = await list<TremendousOrder>(
        "tremendousOrder",
        a.workspaceId,
        s.id,
      );
      if (
        orders.length >= 100 ||
        orders.reduce((n, o) => n + o.amountMinor, 0) + r.terms!.amountMinor >
          freshPlan.maxValueMinor
      )
        fail(
          409,
          "The reviewed sandbox face-value budget or 100-order limit would be exceeded.",
        );
      order = {
        id,
        workspaceId: a.workspaceId,
        studyId: s.id,
        interviewId: input.interviewId,
        environment: "sandbox",
        externalId: "echo_sb_" + id,
        connectionHash: b.hash,
        incentiveVersion: r.version,
        planVersion: freshPlan.version,
        amountMinor: r.terms!.amountMinor,
        productId: freshPlan.productId,
        state: "submitting",
        createdAt: now(),
        createdBy: a.name,
        updatedAt: now(),
      };
      await put("tremendousSpent", {
        id,
        workspaceId: a.workspaceId,
        createdAt: now(),
      });
    }
    await put("tremendousOrder", order);
    dispatch = true;
  });
  if (!dispatch) return respond({ order: safeOrder(order), retried: true });
  let outcome: Partial<TremendousOrder>;
  try {
    const data = await provider.request(a.workspaceId, "orders", "POST", {
      external_id: order.externalId,
      payment: { funding_source_id: "BALANCE" },
      reward: {
        value: { denomination: order.amountMinor / 100, currency_code: "USD" },
        products: [order.productId],
        recipient: { name: "Research participant" },
        delivery: { method: "LINK" },
      },
    });
    outcome = {
      ...orderProjection(data, order),
      state: "observed",
      lastSyncedAt: now(),
    };
  } catch (e) {
    outcome = {
      state:
        e instanceof TremendousProviderError && e.status === 402
          ? "insufficient_funds"
          : e instanceof TremendousProviderError &&
              [400, 401, 403, 422, 429].includes(e.status)
            ? "rejected"
            : "unknown",
    };
  }
  await transaction(async () => {
    const existing = await get<TremendousOrder>(
        "tremendousOrder",
        id,
        a.workspaceId,
      ),
      source = await get<Interview>(
        "interview",
        input.interviewId,
        a.workspaceId,
      );
    if (existing && source && source.studyId === s.id) {
      order = existing.readVersion
        ? existing
        : { ...existing, ...outcome, updatedAt: now() };
      await put("tremendousOrder", order);
    } else
      fail(
        409,
        "The source was erased while the provider request was in progress. No claim or source data was restored.",
      );
  });
  return respond({ order: safeOrder(order) });
}
