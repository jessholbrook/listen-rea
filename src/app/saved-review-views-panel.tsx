"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import {
  savedViewLabels,
  type SavedViewConfig,
  type SavedReviewViewItem,
  type SavedReviewViewList,
} from "@/lib/saved-review-views";
import type { Language } from "@/lib/localization";
type Draft = {
  id?: string;
  version?: number;
  name: string;
  visibility: "private" | "shared";
  config: SavedViewConfig;
};
export default function SavedReviewViewsPanel({
  kind,
  language,
  disabled,
  current,
  onApply,
  onDirty,
  onStart,
}: {
  kind: SavedViewConfig["kind"];
  language: Language;
  disabled: boolean;
  current: () => SavedViewConfig;
  onApply: (v: SavedViewConfig) => void;
  onDirty: (v: boolean) => void;
  onStart: () => void;
}) {
  const l = savedViewLabels[language],
    title =
      kind === "report_workload" ||
      kind === "report_activity" ||
      kind === "report_calendar" ||
      kind === "report_unified"
        ? l.reportTitle
        : kind === "unified"
          ? l.unifiedTitle
          : kind === "calendar"
            ? l.calendarTitle
            : kind === "tasks" || kind === "task_activity"
              ? l.followUpTitle
              : l.title,
    [catalog, setCatalog] = useState<SavedReviewViewList | null>(null),
    [selected, setSelected] = useState(""),
    [draft, setDraft] = useState<Draft | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let active = true;
    const c = new AbortController();
    api<SavedReviewViewList>(
      "library/saved-review-views",
      "GET",
      undefined,
      undefined,
      c.signal,
    )
      .then((v) => {
        if (active) setCatalog(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      alive.current = false;
      c.abort();
    };
  }, []);
  useEffect(() => {
    onDirty(!!draft || busy);
  }, [draft, busy, onDirty]);
  const rows = (catalog?.views || []).filter((v) => v.config.kind === kind),
    chosen = rows.find((v) => v.id === selected);
  async function run(action: () => Promise<void>, message = "") {
    onStart();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (alive.current) {
        const result = await api<SavedReviewViewList>(
          "library/saved-review-views",
        );
        if (alive.current) {
          setCatalog(result);
          setDraft(null);
          setNotice(message);
        }
      }
    } catch (e) {
      if (alive.current) {
        setCatalog(null);
        setSelected("");
        setDraft(null);
        setError((e as Error).message);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function fresh(v: SavedReviewViewItem) {
    return (
      await api<{ view: SavedReviewViewItem }>(
        "library/saved-review-views/" + v.id + "?version=" + v.version,
      )
    ).view;
  }
  function edit(v?: SavedReviewViewItem) {
    onStart();
    try {
      setError("");
      setNotice("");
      setDraft({
        ...(v ? { id: v.id, version: v.version } : {}),
        name: v?.name || "",
        visibility: v?.visibility || "private",
        config: current(),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section
      className="library-stack saved-review-views"
      aria-label={title}
      aria-busy={busy}
    >
      <h3>{title}</h3>
      <p className="muted">
        {kind === "report_workload" ||
        kind === "report_activity" ||
        kind === "report_calendar" ||
        kind === "report_unified"
          ? l.reportNotice
          : kind === "unified"
            ? l.unifiedNotice
            : kind === "calendar"
              ? l.calendarNotice
              : l.notice}
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <fieldset className="library-stack" disabled={disabled || busy}>
        <legend>{title}</legend>
        {!draft && (
          <>
            <button
              className="button"
              onClick={() => void run(async () => {}, "")}
            >
              {l.refresh}
            </button>
            {!rows.length && catalog && <p>{l.empty}</p>}
            <label>
              {l.choose}
              <select
                aria-label={l.choose}
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setNotice("");
                }}
              >
                <option value="">—</option>
                {rows.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {l[v.visibility]}
                  </option>
                ))}
              </select>
            </label>
            {chosen && (
              <p>
                {l.owner}: {chosen.owner.name || l.former}
              </p>
            )}
            <button
              className="button"
              disabled={!catalog}
              onClick={() => edit()}
            >
              {l.save}
            </button>
            <button
              className="button"
              disabled={!chosen}
              onClick={() => {
                if (chosen)
                  void run(async () => {
                    const v = await fresh(chosen);
                    if (alive.current) onApply(v.config);
                  }, l.applied);
              }}
            >
              {l.apply}
            </button>
            <button
              className="button"
              disabled={!chosen}
              onClick={() => {
                if (chosen)
                  void run(async () => {
                    const v = await fresh(chosen);
                    const r = await api<{ view: SavedReviewViewItem }>(
                      "library/saved-review-views",
                      "POST",
                      {
                        name: (l.copyPrefix + v.name).slice(0, 120),
                        visibility: "private",
                        config: v.config,
                      },
                    );
                    if (alive.current) setSelected(r.view.id);
                  }, l.copied);
              }}
            >
              {l.copy}
            </button>
            {chosen?.canManage && (
              <>
                <button className="button" onClick={() => edit(chosen)}>
                  {l.update}
                </button>
                <button
                  className="button danger"
                  onClick={() => {
                    if (confirm(l.confirm))
                      void run(async () => {
                        await api(
                          "library/saved-review-views/" + chosen.id,
                          "DELETE",
                          { version: chosen.version },
                        );
                        if (alive.current) setSelected("");
                      }, l.saved);
                  }}
                >
                  {l.remove}
                </button>
              </>
            )}
          </>
        )}
        {draft && (
          <form
            className="library-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const { id, ...payload } = draft;
              void run(async () => {
                const r = await api<{ view: SavedReviewViewItem }>(
                  "library/saved-review-views" + (id ? "/" + id : ""),
                  id ? "PUT" : "POST",
                  payload,
                );
                if (alive.current) setSelected(r.view.id);
              }, l.saved);
            }}
          >
            {!!draft.id && <p>{l.replace}</p>}
            <label>
              {l.name}
              <input
                aria-label={l.name}
                value={draft.name}
                required
                minLength={3}
                maxLength={120}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              {l.visibility}
              <select
                aria-label={l.visibility}
                disabled={!!draft.id && !chosen?.canChangeVisibility}
                value={draft.visibility}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    visibility: e.target.value as Draft["visibility"],
                  })
                }
              >
                <option value="private">{l.private}</option>
                <option value="shared" disabled={!catalog?.canShare}>
                  {l.shared}
                </option>
              </select>
            </label>
            <button className="button" type="submit">
              {draft.id ? l.update : l.save}
            </button>
            <button
              className="button"
              type="button"
              onClick={() => setDraft(null)}
            >
              {l.cancel}
            </button>
          </form>
        )}
      </fieldset>
    </section>
  );
}
