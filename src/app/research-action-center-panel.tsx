"use client";
import {
  calendarViewConfig,
  type CalendarViewConfig,
} from "@/lib/calendar-view-config";
import FollowUpCalendarPanel from "./follow-up-calendar-panel";
import { initialCalendarState, calendarLabels } from "@/lib/follow-up-calendar";
import type { OperationsReportConfig } from "@/lib/operations-report";
import FollowUpWorkloadPanel from "./follow-up-workload-panel";
import {
  defaultFollowUpScope,
  followUpWorkloadLabels,
} from "@/lib/follow-up-workload";
import SavedReviewViewsPanel from "./saved-review-views-panel";
import { followUpViewConfig } from "@/lib/saved-review-views";
import TaskActivityPanel from "./task-activity-panel";
import {
  defaultTaskActivityFilters,
  taskActivityLabels,
} from "@/lib/task-activity";
import OperationsTriagePanel from "./operations-triage-panel";
import { triageLabels } from "@/lib/operations-triage";
import type { ActionEntry } from "@/lib/research-operations";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { languages, languageNames, type Language } from "@/lib/localization";
import {
  actionLabels,
  defaultActionFilters,
  localCalendarDay,
  actionOverdue,
  selectActionTasks,
  type ActionCenter,
  type ActionTask,
} from "@/lib/research-action-center";
import CollectionReviewPanel from "./collection-review-panel";
import LibrarySavedAnswers from "./library-saved-answers";
export default function ResearchActionCenterPanel({
  openSource,
  openBrief,
  refresh,
  initial,
}: {
  openSource: (id: string) => Promise<void>;
  openBrief: (id: string) => void;
  refresh: number;
  initial?: ActionEntry;
}) {
  const [calendarState, setCalendarState] = useState(() =>
    initial?.report?.kind === "calendar"
      ? initial.report.filters
      : initial?.planning?.filters || initialCalendarState(localCalendarDay()),
  );
  const [reportTimeZone, setReportTimeZone] = useState(
    () =>
      initial?.report?.timeZone ||
      initial?.planning?.timeZone ||
      Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [workloadShow, setWorkloadShow] = useState<
    "all" | "active" | "overdue"
  >(initial?.report?.kind === "workload" ? initial.report.filters.show : "all");
  const [reportLocked, setReportLocked] = useState(false);
  const [workloadScope, setWorkloadScope] = useState({
    ...(initial?.report?.kind === "workload"
      ? {
          collectionId: initial.report.filters.collectionId,
          query: initial.report.filters.query,
        }
      : defaultFollowUpScope),
  });
  const [viewedTask, setViewedTask] = useState<string | null>(null);
  const [savedViewDirty, setSavedViewDirty] = useState(false);
  const [mode, setMode] = useState(
      initial?.report?.kind === "workload"
        ? "workload"
        : initial?.report?.kind === "task_activity"
          ? "history"
          : initial?.report?.kind === "calendar" || initial?.planning
            ? "calendar"
            : initial?.mode
              ? initial.mode
              : initial?.config?.kind === "task_activity"
                ? "history"
                : "tasks",
    ),
    [historyFilters, setHistoryFilters] = useState({
      ...(initial?.report?.kind === "task_activity"
        ? { ...initial.report.filters, page: 0 }
        : initial?.config?.kind === "task_activity"
          ? { ...initial.config.filters, page: 0 }
          : defaultTaskActivityFilters),
    });
  const pendingTask = useRef<{ id: string; collectionId: string } | null>(
    initial?.task || null,
  );
  const [triageMode, setTriageMode] = useState(false),
    [triageDirty, setTriageDirty] = useState(false),
    [triageLocked, setTriageLocked] = useState(false);
  const [language, setLanguage] = useState<Language>(
      initial?.report?.language ||
        initial?.planning?.language ||
        initial?.language ||
        "en",
    ),
    [data, setData] = useState<ActionCenter | null>(null),
    [page, setPage] = useState(0),
    [filters, setFilters] = useState(
      initial?.config?.kind === "tasks"
        ? initial.config.filters
        : initial?.filters || { ...defaultActionFilters },
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [editing, setEditing] = useState<ActionTask | null>(null),
    [collection, setCollection] = useState<string | null>(null),
    [answer, setAnswer] = useState<ActionTask | null>(null),
    [today, setToday] = useState(localCalendarDay);
  const l = actionLabels[language],
    epoch = useRef(0),
    controller = useRef<AbortController | null>(null),
    titleInput = useRef<HTMLInputElement | null>(null);
  async function run(action?: () => Promise<unknown>) {
    const g = ++epoch.current,
      c = new AbortController();
    controller.current?.abort();
    controller.current = c;
    setReportLocked(false);
    setSavedViewDirty(false);
    setTriageMode(false);
    setTriageDirty(false);
    setTriageLocked(false);
    setViewedTask(null);
    setBusy(true);
    setPage(0);
    setData(null);
    setError("");
    setNotice("");
    setCollection(null);
    setAnswer(null);
    try {
      if (action) await action();
      if (g !== epoch.current) return;
      const v = await api<ActionCenter>(
        "library/action-center",
        "GET",
        undefined,
        undefined,
        c.signal,
      );
      if (g === epoch.current) {
        setData(v);
        const target = pendingTask.current;
        pendingTask.current = null;
        const task = target
          ? v.tasks.find(
              (t) =>
                t.id === target.id && t.collectionId === target.collectionId,
            )
          : undefined;
        setEditing(task && v.canEdit ? task : null);
        if (target && !task)
          setError(taskActivityLabels[language].unavailableTask);
        if (target && task) {
          const nextFilters = {
            ...defaultActionFilters,
            status: "all",
            collectionId: task.collectionId,
            query: task.title,
          };
          setFilters(nextFilters);
          setViewedTask(task.id);
        }
        setToday(localCalendarDay());
        if (action) setNotice(l.saved);
      }
    } catch (e) {
      if (g === epoch.current) {
        setError((e as Error).message);
        setEditing(null);
      }
    } finally {
      if (g === epoch.current) setBusy(false);
    }
  }
  function applyPlanning(config: CalendarViewConfig) {
    pendingTask.current = null;
    setCalendarState(config.filters);
    setReportTimeZone(config.timeZone);
    setMode("calendar");
    if (config.language !== language) setLanguage(config.language);
    else void run();
  }
  function applyReport(config: OperationsReportConfig) {
    if (config.kind === "unified") return;
    pendingTask.current = null;
    setReportTimeZone(config.timeZone);
    if (config.kind === "workload") {
      setWorkloadScope({
        collectionId: config.filters.collectionId,
        query: config.filters.query,
      });
      setWorkloadShow(config.filters.show);
      setMode("workload");
    } else if (config.kind === "calendar") {
      setCalendarState(config.filters);
      setMode("calendar");
    } else {
      setHistoryFilters({ ...config.filters, page: 0 });
      setMode("history");
    }
    if (config.language !== language) setLanguage(config.language);
    else void run();
  }
  useEffect(() => {
    setEditing(null);
    void run();
    return () => {
      epoch.current++;
      controller.current?.abort();
    };
  }, [language, refresh]);
  useEffect(() => {
    const tick = () => setToday(localCalendarDay());
    const timer = window.setInterval(tick, 60000);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, []);
  useEffect(() => {
    if (editing) {
      titleInput.current?.focus();
      titleInput.current?.scrollIntoView({ block: "center" });
    }
  }, [editing?.id]);
  useEffect(() => setPage(0), [filters, today]);
  useEffect(() => {
    if (viewedTask && data && !busy && !editing) {
      const row = document.querySelector<HTMLElement>(
        `[data-action-task="${viewedTask}"]`,
      );
      if (row) {
        row.focus();
        row.scrollIntoView({ block: "center" });
        setViewedTask(null);
      } else {
        const index = selectActionTasks(data, filters, today).findIndex(
          (t) => t.id === viewedTask,
        );
        if (index >= 0) setPage(Math.floor(index / 50));
      }
    }
  }, [viewedTask, data, busy, editing, filters, today, page]);
  const rows = data ? selectActionTasks(data, filters, today) : [];
  const pages = Math.max(1, Math.ceil(rows.length / 50)),
    currentPage = Math.min(page, pages - 1);
  return (
    <section
      className="panel library-stack"
      aria-label={l.title}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <h2>{l.title}</h2>
      <p className="muted">{l.notice}</p>
      <label>
        {l.language}
        <select
          aria-label={l.language}
          value={language}
          disabled={busy || triageDirty || savedViewDirty || reportLocked}
          onChange={(e) => {
            setWorkloadShow("all");
            setReportTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
            setWorkloadScope({ ...defaultFollowUpScope });
            setHistoryFilters({ ...defaultTaskActivityFilters });
            setFilters({ ...defaultActionFilters });
            setLanguage(e.target.value as Language);
          }}
        >
          {languages.map((k) => (
            <option key={k} value={k}>
              {languageNames[k]}
            </option>
          ))}
        </select>
      </label>
      <button
        className="button"
        disabled={busy || triageDirty || savedViewDirty || reportLocked}
        onClick={() => void run()}
      >
        {l.refresh}
      </button>
      <div className="toolbar">
        {(["tasks", "history", "workload", "calendar"] as const).map(
          (value) => (
            <button
              className="button"
              key={value}
              aria-pressed={mode === value}
              disabled={
                busy ||
                triageDirty ||
                savedViewDirty ||
                reportLocked ||
                !!editing ||
                !!collection ||
                !!answer
              }
              onClick={() => setMode(value)}
            >
              {value === "tasks"
                ? taskActivityLabels[language].tasks
                : value === "history"
                  ? taskActivityLabels[language].title
                  : value === "workload"
                    ? followUpWorkloadLabels[language].title
                    : calendarLabels[language].title}
            </button>
          ),
        )}
      </div>
      {data?.canEdit && !triageMode && mode === "tasks" && (
        <button
          className="button"
          disabled={
            busy || savedViewDirty || !!editing || !!collection || !!answer
          }
          onClick={() => setTriageMode(true)}
        >
          {triageLabels[language].title}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {data &&
        (mode === "tasks" || mode === "history" || mode === "calendar") && (
          <SavedReviewViewsPanel
            key={mode}
            kind={
              mode === "tasks"
                ? "tasks"
                : mode === "calendar"
                  ? "calendar"
                  : "task_activity"
            }
            language={language}
            disabled={
              busy ||
              reportLocked ||
              triageMode ||
              triageDirty ||
              !!editing ||
              !!collection ||
              !!answer
            }
            current={() => {
              if (mode === "calendar")
                return calendarViewConfig.parse({
                  kind: "calendar",
                  filters: calendarState,
                  language,
                  timeZone: reportTimeZone,
                });
              const { page: _, ...history } = historyFilters;
              return followUpViewConfig.parse(
                mode === "tasks"
                  ? { kind: "tasks", filters }
                  : { kind: "task_activity", filters: history },
              );
            }}
            onApply={(value) => {
              if (value.kind === "calendar") {
                applyPlanning(value);
                return;
              }
              const config = followUpViewConfig.parse(value);
              pendingTask.current = null;
              setEditing(null);
              if (config.kind === "tasks") setFilters(config.filters);
              else setHistoryFilters({ ...config.filters, page: 0 });
              setMode(config.kind === "tasks" ? "tasks" : "history");
              void run();
            }}
            onDirty={setSavedViewDirty}
            onStart={() => setNotice("")}
          />
        )}
      <fieldset
        disabled={savedViewDirty}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        {data && mode === "calendar" && (
          <FollowUpCalendarPanel
            timeZone={reportTimeZone}
            onTimeZone={setReportTimeZone}
            onApplyReport={applyReport}
            onReportLock={setReportLocked}
            data={data}
            state={calendarState}
            onState={setCalendarState}
            today={today}
            language={language}
            onDirty={setTriageDirty}
            onLock={setTriageLocked}
            onFinish={() => void run()}
            onOpen={(target) => {
              pendingTask.current = target;
              setMode("tasks");
              void run();
            }}
          />
        )}
        {data && mode === "workload" && (
          <FollowUpWorkloadPanel
            show={workloadShow}
            onShow={setWorkloadShow}
            timeZone={reportTimeZone}
            onTimeZone={setReportTimeZone}
            onApplyReport={applyReport}
            onReportLock={setReportLocked}
            data={data}
            scope={workloadScope}
            onScope={setWorkloadScope}
            today={today}
            language={language}
            onOpen={(filters) => {
              pendingTask.current = null;
              setFilters(filters);
              setMode("tasks");
              void run();
            }}
          />
        )}
        {data && mode === "history" && (
          <TaskActivityPanel
            timeZone={reportTimeZone}
            onTimeZone={setReportTimeZone}
            onApplyReport={applyReport}
            onReportLock={setReportLocked}
            language={language}
            filters={historyFilters}
            onState={setHistoryFilters}
            onOpen={(target) => {
              pendingTask.current = target;
              setMode("tasks");
              void run();
            }}
          />
        )}
        {data && mode === "tasks" && (
          <>
            <fieldset
              disabled={triageLocked}
              style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
            >
              <div className="library-stack">
                <label>
                  {l.collection}
                  <select
                    aria-label={l.collection}
                    disabled={busy}
                    value={filters.collectionId}
                    onChange={(e) =>
                      setFilters({ ...filters, collectionId: e.target.value })
                    }
                  >
                    <option value="">{l.allCollections}</option>
                    {filters.collectionId &&
                      !data.collections.some(
                        (c) => c.id === filters.collectionId,
                      ) && (
                        <option value={filters.collectionId}>
                          {l.unavailableCollection}
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
                  {l.assignee}
                  <select
                    aria-label={l.assignee}
                    disabled={busy}
                    value={filters.assignee}
                    onChange={(e) =>
                      setFilters({ ...filters, assignee: e.target.value })
                    }
                  >
                    <option value="">{l.allAssignees}</option>
                    <option value="mine">{l.mine}</option>
                    <option value="unassigned">{l.unassigned}</option>
                    {filters.assignee &&
                      !["mine", "unassigned"].includes(filters.assignee) &&
                      !data.members.some((m) => m.id === filters.assignee) && (
                        <option value={filters.assignee}>
                          {l.unavailableAssignee}
                        </option>
                      )}
                    {data.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {l.status}
                  <select
                    aria-label={l.status}
                    value={filters.status}
                    onChange={(e) =>
                      setFilters({ ...filters, status: e.target.value })
                    }
                  >
                    {(
                      [
                        "active",
                        "all",
                        "open",
                        "in_progress",
                        "completed",
                      ] as const
                    ).map((k) => (
                      <option key={k} value={k}>
                        {l[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {l.due}
                  <select
                    aria-label={l.due}
                    value={filters.due}
                    onChange={(e) =>
                      setFilters({ ...filters, due: e.target.value })
                    }
                  >
                    <option value="">{l.anyDue}</option>
                    {(["overdue", "today", "week", "undated"] as const).map(
                      (k) => (
                        <option key={k} value={k}>
                          {l[k]}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  {l.query}
                  <input
                    value={filters.query}
                    maxLength={160}
                    onChange={(e) =>
                      setFilters({ ...filters, query: e.target.value })
                    }
                  />
                </label>
                <button
                  className="button"
                  onClick={() => setFilters({ ...defaultActionFilters })}
                >
                  {l.reset}
                </button>
              </div>
            </fieldset>
            <p role="status">
              {l.matching}: {rows.length} · {l.overdue}:{" "}
              {rows.filter((t) => actionOverdue(t, today)).length} ·{" "}
              {l.completed}:{" "}
              {rows.filter((t) => t.status === "completed").length}
            </p>
            {triageMode && data.canEdit ? (
              <OperationsTriagePanel
                data={data}
                rows={rows}
                filterKey={JSON.stringify(filters)}
                language={language}
                onDirty={setTriageDirty}
                onLock={setTriageLocked}
                onFinish={() => void run()}
              />
            ) : (
              <>
                {editing && data.canEdit && (
                  <form
                    className="panel library-stack"
                    aria-label={l.edit}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const t = editing;
                      void run(() =>
                        api(
                          `library/collections/${t.collectionId}/tasks/${t.id}`,
                          "PUT",
                          {
                            version: t.version,
                            title: t.title,
                            assigneeId: t.assigneeId,
                            dueDate: t.dueDate,
                            status: t.status,
                          },
                        ),
                      );
                    }}
                  >
                    <label>
                      {l.titleField}
                      <input
                        ref={titleInput}
                        required
                        minLength={3}
                        maxLength={160}
                        value={editing.title}
                        onChange={(e) =>
                          setEditing({ ...editing, title: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      {l.assignee}
                      <select
                        aria-label={l.assignee}
                        value={editing.assigneeId || ""}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            assigneeId: e.target.value || null,
                          })
                        }
                      >
                        <option value="">{l.unassigned}</option>
                        {data.members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {l.status}
                      <select
                        aria-label={l.status}
                        value={editing.status}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            status: e.target.value as ActionTask["status"],
                          })
                        }
                      >
                        {(["open", "in_progress", "completed"] as const).map(
                          (k) => (
                            <option key={k} value={k}>
                              {l[k]}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      {l.dueDate}
                      <input
                        type="date"
                        min="2000-01-01"
                        max="2100-12-31"
                        value={editing.dueDate || ""}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            dueDate: e.target.value || null,
                          })
                        }
                      />
                    </label>
                    <button className="button" type="submit" disabled={busy}>
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
                {!rows.length && <p>{l.empty}</p>}
                {rows.length > 50 && (
                  <nav aria-label={l.page}>
                    <button
                      className="button"
                      disabled={currentPage === 0}
                      onClick={() => setPage(currentPage - 1)}
                    >
                      {l.previous}
                    </button>
                    <span>
                      {l.page} {currentPage + 1}/{pages}
                    </span>
                    <button
                      className="button"
                      disabled={currentPage + 1 >= pages}
                      onClick={() => setPage(currentPage + 1)}
                    >
                      {l.next}
                    </button>
                  </nav>
                )}
                {rows
                  .slice(currentPage * 50, (currentPage + 1) * 50)
                  .map((t) => (
                    <article
                      key={t.id}
                      data-action-task={t.id}
                      tabIndex={-1}
                      className="panel"
                    >
                      <h3>{t.title}</h3>
                      <button
                        className="button"
                        disabled={
                          busy ||
                          savedViewDirty ||
                          reportLocked ||
                          !!editing ||
                          !!collection ||
                          !!answer
                        }
                        onClick={() => {
                          setHistoryFilters({
                            ...defaultTaskActivityFilters,
                            collectionId: t.collectionId,
                            taskId: t.id,
                          });
                          setMode("history");
                        }}
                      >
                        {taskActivityLabels[language].view}
                      </button>
                      <p>
                        {
                          data.collections.find((c) => c.id === t.collectionId)
                            ?.title
                        }{" "}
                        · {l[t.status]} ·{" "}
                        {data.members.find((m) => m.id === t.assigneeId)
                          ?.name || l.unassigned}
                      </p>
                      {t.dueDate && (
                        <p>
                          {l.dueDate}:{" "}
                          <time dateTime={t.dueDate}>{t.dueDate}</time>
                          {actionOverdue(t, today) ? ` · ${l.overdue}` : ""}
                        </p>
                      )}
                      {t.completedAt && (
                        <p>
                          {l.completed}:{" "}
                          <time dateTime={t.completedAt}>
                            {new Intl.DateTimeFormat(language, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            }).format(new Date(t.completedAt))}
                          </time>
                        </p>
                      )}
                      {t.source && <p>{t.source.label}</p>}
                      {data.canEdit && (
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() => {
                            setEditing(t);
                            setNotice("");
                          }}
                        >
                          {l.edit}
                        </button>
                      )}
                      {t.target && t.source && (
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() => {
                            setEditing(null);
                            if (t.target!.kind === "interview")
                              void openSource(t.target!.id);
                            else if (t.target!.kind === "brief")
                              openBrief(t.target!.id);
                            else {
                              setCollection(null);
                              setAnswer(t);
                            }
                          }}
                        >
                          {l.review}
                        </button>
                      )}
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => {
                          setEditing(null);
                          setAnswer(null);
                          setCollection(t.collectionId);
                        }}
                      >
                        {l.openCollection}
                      </button>
                    </article>
                  ))}
              </>
            )}
          </>
        )}
        {collection && (
          <CollectionReviewPanel
            key={collection + language}
            id={collection}
            language={language}
            openSource={openSource}
            openBrief={openBrief}
            close={() => void run()}
          />
        )}
        {answer?.target && answer.source?.scope && (
          <LibrarySavedAnswers
            onlyId={answer.target.id}
            scope={answer.source.scope}
            language={language}
            refresh={0}
            openResponse={openSource}
            closed={() => void run()}
          />
        )}
      </fieldset>
    </section>
  );
}
