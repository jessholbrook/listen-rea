"use client";
import type { OperationsReportConfig } from "@/lib/operations-report";
import OperationsReportPanel from "./operations-report-panel";
import { useCallback, useEffect, useState } from "react";
import {
  followUpWorkload,
  followUpWorkloadLabels,
  workloadMetrics,
  workloadQueueFilters,
  defaultFollowUpScope,
  type FollowUpScope,
} from "@/lib/follow-up-workload";
import {
  actionLabels,
  type ActionCenter,
  type ActionFilters,
} from "@/lib/research-action-center";
import type { Language } from "@/lib/localization";
export default function FollowUpWorkloadPanel({
  timeZone,
  onTimeZone,
  onApplyReport,
  show,
  onShow,
  onReportLock,
  data,
  scope,
  onScope,
  today,
  language,
  onOpen,
}: {
  timeZone: string;
  onTimeZone: (v: string) => void;
  onApplyReport: (v: OperationsReportConfig) => void;
  show: "all" | "active" | "overdue";
  onShow: (v: "all" | "active" | "overdue") => void;
  onReportLock: (locked: boolean) => void;
  data: ActionCenter;
  scope: FollowUpScope;
  onScope: (scope: FollowUpScope) => void;
  today: string;
  language: Language;
  onOpen: (filters: ActionFilters) => void;
}) {
  const l = followUpWorkloadLabels[language],
    al = actionLabels[language];
  const [reportLocked, setReportLocked] = useState(false);
  const [page, setPage] = useState(0);
  const lockReport = useCallback(
    (locked: boolean) => {
      setReportLocked(locked);
      onReportLock(locked);
    },
    [onReportLock],
  );
  const workload = followUpWorkload(data, scope, today);
  const rows = workload.rows.filter(
    (r) => show === "all" || r.counts[show as "active" | "overdue"] > 0,
  );
  const pages = Math.max(1, Math.ceil(rows.length / 20)),
    current = Math.min(page, pages - 1);
  useEffect(() => setPage(0), [scope, show, today]);
  const metrics = (assignee: string, counts: typeof workload.totals) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(125px, 1fr))",
        gap: "0.5rem",
      }}
    >
      {workloadMetrics.map((metric) => (
        <button
          className="button"
          key={metric}
          data-workload-metric={metric}
          aria-label={`${l.open}: ${al[metric]} (${counts[metric]})`}
          onClick={() => onOpen(workloadQueueFilters(scope, assignee, metric))}
        >
          {al[metric]}: {counts[metric]}
        </button>
      ))}
    </div>
  );
  return (
    <section className="library-stack follow-up-workload" aria-label={l.title}>
      <h3>{l.title}</h3>
      <p className="muted">{l.notice}</p>
      <OperationsReportPanel
        onTimeZone={onTimeZone}
        onApply={onApplyReport}
        config={{
          kind: "workload",
          language,
          timeZone,
          filters: { ...scope, show: show as "all" | "active" | "overdue" },
        }}
        onLock={lockReport}
      />
      <fieldset
        disabled={reportLocked}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <fieldset className="library-stack" style={{ minWidth: 0 }}>
          <legend>{l.scope}</legend>
          <label>
            {al.collection}
            <select
              aria-label={al.collection}
              value={scope.collectionId}
              onChange={(e) =>
                onScope({ ...scope, collectionId: e.target.value })
              }
            >
              <option value="">{al.allCollections}</option>
              {scope.collectionId &&
                !data.collections.some((c) => c.id === scope.collectionId) && (
                  <option value={scope.collectionId}>
                    {al.unavailableCollection}
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
            {l.query}
            <input
              aria-label={l.query}
              maxLength={160}
              value={scope.query}
              onChange={(e) => onScope({ ...scope, query: e.target.value })}
            />
          </label>
          <button
            className="button"
            onClick={() => onScope({ ...defaultFollowUpScope })}
          >
            {l.reset}
          </button>
        </fieldset>
        <article
          className="panel library-stack"
          aria-label={l.totals}
          data-workload-assignee=""
        >
          <h4>{l.totals}</h4>
          {metrics("", workload.totals)}
        </article>
        <label>
          {l.rows}
          <select
            aria-label={l.rows}
            value={show}
            onChange={(e) =>
              onShow(e.target.value as "all" | "active" | "overdue")
            }
          >
            {(["all", "active", "overdue"] as const).map((v) => (
              <option key={v} value={v}>
                {l[v]}
              </option>
            ))}
          </select>
        </label>
        <h4>{l.people}</h4>
        <p role="status">
          {l.matching}: {rows.length}
        </p>
        {!rows.length && <p>{l.empty}</p>}
        {pages > 1 && (
          <nav aria-label={l.page}>
            <button
              className="button"
              disabled={!current}
              onClick={() => setPage(current - 1)}
            >
              {l.previous}
            </button>
            <span>
              {l.page} {current + 1}/{pages}
            </span>
            <button
              className="button"
              disabled={current + 1 >= pages}
              onClick={() => setPage(current + 1)}
            >
              {l.next}
            </button>
          </nav>
        )}
        {rows.slice(current * 20, (current + 1) * 20).map((r) => (
          <article
            className="panel library-stack"
            key={r.id}
            data-workload-assignee={r.id}
          >
            <h4>
              {r.id === "unassigned" ? al.unassigned : r.name || l.unavailable}
            </h4>
            {metrics(r.id, r.counts)}
          </article>
        ))}
      </fieldset>
    </section>
  );
}
