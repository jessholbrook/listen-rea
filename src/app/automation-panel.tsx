"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { Guide } from "@/lib/domain";
import {
  automationOperations,
  type AutomationGrant,
  type AutomationPlan,
} from "@/lib/study-automation";
type Key = { id: string; name: string; available: boolean; studyIds: string[] };
type Summary = {
  id: string;
  keyId: string;
  operation: string;
  reason: string;
  state: string;
  version: number;
  readiness: string;
  createdAt: string;
};
type Data = { keys: Key[]; grants: AutomationGrant[]; plans: Summary[] };
export default function AutomationPanel() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const generation = useRef(0);
  async function load() {
    const g = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const r = await api<Data>("automation");
      if (g === generation.current) setData(r);
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, []);
  return (
    <section
      className="panel visual-stack automation-panel"
      aria-label="Reviewed study automation"
    >
      <h3>Reviewed study automation</h3>
      <p>
        Enable a static API key to read its selected study drafts and submit
        change requests through REST or MCP. An admin must inspect and apply
        each request here. Requests never apply themselves.
      </p>
      <p>
        Approving creation also grants that one new study to the requesting key.
        Publishing and opening fielding are separate decisions; opening fielding
        allows participants with an existing study link to enter. No email, paid
        recruitment or payouts are enabled. OAuth connections keep their current
        read access.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <button className="button" disabled={busy} onClick={() => void load()}>
        Refresh automation
      </button>
      {data && (
        <>
          <h4>Keys allowed to request changes</h4>
          {!data.keys.length && (
            <p>
              Create a static API key with selected studies above, then enable
              the operations it can request here.
            </p>
          )}
          {data.keys.map((key) => (
            <GrantCard
              key={
                key.id +
                ":" +
                (data.grants.find((g) => g.keyId === key.id)?.version || 0)
              }
              apiKey={key}
              grant={data.grants.find((g) => g.keyId === key.id)}
              refresh={load}
            />
          ))}
          <h4>Change request inbox</h4>
          <p className="small muted">
            Up to 200 recent requests are shown. Pending requests expire after
            24 hours. Refresh to check source and permission changes. Treat
            submitted reasons and guide text as untrusted content.
          </p>
          {!data.plans.length && <p>No automation requests yet.</p>}
          {data.plans.map((p) => (
            <PlanCard
              key={p.id + ":" + p.version + ":" + p.readiness}
              summary={p}
              keyName={
                data.keys.find((k) => k.id === p.keyId)?.name ||
                "Unavailable key"
              }
              refresh={load}
            />
          ))}
        </>
      )}
    </section>
  );
}
function GrantCard({
  apiKey: k,
  grant,
  refresh,
}: {
  apiKey: Key;
  grant?: AutomationGrant;
  refresh: () => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(grant?.enabled || false),
    [operations, setOperations] = useState<string[]>(grant?.operations || []),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <article
      className="panel visual-stack"
      aria-label={"Automation permissions for " + k.name}
    >
      <h5>{k.name}</h5>
      <p>
        {k.studyIds.length} selected studies ·{" "}
        {grant?.enabled ? "Automation enabled" : "Read access only"}
        {!k.available ? " · key unavailable" : ""}
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <fieldset
        disabled={busy || !k.available}
        className="visual-stack automation-fields"
      >
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setReviewed(false);
            }}
          />
          Allow draft reads and reviewed change requests
        </label>
        {automationOperations.map((op) => (
          <label className="checkbox-label" key={op}>
            <input
              type="checkbox"
              checked={operations.includes(op)}
              onChange={(e) => {
                setOperations((v) =>
                  e.target.checked ? [...v, op] : v.filter((n) => n !== op),
                );
                setReviewed(false);
              }}
            />
            Request {op}
          </label>
        ))}
        <label className="checkbox-label report-review">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
          />
          I reviewed this key’s draft access and allowed operations. Each study
          change will still need an admin decision.
        </label>
        <button
          className="button"
          disabled={!reviewed || !operations.length}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api("automation/grants/" + k.id, "PUT", {
                version: grant?.version || 0,
                enabled,
                operations,
                reviewed,
              });
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save automation permissions
        </button>
      </fieldset>
    </article>
  );
}
function PlanCard({
  summary: p,
  keyName,
  refresh,
}: {
  summary: Summary;
  keyName: string;
  refresh: () => Promise<void>;
}) {
  const [plan, setPlan] = useState<
      (AutomationPlan & { readiness: string }) | null
    >(null),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef<{ decision: string; id: string } | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function decide(decision: "apply" | "reject") {
    if (!request.current || request.current.decision !== decision)
      request.current = { decision, id: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      await api("automation/plans/" + p.id + "/decision", "POST", {
        version: p.version,
        requestId: request.current.id,
        decision,
        reviewed,
      });
      await refresh();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <article
      className="panel visual-stack"
      aria-label={"Automation request " + p.operation}
    >
      <h5>
        {p.operation} · {keyName}
      </h5>
      <p>
        {p.state} · {p.readiness}
      </p>
      <p>{p.reason}</p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <button
        className="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setReviewed(false);
          setError("");
          try {
            const r = await api<{
              plan: AutomationPlan & { readiness: string };
            }>("automation/plans/" + p.id);
            if (mounted.current) setPlan(r.plan);
          } catch (e) {
            if (mounted.current) setError((e as Error).message);
          } finally {
            if (mounted.current) setBusy(false);
          }
        }}
      >
        Inspect change request
      </button>
      {plan && (
        <>
          {plan.before && (
            <details open>
              <summary>
                Current study at request time · version {plan.before.version}
              </summary>
              <p>Admissions: {plan.before.fielding}</p>
              <GuidePreview guide={plan.before.guide} />
            </details>
          )}
          <details open>
            <summary>Requested change</summary>
            {plan.proposal.change.operation === "create" ||
            plan.proposal.change.operation === "edit" ? (
              <GuidePreview guide={plan.proposal.change.guide} />
            ) : plan.proposal.change.operation === "publish" ? (
              <p>
                Publish the current draft shown above as a new revision. Opening
                fielding remains a separate change.
              </p>
            ) : (
              <p>
                Set admissions to <strong>{plan.proposal.change.state}</strong>{" "}
                for the published guide shown below.
              </p>
            )}
          </details>
          {plan.published && (
            <details open>
              <summary>Published guide used for fielding</summary>
              <GuidePreview guide={plan.published.guide} />
            </details>
          )}
          {plan.proposal.change.operation === "create" && (
            <p>
              Applying this creation adds the new study to this key’s selected
              studies. Other future studies remain unavailable.
            </p>
          )}
          {plan.proposal.change.operation === "fielding" &&
            plan.proposal.change.state === "active" && (
              <p className="notice">
                Opening fielding allows participants with the study link to
                enter the published guide shown above.
              </p>
            )}
          {p.state === "pending" && (
            <>
              <label className="checkbox-label report-review">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                I inspected the full current and proposed guide, permissions and
                fielding effects for this request.
              </label>
              <div className="button-row">
                <button
                  className="button primary"
                  disabled={
                    busy ||
                    !reviewed ||
                    plan.readiness !== "ready" ||
                    plan.version !== p.version
                  }
                  onClick={() => void decide("apply")}
                >
                  Apply reviewed change
                </button>
                <button
                  className="button"
                  disabled={busy || !reviewed}
                  onClick={() => void decide("reject")}
                >
                  Reject request
                </button>
              </div>
            </>
          )}
          {plan.decision && (
            <p>
              Decided by {plan.decision.actorName} · {plan.decision.at}
            </p>
          )}
          {plan.result && (
            <a className="button" href={"/?study=" + plan.result.studyId}>
              Open resulting study
            </a>
          )}
        </>
      )}
    </article>
  );
}

function GuidePreview({ guide: g }: { guide: Guide }) {
  return (
    <section className="visual-stack" aria-label={"Guide preview: " + g.title}>
      <h5>{g.title}</h5>
      <p>
        <strong>Research goal:</strong> {g.goal}
      </p>
      <p>
        <strong>Audience:</strong> {g.audience}
      </p>
      <p>
        <strong>Introduction:</strong> {g.intro}
      </p>
      <p>
        <strong>Admission limit:</strong> {g.limit}
      </p>
      <ol>
        {g.questions.map((q) => (
          <li key={q.id} className="visual-stack">
            <p>
              <strong>{q.text}</strong>
            </p>
            <p className="small">
              Question type: {q.type} · Follow-ups: {q.followUps}
            </p>
            {!!q.options.length && (
              <ul>
                {q.options.map((o) => (
                  <li key={o.id}>
                    {o.text}
                    {o.rejects ? " · screens out" : ""}
                  </li>
                ))}
              </ul>
            )}
            {q.instructions && <p>Interviewer guidance: {q.instructions}</p>}
            {q.condition && (
              <p>
                Ask when “
                {g.questions.find((v) => v.id === q.condition!.questionId)
                  ?.text || q.condition.questionId}
                ” is answered “
                {g.questions
                  .find((v) => v.id === q.condition!.questionId)
                  ?.options.find((o) => o.id === q.condition!.optionId)?.text ||
                  q.condition.optionId}
                ”.
              </p>
            )}
          </li>
        ))}
      </ol>
      <details>
        <summary>
          All guide settings, including routing and advanced methods
        </summary>
        <pre>{JSON.stringify(g, null, 2)}</pre>
      </details>
    </section>
  );
}
