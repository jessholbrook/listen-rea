"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import {
  money,
  type IncentiveSettings,
  type IncentiveRecord,
} from "@/lib/incentives";
import { Modal, Spinner } from "./components";
type Row = {
  interviewId: string;
  reference: string;
  responseStatus: string;
  excluded: boolean;
  completedAt: string | null;
  eligibilityReason: string | null;
  status: string;
  record: IncentiveRecord | null;
};
type Data = {
  settings: IncentiveSettings;
  rows: Row[];
  totals: Record<string, { approvedMinor: number; paidMinor: number }>;
  canManage: boolean;
};
const labels: Record<string, string> = {
  needs_review: "Needs review",
  ineligible: "Ineligible",
  approved: "Approved, unpaid",
  declined: "Declined",
  paid: "Payment recorded",
  voided: "Payment voided",
};
export default function IncentivesPanel({
  studyId,
  dataVersion,
}: {
  studyId: string;
  dataVersion: number;
}) {
  const [data, setData] = useState<Data | null>(null),
    [terms, setTerms] = useState<IncentiveSettings | null>(null),
    [amount, setAmount] = useState("25.00"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("all"),
    [notice, setNotice] = useState("");
  const [review, setReview] = useState<{
      row: Row;
      action: "approve" | "decline" | "record_payment" | "void_payment";
    } | null>(null),
    [reason, setReason] = useState(""),
    [reference, setReference] = useState(""),
    [method, setMethod] = useState("bank_transfer"),
    [paidDate, setPaidDate] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [history, setHistory] = useState<Row | null>(null);
  const pending = useRef<{
      semantic: string;
      id: string;
      paymentAt?: string;
    } | null>(null),
    root = `studies/${studyId}/incentives`;
  async function load() {
    const d = await api<Data>(root);
    setData(d);
    setTerms(d.settings);
    setAmount((d.settings.amountMinor / 100).toFixed(2));
  }
  useEffect(() => {
    let active = true;
    setData(null);
    setReview(null);
    setHistory(null);
    pending.current = null;
    api<Data>(root)
      .then((d) => {
        if (active) {
          setData(d);
          setTerms(d.settings);
          setAmount((d.settings.amountMinor / 100).toFixed(2));
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [studyId, dataVersion]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function open(row: Row, action: NonNullable<typeof review>["action"]) {
    setReason("");
    setReference("");
    setConfirmed(false);
    setPaidDate(new Date().toISOString().slice(0, 10));
    setReview({ row, action });
    setError("");
  }
  async function act() {
    if (!review) return;
    const payload = {
      version: review.row.record?.version || 0,
      action: review.action,
      reason,
      ...(review.action === "approve"
        ? { termsVersion: data?.settings.version }
        : {}),
      ...(review.action === "record_payment"
        ? {
            payment: {
              reference,
              method,
              paidAt: new Date(paidDate + "T12:00:00Z").toISOString(),
            },
          }
        : {}),
    };
    const semantic = JSON.stringify({ id: review.row.interviewId, ...payload });
    if (!pending.current || pending.current.semantic !== semantic)
      pending.current = {
        semantic,
        id: crypto.randomUUID(),
        paymentAt:
          paidDate === new Date().toISOString().slice(0, 10)
            ? new Date().toISOString()
            : new Date(paidDate + "T12:00:00Z").toISOString(),
      };
    if ("payment" in payload && payload.payment)
      payload.payment.paidAt = pending.current.paymentAt!;
    await api(root + "/" + review.row.interviewId, "POST", {
      ...payload,
      requestId: pending.current.id,
    });
    await load();
    pending.current = null;
    setReview(null);
    setNotice("Incentive ledger updated. No money was sent.");
  }
  return (
    <section className="panel visual-stack recruitment-panel">
      <div className="panel-heading">
        <h2>Participant incentives</h2>
        <button className="button" disabled={busy} onClick={() => run(load)}>
          Refresh incentives
        </button>
      </div>
      <p>
        Review completed, included interviews and track incentives paid through
        your own process. Echo Lab does not send payments. Approval does not
        verify participant identity or replace your payment provider’s checks.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!data || !terms ? (
        !error && <Spinner />
      ) : (
        <>
          {!data.canManage && (
            <p>
              A researcher or admin must approve incentives and record payments.
            </p>
          )}
          <details>
            <summary>Incentive review terms</summary>
            <form
              className="visual-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  if (!/^\d+(\.\d{1,2})?$/.test(amount))
                    throw new Error(
                      "Enter an amount with at most two decimal places.",
                    );
                  const [whole, fraction = ""] = amount.split(".");
                  const amountMinor =
                    Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
                  await api(root, "PUT", { ...terms, amountMinor });
                  await load();
                  setNotice(
                    "Review terms saved. Existing approvals keep their agreed amount and currency.",
                  );
                });
              }}
            >
              <label>
                <input
                  type="checkbox"
                  checked={terms.enabled}
                  disabled={busy || !data.canManage}
                  onChange={(e) =>
                    setTerms({ ...terms, enabled: e.target.checked })
                  }
                />{" "}
                Enable incentive reviews
              </label>
              <div className="mixed-grid">
                <label>
                  Incentive amount
                  <input
                    required
                    inputMode="decimal"
                    value={amount}
                    disabled={busy || !data.canManage}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <label>
                  Incentive currency
                  <select
                    aria-label="Incentive currency"
                    value={terms.currency}
                    disabled={busy || !data.canManage}
                    onChange={(e) =>
                      setTerms({
                        ...terms,
                        currency: e.target
                          .value as IncentiveSettings["currency"],
                      })
                    }
                  >
                    {["USD", "EUR", "GBP", "CAD", "AUD"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Eligibility and review terms
                <textarea
                  required
                  maxLength={1000}
                  aria-label="Eligibility and review terms"
                  value={terms.description}
                  disabled={busy || !data.canManage}
                  onChange={(e) =>
                    setTerms({ ...terms, description: e.target.value })
                  }
                />
              </label>
              <p>
                These are internal review terms, not an offer shown to
                participants. Communicate any promised incentive yourself. Only
                completed, included native interviews can be approved. Changing
                or disabling these terms leaves earlier approvals intact;
                eligibility is checked again before payment is recorded.
              </p>
              <button
                className="button primary"
                disabled={busy || !data.canManage}
              >
                Save incentive terms
              </button>
            </form>
          </details>
          <div className="visual-stack">
            {Object.entries(data.totals).map(([currency, t]) => (
              <p key={currency}>
                {currency}: {money(t.approvedMinor, currency)} approved and
                unpaid · {money(t.paidMinor, currency)} recorded paid
              </p>
            ))}
          </div>
          <div className="button-row">
            <label>
              Incentive status
              <select
                aria-label="Incentive status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">All responses</option>
                {Object.entries(labels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <a className="button" href={"/api/" + root + "/export"}>
              Export incentive ledger
            </a>
          </div>
          <p>
            Totals are separate by currency and omit voided payments. Excluded
            responses with recorded payments remain in paid totals and show a
            warning. Record a unique transaction or gift-card reference; do not
            enter bank details, card numbers or participant contact information.
          </p>
          {!data.rows.length ? (
            <p>No participant responses to review yet.</p>
          ) : (
            <div className="pricing-table">
              <table>
                <thead>
                  <tr>
                    <th>Participant / response</th>
                    <th>Eligibility</th>
                    <th>Ledger status</th>
                    <th>Amount</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows
                    .filter((r) => status === "all" || r.status === status)
                    .map((row) => (
                      <tr key={row.interviewId}>
                        <td>
                          {row.reference}
                          <small>{row.interviewId.slice(0, 8)}</small>
                          <a href={`/?study=${studyId}&tab=responses`}>
                            Review responses
                          </a>
                        </td>
                        <td>
                          {row.eligibilityReason || "Complete and included"}
                          <small>{row.responseStatus}</small>
                        </td>
                        <td>
                          {labels[row.status]}
                          {row.record?.state === "approved" &&
                            row.eligibilityReason && (
                              <small>Approval held: eligibility changed</small>
                            )}
                        </td>
                        <td>
                          {row.record?.terms
                            ? money(
                                row.record.terms.amountMinor,
                                row.record.terms.currency,
                              )
                            : "Not approved"}
                        </td>
                        <td>
                          <div className="recruitment-actions">
                            <button
                              className="button"
                              disabled={
                                busy ||
                                !data.canManage ||
                                !!row.eligibilityReason ||
                                !data.settings.enabled ||
                                row.record?.state === "paid" ||
                                row.record?.state === "approved"
                              }
                              onClick={() => open(row, "approve")}
                            >
                              Approve incentive
                            </button>
                            <button
                              className="button"
                              disabled={
                                busy ||
                                !data.canManage ||
                                row.record?.state === "paid"
                              }
                              onClick={() => open(row, "decline")}
                            >
                              Decline incentive
                            </button>
                            <button
                              className="button"
                              disabled={
                                busy ||
                                !data.canManage ||
                                row.status !== "approved"
                              }
                              onClick={() => open(row, "record_payment")}
                            >
                              Record payment
                            </button>
                            <button
                              className="button"
                              disabled={
                                busy ||
                                !data.canManage ||
                                row.record?.state !== "paid"
                              }
                              onClick={() => open(row, "void_payment")}
                            >
                              Void payment record
                            </button>
                            <button
                              className="button"
                              disabled={!row.record}
                              onClick={() => setHistory(row)}
                            >
                              View incentive history
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          <p>
            Deleting a source response also deletes its linked incentive ledger,
            references and review history. Export for reconciliation first if
            needed. A reference hash with no response link is retained to
            prevent accidental reuse. Downloaded exports and your external
            payments are outside application deletion.
          </p>
        </>
      )}
      {review && data && (
        <Modal
          title={
            {
              approve: "Approve incentive",
              decline: "Decline incentive",
              record_payment: "Record payment sent elsewhere",
              void_payment: "Void payment record",
            }[review.action]
          }
          onClose={() => {
            if (!busy) setReview(null);
          }}
        >
          <form
            className="visual-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(act);
            }}
          >
            <p>
              {review.row.reference} ·{" "}
              {review.action === "approve"
                ? money(data.settings.amountMinor, data.settings.currency)
                : review.row.record?.terms
                  ? money(
                      review.row.record.terms.amountMinor,
                      review.row.record.terms.currency,
                    )
                  : "No approved amount"}
            </p>
            {review.action === "approve" && <p>{data.settings.description}</p>}
            {review.action === "void_payment" && (
              <p>
                This corrects the ledger only. It does not cancel a transfer or
                refund money. Reapproval and a new payment reference are
                required to record a replacement.
              </p>
            )}
            {review.action === "record_payment" && (
              <>
                <label>
                  Payment reference
                  <input
                    required
                    maxLength={120}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </label>
                <label>
                  Payment method
                  <select
                    aria-label="Payment method"
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                  >
                    <option value="bank_transfer">Bank transfer</option>
                    <option value="gift_card">Gift card</option>
                    <option value="cash">Cash</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label>
                  Payment date (UTC)
                  <input
                    required
                    type="date"
                    max={new Date().toISOString().slice(0, 10)}
                    value={paidDate}
                    onChange={(e) => setPaidDate(e.target.value)}
                  />
                </label>
                <label>
                  <input
                    required
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />{" "}
                  I confirm this payment was sent outside Echo Lab. Recording it
                  will not send money.
                </label>
              </>
            )}
            <label>
              Review or reconciliation reason
              <textarea
                required
                maxLength={1000}
                aria-label="Review or reconciliation reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button
              className="button primary"
              disabled={
                busy ||
                !reason.trim() ||
                (review.action === "record_payment" && !confirmed)
              }
            >
              {
                {
                  approve: "Confirm incentive approval",
                  decline: "Confirm incentive decline",
                  record_payment: "Confirm payment record",
                  void_payment: "Confirm void record",
                }[review.action]
              }
            </button>
            {error && <p role="alert">{error}</p>}
          </form>
        </Modal>
      )}
      {history && (
        <Modal
          title="Incentive review history"
          onClose={() => setHistory(null)}
        >
          <p>{history.reference}</p>
          {history.record?.events.map((e, n) => (
            <div className="panel visual-stack" key={n}>
              <strong>{e.action.replaceAll("_", " ")}</strong>
              <small>
                {new Date(e.at).toLocaleString()} · {e.by}
              </small>
              <p>{e.reason}</p>
              {e.terms && (
                <p>
                  Terms v{e.terms.version}:{" "}
                  {money(e.terms.amountMinor, e.terms.currency)} ·{" "}
                  {e.terms.description}
                </p>
              )}
              {e.payment && (
                <p>
                  {money(e.payment.amountMinor, e.payment.currency)} ·{" "}
                  {e.payment.method.replaceAll("_", " ")} ·{" "}
                  {e.payment.reference} · {e.payment.paidAt}
                </p>
              )}
            </div>
          ))}
        </Modal>
      )}
    </section>
  );
}
