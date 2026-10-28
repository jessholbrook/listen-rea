"use client";
import { useEffect, useRef, useState } from "react";
import { calendarLabels } from "@/lib/follow-up-calendar";
import { api } from "@/lib/client";
import type { Language } from "@/lib/localization";
import type { ActionCenter, ActionTask } from "@/lib/research-action-center";
import { actionLabels } from "@/lib/research-action-center";
import {
  triageLabels,
  triageChanges,
  type TriageTarget,
  type TriagePreview,
} from "@/lib/operations-triage";
export default function OperationsTriagePanel({
  data,
  rows,
  filterKey,
  language,
  onDirty,
  onLock,
  onFinish,
  dateOnly = false,
}: {
  dateOnly?: boolean;
  data: ActionCenter;
  rows: ActionTask[];
  filterKey: string;
  language: Language;
  onDirty: (v: boolean) => void;
  onLock: (v: boolean) => void;
  onFinish: () => void;
}) {
  const [selected, setSelected] = useState<TriageTarget[]>([]),
    [assigneeMode, setAssigneeMode] = useState("keep"),
    [assignee, setAssignee] = useState(""),
    [dueMode, setDueMode] = useState("keep"),
    [date, setDate] = useState(""),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<TriagePreview | null>(null),
    [results, setResults] = useState(false),
    [ack, setAck] = useState(false),
    alive = useRef(true);
  const l = dateOnly
      ? {
          ...triageLabels[language],
          title: calendarLabels[language].reschedule,
          close: calendarLabels[language].close,
        }
      : triageLabels[language],
    al = actionLabels[language],
    locked = busy || !!preview || !!error;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      onDirty(false);
      onLock(false);
    };
  }, [onDirty, onLock]);
  useEffect(() => {
    onDirty(
      selected.length > 0 ||
        assigneeMode !== "keep" ||
        dueMode !== "keep" ||
        locked,
    );
    onLock(locked);
  }, [selected.length, assigneeMode, dueMode, locked, onDirty, onLock]);
  useEffect(() => setPage(0), [filterKey]);
  const pages = Math.max(1, Math.ceil(rows.length / 20)),
    currentPage = Math.min(page, pages - 1),
    hidden = selected.filter((t) => !rows.some((r) => r.id === t.id)).length;
  function changes() {
    return triageChanges.parse({
      assignee:
        assigneeMode === "set"
          ? { mode: "set", id: assignee }
          : { mode: assigneeMode },
      dueDate: dueMode === "set" ? { mode: "set", date } : { mode: dueMode },
    });
  }
  async function prepare() {
    setBusy(true);
    setError("");
    try {
      const result = await api<TriagePreview>(
        "library/operations-triage/preview",
        "POST",
        { changes: changes(), tasks: selected },
      );
      if (alive.current) {
        setPreview(result);
        setAck(false);
      }
    } catch {
      if (alive.current) {
        setError(l.failed);
        setPreview(null);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function apply() {
    if (!preview || !ack) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<TriagePreview>(
        "library/operations-triage/apply",
        "POST",
        {
          changes: preview.changes,
          acknowledged: true,
          tasks: preview.tasks
            .filter((t) => t.status === "ready")
            .map(({ id, collectionId, version }) => ({
              id,
              collectionId,
              version,
            })),
        },
      );
      if (alive.current) {
        setPreview({
          ...result,
          tasks: preview.tasks.map(
            (t) => result.tasks.find((r) => r.id === t.id) || t,
          ),
        });
        setResults(true);
        setAck(false);
      }
    } catch {
      if (alive.current) {
        setError(l.failed);
        setPreview(null);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const eligible =
    selected.length > 0 &&
    (assigneeMode !== "keep" || dueMode !== "keep") &&
    (assigneeMode !== "set" || !!assignee) &&
    (dueMode !== "set" || !!date);
  return (
    <section
      className="library-stack operations-triage"
      aria-label={l.title}
      aria-busy={busy}
    >
      <h3>{l.title}</h3>
      <p>{l.notice}</p>
      {dateOnly && <p>{calendarLabels[language].dateOnly}</p>}
      <p>{l.reviewWarning}</p>
      <p className="muted">{l.interrupted}</p>
      {error && <p role="alert">{error}</p>}
      {(results || error) && (
        <button className="button" disabled={busy} onClick={onFinish}>
          {l.finish}
        </button>
      )}
      {!preview && !error && (
        <>
          <p role="status">
            {l.selected}: {selected.length}/25 · {l.hidden}: {hidden}
          </p>
          {selected.length > 0 && (
            <ul aria-label={l.selected}>
              {selected.map((t) => (
                <li key={t.id}>
                  {data.tasks.find((r) => r.id === t.id)?.title ||
                    l.unavailable}
                </li>
              ))}
            </ul>
          )}
          <button
            className="button"
            disabled={busy || !selected.length}
            onClick={() => setSelected([])}
          >
            {l.clear}
          </button>
          <form
            className="panel library-stack"
            aria-label={l.preview}
            onSubmit={(e) => {
              e.preventDefault();
              void prepare();
            }}
          >
            <fieldset
              className="library-stack"
              disabled={busy}
              style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
            >
              {!dateOnly && (
                <label>
                  {l.assignee}
                  <select
                    aria-label={l.assignee}
                    value={assigneeMode}
                    onChange={(e) => setAssigneeMode(e.target.value)}
                  >
                    {["keep", "set", "clear"].map((m) => (
                      <option key={m} value={m}>
                        {l[m === "clear" ? "remove" : (m as "keep" | "set")]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {assigneeMode === "set" && (
                <label>
                  {l.member}
                  <select
                    aria-label={l.member}
                    required
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                  >
                    <option value="">—</option>
                    {data.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                {l.due}
                <select
                  aria-label={l.due}
                  value={dueMode}
                  onChange={(e) => setDueMode(e.target.value)}
                >
                  {["keep", "set", "clear"].map((m) => (
                    <option key={m} value={m}>
                      {l[m === "clear" ? "remove" : (m as "keep" | "set")]}
                    </option>
                  ))}
                </select>
              </label>
              {dueMode === "set" && (
                <label>
                  {l.date}
                  <input
                    aria-label={l.date}
                    type="date"
                    required
                    min="2000-01-01"
                    max="2100-12-31"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
              )}
              <button className="button" type="submit" disabled={!eligible}>
                {l.preview}
              </button>
            </fieldset>
          </form>
          {!selected.length && <p>{l.empty}</p>}
          <nav aria-label={al.page}>
            <button
              className="button"
              disabled={busy || currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              {al.previous}
            </button>
            <span>
              {al.page} {currentPage + 1}/{pages}
            </span>
            <button
              className="button"
              disabled={busy || currentPage + 1 >= pages}
              onClick={() => setPage(currentPage + 1)}
            >
              {al.next}
            </button>
          </nav>
          {rows.slice(currentPage * 20, currentPage * 20 + 20).map((t) => (
            <article
              className="panel library-stack"
              key={t.id}
              data-triage-task={t.id}
            >
              <label>
                <input
                  type="checkbox"
                  aria-label={`${l.select}: ${t.title}`}
                  checked={selected.some((s) => s.id === t.id)}
                  disabled={
                    busy ||
                    (!selected.some((s) => s.id === t.id) &&
                      selected.length >= 25)
                  }
                  onChange={(e) =>
                    setSelected((s) =>
                      e.target.checked
                        ? [
                            ...s,
                            {
                              id: t.id,
                              collectionId: t.collectionId,
                              version: t.version,
                            },
                          ]
                        : s.filter((v) => v.id !== t.id),
                    )
                  }
                />
                {t.title}
              </label>
              <span>
                {data.collections.find((c) => c.id === t.collectionId)?.title}
              </span>
              <span>
                {al[t.status]} ·{" "}
                {data.members.find((m) => m.id === t.assigneeId)?.name ||
                  al.unassigned}{" "}
                · {t.dueDate || l.none}
              </span>
            </article>
          ))}
        </>
      )}
      {preview && (
        <>
          <h4>{results ? l.results : l.preview}</h4>
          {preview.tasks.map((t) => (
            <article
              key={t.id}
              className="panel library-stack"
              data-triage-result={t.id}
            >
              <strong>
                {t.title ||
                  data.tasks.find((previous) => previous.id === t.id)?.title ||
                  l.unavailable}
              </strong>
              {t.collectionTitle && <span>{t.collectionTitle}</span>}
              <p>{l[t.status]}</p>
              {t.taskStatus && <p>{al[t.taskStatus]}</p>}
              {t.before && (
                <p>
                  {l.before}:{" "}
                  {t.before.assignee?.name ||
                    (t.before.assignee
                      ? al.unavailableAssignee
                      : al.unassigned)}{" "}
                  · {t.before.dueDate || l.none}
                </p>
              )}
              {t.after && (
                <p>
                  {l.after}:{" "}
                  {t.after.assignee?.name ||
                    (t.after.assignee
                      ? al.unavailableAssignee
                      : al.unassigned)}{" "}
                  · {t.after.dueDate || l.none}
                </p>
              )}
            </article>
          ))}
          {!results && (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={ack}
                  disabled={busy}
                  onChange={(e) => setAck(e.target.checked)}
                />
                {l.ack}
              </label>
              <button
                className="button"
                disabled={
                  busy ||
                  !ack ||
                  !preview.tasks.some((t) => t.status === "ready")
                }
                onClick={() => void apply()}
              >
                {l.apply}
              </button>
            </>
          )}
        </>
      )}
      {!results && !error && (
        <button className="button" disabled={busy} onClick={onFinish}>
          {preview ||
          selected.length ||
          assigneeMode !== "keep" ||
          dueMode !== "keep"
            ? l.cancel
            : l.close}
        </button>
      )}
    </section>
  );
}
