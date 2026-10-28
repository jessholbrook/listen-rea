"use client";
import { unifiedLabels } from "@/lib/unified-planning";
import { calendarLabels } from "@/lib/follow-up-calendar";
import {
  operationsWorkspaceLabels,
  followUpPriorities,
  type OperationsPins,
  type PinScope,
} from "@/lib/operations-workspace";
import { operationsReportConfig } from "@/lib/operations-report";
import { defaultTaskActivityFilters } from "@/lib/task-activity";
import { followUpWorkloadLabels } from "@/lib/follow-up-workload";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { languages, languageNames, type Language } from "@/lib/localization";
import {
  loadOperations,
  operationsLabels,
  operationsSummary,
  type OperationsData,
  type ActionEntry,
  type ReviewEntry,
} from "@/lib/research-operations";
import {
  defaultActionFilters,
  localCalendarDay,
} from "@/lib/research-action-center";
import {
  defaultInboxFilters,
  inboxLabels,
  type InboxFilters,
  type InboxPacket,
} from "@/lib/team-review-inbox";
import { activityLabels } from "@/lib/review-activity";
import { defaultActivityFilters } from "./review-activity-panel";
import {
  reviewViewConfig,
  savedViewConfig,
  type SavedReviewViewItem,
} from "@/lib/saved-review-views";
export default function ResearchOperationsPanel({
  openPlanning,
  openReviews,
  openActions,
}: {
  openPlanning: (
    entry: Language | import("@/lib/unified-view-config").UnifiedViewConfig,
  ) => void;
  openReviews: (entry: ReviewEntry) => void;
  openActions: (entry: ActionEntry) => void;
}) {
  const [pins, setPins] = useState<OperationsPins | null>(null);
  const [language, setLanguage] = useState<Language>("en"),
    [data, setData] = useState<OperationsData | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(""),
    [loadedAt, setLoadedAt] = useState(""),
    [today, setToday] = useState(localCalendarDay);
  const epoch = useRef(0),
    controller = useRef<AbortController | null>(null),
    l = operationsLabels[language],
    w = operationsWorkspaceLabels[language];
  async function load() {
    const n = ++epoch.current,
      c = new AbortController();
    controller.current?.abort();
    controller.current = c;
    setData(null);
    setPins(null);
    setError("");
    setBusy(true);
    setSelected("");
    setLoadedAt("");
    try {
      const [d, boards] = await Promise.all([
        loadOperations((route) =>
          api(route, "GET", undefined, undefined, c.signal),
        ),
        api<OperationsPins>(
          "library/operations-pins",
          "GET",
          undefined,
          undefined,
          c.signal,
        ),
      ]);
      if (n === epoch.current) {
        setData(d);
        setPins(boards);
        setLoadedAt(new Date().toISOString());
        setToday(localCalendarDay());
      }
    } catch {
      c.abort();
      if (n === epoch.current) setError(l.failed);
    } finally {
      if (n === epoch.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
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
  const summary = data ? operationsSummary(data, today) : null;
  const review = (filters: Partial<InboxFilters>) =>
    openReviews({
      language,
      config: reviewViewConfig.parse({
        kind: "requests",
        filters: { ...defaultInboxFilters, ...filters },
      }),
    });
  const tasks = (collectionId = "") =>
    openActions({
      language,
      filters: { ...defaultActionFilters, due: "overdue", collectionId },
    });
  const packet = (p: Pick<InboxPacket, "id" | "collectionId">) =>
    openReviews({
      language,
      packet: { id: p.id, collectionId: p.collectionId },
    });
  async function apply(viewId = selected) {
    const old = data?.views.find((v) => v.id === viewId);
    if (!old) return;
    const n = ++epoch.current,
      c = new AbortController();
    controller.current?.abort();
    controller.current = c;
    setBusy(true);
    setError("");
    try {
      const { view } = await api<{ view: SavedReviewViewItem }>(
        `library/saved-review-views/${old.id}?version=${old.version}`,
        "GET",
        undefined,
        undefined,
        c.signal,
      );
      if (n === epoch.current) {
        const config = savedViewConfig.parse(view.config);
        if (config.kind === "tasks" || config.kind === "task_activity")
          openActions({
            language,
            filters:
              config.kind === "tasks"
                ? config.filters
                : { ...defaultActionFilters },
            config,
          });
        else if (config.kind === "unified") openPlanning(config);
        else if (config.kind === "report_unified") openPlanning(config.report);
        else if (config.kind === "calendar")
          openActions({
            planning: config,
            language: config.language,
            filters: { ...defaultActionFilters },
          });
        else if (
          config.kind === "report_calendar" ||
          config.kind === "report_workload" ||
          config.kind === "report_activity"
        )
          openActions({
            language: config.report.language,
            filters: { ...defaultActionFilters },
            report: config.report,
          });
        else openReviews({ language, config });
      }
    } catch {
      if (n === epoch.current) {
        setData(null);
        setSelected("");
        setLoadedAt("");
        setError(l.unavailable);
      }
    } finally {
      if (n === epoch.current) setBusy(false);
    }
  }
  async function savePins(scope: PinScope, viewIds: string[]) {
    if (!pins) return;
    const n = ++epoch.current;
    setBusy(true);
    setError("");
    try {
      await api("library/operations-pins/" + scope, "PUT", {
        version: pins[scope].version,
        viewIds,
      });
      if (n === epoch.current) await load();
    } catch (e) {
      if (n === epoch.current) {
        setData(null);
        setPins(null);
        setLoadedAt("");
        setSelected("");
        setError((e as Error).message);
      }
    } finally {
      if (n === epoch.current) setBusy(false);
    }
  }
  function quickReport(kind: "workload" | "task_activity") {
    const { page: _, ...history } = defaultTaskActivityFilters;
    const report = operationsReportConfig.parse({
      kind,
      language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      filters:
        kind === "workload"
          ? { collectionId: "", query: "", show: "all" }
          : history,
    });
    if (report.kind === "workload" || report.kind === "task_activity")
      openActions({ language, filters: { ...defaultActionFilters }, report });
  }
  function movePin(scope: PinScope, index: number, delta: number) {
    const ids = [...pins![scope].viewIds];
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    void savePins(scope, ids);
  }
  return (
    <section
      className="panel library-stack operations-home"
      aria-label={l.title}
      aria-busy={busy}
    >
      <h2>{l.title}</h2>
      <p className="muted">{l.notice}</p>
      <label>
        {l.language}
        <select
          aria-label={l.language}
          value={language}
          disabled={busy}
          onChange={(e) => setLanguage(e.target.value as Language)}
        >
          {languages.map((k) => (
            <option key={k} value={k}>
              {languageNames[k]}
            </option>
          ))}
        </select>
      </label>
      <button className="button" disabled={busy} onClick={() => void load()}>
        {l.refresh}
      </button>
      {error && <p role="alert">{error}</p>}
      {data && summary && (
        <>
          <p role="status">
            {l.updated}{" "}
            <time dateTime={loadedAt}>
              {new Date(loadedAt).toLocaleString(language)}
            </time>
          </p>
          {pins && (
            <section className="library-stack" aria-label={w.title}>
              <h3>{w.title}</h3>
              <p className="muted">{w.notice}</p>
              {(["private", "shared"] as const).map((scope) => (
                <section
                  className="library-stack"
                  key={scope}
                  aria-label={scope === "private" ? w.personal : w.team}
                >
                  <h4>{scope === "private" ? w.personal : w.team}</h4>
                  {!pins[scope].viewIds.length && <p>{w.empty}</p>}
                  <ol>
                    {pins[scope].viewIds.map((id, i) => {
                      const view = data.views.find((v) => v.id === id);
                      if (!view) return null;
                      return (
                        <li
                          className="panel library-stack"
                          key={id}
                          data-operation-pin={id}
                        >
                          <strong>{view.name}</strong>
                          <span>{l[view.visibility]}</span>
                          <button
                            className="button"
                            disabled={busy}
                            onClick={() => void apply(id)}
                          >
                            {w.open}
                          </button>
                          {(scope === "private" || pins.canManageShared) && (
                            <div className="toolbar">
                              <button
                                className="button"
                                disabled={busy || i === 0}
                                onClick={() => movePin(scope, i, -1)}
                              >
                                {w.up}
                              </button>
                              <button
                                className="button"
                                disabled={
                                  busy || i + 1 === pins[scope].viewIds.length
                                }
                                onClick={() => movePin(scope, i, 1)}
                              >
                                {w.down}
                              </button>
                              <button
                                className="button"
                                disabled={busy}
                                onClick={() =>
                                  void savePins(
                                    scope,
                                    pins[scope].viewIds.filter((v) => v !== id),
                                  )
                                }
                              >
                                {w.remove}
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ))}
              <p className="muted">{w.manage}</p>
              <button
                className="button"
                disabled={busy}
                onClick={() => openPlanning(language)}
              >
                {unifiedLabels[language].title}
              </button>
              <section className="library-stack" aria-label={w.quick}>
                <h4>{w.quick}</h4>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    openActions({
                      language,
                      mode: "calendar",
                      filters: { ...defaultActionFilters },
                    })
                  }
                >
                  {calendarLabels[language].title}
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => quickReport("workload")}
                >
                  {w.workload}
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => quickReport("task_activity")}
                >
                  {w.activity}
                </button>
              </section>
              <section className="library-stack" aria-label={w.priorities}>
                <h4>{w.priorities}</h4>
                <p className="muted">{w.overlap}</p>
                <div className="operations-grid">
                  {followUpPriorities(data.actions, today).map((p) => (
                    <article
                      className="panel library-stack"
                      key={p.kind}
                      aria-label={w[p.kind]}
                    >
                      <h5>{w[p.kind]}</h5>
                      <strong className="operations-count">{p.count}</strong>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() =>
                          openActions({ language, filters: p.filters })
                        }
                      >
                        {w.queue}
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            </section>
          )}
          <div className="operations-grid">
            {[
              [l.overdueTasks, summary.tasks.length, l.tasks, () => tasks()],
              [
                l.overdueReviews,
                summary.overdue.length,
                l.reviews,
                () => review({ reviewer: "", due: "overdue" }),
              ],
              [
                l.blocked,
                summary.blocked.length,
                l.blockers,
                () =>
                  review({ reviewer: "", decision: "all", state: "blocked" }),
              ],
              [l.mine, summary.mine.length, l.myReviews, () => review({})],
              [
                l.ready,
                summary.ready.length,
                l.final,
                () => review({ reviewer: "", decision: "all", state: "ready" }),
              ],
            ].map(([title, count, text, action]) => (
              <article
                className="panel library-stack"
                key={String(title)}
                aria-label={String(title)}
              >
                <h3>{String(title)}</h3>
                <strong className="operations-count">{String(count)}</strong>
                <button
                  className="button"
                  disabled={busy}
                  onClick={action as () => void}
                >
                  {String(text)}
                </button>
              </article>
            ))}
          </div>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              openActions({
                language,
                filters: { ...defaultActionFilters },
                mode: "workload",
              })
            }
          >
            {followUpWorkloadLabels[language].title}
          </button>
          <p className="muted">{l.limit}</p>
          <section className="library-stack" aria-label={l.overdueTasks}>
            <h3>{l.overdueTasks}</h3>
            {!summary.tasks.length && <p>{l.empty}</p>}
            {summary.tasks.slice(0, 5).map((t) => (
              <article className="panel library-stack" key={t.id}>
                <strong>{t.title}</strong>
                <span>
                  {
                    data.actions.collections.find(
                      (c) => c.id === t.collectionId,
                    )?.title
                  }
                </span>
                <time dateTime={t.dueDate!}>{t.dueDate}</time>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => tasks(t.collectionId)}
                >
                  {l.openTask}
                </button>
              </article>
            ))}
          </section>
          <section className="library-stack" aria-label={l.blocked}>
            <h3>{l.blocked}</h3>
            {!summary.blocked.length && <p>{l.empty}</p>}
            {summary.blocked.slice(0, 5).map((p) => (
              <article className="panel library-stack" key={p.id}>
                <strong>{p.title}</strong>
                <span>{p.collectionTitle}</span>
                <span>
                  {inboxLabels[language].openComments}: {p.openComments}
                </span>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => packet(p)}
                >
                  {l.openPacket}
                </button>
              </article>
            ))}
          </section>
          <section className="library-stack" aria-label={l.recent}>
            <h3>{l.recent}</h3>
            <p className="muted">{l.retained}</p>
            {!summary.activity.length && <p>{l.empty}</p>}
            {summary.activity.slice(0, 5).map((e) => (
              <article className="panel library-stack" key={e.id}>
                <strong>{activityLabels[language][e.action]}</strong>
                <span>{e.packet.title}</span>
                <span>
                  {e.actor
                    ? e.actor.name || activityLabels[language].former
                    : activityLabels[language].system}
                </span>
                <time dateTime={e.at}>
                  {new Date(e.at).toLocaleString(language)}
                </time>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => packet(e.packet)}
                >
                  {l.openPacket}
                </button>
              </article>
            ))}
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                const { page: _, ...filters } = defaultActivityFilters;
                openReviews({
                  language,
                  config: reviewViewConfig.parse({ kind: "activity", filters }),
                });
              }}
            >
              {l.history}
            </button>
          </section>
          <section className="library-stack" aria-label={l.saved}>
            <h3>{l.saved}</h3>
            {!data.views.length ? (
              <p>{l.empty}</p>
            ) : (
              <>
                <label>
                  {l.choose}
                  <select
                    aria-label={l.choose}
                    disabled={busy}
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    <option value="">—</option>
                    {data.views.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} · {l[v.visibility]}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button"
                  disabled={busy || !selected}
                  onClick={() => void apply()}
                >
                  {l.apply}
                </button>
                {pins && (
                  <>
                    <button
                      className="button"
                      disabled={
                        busy ||
                        !selected ||
                        pins.private.viewIds.includes(selected) ||
                        pins.private.viewIds.length >= 12
                      }
                      onClick={() =>
                        void savePins("private", [
                          ...pins.private.viewIds,
                          selected,
                        ])
                      }
                    >
                      {w.pinPersonal}
                    </button>
                    {pins.canManageShared && (
                      <button
                        className="button"
                        disabled={
                          busy ||
                          !selected ||
                          data.views.find((v) => v.id === selected)
                            ?.visibility !== "shared" ||
                          pins.shared.viewIds.includes(selected) ||
                          pins.shared.viewIds.length >= 12
                        }
                        onClick={() =>
                          void savePins("shared", [
                            ...pins.shared.viewIds,
                            selected,
                          ])
                        }
                      >
                        {w.pinTeam}
                      </button>
                    )}
                  </>
                )}
              </>
            )}
            <button
              className="button"
              disabled={busy}
              onClick={() => review({})}
            >
              {l.manage}
            </button>
          </section>
        </>
      )}
    </section>
  );
}
