"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import {
  activityActions,
  activityLabels,
  type ActivityView,
} from "@/lib/review-activity";
import { inboxLabels } from "@/lib/team-review-inbox";
import type { Language } from "@/lib/localization";
export const defaultActivityFilters = {
  packetId: "",
  personId: "",
  action: "",
  from: "",
  to: "",
  page: 0,
};
export default function ReviewActivityPanel({
  language,
  saved,
  onState,
  onOpen,
}: {
  language: Language;
  saved: typeof defaultActivityFilters;
  onState: (v: typeof defaultActivityFilters) => void;
  onOpen: (p: { id: string; collectionId: string }) => void;
}) {
  const l = activityLabels[language],
    il = inboxLabels[language],
    [data, setData] = useState<ActivityView | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [timeZone] = useState(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  useEffect(() => {
    let active = true;
    const c = new AbortController();
    setBusy(true);
    setError("");
    setData(null);
    const q = new URLSearchParams({
      ...saved,
      page: String(saved.page),
      timeZone,
    });
    api<ActivityView>(
      "library/review-activity?" + q,
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
    saved.packetId,
    saved.personId,
    saved.action,
    saved.from,
    saved.to,
    saved.page,
    revision,
    timeZone,
  ]);
  function filter(v: Partial<typeof defaultActivityFilters>) {
    onState({ ...saved, ...v, page: 0 });
  }
  return (
    <section
      className="library-stack review-activity"
      aria-label={l.title}
      aria-busy={busy}
    >
      <h3>{l.title}</h3>
      <p className="muted">{l.notice}</p>
      <p className="muted">{l.retained}</p>
      <button
        className="button"
        disabled={busy}
        onClick={() => setRevision(revision + 1)}
      >
        {l.refresh}
      </button>
      <fieldset className="library-stack" disabled={busy}>
        <legend>{l.title}</legend>
        <label>
          {l.packet}
          <select
            aria-label={l.packet}
            value={saved.packetId}
            onChange={(e) => filter({ packetId: e.target.value })}
          >
            <option value="">{l.all}</option>
            {saved.packetId &&
              !data?.packets.some((p) => p.id === saved.packetId) && (
                <option value={saved.packetId}>{l.unavailablePacket}</option>
              )}
            {data?.packets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          {l.person}
          <select
            aria-label={l.person}
            value={saved.personId}
            onChange={(e) => filter({ personId: e.target.value })}
          >
            <option value="">{l.all}</option>
            <option value="system">{l.system}</option>
            {saved.personId &&
              saved.personId !== "system" &&
              !data?.people.some((p) => p.id === saved.personId) && (
                <option value={saved.personId}>{l.former}</option>
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
            value={saved.action}
            onChange={(e) => filter({ action: e.target.value })}
          >
            <option value="">{l.all}</option>
            {activityActions.map((action) => (
              <option key={action} value={action}>
                {l[action]}
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
            value={saved.from}
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
            value={saved.to}
            onChange={(e) => filter({ to: e.target.value })}
          />
        </label>
        <button
          className="button"
          onClick={() => onState({ ...defaultActivityFilters })}
        >
          {il.reset}
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
              data-review-event={e.id}
              data-review-action={e.action}
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
                {e.packet.title} · {e.packet.collectionTitle}
              </p>
              {e.reviewer && (
                <p>
                  {l.person}: {e.reviewer.name || l.former}
                </p>
              )}
              {e.before && (
                <div>
                  <h5>{l.before}</h5>
                  {!e.before.length && <p>{l.none}</p>}
                  {e.before.map((p, n) => (
                    <p key={p.id + ":" + n}>
                      {p.name || l.former} · {p.dueDate || l.noDate}
                    </p>
                  ))}
                </div>
              )}
              {e.after && (
                <div>
                  <h5>{l.after}</h5>
                  {!e.after.length && <p>{l.none}</p>}
                  {e.after.map((p, n) => (
                    <p key={p.id + ":" + n}>
                      {p.name || l.former} · {p.dueDate || l.noDate}
                    </p>
                  ))}
                </div>
              )}
              {!!e.clearedReviewers.length && (
                <p>
                  {l.cleared}:{" "}
                  {e.clearedReviewers.map((p) => p.name || l.former).join(", ")}
                </p>
              )}
              {e.finalApprovalReset && <p>{l.finalReset}</p>}
              <button className="button" onClick={() => onOpen(e.packet)}>
                {il.open}
              </button>
            </article>
          ))}
          {data.pages > 1 && (
            <div className="toolbar">
              <button
                className="button"
                disabled={!data.page}
                onClick={() => onState({ ...saved, page: data.page - 1 })}
              >
                {il.previous}
              </button>
              <span>
                {il.page} {data.page + 1}/{data.pages}
              </span>
              <button
                className="button"
                disabled={data.page === data.pages - 1}
                onClick={() => onState({ ...saved, page: data.page + 1 })}
              >
                {il.next}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
