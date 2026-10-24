"use client";
import type { ReviewEntry } from "@/lib/research-operations";
import SavedReviewViewsPanel from "./saved-review-views-panel";
import {
  reviewViewConfig,
  savedViewLabels,
  type ReviewViewConfig,
} from "@/lib/saved-review-views";
import ReviewActivityPanel, {
  defaultActivityFilters,
} from "./review-activity-panel";
import { activityLabels } from "@/lib/review-activity";
import BatchReviewPlansPanel from "./batch-review-plans-panel";
import { batchLabels } from "@/lib/batch-review-plans";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { languages, languageNames, type Language } from "@/lib/localization";
import {
  inboxLabels,
  defaultInboxFilters,
  selectInboxPackets,
  matchingInboxReviewers,
  inboxNextDeadline,
  type ReviewInbox,
  type InboxPacket,
  type InboxFilters,
} from "@/lib/team-review-inbox";
import { localCalendarDay } from "@/lib/research-action-center";
import { deadlineLabels, reviewOverdue } from "@/lib/review-deadlines";
import ReviewWorkloadPanel from "./review-workload-panel";
import { workloadLabels, defaultWorkloadFilters } from "@/lib/review-workload";
import CollectionHandoffPanel from "./collection-handoff-panel";
import CollectionReviewPanel from "./collection-review-panel";
export default function TeamReviewInboxPanel({
  openSource,
  openBrief,
  refresh,
  initial,
}: {
  openSource: (id: string) => Promise<void>;
  openBrief: (id: string) => void;
  refresh: number;
  initial?: ReviewEntry;
}) {
  const [language, setLanguage] = useState<Language>(initial?.language || "en"),
    [activityState, setActivityState] = useState(
      initial?.config?.kind === "activity"
        ? { ...initial.config.filters, page: 0 }
        : { ...defaultActivityFilters },
    ),
    [mode, setMode] = useState<string>(initial?.config?.kind || "requests"),
    [workloadState, setWorkloadState] = useState({
      filters:
        initial?.config?.kind === "workload"
          ? initial.config.filters
          : { ...defaultWorkloadFilters },
      selected:
        initial?.config?.kind === "workload"
          ? initial.config.selected
          : (null as string | null),
    }),
    [savedViewDirty, setSavedViewDirty] = useState(false),
    [workloadRevision, setWorkloadRevision] = useState(0),
    [batchDirty, setBatchDirty] = useState(false),
    [workloadDirty, setWorkloadDirty] = useState(false),
    [notice, setNotice] = useState(""),
    [data, setData] = useState<ReviewInbox | null>(null),
    [filters, setFilters] = useState(
      initial?.config?.kind === "requests"
        ? initial.config.filters
        : { ...defaultInboxFilters },
    ),
    [page, setPage] = useState(0),
    [today, setToday] = useState(localCalendarDay),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [packet, setPacket] = useState<Pick<
      InboxPacket,
      "id" | "collectionId"
    > | null>(null),
    [dashboard, setDashboard] = useState<string | null>(null);
  const initialPacket = useRef(initial?.packet);
  const dl = deadlineLabels[language];
  const l = inboxLabels[language],
    epoch = useRef(0),
    controller = useRef<AbortController | null>(null),
    closeButton = useRef<HTMLButtonElement | null>(null);
  async function run(action?: () => Promise<unknown>, message = "") {
    const g = ++epoch.current,
      c = new AbortController();
    controller.current?.abort();
    controller.current = c;
    setSavedViewDirty(false);
    setBatchDirty(false);
    setToday(localCalendarDay());
    setBusy(true);
    setData(null);
    setError("");
    setNotice("");
    setPacket(null);
    setDashboard(null);
    setPage(0);
    try {
      if (action) await action();
      if (g !== epoch.current) return;
      const v = await api<ReviewInbox>(
        "library/review-inbox",
        "GET",
        undefined,
        undefined,
        c.signal,
      );
      if (g === epoch.current) {
        setData(v);
        const target = initialPacket.current;
        initialPacket.current = undefined;
        if (
          target &&
          v.packets.some(
            (p) => p.id === target.id && p.collectionId === target.collectionId,
          )
        )
          setPacket(target);
        else if (target) setError(activityLabels[language].unavailablePacket);
        setNotice(message);
      }
    } catch (e) {
      if (g === epoch.current) setError((e as Error).message);
    } finally {
      if (g === epoch.current) setBusy(false);
    }
  }
  useEffect(() => {
    void run();
    return () => {
      epoch.current++;
      controller.current?.abort();
    };
  }, [language, refresh]);
  useEffect(() => {
    if (packet) {
      closeButton.current?.focus();
      closeButton.current?.scrollIntoView({ block: "center" });
    }
  }, [packet?.id]);
  useEffect(() => {
    const tick = () => setToday(localCalendarDay()),
      timer = window.setInterval(tick, 60000);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, []);
  useEffect(() => setPage(0), [today]);
  function filter(v: Partial<InboxFilters>) {
    setFilters((f) => ({ ...f, ...v }));
    setPage(0);
  }
  function currentSavedConfig(): ReviewViewConfig {
    if (mode === "workload")
      return reviewViewConfig.parse({ kind: "workload", ...workloadState });
    if (mode === "activity") {
      const { page: _, ...filters } = activityState;
      return reviewViewConfig.parse({ kind: "activity", filters });
    }
    return reviewViewConfig.parse({ kind: "requests", filters });
  }
  function applySavedConfig(config: ReviewViewConfig) {
    if (config.kind === "requests") setFilters(config.filters);
    if (config.kind === "workload") {
      setWorkloadState({ filters: config.filters, selected: config.selected });
      setWorkloadRevision((v) => v + 1);
    }
    if (config.kind === "activity")
      setActivityState({ ...config.filters, page: 0 });
    setMode(config.kind);
    void run(undefined, savedViewLabels[language].applied);
  }
  const rows = data ? selectInboxPackets(data, filters, today) : [],
    pages = Math.max(1, Math.ceil(rows.length / 20)),
    currentPage = Math.min(page, pages - 1);
  const options = data
    ? [
        ...data.members,
        ...Array.from(
          new Set(data.packets.flatMap((p) => p.reviewers.map((r) => r.id))),
        )
          .filter((id) => !data.members.some((m) => m.id === id))
          .map((id) => ({ id, name: l.unavailableReviewer })),
      ]
    : [];
  return (
    <section
      className="panel library-stack team-review-inbox"
      aria-label={l.title}
      aria-busy={busy}
    >
      <h2>{l.title}</h2>
      <p className="muted">{l.notice}</p>
      <p className="muted">{dl.notice}</p>
      <label>
        {l.language}
        <select
          aria-label={l.language}
          disabled={busy || workloadDirty || batchDirty || savedViewDirty}
          value={language}
          onChange={(e) => {
            setLanguage(e.target.value as Language);
            setActivityState({ ...defaultActivityFilters });
            setFilters({ ...defaultInboxFilters });
            setWorkloadState({
              filters: { ...defaultWorkloadFilters },
              selected: null,
            });
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
        disabled={busy || workloadDirty || batchDirty || savedViewDirty}
        onClick={() => void run()}
      >
        {l.refresh}
      </button>
      <div className="toolbar">
        <button
          className="button"
          disabled={
            busy ||
            workloadDirty ||
            batchDirty ||
            savedViewDirty ||
            !!packet ||
            !!dashboard
          }
          aria-pressed={mode === "requests"}
          onClick={() => setMode("requests")}
        >
          {workloadLabels[language].requests}
        </button>
        <button
          className="button"
          disabled={
            busy ||
            workloadDirty ||
            batchDirty ||
            savedViewDirty ||
            !!packet ||
            !!dashboard
          }
          aria-pressed={mode === "workload"}
          onClick={() => setMode("workload")}
        >
          {workloadLabels[language].tab}
        </button>
        {data?.canEdit && (
          <button
            className="button"
            disabled={
              busy ||
              workloadDirty ||
              batchDirty ||
              savedViewDirty ||
              !!packet ||
              !!dashboard
            }
            aria-pressed={mode === "batch"}
            onClick={() => setMode("batch")}
          >
            {batchLabels[language].title}
          </button>
        )}
        <button
          className="button"
          disabled={
            busy ||
            workloadDirty ||
            batchDirty ||
            savedViewDirty ||
            !!packet ||
            !!dashboard
          }
          aria-pressed={mode === "activity"}
          onClick={() => setMode("activity")}
        >
          {activityLabels[language].title}
        </button>
      </div>
      {data &&
        ["requests", "workload", "activity"].includes(mode) &&
        !packet &&
        !dashboard && (
          <SavedReviewViewsPanel
            key={mode}
            kind={mode as ReviewViewConfig["kind"]}
            language={language}
            disabled={busy || workloadDirty || batchDirty}
            current={currentSavedConfig}
            onApply={(config) =>
              applySavedConfig(reviewViewConfig.parse(config))
            }
            onDirty={setSavedViewDirty}
            onStart={() => setNotice("")}
          />
        )}
      <fieldset
        disabled={savedViewDirty}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        {data && mode === "activity" && !packet && !dashboard && (
          <ReviewActivityPanel
            language={language}
            saved={activityState}
            onState={setActivityState}
            onOpen={(p) => {
              setDashboard(null);
              setPacket(p);
            }}
          />
        )}
        {data && data.canEdit && mode === "batch" && !packet && !dashboard && (
          <BatchReviewPlansPanel
            data={data}
            language={language}
            onDirty={setBatchDirty}
            onFinish={() => {
              setBatchDirty(false);
              void run();
            }}
          />
        )}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {data && mode === "workload" && !packet && !dashboard && (
          <ReviewWorkloadPanel
            key={workloadRevision}
            saved={workloadState}
            onState={setWorkloadState}
            data={data}
            today={today}
            language={language}
            onDirty={setWorkloadDirty}
            onError={(s) => {
              epoch.current++;
              controller.current?.abort();
              setData(null);
              setPacket(null);
              setDashboard(null);
              setNotice("");
              setError(s);
              setBusy(false);
            }}
            openPacket={(p) => {
              setDashboard(null);
              setPacket(p);
            }}
            onAction={(collectionId, input) =>
              void run(
                () =>
                  api(
                    `library/collections/${collectionId}/handoff/feedback`,
                    "POST",
                    input,
                  ),
                workloadLabels[language].saved,
              )
            }
          />
        )}

        {data && mode === "requests" && (
          <>
            <div className="library-stack">
              <label>
                {l.collection}
                <select
                  aria-label={l.collection}
                  value={filters.collectionId}
                  onChange={(e) => filter({ collectionId: e.target.value })}
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
                {l.reviewer}
                <select
                  aria-label={l.reviewer}
                  value={filters.reviewer}
                  onChange={(e) => filter({ reviewer: e.target.value })}
                >
                  <option value="">{l.everyone}</option>
                  <option value="mine">{l.mine}</option>
                  <option value="unassigned">{l.unassigned}</option>
                  {filters.reviewer &&
                    !["mine", "unassigned"].includes(filters.reviewer) &&
                    !options.some((m) => m.id === filters.reviewer) && (
                      <option value={filters.reviewer}>
                        {l.unavailableReviewer}
                      </option>
                    )}
                  {options.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {l.decision}
                <select
                  aria-label={l.decision}
                  value={filters.decision}
                  onChange={(e) => filter({ decision: e.target.value })}
                >
                  {(["pending", "approved", "all"] as const).map((k) => (
                    <option key={k} value={k}>
                      {l[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {l.state}
                <select
                  aria-label={l.state}
                  value={filters.state}
                  onChange={(e) => filter({ state: e.target.value })}
                >
                  <option value="">{l.anyState}</option>
                  {(["blocked", "awaiting", "ready", "exported"] as const).map(
                    (k) => (
                      <option key={k} value={k}>
                        {l[k]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                {dl.window}
                <select
                  aria-label={dl.window}
                  value={filters.due}
                  onChange={(e) => filter({ due: e.target.value })}
                >
                  <option value="">{dl.any}</option>
                  {(["overdue", "today", "week", "undated"] as const).map(
                    (k) => (
                      <option key={k} value={k}>
                        {dl[k]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                {l.query}
                <input
                  aria-label={l.query}
                  maxLength={160}
                  value={filters.query}
                  onChange={(e) => filter({ query: e.target.value })}
                />
              </label>
              <button
                className="button"
                onClick={() => {
                  setFilters({ ...defaultInboxFilters });
                  setPage(0);
                }}
              >
                {l.reset}
              </button>
            </div>
            <p role="status">
              {l.matching}: {rows.length}
            </p>
            <p>
              {dl.overdueCount}:{" "}
              {rows.reduce(
                (n, p) =>
                  n +
                  matchingInboxReviewers(p, data, filters, today).filter((r) =>
                    reviewOverdue(r, today),
                  ).length,
                0,
              )}
            </p>
            {!rows.length && <p>{l.empty}</p>}
            {pages > 1 && (
              <div className="toolbar">
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
                  disabled={currentPage === pages - 1}
                  onClick={() => setPage(currentPage + 1)}
                >
                  {l.next}
                </button>
              </div>
            )}
            {rows.slice(currentPage * 20, currentPage * 20 + 20).map((p) => (
              <article
                className="panel library-stack"
                data-review-packet={p.id}
                key={p.id}
              >
                <h3>{p.title}</h3>
                <p>{p.collectionTitle}</p>
                <p>{l[p.state]}</p>
                {inboxNextDeadline(p, data, filters, today) && (
                  <p>
                    {dl.next}:{" "}
                    <time
                      dateTime={inboxNextDeadline(p, data, filters, today)!}
                    >
                      {inboxNextDeadline(p, data, filters, today)}
                    </time>
                  </p>
                )}
                <p>
                  {l.openComments}: {p.openComments} · {l.remaining}:{" "}
                  {p.reviewers.filter((r) => !r.approvedAt).length}/
                  {p.reviewers.length}
                </p>
                {!p.reviewers.length && <p>{l.none}</p>}
                {p.reviewers.map((r) => (
                  <div key={r.id}>
                    <p>
                      {r.name || l.unavailableReviewer} ·{" "}
                      {r.approvedAt ? l.approved : l.pending}
                    </p>
                    <p>
                      {dl.due}:{" "}
                      {r.dueDate ? (
                        <time dateTime={r.dueDate}>{r.dueDate}</time>
                      ) : (
                        dl.none
                      )}
                      {reviewOverdue(r, today)
                        ? ` · ${dl.overdue}`
                        : !r.approvedAt && r.dueDate === today
                          ? ` · ${dl.today}`
                          : ""}
                    </p>
                  </div>
                ))}
                <p>
                  {l.updated}:{" "}
                  <time dateTime={p.updatedAt}>
                    {new Intl.DateTimeFormat(language, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(p.updatedAt))}
                  </time>
                </p>
                <button
                  className="button"
                  onClick={() => {
                    setDashboard(null);
                    setPacket(p);
                  }}
                >
                  {l.open}
                </button>
                <button
                  className="button"
                  onClick={() => {
                    setPacket(null);
                    setDashboard(p.collectionId);
                  }}
                >
                  {l.dashboard}
                </button>
              </article>
            ))}
          </>
        )}
        {packet && (
          <div className="library-stack" key={packet.id + language}>
            <button
              ref={closeButton}
              className="button"
              onClick={() => void run()}
            >
              {l.close}
            </button>
            <CollectionHandoffPanel
              id={packet.collectionId}
              expectedId={packet.id}
              language={language}
              refresh={0}
            />
          </div>
        )}
        {dashboard && (
          <CollectionReviewPanel
            key={dashboard + language}
            id={dashboard}
            language={language}
            openSource={openSource}
            openBrief={openBrief}
            close={() => void run()}
          />
        )}
      </fieldset>
    </section>
  );
}
