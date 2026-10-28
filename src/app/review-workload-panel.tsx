"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import {
  inboxLabels,
  type ReviewInbox,
  type InboxPacket,
} from "@/lib/team-review-inbox";
import { deadlineLabels, reviewOverdue } from "@/lib/review-deadlines";
import {
  workloadLabels,
  defaultWorkloadFilters,
  reviewWorkload,
  workloadRequests,
  type ReviewPlanning,
} from "@/lib/review-workload";
import type { FeedbackInput } from "@/lib/handoff-feedback";
import type { Language } from "@/lib/localization";
export default function ReviewWorkloadPanel({
  data,
  today,
  language,
  onDirty,
  onError,
  onAction,
  openPacket,
  saved,
  onState,
}: {
  saved: {
    filters: import("@/lib/review-workload").WorkloadFilters;
    selected: string | null;
  };
  onState: (v: {
    filters: import("@/lib/review-workload").WorkloadFilters;
    selected: string | null;
  }) => void;
  data: ReviewInbox;
  today: string;
  language: Language;
  onDirty: (v: boolean) => void;
  onError: (s: string) => void;
  onAction: (collectionId: string, input: FeedbackInput) => void;
  openPacket: (p: InboxPacket) => void;
}) {
  const [filters, setFilters] = useState(saved.filters),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<string | null>(saved.selected),
    [requestPage, setRequestPage] = useState(0),
    [preparing, setPreparing] = useState(false),
    [plan, setPlan] = useState<{
      packet: InboxPacket;
      from: string;
      current: ReviewPlanning;
    } | null>(null),
    [target, setTarget] = useState(""),
    [checked, setChecked] = useState(false);
  const l = workloadLabels[language],
    il = inboxLabels[language],
    dl = deadlineLabels[language],
    controller = useRef<AbortController | null>(null),
    epoch = useRef(0),
    form = useRef<HTMLSelectElement | null>(null),
    detail = useRef<HTMLButtonElement | null>(null),
    locked = preparing || !!plan;
  useEffect(() => {
    onState({ filters, selected });
  }, [filters, selected, onState]);
  useEffect(() => {
    onDirty(locked);
  }, [locked, onDirty]);
  useEffect(
    () => () => {
      epoch.current++;
      controller.current?.abort();
      onDirty(false);
    },
    [onDirty],
  );
  useEffect(() => {
    setPage(0);
    setRequestPage(0);
  }, [filters, today]);
  useEffect(() => {
    if (plan) {
      form.current?.focus();
      form.current?.scrollIntoView({ block: "center" });
    }
  }, [plan]);
  useEffect(() => {
    if (selected) {
      detail.current?.focus();
      detail.current?.scrollIntoView({ block: "center" });
    }
  }, [selected]);
  const members = reviewWorkload(data, filters, today),
    totals = reviewWorkload(data, { ...defaultWorkloadFilters }, today),
    pages = Math.max(1, Math.ceil(members.length / 20)),
    currentPage = Math.min(page, pages - 1),
    requests = selected ? workloadRequests(data, filters, selected) : [],
    requestPages = Math.max(1, Math.ceil(requests.length / 20)),
    currentRequestPage = Math.min(requestPage, requestPages - 1),
    selectedMember = totals.find((m) => m.id === selected);
  const options = plan
    ? plan.current.members.filter(
        (m) => !plan.current.reviewers.some((r) => r.id === m.id),
      )
    : [];
  function cancel() {
    epoch.current++;
    controller.current?.abort();
    setPreparing(false);
    setPlan(null);
    setTarget("");
    setChecked(false);
  }
  async function prepare(p: InboxPacket, id: string) {
    const g = ++epoch.current,
      c = new AbortController();
    controller.current?.abort();
    controller.current = c;
    setPreparing(true);
    setTarget("");
    setChecked(false);
    try {
      const r = await api<{ planning: ReviewPlanning }>(
        `library/collections/${p.collectionId}/handoff/planning?id=${p.id}`,
        "GET",
        undefined,
        undefined,
        c.signal,
      );
      if (g !== epoch.current) return;
      const from = r.planning.reviewers.find((r) => r.id === id);
      if (!from || from.approvedAt)
        throw Error(
          "This pending request changed. Refresh the inbox before reassigning.",
        );
      setPlan({ packet: p, from: id, current: r.planning });
    } catch (e) {
      if (g === epoch.current) onError((e as Error).message);
    } finally {
      if (g === epoch.current) setPreparing(false);
    }
  }
  return (
    <section className="panel library-stack" aria-label={l.title}>
      <h3>{l.title}</h3>
      <p className="muted">{l.notice}</p>
      <fieldset className="library-stack" disabled={locked}>
        <label>
          {il.collection}
          <select
            aria-label={il.collection}
            value={filters.collectionId}
            onChange={(e) =>
              setFilters({ ...filters, collectionId: e.target.value })
            }
          >
            <option value="">{il.allCollections}</option>
            {filters.collectionId &&
              !data.collections.some((c) => c.id === filters.collectionId) && (
                <option value={filters.collectionId}>
                  {il.unavailableCollection}
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
          {il.query}
          <input
            aria-label={il.query}
            maxLength={160}
            value={filters.query}
            onChange={(e) => setFilters({ ...filters, query: e.target.value })}
          />
        </label>
        <label>
          {l.load}
          <select
            aria-label={l.load}
            value={filters.load}
            onChange={(e) =>
              setFilters({
                ...filters,
                load: e.target.value as typeof filters.load,
              })
            }
          >
            {(["all", "pending", "overdue"] as const).map((k) => (
              <option value={k} key={k}>
                {l[k]}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button"
          onClick={() => setFilters({ ...defaultWorkloadFilters })}
        >
          {il.reset}
        </button>
      </fieldset>
      <p role="status">
        {l.people}: {members.length}
      </p>
      {!members.length && <p>{l.empty}</p>}
      {pages > 1 && (
        <div className="toolbar">
          <button
            className="button"
            disabled={locked || currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            {il.previous}
          </button>
          <span>
            {il.page} {currentPage + 1}/{pages}
          </span>
          <button
            className="button"
            disabled={locked || currentPage === pages - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            {il.next}
          </button>
        </div>
      )}
      {members.slice(currentPage * 20, currentPage * 20 + 20).map((m) => (
        <article
          className="panel library-stack"
          data-workload-member={m.id}
          key={m.id}
        >
          <h4>{m.name || l.unavailable}</h4>
          {!m.available && <p>{l.unavailable}</p>}
          <p>
            {l.remaining}: {m.pending} · {dl.overdue}: {m.overdue}
          </p>
          <p>
            {l.today}: {m.today} · {l.week}: {m.week}
          </p>
          <p>
            {l.undated}: {m.undated} · {l.blocked}: {m.blocked}
          </p>
          <p>
            {l.approved}: {m.approved}
          </p>
          {m.nextDue && (
            <p>
              {dl.next}: <time dateTime={m.nextDue}>{m.nextDue}</time>
            </p>
          )}
          <button
            className="button"
            disabled={locked}
            onClick={() => {
              setSelected(m.id);
              setRequestPage(0);
            }}
          >
            {l.show}
          </button>
        </article>
      ))}
      {selected && (
        <section className="panel library-stack" aria-label={l.requests}>
          <h4>
            {l.selected}: {selectedMember?.name || l.unavailable}
          </h4>
          <button
            className="button"
            ref={detail}
            disabled={locked}
            onClick={() => setSelected(null)}
          >
            {l.back}
          </button>
          {!requests.length && <p>{l.none}</p>}
          {requestPages > 1 && (
            <div className="toolbar">
              <button
                className="button"
                disabled={locked || currentRequestPage === 0}
                onClick={() => setRequestPage(currentRequestPage - 1)}
              >
                {il.previous}
              </button>
              <span>
                {il.page} {currentRequestPage + 1}/{requestPages}
              </span>
              <button
                className="button"
                disabled={locked || currentRequestPage === requestPages - 1}
                onClick={() => setRequestPage(currentRequestPage + 1)}
              >
                {il.next}
              </button>
            </div>
          )}
          {requests
            .slice(currentRequestPage * 20, currentRequestPage * 20 + 20)
            .map((p) => {
              const r = p.reviewers.find((r) => r.id === selected)!;
              return (
                <article
                  className="panel library-stack"
                  data-workload-request={p.id}
                  key={p.id}
                >
                  <h5>{p.title}</h5>
                  <p>
                    {p.collectionTitle} · {il[p.state]}
                  </p>
                  <p>
                    {il.openComments}: {p.openComments}
                  </p>
                  <p>
                    {dl.due}:{" "}
                    {r.dueDate ? (
                      <time dateTime={r.dueDate}>{r.dueDate}</time>
                    ) : (
                      dl.none
                    )}
                    {reviewOverdue(r, today) ? ` · ${dl.overdue}` : ""}
                  </p>
                  <button
                    className="button"
                    disabled={locked}
                    onClick={() => openPacket(p)}
                  >
                    {il.open}
                  </button>
                  {data.canEdit && (
                    <button
                      className="button"
                      disabled={locked}
                      onClick={() => void prepare(p, selected)}
                    >
                      {l.reassign}
                    </button>
                  )}
                </article>
              );
            })}
        </section>
      )}
      {preparing && (
        <>
          <p role="status">{l.loading}</p>
          <button className="button" onClick={cancel}>
            {l.cancel}
          </button>
        </>
      )}
      {plan && (
        <form
          className="panel library-stack"
          aria-label={l.reassign}
          onSubmit={(e) => {
            e.preventDefault();
            if (!target || !checked) return;
            const p = plan.current;
            onAction(plan.packet.collectionId, {
              op: "reassign",
              id: p.id,
              packetVersion: p.packetVersion,
              version: p.version,
              signature: p.signature,
              fromReviewerId: plan.from,
              toReviewerId: target,
            });
          }}
        >
          <h4>{plan.current.title}</h4>
          <p>
            {plan.current.reviewers.find((r) => r.id === plan.from)?.name ||
              l.unavailable}
          </p>
          <p>
            {dl.due}:{" "}
            {plan.current.reviewers.find((r) => r.id === plan.from)?.dueDate ||
              dl.none}
          </p>
          <p>{l.notice}</p>
          {!options.length && <p>{l.noReplacement}</p>}
          <label>
            {l.replacement}
            <select
              ref={form}
              aria-label={l.replacement}
              required
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setChecked(false);
              }}
            >
              <option value="">{l.choose}</option>
              {options.map((m) => {
                const t = totals.find((t) => t.id === m.id);
                return (
                  <option value={m.id} key={m.id}>
                    {m.name} · {l.workspace}: {t?.pending ?? 0}/
                    {t?.overdue ?? 0}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            {l.acknowledge}
          </label>
          <button
            className="button"
            type="submit"
            disabled={!target || !checked}
          >
            {l.save}
          </button>
          <button className="button" type="button" onClick={cancel}>
            {l.cancel}
          </button>
        </form>
      )}
    </section>
  );
}
