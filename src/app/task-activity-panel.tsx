"use client";
import type { OperationsReportConfig } from "@/lib/operations-report";
import OperationsReportPanel from "./operations-report-panel";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { Language } from "@/lib/localization";
import {
  defaultTaskActivityFilters,
  taskActivityActions,
  taskActivityFields,
  taskActivityLabels,
  type TaskActivityView,
  type TaskEventView,
} from "@/lib/task-activity";
export default function TaskActivityPanel({
  timeZone,
  onTimeZone,
  onApplyReport,
  onReportLock,
  language,
  filters,
  onState,
  onOpen,
}: {
  timeZone: string;
  onTimeZone: (v: string) => void;
  onApplyReport: (v: OperationsReportConfig) => void;
  onReportLock: (locked: boolean) => void;
  language: Language;
  filters: typeof defaultTaskActivityFilters;
  onState: (v: typeof defaultTaskActivityFilters) => void;
  onOpen: (t: { id: string; collectionId: string }) => void;
}) {
  const [reportLocked, setReportLocked] = useState(false);
  const lockReport = useCallback(
    (locked: boolean) => {
      setReportLocked(locked);
      onReportLock(locked);
    },
    [onReportLock],
  );
  const { page: _, ...reportFilters } = filters;
  const l = taskActivityLabels[language],
    [data, setData] = useState<TaskActivityView | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    let active = true;
    setBusy(true);
    setError("");
    setData(null);
    api<TaskActivityView>(
      "library/task-activity?" +
        new URLSearchParams({
          ...filters,
          page: String(filters.page),
          timeZone,
        }),
      "GET",
      undefined,
      undefined,
      c.signal,
    )
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      c.abort();
    };
  }, [
    language,
    filters.collectionId,
    filters.taskId,
    filters.personId,
    filters.action,
    filters.field,
    filters.from,
    filters.to,
    filters.page,
    revision,
    timeZone,
  ]);
  const filter = (v: Partial<typeof filters>) =>
    onState({ ...filters, ...v, page: 0 });
  const state = (s: NonNullable<TaskEventView["before"]>) => (
    <p>
      {s.assignee ? s.assignee.name || l.former : l.unassigned} ·{" "}
      {s.dueDate || l.none} · {s.status === "open" ? l.openStatus : l[s.status]}
    </p>
  );
  return (
    <section
      className="library-stack task-activity"
      aria-label={l.title}
      aria-busy={busy}
    >
      <h3>{l.title}</h3>
      <p className="muted">{l.notice}</p>
      <OperationsReportPanel
        onTimeZone={onTimeZone}
        onApply={onApplyReport}
        config={{
          kind: "task_activity",
          filters: reportFilters,
          language,
          timeZone,
        }}
        onLock={lockReport}
      />
      <fieldset
        disabled={reportLocked}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <button
          className="button"
          disabled={busy}
          onClick={() => setRevision((r) => r + 1)}
        >
          {l.refresh}
        </button>
        <fieldset
          className="library-stack"
          disabled={busy}
          style={{ minWidth: 0 }}
        >
          <legend>{l.title}</legend>
          <label>
            {l.collection}
            <select
              aria-label={l.collection}
              value={filters.collectionId}
              onChange={(e) => filter({ collectionId: e.target.value })}
            >
              <option value="">{l.all}</option>
              {filters.collectionId &&
                !data?.collections.some(
                  (c) => c.id === filters.collectionId,
                ) && (
                  <option value={filters.collectionId}>
                    {l.unavailableCollection}
                  </option>
                )}
              {data?.collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {l.task}
            <select
              aria-label={l.task}
              value={filters.taskId}
              onChange={(e) => filter({ taskId: e.target.value })}
            >
              <option value="">{l.all}</option>
              {filters.taskId &&
                !data?.tasks.some((t) => t.id === filters.taskId) && (
                  <option value={filters.taskId}>{l.unavailableTask}</option>
                )}
              {data?.tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {l.person}
            <select
              aria-label={l.person}
              value={filters.personId}
              onChange={(e) => filter({ personId: e.target.value })}
            >
              <option value="">{l.all}</option>
              <option value="system">{l.system}</option>
              {filters.personId &&
                filters.personId !== "system" &&
                !data?.people.some((p) => p.id === filters.personId) && (
                  <option value={filters.personId}>{l.former}</option>
                )}
              {data?.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || l.former}
                </option>
              ))}
            </select>
          </label>
          <label>
            {l.action}
            <select
              aria-label={l.action}
              value={filters.action}
              onChange={(e) => filter({ action: e.target.value })}
            >
              <option value="">{l.all}</option>
              {taskActivityActions.map((k) => (
                <option key={k} value={k}>
                  {l[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {l.field}
            <select
              aria-label={l.field}
              value={filters.field}
              onChange={(e) => filter({ field: e.target.value })}
            >
              <option value="">{l.all}</option>
              {taskActivityFields.map((k) => (
                <option key={k} value={k}>
                  {l[k === "title" ? "titleField" : k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {l.from}
            <input
              aria-label={l.from}
              type="date"
              min="2000-01-01"
              max="2100-12-31"
              value={filters.from}
              onChange={(e) => filter({ from: e.target.value })}
            />
          </label>
          <label>
            {l.to}
            <input
              aria-label={l.to}
              type="date"
              min="2000-01-01"
              max="2100-12-31"
              value={filters.to}
              onChange={(e) => filter({ to: e.target.value })}
            />
          </label>
          <button
            className="button"
            onClick={() => onState({ ...defaultTaskActivityFilters })}
          >
            {l.reset}
          </button>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        {data && (
          <>
            <p role="status">
              {l.matches}: {data.total}
            </p>
            {!!data.omitted && (
              <p>
                {l.omitted}: {data.omitted}
              </p>
            )}
            {!data.events.length && <p>{l.empty}</p>}
            {data.events.map((e) => (
              <article
                className="panel library-stack"
                key={e.id}
                data-task-event={e.id}
                data-task-action={e.action}
              >
                <h4>{l[e.action]}</h4>
                <p>
                  {e.actor ? e.actor.name || l.former : l.system} ·{" "}
                  <time dateTime={e.at}>
                    {new Intl.DateTimeFormat(language, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(e.at))}
                  </time>
                </p>
                <p>
                  {e.task.title} · {e.task.collectionTitle}
                </p>
                <div>
                  <h5>{l.before}</h5>
                  {e.before ? state(e.before) : <p>{l.none}</p>}
                </div>
                <div>
                  <h5>{l.after}</h5>
                  {state(e.after)}
                </div>
                {e.titleChanged && <p>{l.titleChanged}</p>}
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => onOpen(e.task)}
                >
                  {l.open}
                </button>
              </article>
            ))}
            {data.pages > 1 && (
              <nav aria-label={l.page}>
                <button
                  className="button"
                  disabled={busy || data.page === 0}
                  onClick={() => onState({ ...filters, page: data.page - 1 })}
                >
                  {l.previous}
                </button>
                <span>
                  {l.page} {data.page + 1}/{data.pages}
                </span>
                <button
                  className="button"
                  disabled={busy || data.page + 1 >= data.pages}
                  onClick={() => onState({ ...filters, page: data.page + 1 })}
                >
                  {l.next}
                </button>
              </nav>
            )}
          </>
        )}
      </fieldset>
    </section>
  );
}
