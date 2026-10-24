"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { planLabels, type PlanView } from "@/lib/review-plans";
import {
  batchLabels,
  type BatchPreview,
  type BatchTarget,
} from "@/lib/batch-review-plans";
import { inboxLabels, type ReviewInbox } from "@/lib/team-review-inbox";
import { localCalendarDay } from "@/lib/research-action-center";
import type { Language } from "@/lib/localization";
export default function BatchReviewPlansPanel({
  data,
  language,
  onDirty,
  onFinish,
}: {
  data: ReviewInbox;
  language: Language;
  onDirty: (v: boolean) => void;
  onFinish: () => void;
}) {
  const l = batchLabels[language],
    pl = planLabels[language],
    il = inboxLabels[language],
    [plans, setPlans] = useState<PlanView[] | null>(null),
    [selected, setSelected] = useState<BatchTarget[]>([]),
    [planId, setPlanId] = useState(""),
    [start, setStart] = useState(localCalendarDay),
    [collection, setCollection] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<BatchPreview | null>(null),
    [results, setResults] = useState(false),
    [ack, setAck] = useState(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const c = new AbortController();
    let current = true;
    api("library/review-plans", "GET", undefined, undefined, c.signal)
      .then((v) => {
        if (current) setPlans(v.plans);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
      alive.current = false;
      c.abort();
    };
  }, []);
  useEffect(() => {
    onDirty(!!selected.length || busy || !!preview || !!error);
  }, [selected.length, busy, preview, error, onDirty]);
  const rows = data.packets
      .filter(
        (p) =>
          (!collection || p.collectionId === collection) &&
          (!query.trim() ||
            (p.title + " " + p.collectionTitle)
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase())),
      )
      .sort(
        (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
      ),
    pages = Math.max(1, Math.ceil(rows.length / 20)),
    currentPage = Math.min(page, pages - 1),
    plan = plans?.find((p) => p.id === planId),
    unavailable = plan?.reviewers.some(
      (r) => !data.members.some((m) => m.id === r.id),
    );
  async function prepare() {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<BatchPreview>(
        "library/review-plan-batch/preview",
        "POST",
        {
          planId: plan.id,
          planVersion: plan.version,
          start,
          packets: selected,
        },
      );
      if (alive.current) {
        setPreview(r);
        setAck(false);
      }
    } catch (e) {
      if (alive.current) {
        setError((e as Error).message);
        setPreview(null);
        setPlans(null);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function apply() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<BatchPreview>(
        "library/review-plan-batch/apply",
        "POST",
        {
          planId: preview.plan.id,
          planVersion: preview.plan.version,
          start: preview.start,
          acknowledged: true,
          packets: preview.packets
            .filter((p) => p.status === "ready")
            .map(({ collectionId, id, packetVersion, version, signature }) => ({
              collectionId,
              id,
              packetVersion,
              version,
              signature,
            })),
        },
      );
      if (alive.current) {
        setPreview({
          ...r,
          packets: preview.packets.map(
            (previous) =>
              r.packets.find((current) => current.id === previous.id) ||
              previous,
          ),
        });
        setResults(true);
        setAck(false);
      }
    } catch (e) {
      if (alive.current) {
        setError((e as Error).message);
        setPreview(null);
        setPlans(null);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section
      className="library-stack batch-review-plans"
      aria-label={l.title}
      aria-busy={busy}
    >
      <h3>{l.title}</h3>
      <p>{l.notice}</p>
      <p className="muted">{l.interrupted}</p>
      {error && <p role="alert">{error}</p>}
      {(error || results) && (
        <button className="button" disabled={busy} onClick={onFinish}>
          {l.finish}
        </button>
      )}
      {!preview && !error && (
        <fieldset disabled={busy}>
          <legend>{l.title}</legend>
          {plans && !plans.length && <p>{l.none}</p>}
          <label>
            {pl.choose}
            <select
              aria-label={pl.choose}
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
            >
              <option value="">—</option>
              {plans?.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {pl.start}
            <input
              aria-label={pl.start}
              type="date"
              min="2000-01-01"
              max="2100-12-31"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          {unavailable && <p>{pl.unavailable}</p>}
          <label>
            {il.collection}
            <select
              aria-label={il.collection}
              value={collection}
              onChange={(e) => {
                setCollection(e.target.value);
                setPage(0);
              }}
            >
              <option value="">{il.allCollections}</option>
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
              value={query}
              maxLength={160}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <p role="status">
            {l.selected}: {selected.length}/10
          </p>
          {!!selected.length && (
            <button className="button" onClick={() => setSelected([])}>
              {l.clear}
            </button>
          )}
          {selected.map((p) => (
            <div className="toolbar" key={p.id}>
              <span>
                {data.packets.find((v) => v.id === p.id)?.title ||
                  l.unavailable}
              </span>
              <button
                className="button"
                onClick={() =>
                  setSelected(selected.filter((v) => v.id !== p.id))
                }
              >
                {pl.remove}:{" "}
                {data.packets.find((v) => v.id === p.id)?.title ||
                  l.unavailable}
              </button>
            </div>
          ))}
          {!rows.length && <p>{l.empty}</p>}
          {rows.slice(currentPage * 20, currentPage * 20 + 20).map((p) => (
            <label className="check-row" key={p.id}>
              <input
                aria-label={`${l.select}: ${p.title}`}
                type="checkbox"
                checked={selected.some((v) => v.id === p.id)}
                disabled={
                  selected.length >= 10 && !selected.some((v) => v.id === p.id)
                }
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [
                          ...selected,
                          { id: p.id, collectionId: p.collectionId },
                        ]
                      : selected.filter((v) => v.id !== p.id),
                  )
                }
              />
              <span>
                {p.title} · {p.collectionTitle} · {il[p.state]}
              </span>
            </label>
          ))}
          {pages > 1 && (
            <div className="toolbar">
              <button
                className="button"
                disabled={!currentPage}
                onClick={() => setPage(currentPage - 1)}
              >
                {il.previous}
              </button>
              <span>
                {il.page} {currentPage + 1}/{pages}
              </span>
              <button
                className="button"
                disabled={currentPage === pages - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                {il.next}
              </button>
            </div>
          )}
          <button
            className="button"
            disabled={!plan || !selected.length || !start || unavailable}
            onClick={() => void prepare()}
          >
            {l.preview}
          </button>
        </fieldset>
      )}
      {preview && (
        <div className="library-stack">
          <h4>
            {results ? l.results : l.preview}: {preview.plan.name}
          </h4>
          <p>
            {pl.start}: {preview.start}
          </p>
          <h5>{l.proposed}</h5>
          {preview.reviewers.map((r) => (
            <p key={r.id}>
              {r.name} · {r.dueDate || pl.noDate}
            </p>
          ))}
          {preview.packets.map((p, index) => (
            <article
              className="panel library-stack"
              data-batch-packet={p.id}
              key={p.id}
            >
              <h5>
                {index + 1}. {p.title || l[p.status]}
              </h5>
              <p role="status">{l[p.status]}</p>
              {!results && p.status === "ready" && (
                <>
                  <h6>{l.current}</h6>
                  {!p.reviewers?.length && <p>{il.none}</p>}
                  {p.reviewers?.map((r) => (
                    <p key={r.id}>
                      {r.name || il.unavailableReviewer} ·{" "}
                      {r.dueDate || pl.noDate} ·{" "}
                      {r.approvedAt ? l.approved : l.pending}
                    </p>
                  ))}
                  <p>
                    {l.comments}: {p.openComments}
                  </p>
                  {p.finalApproved && <p>{l.final}</p>}
                </>
              )}
            </article>
          ))}
          {!results && (
            <>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={ack}
                  disabled={busy}
                  onChange={(e) => setAck(e.target.checked)}
                />
                <span>{l.ack}</span>
              </label>
              <button
                className="button"
                disabled={
                  busy ||
                  !ack ||
                  !preview.packets.some((p) => p.status === "ready")
                }
                onClick={() => void apply()}
              >
                {l.apply}
              </button>
              <button className="button" disabled={busy} onClick={onFinish}>
                {l.cancel}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
