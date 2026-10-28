"use client";
import OperationsReportPanel from "./operations-report-panel";
import SavedReviewViewsPanel from "./saved-review-views-panel";
import {
  unifiedViewConfig,
  type UnifiedViewConfig,
} from "@/lib/unified-view-config";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { languages, languageNames, type Language } from "@/lib/localization";
import {
  unifiedLabels,
  initialUnifiedFilters,
  unifiedProjection,
  type UnifiedPlanning,
  type PlanningRow,
} from "@/lib/unified-planning";
import {
  calendarMonth,
  calendarDateLabel,
  moveCalendarMonth,
  calendarLabels,
} from "@/lib/follow-up-calendar";
import { actionLabels, localCalendarDay } from "@/lib/research-action-center";
import { inboxLabels } from "@/lib/team-review-inbox";
import type { ReviewEntry } from "@/lib/research-operations";
import OperationsTriagePanel from "./operations-triage-panel";
import ReviewDeadlinePlanner from "./review-deadline-planner";
export default function UnifiedPlanningPanel({
  initial,
  initialLanguage = "en",
  openTask,
  openReview,
}: {
  initial?: UnifiedViewConfig;
  initialLanguage?: Language;
  openTask: (
    row: { id: string; collectionId: string },
    language: Language,
  ) => void;
  openReview: (entry: ReviewEntry) => void;
}) {
  const [language, setLanguage] = useState<Language>(
      initial?.language || initialLanguage,
    ),
    [today, setToday] = useState(localCalendarDay),
    [filters, setFilters] = useState(
      () => initial?.filters || initialUnifiedFilters(localCalendarDay()),
    ),
    [data, setData] = useState<UnifiedPlanning | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [page, setPage] = useState(0),
    [taskMode, setTaskMode] = useState(false),
    [taskDirty, setTaskDirty] = useState(false),
    [taskLocked, setTaskLocked] = useState(false),
    [review, setReview] = useState<Extract<
      PlanningRow,
      { kind: "review" }
    > | null>(null);
  const [timeZone, setTimeZone] = useState(
    initial?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [savedDirty, setSavedDirty] = useState(false),
    [reportLocked, setReportLocked] = useState(false);
  const epoch = useRef(0),
    controller = useRef<AbortController | null>(null),
    l = unifiedLabels[language],
    a = actionLabels[language],
    c = calendarLabels[language],
    il = inboxLabels[language],
    dirty = taskDirty || !!review || savedDirty || reportLocked;
  async function refresh() {
    const g = ++epoch.current,
      ac = new AbortController();
    controller.current?.abort();
    controller.current = ac;
    setBusy(true);
    setData(null);
    setError("");
    setSavedDirty(false);
    setReportLocked(false);
    setTaskMode(false);
    setTaskDirty(false);
    setTaskLocked(false);
    setReview(null);
    setPage(0);
    try {
      const v = await api<UnifiedPlanning>(
        "library/unified-planning",
        "GET",
        undefined,
        undefined,
        ac.signal,
      );
      if (g === epoch.current) {
        setData(v);
        setToday(localCalendarDay());
      }
    } catch {
      if (g === epoch.current) setError(l.failed);
    } finally {
      if (g === epoch.current) setBusy(false);
    }
  }
  function applyConfig(value: UnifiedViewConfig) {
    setFilters(value.filters);
    setTimeZone(value.timeZone);
    if (value.language !== language) setLanguage(value.language);
    else void refresh();
  }
  useEffect(() => {
    void refresh();
    return () => {
      epoch.current++;
      controller.current?.abort();
    };
  }, [language]);
  useEffect(() => {
    const tick = () => setToday(localCalendarDay()),
      timer = window.setInterval(tick, 60000);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, []);
  const key = JSON.stringify(filters);
  useEffect(() => setPage(0), [key, today]);
  const projection = data ? unifiedProjection(data, filters, today) : null,
    month = calendarMonth(filters.month),
    pages = Math.max(1, Math.ceil((projection?.rows.length || 0) / 20)),
    current = Math.min(page, pages - 1);
  const collections = data
      ? [
          ...new Map(
            [...data.actions.collections, ...data.reviews.collections].map(
              (v) => [v.id, v],
            ),
          ).values(),
        ].sort((a, b) => a.title.localeCompare(b.title))
      : [],
    members = data
      ? [
          ...new Map(
            [...data.actions.members, ...data.reviews.members].map((v) => [
              v.id,
              v,
            ]),
          ).values(),
        ].sort((a, b) => a.name.localeCompare(b.name))
      : [];
  function shift(delta: number) {
    setFilters({
      ...filters,
      month: moveCalendarMonth(filters.month, delta),
      day: "",
      window: "month",
    });
  }
  return (
    <section
      className="panel library-stack unified-planning"
      aria-label={l.title}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
      aria-busy={busy}
    >
      <h2>{l.title}</h2>
      <p>{l.notice}</p>
      <p>{l.taskWarning}</p>
      <label>
        {a.language}
        <select
          aria-label={a.language}
          value={language}
          disabled={busy || dirty}
          onChange={(e) => setLanguage(e.target.value as Language)}
        >
          {languages.map((v) => (
            <option key={v} value={v}>
              {languageNames[v]}
            </option>
          ))}
        </select>
      </label>
      <button
        className="button"
        disabled={busy || dirty}
        onClick={() => void refresh()}
      >
        {l.refresh}
      </button>
      {error && <p role="alert">{error}</p>}
      {data && (
        <SavedReviewViewsPanel
          kind="unified"
          language={language}
          disabled={busy || taskMode || !!review || reportLocked}
          current={() =>
            unifiedViewConfig.parse({
              kind: "unified",
              filters,
              language,
              timeZone,
            })
          }
          onApply={(value) => applyConfig(unifiedViewConfig.parse(value))}
          onDirty={setSavedDirty}
          onStart={() => setError("")}
        />
      )}
      <fieldset
        disabled={savedDirty}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        {data && projection && (
          <>
            <p>
              {l.loaded}{" "}
              <time dateTime={data.loadedAt}>
                {new Date(data.loadedAt).toLocaleString(language)}
              </time>
            </p>
            <fieldset
              className="library-stack"
              disabled={taskLocked || !!review || reportLocked}
              style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
            >
              <label>
                {l.kind}
                <select
                  aria-label={l.kind}
                  value={filters.kind}
                  onChange={(e) =>
                    setFilters({
                      ...filters,
                      kind: e.target.value as typeof filters.kind,
                    })
                  }
                >
                  {(["all", "tasks", "reviews"] as const).map((k) => (
                    <option key={k} value={k}>
                      {l[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {a.collection}
                <select
                  aria-label={a.collection}
                  value={filters.collectionId}
                  onChange={(e) =>
                    setFilters({ ...filters, collectionId: e.target.value })
                  }
                >
                  <option value="">{a.allCollections}</option>
                  {filters.collectionId &&
                    !collections.some((v) => v.id === filters.collectionId) && (
                      <option value={filters.collectionId}>
                        {a.unavailableCollection}
                      </option>
                    )}
                  {collections.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {l.person}
                <select
                  aria-label={l.person}
                  value={filters.person}
                  onChange={(e) =>
                    setFilters({ ...filters, person: e.target.value })
                  }
                >
                  <option value="">{a.allAssignees}</option>
                  <option value="mine">{a.mine}</option>
                  <option value="unassigned">{a.unassigned}</option>
                  {filters.person &&
                    !["mine", "unassigned"].includes(filters.person) &&
                    !members.some((v) => v.id === filters.person) && (
                      <option value={filters.person}>
                        {a.unavailableAssignee}
                      </option>
                    )}
                  {members.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {a.query}
                <input
                  aria-label={a.query}
                  value={filters.query}
                  maxLength={160}
                  onChange={(e) =>
                    setFilters({ ...filters, query: e.target.value })
                  }
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={filters.includeFinished}
                  disabled={filters.window !== "month"}
                  onChange={(e) =>
                    setFilters({
                      ...filters,
                      includeFinished: e.target.checked,
                    })
                  }
                />
                {l.finished}
              </label>
              <div className="toolbar">
                {(["overdue", "week", "undated"] as const).map((window) => (
                  <button
                    className="button"
                    key={window}
                    aria-pressed={filters.window === window}
                    onClick={() =>
                      setFilters({
                        ...filters,
                        window,
                        day: "",
                        includeFinished: false,
                      })
                    }
                  >
                    {a[window]} ({projection.priorities[window]})
                  </button>
                ))}
              </div>
              <div className="toolbar">
                <button
                  className="button"
                  disabled={filters.month <= "2000-01"}
                  onClick={() => shift(-1)}
                >
                  {c.previous}
                </button>
                <button
                  className="button"
                  onClick={() =>
                    setFilters({
                      ...filters,
                      month: today.slice(0, 7),
                      day: "",
                      window: "month",
                    })
                  }
                >
                  {c.current}
                </button>
                <button
                  className="button"
                  disabled={filters.month >= "2100-12"}
                  onClick={() => shift(1)}
                >
                  {c.next}
                </button>
              </div>
              <label>
                {c.month}
                <input
                  aria-label={c.month}
                  type="month"
                  min="2000-01"
                  max="2100-12"
                  value={filters.month}
                  onChange={(e) => {
                    if (/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(e.target.value))
                      setFilters({
                        ...filters,
                        month: e.target.value,
                        window: "month",
                        day: "",
                      });
                  }}
                />
              </label>
              <h3>
                {calendarDateLabel(filters.month + "-01", language, true)}
              </h3>
              <div
                role="group"
                aria-label={c.monthView}
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7,minmax(0,1fr))",
                  gap: 3,
                }}
              >
                {Array.from({ length: 7 }, (_, i) => (
                  <span key={"w" + i} style={{ textAlign: "center" }}>
                    {new Intl.DateTimeFormat(language, {
                      weekday: "narrow",
                      timeZone: "UTC",
                    }).format(new Date(Date.UTC(2028, 0, 3 + i, 12)))}
                  </span>
                ))}
                {Array.from({ length: month.offset }, (_, i) => (
                  <span key={"empty" + i} aria-hidden="true" />
                ))}
                {month.days.map((day) => (
                  <button
                    className="button"
                    key={day}
                    data-planning-day={day}
                    aria-current={day === today ? "date" : undefined}
                    aria-pressed={
                      filters.window === "month" && filters.day === day
                    }
                    aria-label={`${calendarDateLabel(day, language)}: ${projection.counts[day]}`}
                    style={{
                      minWidth: 0,
                      padding: "6px 1px",
                      display: "flex",
                      flexDirection: "column",
                      fontSize: 12,
                    }}
                    onClick={() =>
                      setFilters({
                        ...filters,
                        window: "month",
                        day: filters.day === day ? "" : day,
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
                onClick={() =>
                  setFilters({ ...filters, window: "month", day: "" })
                }
              >
                {c.whole}
              </button>
            </fieldset>
            {!review && !taskMode && (
              <OperationsReportPanel
                config={{ kind: "unified", filters, language, timeZone }}
                onTimeZone={setTimeZone}
                onApply={(value) => {
                  if (value.kind === "unified") applyConfig(value);
                }}
                onLock={setReportLocked}
              />
            )}
            <fieldset
              disabled={reportLocked}
              style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
            >
              <h3>
                {c.agenda} ·{" "}
                {filters.window === "month"
                  ? calendarDateLabel(
                      filters.day || filters.month + "-01",
                      language,
                      !filters.day,
                    )
                  : a[filters.window]}
              </h3>
              <p role="status">
                {l.tasks}: {projection.tasks} · {l.reviews}:{" "}
                {projection.reviews}
              </p>
              {review ? (
                <ReviewDeadlinePlanner
                  row={review}
                  language={language}
                  onFinish={() => void refresh()}
                />
              ) : taskMode ? (
                <OperationsTriagePanel
                  dateOnly
                  data={data.actions}
                  rows={projection.rows.flatMap((r) =>
                    r.kind === "task" ? [r.task] : [],
                  )}
                  filterKey={key}
                  language={language}
                  onDirty={setTaskDirty}
                  onLock={setTaskLocked}
                  onFinish={() => void refresh()}
                />
              ) : (
                <>
                  {data.actions.canEdit && projection.tasks > 0 && (
                    <button
                      className="button"
                      onClick={() => setTaskMode(true)}
                    >
                      {l.taskSchedule}
                    </button>
                  )}
                  {!projection.rows.length && <p>{l.empty}</p>}
                  <nav aria-label={a.page}>
                    <button
                      className="button"
                      disabled={current === 0}
                      onClick={() => setPage(current - 1)}
                    >
                      {a.previous}
                    </button>
                    <span>
                      {a.page} {current + 1}/{pages}
                    </span>
                    <button
                      className="button"
                      disabled={current + 1 >= pages}
                      onClick={() => setPage(current + 1)}
                    >
                      {a.next}
                    </button>
                  </nav>
                  {projection.rows
                    .slice(current * 20, current * 20 + 20)
                    .map((row) => (
                      <article
                        className="panel library-stack"
                        key={row.key}
                        data-planning-item={row.key}
                      >
                        <strong>{row.title}</strong>
                        <span>
                          {row.kind === "task" ? l.tasks : l.reviews} ·{" "}
                          {row.collectionTitle}
                        </span>
                        <span>
                          {row.personName ||
                            (row.personId
                              ? il.unavailableReviewer
                              : a.unassigned)}{" "}
                          ·{" "}
                          {row.dueDate
                            ? calendarDateLabel(row.dueDate, language)
                            : a.undated}
                        </span>
                        <span>
                          {row.kind === "task"
                            ? a[row.task.status]
                            : row.finished
                              ? il.approved
                              : il.pending}
                        </span>
                        <button
                          className="button"
                          onClick={() =>
                            row.kind === "task"
                              ? openTask(
                                  {
                                    id: row.task.id,
                                    collectionId: row.collectionId,
                                  },
                                  language,
                                )
                              : openReview({
                                  language,
                                  packet: {
                                    id: row.packet.id,
                                    collectionId: row.collectionId,
                                  },
                                })
                          }
                        >
                          {l.open}
                        </button>
                        {row.kind === "review" && data.reviews.canEdit && (
                          <button
                            className="button"
                            disabled={!row.reviewer.available}
                            onClick={() => setReview(row)}
                          >
                            {l.schedule}
                          </button>
                        )}
                      </article>
                    ))}
                </>
              )}
            </fieldset>
          </>
        )}
      </fieldset>
    </section>
  );
}
