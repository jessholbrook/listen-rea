"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { planDates, planLabels, type PlanView } from "@/lib/review-plans";
import { localCalendarDay } from "@/lib/research-action-center";
import type { Language } from "@/lib/localization";
export default function ReviewPlansPanel({
  language,
  members,
  disabled,
  onDirty,
  onApply,
}: {
  language: Language;
  members: { id: string; name: string }[];
  disabled: boolean;
  onDirty: (v: boolean) => void;
  onApply: (v: Record<string, unknown>) => void;
}) {
  const l = planLabels[language],
    [plans, setPlans] = useState<PlanView[]>([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [name, setName] = useState(""),
    [rows, setRows] = useState<Record<string, string>>({}),
    [selected, setSelected] = useState(""),
    [start, setStart] = useState(localCalendarDay),
    [preview, setPreview] = useState(false),
    [ack, setAck] = useState(false);
  const active = editing !== null || preview;
  useEffect(() => {
    onDirty(active || busy);
  }, [active, busy, onDirty]);
  useEffect(() => {
    let alive = true;
    api("library/review-plans")
      .then((v) => {
        if (alive) {
          setPlans(v.plans);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function change(path: string, method: string, value: unknown) {
    setBusy(true);
    setError("");
    try {
      await api(path, method, value);
      const result = await api("library/review-plans");
      setPlans(result.plans);
      setEditing(null);
      setPreview(false);
      setAck(false);
      setSelected("");
    } catch (e) {
      setError((e as Error).message);
      setLoaded(false);
      setPlans([]);
      setEditing(null);
      setPreview(false);
    } finally {
      setBusy(false);
    }
  }
  const plan = plans.find((p) => p.id === selected);
  let dates: ReturnType<typeof planDates> = [],
    invalid = false;
  try {
    if (plan) dates = planDates(plan.reviewers, start);
  } catch {
    invalid = true;
  }
  const unavailable = plan?.reviewers.some(
    (r) => !members.some((m) => m.id === r.id),
  );
  return (
    <section
      className="library-stack review-plans"
      aria-label={l.title}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <h5>{l.title}</h5>
      <p className="muted">{l.notice}</p>
      {error && <p role="alert">{error}</p>}
      <fieldset className="review-plan-controls" disabled={disabled || busy}>
        <legend>{l.title}</legend>
        {!loaded && !error && <p>…</p>}
        {loaded && !plans.length && <p>{l.none}</p>}
        {editing === null && !preview && (
          <>
            <button
              className="button"
              onClick={() => {
                setEditing("");
                setName("");
                setRows({});
              }}
            >
              {l.new}
            </button>
            {plans.map((p) => (
              <div className="toolbar" key={p.id}>
                <span>{p.name}</span>
                <button
                  className="button"
                  onClick={() => {
                    setEditing(p.id);
                    setName(p.name);
                    setRows(
                      Object.fromEntries(
                        p.reviewers.map((r) => [
                          r.id,
                          r.days === null ? "" : String(r.days),
                        ]),
                      ),
                    );
                  }}
                >
                  {l.edit}: {p.name}
                </button>
                <button
                  className="button danger"
                  onClick={() => {
                    if (confirm(l.confirm))
                      void change("library/review-plans/" + p.id, "DELETE", {
                        version: p.version,
                      });
                  }}
                >
                  {l.remove}: {p.name}
                </button>
              </div>
            ))}
            <label>
              {l.choose}
              <select
                aria-label={l.choose}
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setAck(false);
                }}
              >
                <option value="">—</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {l.start}
              <input
                aria-label={l.start}
                type="date"
                min="2000-01-01"
                max="2100-12-31"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <button
              className="button"
              disabled={!plan || invalid || unavailable}
              onClick={() => {
                setPreview(true);
                setAck(false);
              }}
            >
              {l.preview}
            </button>
            {unavailable && <p role="status">{l.unavailable}</p>}
          </>
        )}
        {editing !== null && (
          <form
            className="library-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const p = plans.find((v) => v.id === editing);
              void change(
                "library/review-plans" + (editing ? "/" + editing : ""),
                editing ? "PUT" : "POST",
                {
                  name,
                  reviewers: Object.entries(rows).map(([id, value]) => ({
                    id,
                    days: value === "" ? null : Number(value),
                  })),
                  ...(p ? { version: p.version } : {}),
                },
              );
            }}
          >
            <label>
              {l.name}
              <input
                aria-label={l.name}
                required
                minLength={3}
                maxLength={160}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {members.map((m) => (
              <div key={m.id}>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={m.id in rows}
                    disabled={!(m.id in rows) && Object.keys(rows).length >= 10}
                    onChange={(e) =>
                      setRows((v) => {
                        const r = { ...v };
                        if (e.target.checked) r[m.id] = "";
                        else delete r[m.id];
                        return r;
                      })
                    }
                  />
                  {m.name}
                </label>
                {m.id in rows && (
                  <label>
                    {l.days}
                    <input
                      aria-label={`${l.days}: ${m.name}`}
                      type="number"
                      min={0}
                      max={365}
                      step={1}
                      value={rows[m.id]}
                      onChange={(e) =>
                        setRows({ ...rows, [m.id]: e.target.value })
                      }
                    />
                  </label>
                )}
              </div>
            ))}
            {Object.keys(rows).some(
              (id) => !members.some((m) => m.id === id),
            ) && (
              <>
                <p>{l.unavailable}</p>
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    setRows(
                      Object.fromEntries(
                        Object.entries(rows).filter(([id]) =>
                          members.some((m) => m.id === id),
                        ),
                      ),
                    )
                  }
                >
                  {l.remove}
                </button>
              </>
            )}
            <button
              className="button"
              type="submit"
              disabled={
                !Object.keys(rows).length ||
                Object.keys(rows).some(
                  (id) => !members.some((m) => m.id === id),
                )
              }
            >
              {l.save}
            </button>
            <button
              className="button"
              type="button"
              onClick={() => setEditing(null)}
            >
              {l.cancel}
            </button>
          </form>
        )}
        {preview && plan && (
          <div className="library-stack" data-review-plan-preview>
            <h6>{plan.name}</h6>
            {dates.map((v) => (
              <p key={v.id}>
                {members.find((m) => m.id === v.id)?.name || l.unavailable} ·{" "}
                {v.dueDate || l.noDate}
              </p>
            ))}
            <label className="check-row">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              {l.ack}
            </label>
            <button
              className="button"
              disabled={!ack || invalid || unavailable}
              onClick={() =>
                onApply({
                  op: "plan",
                  planId: plan.id,
                  planVersion: plan.version,
                  start,
                  acknowledged: true,
                })
              }
            >
              {l.apply}
            </button>
            <button
              className="button"
              onClick={() => {
                setPreview(false);
                setAck(false);
              }}
            >
              {l.cancel}
            </button>
          </div>
        )}
      </fieldset>
    </section>
  );
}
