"use client";
import CollectionReviewPanel from "./collection-review-panel";
import { dashboardLabels } from "@/lib/collection-review";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import {
  collectionLabels,
  type CollectionView,
} from "@/lib/library-collections";
import { languages, languageNames, type Language } from "@/lib/localization";
type Source = {
  id: string;
  title: string;
  studyTitle: string;
  externalId: string;
};
type Brief = { id: string; title: string; canExport: boolean };
export default function LibraryCollectionsPanel({
  openSource,
  openBrief,
  search,
}: {
  openSource: (id: string) => Promise<void>;
  openBrief: (id: string) => void;
  search: (id: string) => void;
}) {
  const [language, setLanguage] = useState<Language>("en"),
    [rows, setRows] = useState<CollectionView[]>([]),
    [sources, setSources] = useState<Source[]>([]),
    [briefs, setBriefs] = useState<Brief[]>([]),
    [selected, setSelected] = useState<CollectionView | null>(null),
    [title, setTitle] = useState(""),
    [interviewIds, setInterviews] = useState<string[]>([]),
    [briefIds, setBriefsIds] = useState<string[]>([]),
    [canEdit, setCanEdit] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [dirty, setDirty] = useState(false),
    [dashboardId, setDashboardId] = useState<string | null>(null);
  const l = collectionLabels[language],
    epoch = useRef(0),
    controller = useRef<AbortController | null>(null),
    requestId = useRef(crypto.randomUUID());
  function reset() {
    epoch.current++;
    controller.current?.abort();
    setBusy(false);
    setError("");
    setNotice("");
  }
  function populate(c: CollectionView | null) {
    setSelected(c);
    setDashboardId(null);
    setTitle(c?.title || "");
    setInterviews(c?.interviewIds || []);
    setBriefsIds(c?.briefIds || []);
    setDirty(false);
    requestId.current = crypto.randomUUID();
  }
  async function run(
    action: (signal: AbortSignal, g: number) => Promise<void>,
  ) {
    reset();
    const g = ++epoch.current,
      c = new AbortController();
    controller.current = c;
    setBusy(true);
    try {
      await action(c.signal, g);
    } catch (e) {
      if (epoch.current === g) {
        setError((e as Error).message);
        setDirty(true);
      }
    } finally {
      if (epoch.current === g) setBusy(false);
    }
  }
  async function lists(signal: AbortSignal) {
    const [c, s, b] = await Promise.all([
      api<{ collections: CollectionView[]; canEdit: boolean }>(
        "library/collections",
        "GET",
        undefined,
        undefined,
        signal,
      ),
      api<{ sources: Source[] }>(
        "library",
        "GET",
        undefined,
        undefined,
        signal,
      ),
      api<{ briefs: Brief[] }>(
        "library/briefs",
        "GET",
        undefined,
        undefined,
        signal,
      ),
    ]);
    return { c, s, b };
  }
  function apply(v: Awaited<ReturnType<typeof lists>>) {
    setRows(v.c.collections);
    setCanEdit(v.c.canEdit);
    setSources(v.s.sources);
    setBriefs(v.b.briefs);
  }
  async function load() {
    await run(async (signal, g) => {
      const v = await lists(signal);
      const c = selected
        ? (
            await api<{ collection: CollectionView }>(
              "library/collections/" + selected.id,
              "GET",
              undefined,
              undefined,
              signal,
            )
          ).collection
        : null;
      if (epoch.current === g) {
        apply(v);
        populate(c);
      }
    });
  }
  useEffect(() => {
    void load();
    return () => {
      epoch.current++;
      controller.current?.abort();
    };
  }, [language]);
  function edit() {
    setDirty(true);
    setNotice("");
  }
  async function save() {
    await run(async (signal, g) => {
      const v = await api<{ collection: CollectionView }>(
        "library/collections" + (selected ? "/" + selected.id : ""),
        selected ? "PUT" : "POST",
        {
          title,
          interviewIds,
          briefIds,
          ...(selected
            ? { version: selected.version }
            : { requestId: requestId.current }),
        },
        undefined,
        signal,
      );
      const all = await lists(signal);
      if (epoch.current === g) {
        apply(all);
        populate(v.collection);
        setNotice(l.saved);
      }
    });
  }
  async function remove() {
    if (!selected || !confirm(l.confirm)) return;
    await run(async (signal, g) => {
      await api(
        "library/collections/" + selected.id,
        "DELETE",
        { version: selected.version },
        undefined,
        signal,
      );
      const v = await lists(signal);
      if (epoch.current === g) {
        apply(v);
        populate(null);
      }
    });
  }
  function toggle(ids: string[], id: string, checked: boolean) {
    return checked ? [...ids, id] : ids.filter((i) => i !== id);
  }
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
          disabled={busy}
          onChange={(e) => {
            if (e.target.value === language) return;
            reset();
            populate(null);
            setLanguage(e.target.value as Language);
          }}
        >
          {languages.map((v) => (
            <option key={v} value={v}>
              {languageNames[v]}
            </option>
          ))}
        </select>
      </label>
      <div className="toolbar">
        <button disabled={busy} onClick={() => void load()}>
          {l.refresh}
        </button>
        <button
          disabled={busy || !canEdit}
          onClick={() => {
            reset();
            populate(null);
          }}
        >
          {l.new}
        </button>
      </div>
      {!rows.length && <p>{l.empty}</p>}
      {rows.map((c) => (
        <article key={c.id} className="panel" data-collection-id={c.id}>
          <h3>{c.title}</h3>
          <p>
            {c.interviewIds.length} · {l.sources} / {c.briefIds.length} ·{" "}
            {l.briefs}
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async (signal, g) => {
                const v = await api<{ collection: CollectionView }>(
                  "library/collections/" + c.id,
                  "GET",
                  undefined,
                  undefined,
                  signal,
                );
                if (epoch.current === g) populate(v.collection);
              })
            }
          >
            {l.open}
          </button>
          <button disabled={busy} onClick={() => setDashboardId(c.id)}>
            {dashboardLabels[language].open}
          </button>
        </article>
      ))}
      {dashboardId && (
        <CollectionReviewPanel
          id={dashboardId}
          language={language}
          openSource={openSource}
          openBrief={openBrief}
          close={() => setDashboardId(null)}
        />
      )}
      <section className="library-stack" aria-label={l.name}>
        <h3>{selected ? selected.title : l.new}</h3>
        {selected && (
          <p>
            v{selected.version} · {selected.updatedAt}
          </p>
        )}
        <fieldset disabled={busy || !canEdit} className="library-stack">
          <label>
            {l.name}
            <input
              aria-label={l.name}
              value={title}
              minLength={3}
              maxLength={160}
              onChange={(e) => {
                setTitle(e.target.value);
                edit();
              }}
            />
          </label>
          <fieldset>
            <legend>
              {l.sources} ({interviewIds.length}/200)
            </legend>
            {sources.map((s) => (
              <label className="check-row" key={s.id}>
                <input
                  type="checkbox"
                  checked={interviewIds.includes(s.id)}
                  disabled={
                    !interviewIds.includes(s.id) && interviewIds.length >= 200
                  }
                  onChange={(e) => {
                    setInterviews(toggle(interviewIds, s.id, e.target.checked));
                    edit();
                  }}
                />
                {s.title} · {s.studyTitle} · {s.externalId || s.id.slice(0, 8)}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>
              {l.briefs} ({briefIds.length}/30)
            </legend>
            {briefs.map((b) => (
              <label className="check-row" key={b.id}>
                <input
                  type="checkbox"
                  checked={briefIds.includes(b.id)}
                  disabled={!briefIds.includes(b.id) && briefIds.length >= 30}
                  onChange={(e) => {
                    setBriefsIds(toggle(briefIds, b.id, e.target.checked));
                    edit();
                  }}
                />
                {b.title}
              </label>
            ))}
          </fieldset>
          {!interviewIds.length && <p>{l.none}</p>}
          <button
            disabled={!dirty || title.trim().length < 3}
            onClick={() => void save()}
          >
            {selected ? l.save : l.create}
          </button>
        </fieldset>
        {selected && (
          <>
            <button
              disabled={busy || dirty}
              onClick={() => search(selected.id)}
            >
              {l.search}
            </button>
            {sources
              .filter((s) => selected.interviewIds.includes(s.id))
              .map((s) => (
                <div key={s.id}>
                  <span>{s.title} </span>
                  <button disabled={busy} onClick={() => void openSource(s.id)}>
                    {l.openSource}
                  </button>
                </div>
              ))}
            {briefs
              .filter((b) => selected.briefIds.includes(b.id))
              .map((b) => (
                <div key={b.id}>
                  <span>{b.title} </span>
                  <button disabled={busy} onClick={() => openBrief(b.id)}>
                    {l.openBrief}
                  </button>
                </div>
              ))}
            <button disabled={busy || !canEdit} onClick={() => void remove()}>
              {l.remove}
            </button>
          </>
        )}
      </section>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
