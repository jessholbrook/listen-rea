import { z } from "zod";
import { actor, body, respond, fail, canLaunch } from "./http";
import {
  get,
  put,
  list,
  hash,
  now,
  transaction,
  requireStudy,
  interviews,
} from "./db";
import type { Study, Interview } from "./domain";
import { retention } from "./features";
import type { ParticipantInvitation } from "./recruitment";
import {
  incentiveTermsInput,
  incentiveActionInput,
  incentiveEligibility,
  incentiveStatus,
  type IncentiveSettings,
  type IncentiveRecord,
  type IncentiveEvent,
  type Payment,
} from "./incentives";
import { csv } from "./evidence";
async function settings(s: Study): Promise<IncentiveSettings> {
  return (
    (await get<IncentiveSettings>(
      "incentiveSettings",
      s.id,
      s.workspaceId,
    )) || {
      id: s.id,
      workspaceId: s.workspaceId,
      studyId: s.id,
      version: 0,
      enabled: false,
      amountMinor: 2500,
      currency: "USD",
      description:
        "Complete the interview. The research team reviews eligibility before approving an incentive.",
    }
  );
}
async function roster(s: Study) {
  const [sources, records, invites] = await Promise.all([
    interviews(s),
    list<IncentiveRecord>("incentiveRecord", s.workspaceId, s.id),
    list<ParticipantInvitation>("participantInvitation", s.workspaceId, s.id),
  ]);
  return sources
    .filter((i) => !i.preview && !i.origin)
    .map((i) => {
      const record = records.find((r) => r.interviewId === i.id);
      return {
        interviewId: i.id,
        reference:
          invites.find((v) => v.interviewId === i.id)?.reference ||
          i.id.slice(0, 8),
        responseStatus: i.status,
        excluded: i.excluded,
        completedAt: i.completedAt || null,
        eligibilityReason: incentiveEligibility(i),
        status: incentiveStatus(i, record),
        record: record || null,
      };
    });
}
export async function dispatchIncentives(req: Request, p: string[]) {
  if (p[0] !== "studies" || !p[1] || p[2] !== "incentives") return null;
  await retention();
  const a = await actor(),
    s = await requireStudy(p[1], a);
  if (req.method === "GET" && p.length === 3) {
    const rows = await roster(s),
      totals: Record<string, { approvedMinor: number; paidMinor: number }> = {};
    for (const row of rows) {
      const r = row.record;
      if (!r?.terms) continue;
      const t = (totals[r.terms.currency] ||= {
        approvedMinor: 0,
        paidMinor: 0,
      });
      if (row.status === "approved") t.approvedMinor += r.terms.amountMinor;
      for (const pay of r.payments)
        if (!pay.voidedAt) {
          const pt = (totals[pay.currency] ||= {
            approvedMinor: 0,
            paidMinor: 0,
          });
          pt.paidMinor += pay.amountMinor;
        }
    }
    return respond({
      settings: await settings(s),
      rows,
      totals,
      canManage: a.role !== "collaborator",
    });
  }
  if (req.method === "GET" && p.length === 4 && p[3] === "export") {
    const rows = await roster(s);
    return new Response(
      csv([
        [
          "response_id",
          "participant_reference",
          "response_status",
          "excluded",
          "eligibility_issue",
          "ledger_status",
          "version",
          "terms_version",
          "amount_minor",
          "currency",
          "terms",
          "payments",
          "history",
        ],
        ...rows.map((v) => [
          v.interviewId,
          v.reference,
          v.responseStatus,
          String(v.excluded),
          v.eligibilityReason || "",
          v.status,
          String(v.record?.version || 0),
          String(v.record?.terms?.version || ""),
          String(v.record?.terms?.amountMinor || ""),
          v.record?.terms?.currency || "",
          v.record?.terms?.description || "",
          JSON.stringify(v.record?.payments || []),
          JSON.stringify(v.record?.events || []),
        ]),
      ]),
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="incentive-ledger.csv"',
          "Cache-Control": "private, no-store",
        },
      },
    );
  }
  canLaunch(a);
  if (req.method === "PUT" && p.length === 3) {
    const input = incentiveTermsInput
      .extend({ version: z.number().int().min(0) })
      .parse(await body(req));
    await transaction(async () => {
      const current = await settings(s);
      if (current.version !== input.version)
        fail(409, "Incentive terms changed. Refresh before saving.");
      await put("incentiveSettings", {
        ...current,
        ...input,
        version: current.version + 1,
        updatedAt: now(),
        updatedBy: a.name,
      });
    });
    return respond({ settings: await settings(s) });
  }
  if (req.method === "POST" && p.length === 4) {
    const input = incentiveActionInput.parse(await body(req)),
      fingerprint = hash(JSON.stringify({ interviewId: p[3], ...input })),
      requestKey = s.id + ":" + input.requestId;
    await transaction(async () => {
      const i = await get<Interview>("interview", p[3], a.workspaceId);
      if (!i || i.studyId !== s.id || i.preview || i.origin)
        fail(404, "Participant response not found.");
      const retry = await get<{ fingerprint: string }>(
        "incentiveRequest",
        requestKey,
        a.workspaceId,
      );
      if (retry) {
        if (retry.fingerprint !== fingerprint)
          fail(
            409,
            "This request ID was already used for a different ledger action.",
          );
        return;
      }
      const previous = await get<IncentiveRecord>(
        "incentiveRecord",
        i.id,
        a.workspaceId,
      );
      if ((previous?.version || 0) !== input.version)
        fail(409, "The incentive record changed. Refresh before reviewing it.");
      if ((previous?.events.length || 0) >= 100)
        fail(
          409,
          "This record has reached its review-history limit. Export it for reconciliation.",
        );
      const at = now(),
        r: IncentiveRecord = previous || {
          id: i.id,
          workspaceId: a.workspaceId,
          studyId: s.id,
          interviewId: i.id,
          version: 0,
          state: "pending",
          payments: [],
          events: [],
          createdAt: at,
          updatedAt: at,
        };
      const event: IncentiveEvent = {
        action: input.action,
        at,
        by: a.name,
        reason: input.reason,
      };
      if (input.action === "approve") {
        const terms = await settings(s);
        if (input.termsVersion !== terms.version)
          fail(
            409,
            "Incentive terms changed. Refresh and review the current terms before approving.",
          );
        if (!terms.enabled)
          fail(409, "Enable incentive reviews before approving a response.");
        const why = incentiveEligibility(i);
        if (why) fail(409, why);
        if (r.state === "paid")
          fail(409, "Void the payment record before reviewing it again.");
        if (r.state === "approved")
          fail(409, "This response is already approved.");
        const { enabled, amountMinor, currency, description, version } = terms;
        r.terms = { enabled, amountMinor, currency, description, version };
        r.state = "approved";
        event.terms = r.terms;
      } else if (input.action === "decline") {
        if (r.state === "paid")
          fail(409, "Void the payment record before declining it.");
        r.state = "declined";
      } else if (input.action === "record_payment") {
        if (!input.payment)
          fail(400, "Enter the payment method, reference and date.");
        if (r.state !== "approved" || !r.terms)
          fail(409, "Approve eligibility before recording payment.");
        const why = incentiveEligibility(i);
        if (why) fail(409, why);
        if (Date.parse(input.payment.paidAt) > Date.now() + 60000)
          fail(400, "Payment date cannot be in the future.");
        const receiptId = hash(
          JSON.stringify([
            a.workspaceId,
            input.payment.reference.normalize("NFKC").toLowerCase(),
          ]),
        );
        if (await get("incentiveReceipt", receiptId, a.workspaceId))
          fail(
            409,
            "This payment reference has already been recorded in this workspace, including voided records.",
          );
        const pay: Payment = {
          ...input.payment,
          amountMinor: r.terms.amountMinor,
          currency: r.terms.currency,
          recordedAt: at,
          recordedBy: a.name,
        };
        r.payments.push(pay);
        r.state = "paid";
        event.payment = { ...pay };
        // Content-free deduplication tombstone: no response ID, payment reference or contact information.
        await put("incentiveReceipt", {
          id: receiptId,
          workspaceId: a.workspaceId,
          createdAt: at,
        });
      } else {
        if (r.state !== "paid")
          fail(409, "Only a recorded payment can be voided.");
        const pay = r.payments.findLast((v) => !v.voidedAt);
        if (!pay) fail(409, "No active payment record.");
        pay.voidedAt = at;
        r.state = "voided";
        event.payment = { ...pay };
      }
      r.events.push(event);
      r.version++;
      r.updatedAt = at;
      await put("incentiveRecord", r);
      await put("incentiveRequest", {
        id: requestKey,
        workspaceId: a.workspaceId,
        studyId: s.id,
        interviewId: i.id,
        fingerprint,
        createdAt: at,
      });
    });
    return respond({ ok: true });
  }
  fail(405, "Unsupported incentive ledger action.");
}
