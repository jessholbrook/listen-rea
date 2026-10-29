"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { Guide } from "@/lib/domain";
import type {
  ProlificInput,
  ProlificConfig,
  ProlificOperation,
  ProlificSubmission,
} from "@/lib/prolific";
type Config = Omit<ProlificConfig, "quote"> & {
  quote: {
    id: string;
    totalMinor: number;
    currency: string;
    expiresAt: number;
  } | null;
};
type Data = {
  acceptingParticipants: boolean;
  boundGuide: Guide | null;
  config: Config | null;
  canManage: boolean;
  connected: boolean;
  testEnabled: boolean;
  paidEnabled: boolean;
  studyVersion: number;
  revisionId: string | null;
  fielding: string;
  operation: ProlificOperation | null;
  participantUrl: string;
  rows: (ProlificSubmission & {
    appStatus: string;
    excluded: boolean;
    identityMatched: boolean;
    deadlineSoon: boolean;
  })[];
};
const initial: ProlificInput = {
  title: "",
  description: "",
  minutes: 15,
  rewardMinor: 300,
  currency: "USD",
  places: 10,
  maxCostMinor: 5000,
  microphone: false,
  terms:
    "Submissions are reviewed in Prolific. Contact the study team about technical problems or withdrawal and any compensation owed.",
};
export default function ProlificPanel({ studyId }: { studyId: string }) {
  const [data, setData] = useState<Data | null>(null),
    [form, setForm] = useState(initial),
    [reviewed, setReviewed] = useState(false),
    [funded, setFunded] = useState(false),
    [testConfirmed, setTestConfirmed] = useState(false),
    [remoteId, setRemote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const generation = useRef(0),
    receipt = useRef<{ key: string; id: string } | null>(null),
    root = "studies/" + studyId + "/prolific";
  async function load(g = generation.current) {
    const r = await api<Data>(root);
    if (g !== generation.current) return;
    setData(r);
    setForm(r.config?.input || initial);
    setReviewed(false);
    setFunded(false);
    setTestConfirmed(false);
  }
  useEffect(() => {
    const g = ++generation.current;
    void load(g).catch((e) => {
      if (g === generation.current) setError(e.message);
    });
    return () => {
      generation.current++;
    };
  }, [root]);
  async function act(fn: () => Promise<unknown>, text: string) {
    const g = generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (g === generation.current) {
        await load(g);
        setNotice(text);
      }
    } catch (e) {
      if (g === generation.current) {
        setError((e as Error).message);
        await load(g).catch(() => {});
      }
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  function change(p: Partial<ProlificInput>) {
    setForm((v) => ({ ...v, ...p }));
    setReviewed(false);
    setFunded(false);
  }
  const c = data?.config,
    unresolved = !!(data?.operation && data.operation.state !== "complete"),
    canWrite = !!(
      data?.connected &&
      data.canManage &&
      c &&
      reviewed &&
      !busy &&
      !unresolved
    ),
    quote = c?.quote;
  async function operation(kind: ProlificOperation["kind"]) {
    const key = JSON.stringify([kind, c!.version, quote?.id, funded]);
    if (receipt.current?.key !== key)
      receipt.current = { key, id: crypto.randomUUID() };
    return api(root + "/operations", "POST", {
      kind,
      version: c!.version,
      requestId: receipt.current.id,
      reviewed,
      ...(kind === "paid"
        ? { quoteId: quote?.id, fundedAndBudgetReviewed: funded }
        : {}),
    });
  }
  const money = (v: number, currency = form.currency) =>
    new Intl.NumberFormat("en", { style: "currency", currency }).format(
      v / 100,
    );
  return (
    <section
      className="panel visual-stack prolific-panel"
      aria-label="Prolific recruitment"
    >
      <h3>Prolific recruitment</h3>
      <p>
        Prepare a general-audience recruitment plan, then create an unpublished
        provider draft. Test launch and paid launch are separate actions.
        Prolific handles its participants’ compensation; do not also pay their
        ordinary study reward through the manual incentive ledger.
      </p>
      <p className="notice">
        {data?.connected
          ? "Prolific credentials are configured for this workspace; verify the account and binding before provider actions."
          : "Prolific is not connected. You can save a plan now; account setup and provider testing come later."}{" "}
        {data?.paidEnabled
          ? "Paid launch is enabled for this deployment and still requires a fresh quote and explicit approval."
          : "Paid launch is disabled for this deployment."}
      </p>
      <p className="small muted">
        Initial scope: desktop, USD or GBP, up to 100 places, general eligible
        panel with no audience filters. Guides with in-interview screen-outs are
        unsupported. Provider test access must be enabled separately; no paid
        fallback is used.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <button
        className="button"
        disabled={busy}
        onClick={() =>
          void act(
            () => load(),
            "Recruitment plan refreshed; review acknowledgement reset.",
          )
        }
      >
        Refresh Prolific plan
      </button>
      {!data ? (
        <p>Loading recruitment plan…</p>
      ) : (
        <>
          {!data.revisionId && (
            <p>
              Publish an Echo Lab guide before saving recruitment. Opening
              ordinary fielding will not publish a Prolific study.
            </p>
          )}
          <fieldset
            className="visual-stack prolific-fields"
            disabled={busy || !data.canManage || unresolved || !!c?.activeId}
          >
            <label>
              Recruitment title
              <input
                aria-label="Prolific recruitment title"
                value={form.title}
                maxLength={160}
                onChange={(e) => change({ title: e.target.value })}
              />
            </label>
            <label>
              Participant description
              <textarea
                aria-label="Prolific participant description"
                value={form.description}
                maxLength={4000}
                onChange={(e) => change({ description: e.target.value })}
              />
            </label>
            <div className="mixed-grid">
              <label>
                Estimated minutes
                <input
                  aria-label="Prolific estimated minutes"
                  type="number"
                  min={1}
                  max={60}
                  value={form.minutes}
                  onChange={(e) => change({ minutes: Number(e.target.value) })}
                />
              </label>
              <label>
                Places
                <input
                  aria-label="Prolific places"
                  type="number"
                  min={1}
                  max={100}
                  value={form.places}
                  onChange={(e) => change({ places: Number(e.target.value) })}
                />
              </label>
              <label>
                Account currency
                <select
                  aria-label="Prolific currency"
                  value={form.currency}
                  onChange={(e) =>
                    change({ currency: e.target.value as "USD" | "GBP" })
                  }
                >
                  <option>USD</option>
                  <option>GBP</option>
                </select>
              </label>
              <label>
                Reward per participant
                <input
                  aria-label="Prolific reward"
                  type="number"
                  step="0.01"
                  min={0.01}
                  value={form.rewardMinor / 100}
                  onChange={(e) =>
                    change({
                      rewardMinor: Math.round(Number(e.target.value) * 100),
                    })
                  }
                />
              </label>
              <label>
                Total budget cap, including fees and tax
                <input
                  aria-label="Prolific budget cap"
                  type="number"
                  step="0.01"
                  min={0.01}
                  value={form.maxCostMinor / 100}
                  onChange={(e) =>
                    change({
                      maxCostMinor: Math.round(Number(e.target.value) * 100),
                    })
                  }
                />
              </label>
            </div>
            <p>
              Participant rewards: {money(form.rewardMinor * form.places)}{" "}
              before fees/tax. Equivalent hourly reward:{" "}
              {money(
                Math.round((form.rewardMinor * 60) / Math.max(1, form.minutes)),
              )}
              . A provider quote is required for paid launch. Changing currency
              does not convert amounts.
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.microphone}
                onChange={(e) => change({ microphone: e.target.checked })}
              />
              A microphone is required for this task
            </label>
            <label>
              Participant terms for review, withdrawal and technical problems
              <textarea
                aria-label="Prolific participant terms"
                value={form.terms}
                maxLength={2000}
                onChange={(e) => change({ terms: e.target.value })}
              />
            </label>
          </fieldset>
          <label className="checkbox-label report-review">
            <input
              type="checkbox"
              disabled={busy || !data.canManage}
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed this plan’s audience, published guide, devices,
            compensation terms and budget.
          </label>
          <button
            className="button primary"
            disabled={
              busy ||
              !data.canManage ||
              !reviewed ||
              !data.revisionId ||
              unresolved ||
              !!c?.activeId
            }
            onClick={() =>
              void act(
                () =>
                  api(root, "PUT", {
                    config: form,
                    version: c?.version || 0,
                    studyVersion: data.studyVersion,
                    reviewed,
                  }),
                "Recruitment plan saved. No provider action was sent.",
              )
            }
          >
            Save reviewed Prolific plan
          </button>
          {c && (
            <>
              {c.activeId &&
                c.providerStatus === "ACTIVE" &&
                data.fielding !== "active" && (
                  <p className="notice">
                    Prolific is active while Echo Lab fielding is{" "}
                    {data.fielding}. Pause provider recruitment to avoid new
                    participants arriving at a closed local study.
                  </p>
                )}
              <p className="small muted">
                The unused Prolific allocation reserves local places while this
                connection accepts participants. Holding admissions releases
                that local reservation; it does not pause Prolific or cancel
                compensation obligations.
              </p>

              {c.revisionId !== data.revisionId && (
                <p className="notice">
                  The published Echo Lab guide changed. This provider plan is
                  stale; new Prolific admissions are held until a current
                  binding is reviewed.
                </p>
              )}
              {data.boundGuide && (
                <details>
                  <summary>Review the bound published guide</summary>
                  <h4>{data.boundGuide.title}</h4>
                  <p>{data.boundGuide.goal}</p>
                  <p>{data.boundGuide.intro}</p>
                  <ol>
                    {data.boundGuide.questions.map((q) => (
                      <li key={q.id}>
                        <p>{q.text}</p>
                        {!!q.options.length && (
                          <ul>
                            {q.options.map((o) => (
                              <li key={o.id}>{o.text}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ol>
                  <p>Published admission limit: {data.boundGuide.limit}</p>
                </details>
              )}
              <p>
                Plan version {c.version} · Published revision{" "}
                {c.revisionId.slice(0, 8)} · Provider status:{" "}
                {c.providerStatus || "No provider draft"} · Admissions:{" "}
                {data.acceptingParticipants ? "enabled" : "held"}
                {c.mode ? " · " + c.mode + " study" : ""}
              </p>
              <label>
                Provider participant link
                <input
                  readOnly
                  aria-label="Prolific participant link"
                  value={data.participantUrl}
                />
              </label>
              <p className="small muted">
                Use provider-expanded identifiers, never the placeholders, for
                an actual interview. IDs in an arrival URL remain claims until
                matched to provider submissions.
              </p>
              <div className="button-row">
                <button
                  className="button"
                  disabled={!canWrite}
                  onClick={() =>
                    void act(
                      () =>
                        api(root + "/verify", "POST", {
                          version: c.version,
                          reviewed,
                        }),
                      "Account and binding verified. Admissions remain held.",
                    )
                  }
                >
                  Verify Prolific account
                </button>
                <button
                  className="button"
                  disabled={!canWrite || !!c.activeId}
                  onClick={() =>
                    void act(
                      () => operation(c.draftId ? "update" : "create"),
                      "Unpublished provider draft saved. No recruitment was launched.",
                    )
                  }
                >
                  {c.draftId
                    ? "Update unpublished Prolific draft"
                    : "Create unpublished Prolific draft"}
                </button>
                <button
                  className="button"
                  disabled={
                    !canWrite ||
                    !c.draftId ||
                    !!c.activeId ||
                    !data.testEnabled ||
                    data.fielding !== "active"
                  }
                  onClick={() =>
                    void act(
                      () => operation("test"),
                      "Provider test clone launched. Confirm its test-participant experience in Prolific.",
                    )
                  }
                >
                  Launch no-credit Prolific test
                </button>
                <button
                  className="button"
                  disabled={!canWrite || !c.draftId || !!c.activeId}
                  onClick={() =>
                    void act(
                      () =>
                        api(root + "/quote", "POST", { version: c.version }),
                      "Provider quote refreshed. Review the total before paid launch.",
                    )
                  }
                >
                  Refresh provider quote
                </button>
              </div>
              {quote && (
                <p className="notice">
                  Provider quote:{" "}
                  {money(quote.totalMinor, quote.currency as "USD" | "GBP")} ·
                  Cap: {money(c.input.maxCostMinor, c.input.currency)} · Quote
                  expires {new Date(quote.expiresAt).toLocaleString()}. The
                  launch request rechecks this quote. Existing liabilities or
                  later provider adjustments can still require reconciliation.
                </p>
              )}
              {data.paidEnabled && (
                <label className="checkbox-label report-review">
                  <input
                    type="checkbox"
                    checked={funded}
                    disabled={busy}
                    onChange={(e) => setFunded(e.target.checked)}
                  />
                  I reviewed the current quote, confirmed provider funding and
                  approve this paid launch within the saved cap.
                </label>
              )}
              <button
                className="button primary"
                disabled={
                  !canWrite ||
                  !data.paidEnabled ||
                  !quote ||
                  !funded ||
                  !!c.activeId ||
                  data.fielding !== "active" ||
                  quote.totalMinor > c.input.maxCostMinor ||
                  quote.expiresAt <= Date.now()
                }
                onClick={() =>
                  void act(
                    () => operation("paid"),
                    "Paid launch sent. Review provider status and compensation deadlines.",
                  )
                }
              >
                Launch paid Prolific study
              </button>
              <div className="button-row">
                <button
                  className="button"
                  disabled={!canWrite || !c.activeId}
                  onClick={() =>
                    void act(
                      () => operation("pause"),
                      "Provider pause reconciled; new local admissions are held.",
                    )
                  }
                >
                  Pause Prolific recruitment
                </button>
                <button
                  className="button"
                  disabled={busy || !data.canManage}
                  onClick={() =>
                    void act(
                      () => api(root + "/hold", "POST", { version: c.version }),
                      "Local admissions held. This does not pause the provider or reverse obligations.",
                    )
                  }
                >
                  Hold local Prolific admissions
                </button>
                <button
                  className="button"
                  disabled={
                    !canWrite || !c.activeId || data.fielding !== "active"
                  }
                  onClick={() =>
                    void act(
                      () =>
                        api(root + "/admissions", "POST", {
                          version: c.version,
                          reviewed,
                        }),
                      "Current provider binding checked; new admissions enabled.",
                    )
                  }
                >
                  Enable reviewed Prolific admissions
                </button>
                <button
                  className="button"
                  disabled={
                    busy || !data.connected || !data.canManage || !c.draftId
                  }
                  onClick={() =>
                    void act(
                      () => api(root + "/sync", "POST", {}),
                      "Provider status and submissions reconciled. Quote and review reset.",
                    )
                  }
                >
                  Reconcile Prolific submissions
                </button>
              </div>
              {unresolved && (
                <div className="notice visual-stack">
                  <h4>Unresolved provider action</h4>
                  <p>
                    The provider may have completed this action. Another write
                    is held. Inspect the provider dashboard and match the exact
                    reviewed draft; do not start over with a new request.
                  </p>
                  <label>
                    Provider study ID to reconcile
                    <input
                      aria-label="Prolific provider study ID"
                      value={remoteId}
                      onChange={(e) => setRemote(e.target.value)}
                    />
                  </label>
                  {data.operation?.kind === "test" && (
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={testConfirmed}
                        onChange={(e) => setTestConfirmed(e.target.checked)}
                      />
                      I confirmed this ID is the no-credit test clone, not the
                      original draft.
                    </label>
                  )}
                  <button
                    className="button"
                    disabled={
                      busy ||
                      !data.canManage ||
                      !data.connected ||
                      !reviewed ||
                      !remoteId ||
                      (data.operation?.kind === "test" && !testConfirmed)
                    }
                    onClick={() =>
                      void act(
                        () =>
                          api(root + "/resolve", "POST", {
                            version: c.version,
                            remoteId,
                            reviewed,
                            testCloneConfirmed: testConfirmed,
                          }),
                        "Provider outcome reconciled. Admissions remain held until reviewed again.",
                      )
                    }
                  >
                    Resolve reviewed provider outcome
                  </button>
                </div>
              )}
              <a
                className="button"
                href="https://app.prolific.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Prolific dashboard
              </a>
            </>
          )}
          <h4>Submission reconciliation</h4>
          <p>
            Research inclusion, provider approval and reported payment are
            separate. Review and compensation actions stay in Prolific.
            Awaiting-review submissions can be automatically approved by
            Prolific after 21 days, even when Echo Lab shows a pending review.
          </p>
          {data.rows.some((r) => r.deadlineSoon) && (
            <p className="notice">
              A provider review deadline is within three days or has passed.
              Review the Prolific dashboard now.
            </p>
          )}
          {data.rows.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Submission</th>
                    <th>Echo Lab</th>
                    <th>Identity match</th>
                    <th>Provider</th>
                    <th>Reported payment</th>
                    <th>Review deadline</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.providerId}</td>
                      <td>
                        {r.appStatus}
                        {r.excluded ? " · excluded from research" : ""}
                      </td>
                      <td>
                        {r.identityMatched
                          ? "Matched IDs"
                          : "Unmatched; review in provider"}
                      </td>
                      <td>{r.status}</td>
                      <td>{r.payment}</td>
                      <td>
                        {r.reviewDeadline
                          ? new Date(r.reviewDeadline).toLocaleString()
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No provider submissions have been reconciled.</p>
          )}
          <a className="button" href={"/api/" + root + "/export"}>
            Export private Prolific reconciliation CSV
          </a>
        </>
      )}
    </section>
  );
}
