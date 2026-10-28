"use client";
import OperationsReportPanel from "./operations-report-panel";
import type { OperationsReportConfig } from "@/lib/operations-report";
import { useCallback, useEffect, useState } from "react";
import type { Language } from "@/lib/localization";
import { actionLabels, type ActionCenter } from "@/lib/research-action-center";
import {
  calendarLabels,
  calendarDateLabel,
  calendarMonth,
  calendarProjection,
  moveCalendarMonth,
  type CalendarState,
} from "@/lib/follow-up-calendar";
import OperationsTriagePanel from "./operations-triage-panel";
export default function FollowUpCalendarPanel({
  timeZone,
  onTimeZone,
  onApplyReport,
  onReportLock,
  data,
  state,
  onState,
  today,
  language,
  onDirty,
  onLock,
  onFinish,
  onOpen,
}: {
  timeZone: string;
  onTimeZone: (v: string) => void;
  onApplyReport: (v: OperationsReportConfig) => void;
  onReportLock: (v: boolean) => void;
  data: ActionCenter;
  state: CalendarState;
  onState: (v: CalendarState) => void;
  today: string;
  language: Language;
  onDirty: (v: boolean) => void;
  onLock: (v: boolean) => void;
  onFinish: () => void;
  onOpen: (t: { id: string; collectionId: string }) => void;
}) {
  const l = calendarLabels[language],
    a = actionLabels[language],
    projection = calendarProjection(data, state, today),
    month = calendarMonth(state.month);
  const [rescheduling, setRescheduling] = useState(false),
    [locked, setLocked] = useState(false),
    [page, setPage] = useState(0);
  const [reportLocked, setReportLocked] = useState(false);
  const lockReport = useCallback(
    (v: boolean) => {
      setReportLocked(v);
      onReportLock(v);
    },
    [onReportLock],
  );
  const key = JSON.stringify(state);
  useEffect(() => setPage(0), [key]);
  useEffect(() => {
    onLock(locked);
    return () => onLock(false);
  }, [locked, onLock]);
  const pages = Math.max(1, Math.ceil(projection.rows.length / 20)),
    currentPage = Math.min(page, pages - 1);
  function shift(delta: number) {
    onState({
      ...state,
      month: moveCalendarMonth(state.month, delta),
      day: "",
      window: "month",
    });
  }
  // Stable parent callbacks keep the triage component's cleanup independent of render cycles.
  return (
    <section
      className="library-stack"
      aria-label={l.title}
      style={{ minWidth: 0 }}
    >
      <h3>{l.title}</h3>
      <p>{l.notice}</p>
      <fieldset
        className="library-stack"
        aria-label={l.scope}
        disabled={locked || reportLocked}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <label>
          {a.collection}
          <select
            aria-label={a.collection}
            value={state.collectionId}
            onChange={(e) =>
              onState({ ...state, collectionId: e.target.value })
            }
          >
            <option value="">{a.allCollections}</option>
            {state.collectionId &&
              !data.collections.some((c) => c.id === state.collectionId) && (
                <option value={state.collectionId}>
                  {a.unavailableCollection}
                </option>
              )}
            {data.collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          {a.assignee}
          <select
            aria-label={a.assignee}
            value={state.assignee}
            onChange={(e) => onState({ ...state, assignee: e.target.value })}
          >
            <option value="">{a.allAssignees}</option>
            <option value="mine">{a.mine}</option>
            <option value="unassigned">{a.unassigned}</option>
            {state.assignee &&
              !["mine", "unassigned"].includes(state.assignee) &&
              !data.members.some((m) => m.id === state.assignee) && (
                <option value={state.assignee}>{a.unavailableAssignee}</option>
              )}
            {data.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {a.status}
          <select
            aria-label={a.status}
            value={state.status}
            onChange={(e) => onState({ ...state, status: e.target.value })}
          >
            {(
              ["active", "all", "open", "in_progress", "completed"] as const
            ).map((s) => (
              <option key={s} value={s}>
                {a[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {a.query}
          <input
            aria-label={a.query}
            value={state.query}
            onChange={(e) => onState({ ...state, query: e.target.value })}
          />
        </label>
        <div className="toolbar" aria-label={l.priorities}>
          {(["overdue", "today", "week", "undated"] as const).map((k) => (
            <button
              className="button"
              key={k}
              aria-pressed={
                k === "today"
                  ? state.window === "month" && state.day === today
                  : state.window === k
              }
              onClick={() =>
                onState({
                  ...state,
                  status: "active",
                  window: k === "today" ? "month" : k,
                  day: k === "today" ? today : "",
                  month: k === "today" ? today.slice(0, 7) : state.month,
                })
              }
            >
              {a[k]} ({projection.priorities[k]})
            </button>
          ))}
        </div>
        <div className="toolbar">
          <button
            className="button"
            disabled={state.month <= "2000-01"}
            onClick={() => shift(-1)}
          >
            {l.previous}
          </button>
          <button
            className="button"
            onClick={() =>
              onState({
                ...state,
                month: today.slice(0, 7),
                day: "",
                window: "month",
              })
            }
          >
            {l.current}
          </button>
          <button
            className="button"
            disabled={state.month >= "2100-12"}
            onClick={() => shift(1)}
          >
            {l.next}
          </button>
        </div>
        <label>
          {l.month}
          <input
            aria-label={l.month}
            type="month"
            min="2000-01"
            max="2100-12"
            value={state.month}
            onChange={(e) => {
              if (/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(e.target.value))
                onState({
                  ...state,
                  month: e.target.value,
                  day: "",
                  window: "month",
                });
            }}
          />
        </label>
        <h4>{calendarDateLabel(state.month + "-01", language, true)}</h4>
        <div
          role="group"
          aria-label={l.monthView}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7,minmax(0,1fr))",
            gap: 3,
          }}
        >
          {Array.from({ length: 7 }, (_, i) => (
            <span
              key={"weekday" + i}
              title={new Intl.DateTimeFormat(language, {
                weekday: "long",
                timeZone: "UTC",
              }).format(new Date(Date.UTC(2028, 0, 3 + i, 12)))}
              style={{ textAlign: "center" }}
            >
              {new Intl.DateTimeFormat(language, {
                weekday: "narrow",
                timeZone: "UTC",
              }).format(new Date(Date.UTC(2028, 0, 3 + i, 12)))}
            </span>
          ))}
          {Array.from({ length: month.offset }, (_, i) => (
            <span key={"blank" + i} aria-hidden="true" />
          ))}
          {month.days.map((day) => (
            <button
              key={day}
              className="button"
              data-calendar-day={day}
              aria-current={day === today ? "date" : undefined}
              aria-pressed={state.window === "month" && state.day === day}
              aria-label={`${calendarDateLabel(day, language)}: ${projection.counts[day]}`}
              style={{
                minWidth: 0,
                padding: "6px 1px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                fontSize: 12,
              }}
              onClick={() =>
                onState({
                  ...state,
                  window: "month",
                  day: state.day === day ? "" : day,
                })
              }
            >
              <span>{Number(day.slice(-2))}</span>
              <strong>{projection.counts[day]}</strong>
            </button>
          ))}
        </div>
        <button
          className="button"
          onClick={() => onState({ ...state, window: "month", day: "" })}
        >
          {l.whole}
        </button>
      </fieldset>
      {!rescheduling && (
        <OperationsReportPanel
          config={{ kind: "calendar", filters: state, language, timeZone }}
          onTimeZone={onTimeZone}
          onApply={onApplyReport}
          onLock={lockReport}
        />
      )}
      <fieldset
        disabled={reportLocked}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <h4>
          {l.agenda} ·{" "}
          {state.window === "month"
            ? state.day
              ? calendarDateLabel(state.day, language)
              : calendarDateLabel(state.month + "-01", language, true)
            : a[state.window]}
        </h4>
        <p role="status">
          {a.matching}: {projection.rows.length}
        </p>
        {rescheduling ? (
          <OperationsTriagePanel
            dateOnly
            data={data}
            rows={projection.rows}
            filterKey={key}
            language={language}
            onDirty={onDirty}
            onLock={setLocked}
            onFinish={onFinish}
          />
        ) : (
          <>
            {data.canEdit && (
              <button className="button" onClick={() => setRescheduling(true)}>
                {l.reschedule}
              </button>
            )}
            {!projection.rows.length && <p>{l.empty}</p>}
            <nav aria-label={a.page}>
              <button
                className="button"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                {a.previous}
              </button>
              <span>
                {a.page} {currentPage + 1}/{pages}
              </span>
              <button
                className="button"
                disabled={currentPage + 1 >= pages}
                onClick={() => setPage(currentPage + 1)}
              >
                {a.next}
              </button>
            </nav>
            {projection.rows
              .slice(currentPage * 20, currentPage * 20 + 20)
              .map((t) => (
                <article
                  className="panel library-stack"
                  key={t.id}
                  data-calendar-task={t.id}
                >
                  <strong>{t.title}</strong>
                  <span>
                    {
                      data.collections.find((c) => c.id === t.collectionId)
                        ?.title
                    }
                  </span>
                  <span>
                    {a[t.status]} ·{" "}
                    {data.members.find((m) => m.id === t.assigneeId)?.name ||
                      a.unassigned}{" "}
                    ·{" "}
                    {t.dueDate
                      ? calendarDateLabel(t.dueDate, language)
                      : a.undated}
                  </span>
                  <button className="button" onClick={() => onOpen(t)}>
                    {l.open}
                  </button>
                </article>
              ))}
          </>
        )}
      </fieldset>
    </section>
  );
}
