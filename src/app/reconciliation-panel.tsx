"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { ReconciliationGrant } from "@/lib/integration-reconciliation";
type Key = {
  id: string;
  name: string;
  available: boolean;
  studyCount: number;
  scopes: string[];
};
type Run = {
  id: string;
  keyId: string;
  state: string;
  position: number;
  total: number;
  version: number;
  createdAt: string;
  expiresAt: number;
};
type Data = { keys: Key[]; grants: ReconciliationGrant[]; runs: Run[] };
function Policy({
  item,
  grant,
  busy,
  save,
}: {
  item: Key;
  grant?: ReconciliationGrant;
  busy: boolean;
  save: (v: { enabled: boolean; limit24h: number }) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(grant?.enabled || false),
    [limit, setLimit] = useState(grant?.limit24h || 10),
    [reviewed, setReviewed] = useState(false);
  useEffect(() => {
    setEnabled(grant?.enabled || false);
    setLimit(grant?.limit24h || 10);
    setReviewed(false);
  }, [grant?.version, item.id]);
  return (
    <article className="panel visual-stack">
      <h4>{item.name}</h4>
      <p>
        {item.studyCount} selected studies · {item.scopes.join(", ")} ·{" "}
        {grant?.enabled ? "Recovery enabled" : "Recovery disabled"}
        {!item.available ? " · Key unavailable" : ""}
      </p>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy || !item.available}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setReviewed(false);
          }}
        />{" "}
        Enable inventory and availability checks for this key
      </label>
      <label>
        New inventories per rolling 24 hours
        <input
          type="number"
          min={1}
          max={50}
          value={limit}
          disabled={busy}
          onChange={(e) => {
            setLimit(Number(e.target.value));
            setReviewed(false);
          }}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={reviewed}
          disabled={busy}
          onChange={(e) => setReviewed(e.target.checked)}
        />{" "}
        I reviewed the selected studies, read scopes and recovery allowance.
        Saving invalidates this key’s existing checkpoints.
      </label>
      <div className="actions">
        <button
          className="button primary"
          disabled={
            busy ||
            !reviewed ||
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 50 ||
            (!item.available && enabled)
          }
          onClick={() => void save({ enabled, limit24h: limit })}
        >
          Save recovery policy
        </button>
        {grant?.enabled && (
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void save({ enabled: false, limit24h: grant.limit24h })
            }
          >
            Disable recovery now
          </button>
        )}
      </div>
    </article>
  );
}
export default function ReconciliationPanel() {
  const [data, setData] = useState<Data | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [discard, setDiscard] = useState<string | null>(null);
  const generation = useRef(0);
  async function load() {
    const g = ++generation.current;
    const d = await api("integration-recovery");
    if (g === generation.current) {
      setData(d);
      setDiscard(null);
    }
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    return () => {
      generation.current++;
    };
  }, []);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel visual-stack reconciliation-panel"
      aria-label="Integration recovery"
    >
      <h3>Integration recovery</h3>
      <p>
        Let a separately enabled static API key catch up after missed
        notifications. Inventories contain IDs and opaque content fingerprints
        for published sources already allowed by the key’s read permissions. No
        additional account is needed.
      </p>
      <p>
        The integration reads each page, updates or removes its own copies, then
        confirms a checkpoint. Completion records that client confirmation at
        that time. Echo Lab cannot verify an external copy. Unavailable sources
        have no reason disclosed; changing sources can require a fresh
        inventory. Runs expire after 24 hours; progress and content-free
        creation receipts age out after seven days.
      </p>
      <a
        href="https://github.com/jessholbrook/listen-rea/blob/main/docs/integration-reconciliation.md"
        target="_blank"
        rel="noreferrer"
      >
        Integration recovery API guide
      </a>
      {error && <p role="alert">{error}</p>}
      <button
        className="button"
        disabled={busy}
        onClick={() => void run(async () => {})}
      >
        Refresh recovery
      </button>
      {!data ? (
        <p>Loading recovery settings…</p>
      ) : (
        <>
          {!data.keys.length && (
            <p>
              Create a static API key with selected-study read access to
              configure recovery.
            </p>
          )}
          {data.keys.map((k) => {
            const grant = data.grants.find((g) => g.keyId === k.id);
            return (
              <Policy
                key={k.id}
                item={k}
                grant={grant}
                busy={busy}
                save={(v) =>
                  run(() =>
                    api("integration-recovery/grants/" + k.id, "PUT", {
                      ...v,
                      version: grant?.version || 0,
                      reviewed: true,
                    }),
                  )
                }
              />
            );
          })}
          <h4>Recent inventory progress</h4>
          <p>
            These are saved checkpoint states. Clients must recheck current
            source availability before relying on old progress. Discarding
            progress does not change research or an integration’s external
            copies.
          </p>
          {!data.runs.length && <p>No recovery inventories yet.</p>}
          {data.runs.map((r) => (
            <article className="panel visual-stack" key={r.id}>
              <strong>
                {data.keys.find((k) => k.id === r.keyId)?.name ||
                  "Unavailable key"}
              </strong>
              <code>{r.id}</code>
              <p>
                {r.state} at last checkpoint · {r.position} / {r.total} sources
                ·{" "}
                {r.expiresAt <= Date.now()
                  ? "Expired"
                  : "Expires " + new Date(r.expiresAt).toLocaleString()}
              </p>
              <button
                className="button"
                disabled={busy}
                onClick={() => setDiscard(r.id)}
              >
                Discard progress
              </button>
              {discard === r.id && (
                <div className="actions">
                  <button
                    className="button danger"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        api("integration-recovery/runs/" + r.id, "DELETE", {
                          version: r.version,
                          reviewed: true,
                        }),
                      )
                    }
                  >
                    Confirm discard
                  </button>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => setDiscard(null)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}
