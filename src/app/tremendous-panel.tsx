"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { money } from "@/lib/incentives";
import type { TremendousOrder, TremendousPlan } from "@/lib/tremendous";
type Data = {
  plan: TremendousPlan | null;
  orders: TremendousOrder[];
  eligible: {
    interviewId: string;
    incentiveVersion: number;
    amountMinor: number;
  }[];
  reservedMinor: number;
  connected: boolean;
  canManage: boolean;
};
export default function TremendousPanel({
  studyId,
  dataVersion,
}: {
  studyId: string;
  dataVersion?: number;
}) {
  const root = `studies/${studyId}/tremendous`,
    [data, setData] = useState<Data | null>(null),
    [productId, setProduct] = useState(""),
    [budget, setBudget] = useState(10000),
    [note, setNote] = useState(
      "Reviewed sandbox gift-card test for our own invitees.",
    ),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function load() {
    const v = await api(root);
    setData(v);
    return v as Data;
  }
  useEffect(() => {
    let live = true;
    api(root)
      .then((v) => {
        if (!live) return;
        setData(v);
        if (v.plan) {
          setProduct(v.plan.productId);
          setBudget(v.plan.maxValueMinor);
          setNote(v.plan.note);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [root, dataVersion]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const dirty =
    !data?.plan ||
    productId !== data.plan.productId ||
    budget !== data.plan.maxValueMinor ||
    note !== data.plan.note;
  return (
    <section
      className="panel visual-stack tremendous-panel"
      aria-label="Tremendous sandbox rewards"
    >
      <div>
        <div className="eyebrow">INCENTIVES · SANDBOX</div>
        <h3>Tremendous reward links</h3>
      </div>
      <p>
        Test reward links for participants recruited through your own Echo Lab
        invitations. Sandbox rewards have no monetary value. Live payouts are
        unavailable.
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!data ? (
        <p>Loading sandbox rewards…</p>
      ) : (
        <>
          <p className="muted">
            {data.connected
              ? "Sandbox connection configured. Verify the organization before testing."
              : "Sandbox is not connected. You can save a reviewed plan now; an admin can connect a Tremendous sandbox account later."}
          </p>
          <form
            className="visual-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api(root, "PUT", {
                  version: data.plan?.version || 0,
                  plan: { productId, maxValueMinor: budget, note },
                  reviewed,
                });
                setReviewed(false);
                setMessage("Sandbox plan saved.");
              });
            }}
          >
            <label>
              Sandbox product ID
              <input
                required
                pattern="[A-Z0-9]{4,20}"
                maxLength={20}
                value={productId}
                onChange={(e) => {
                  setProduct(e.target.value.toUpperCase());
                  setReviewed(false);
                }}
                disabled={!data.canManage || busy}
              />
            </label>
            <small>
              One US merchant gift card supporting the approved USD amount.
              Product availability is checked with Tremendous before each order.
            </small>
            <label>
              Sandbox face-value budget (USD cents)
              <input
                type="number"
                required
                min={1}
                max={1000000}
                value={budget}
                onChange={(e) => {
                  setBudget(Number(e.target.value));
                  setReviewed(false);
                }}
                disabled={!data.canManage || busy}
              />
            </label>
            <label>
              Plan note
              <textarea
                required
                minLength={5}
                maxLength={1000}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setReviewed(false);
                }}
                disabled={!data.canManage || busy}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
                disabled={!data.canManage || busy}
              />{" "}
              I reviewed this sandbox product, USD face-value budget and
              simulated balance funding.
            </label>
            <button
              className="button"
              disabled={busy || !data.canManage || !reviewed}
            >
              Save sandbox plan
            </button>
          </form>
          <p>
            Reserved face value:{" "}
            <strong>{money(data.reservedMinor, "USD")}</strong> /{" "}
            {money(data.plan?.maxValueMinor || 0, "USD")}. Reservations include
            unknown and failed orders. This is a simulated face-value limit;
            reported provider costs are shown separately.
          </p>
          <div className="button-row">
            <button
              className="button"
              disabled={busy || !data.canManage || !data.connected}
              onClick={() =>
                void run(async () => {
                  await api(root + "/verify", "POST", {});
                  setMessage("Sandbox organization verified.");
                })
              }
            >
              Verify sandbox connection
            </button>
            <button
              className="button"
              disabled={busy || !data.canManage || !data.connected}
              onClick={() =>
                void run(async () => {
                  const result = await api(root + "/sync", "POST", {});
                  setMessage(
                    `Reconciled ${result.checked || 0} sandbox orders. ${result.remaining || 0} remain for the next refresh.`,
                  );
                })
              }
            >
              Reconcile sandbox orders
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await load();
                })
              }
            >
              Refresh approvals
            </button>
            <a className="button" href={`/api/${root}/export`}>
              Export sandbox reconciliation
            </a>
          </div>
          <p>
            Approve a completed USD incentive in the ledger first. Only our own
            invited participants qualify; panel and survey handoffs are
            excluded. A sandbox order never marks the real incentive paid.
          </p>
          {data.eligible
            .filter(
              (r) => !data.orders.some((o) => o.interviewId === r.interviewId),
            )
            .map((r) => (
              <div className="panel visual-stack" key={r.interviewId}>
                <strong>
                  Response {r.interviewId.slice(0, 8)} ·{" "}
                  {money(r.amountMinor, "USD")}
                </strong>
                <button
                  className="button"
                  disabled={
                    busy ||
                    !data.canManage ||
                    !data.connected ||
                    !data.plan ||
                    dirty ||
                    !reviewed
                  }
                  onClick={() =>
                    void run(async () => {
                      await api(root + "/order", "POST", {
                        interviewId: r.interviewId,
                        incentiveVersion: r.incentiveVersion,
                        planVersion: data.plan!.version,
                        reviewed,
                      });
                      setReviewed(false);
                      setMessage(
                        "Sandbox order receipt saved. Review its status below.",
                      );
                    })
                  }
                >
                  Create sandbox reward
                </button>
              </div>
            ))}
          {!data.orders.length && <p>No sandbox orders yet.</p>}
          {data.orders.map((o) => (
            <div className="panel visual-stack" key={o.id}>
              <strong>
                Response {o.interviewId.slice(0, 8)} ·{" "}
                {money(o.amountMinor, "USD")} · SANDBOX
              </strong>
              <dl>
                <dt>Operation</dt>
                <dd>{o.state.replaceAll("_", " ")}</dd>
                <dt>Provider order / delivery</dt>
                <dd>
                  {o.orderStatus || "Not observed"} /{" "}
                  {o.deliveryStatus || "Not observed"}
                </dd>
                <dt>Reported provider cost</dt>
                <dd>
                  {o.totalMinor === undefined
                    ? "Not reported"
                    : money(o.totalMinor, o.paymentCurrency || "USD")}
                </dd>
                <dt>Participant link views</dt>
                <dd>{o.claimCount || 0}</dd>
                <dt>Redemption</dt>
                <dd>
                  Not observed. An executed order or active link does not prove
                  redemption.
                </dd>
              </dl>
              <small>
                Order {o.orderId || "not resolved"} · Reward{" "}
                {o.rewardId || "not resolved"} · Last sync{" "}
                {o.lastSyncedAt
                  ? new Date(o.lastSyncedAt).toLocaleString()
                  : "not observed"}
              </small>
              {["unknown", "submitting"].includes(o.state) && (
                <p>
                  The outcome is unresolved. Reconcile the existing external
                  reference; do not create a replacement.
                </p>
              )}
              {["insufficient_funds", "rejected"].includes(o.state) && (
                <button
                  className="button"
                  disabled={
                    busy ||
                    !data.canManage ||
                    !data.connected ||
                    !reviewed ||
                    dirty ||
                    o.planVersion !== data.plan?.version
                  }
                  onClick={() =>
                    void run(async () => {
                      await api(root + "/retry", "POST", {
                        interviewId: o.interviewId,
                        incentiveVersion: o.incentiveVersion,
                        planVersion: o.planVersion,
                        reviewed,
                      });
                      setReviewed(false);
                    })
                  }
                >
                  Retry same rejected sandbox order
                </button>
              )}
            </div>
          ))}
          <p className="muted small">
            Participants return in their original browser to check their sandbox
            reward after approval. Redeemable links are never shown to
            researchers or included in exports. Erasing a response removes its
            local order/claim data but cannot revoke links already disclosed by
            Tremendous.
          </p>
        </>
      )}
    </section>
  );
}
