"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import {
  sourceRevisionLabels,
  type SourceRevisions,
} from "@/lib/library-source-revisions";
import type { RecordingSection } from "@/lib/recording-sections";
import type { Language } from "@/lib/localization";
import RecordingSectionsEditor from "./recording-sections-editor";
import { Notice } from "./components";
type State = {
  revision: SourceRevisions | null;
  base: { text: string; sections?: RecordingSection[] };
  sourceVersion: number;
  media: { id: string; mime: string; durationMs: number };
};
export default function SourceRevisionsPanel({
  id,
  language,
  onPublished,
}: {
  id: string;
  language: Language;
  onPublished: () => void;
}) {
  const l = sourceRevisionLabels[language],
    root = "library/sources/" + id + "/revisions";
  const [open, setOpen] = useState(false),
    [data, setData] = useState<State | null>(null),
    [text, setText] = useState(""),
    [sections, setSections] = useState<RecordingSection[] | undefined>(),
    [reason, setReason] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const epoch = useRef(0),
    controller = useRef<AbortController | null>(null),
    request = useRef<{ signature: string; id: string } | null>(null),
    player = useRef<HTMLMediaElement | null>(null),
    until = useRef<number | null>(null);
  useEffect(
    () => () => {
      epoch.current++;
      controller.current?.abort();
      player.current?.pause();
    },
    [id],
  );
  const latest = data?.revision?.history.at(-1),
    published =
      !!latest &&
      data!.revision!.publications.some(
        (p) => p.reviewVersion === latest.version,
      ),
    stale =
      !!latest &&
      !published &&
      latest.baseSourceVersion !== data!.sourceVersion,
    dirty =
      !!latest &&
      (text !== latest.text ||
        reason !== latest.reason ||
        reviewed !== latest.reviewed ||
        JSON.stringify(sections) !== JSON.stringify(latest.sections));
  function populate(d: State) {
    const h = d.revision?.history.at(-1);
    setData(d);
    setText(h?.text ?? d.base.text);
    setSections(h?.sections ?? (!h ? d.base.sections : undefined));
    setReason(h?.reason || "");
    setReviewed(
      !!h?.reviewed &&
        (d.revision!.publications.some((p) => p.reviewVersion === h.version) ||
          h.baseSourceVersion === d.sourceVersion),
    );
  }
  async function run(fn: (signal: AbortSignal, g: number) => Promise<void>) {
    epoch.current++;
    controller.current?.abort();
    const g = epoch.current,
      c = new AbortController();
    controller.current = c;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await fn(c.signal, g);
    } catch (e) {
      if (epoch.current === g) setError((e as Error).message);
    } finally {
      if (epoch.current === g) setBusy(false);
    }
  }
  function key(body: unknown) {
    const signature = JSON.stringify(body);
    if (request.current?.signature !== signature)
      request.current = { signature, id: crypto.randomUUID() };
    return request.current.id;
  }
  async function load() {
    await run(async (signal, g) => {
      const r = await api<State>(root, "GET", undefined, undefined, signal);
      if (epoch.current === g) populate(r);
    });
  }
  async function action(
    type: "save" | "publish" | "restore",
    reviewVersion?: number,
  ) {
    await run(async (signal, g) => {
      const payload = {
        version: data!.revision?.version || 0,
        sourceVersion: data!.sourceVersion,
        ...(type === "save"
          ? { text, reason, reviewed, ...(sections ? { sections } : {}) }
          : type === "publish"
            ? { reviewVersion: latest!.version, reviewed: true }
            : { reviewVersion, reason: `${l.restore} ${reviewVersion}` }),
      };
      await api(
        root + (type === "save" ? "" : "/" + type),
        type === "save" ? "PUT" : "POST",
        { requestId: key({ type, ...payload }), ...payload },
        undefined,
        signal,
      );
      const current = await api<State>(
        root,
        "GET",
        undefined,
        undefined,
        signal,
      );
      if (epoch.current === g) {
        populate(current);
        setStatus(type === "publish" ? l.done : l.saved);
        if (type === "publish") onPublished();
      }
    });
  }
  if (!open)
    return (
      <button
        className="secondary"
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        {l.open}
      </button>
    );
  const mediaProps = {
    controls: true,
    preload: "none",
    src: data ? `/api/recordings/${data.media.id}` : undefined,
    ref: (node: HTMLMediaElement | null) => {
      player.current = node;
    },
    onTimeUpdate: () => {
      if (
        player.current &&
        until.current !== null &&
        player.current.currentTime >= until.current
      ) {
        player.current.pause();
        until.current = null;
      }
    },
  };
  return (
    <section
      className="panel library-stack"
      aria-label={l.title}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <h3>{l.title}</h3>
      <p>{l.notice}</p>
      <button className="secondary" disabled={busy} onClick={() => void load()}>
        {l.refresh}
      </button>
      {busy && <p role="status">{l.busy}</p>}
      {error && (
        <div role="alert">
          <Notice>{error}</Notice>
        </div>
      )}
      {status && <p role="status">{status}</p>}
      {data && (
        <>
          {stale && <Notice>{l.stale}</Notice>}
          <p>
            {l.published}: {data.sourceVersion} · {l.draft}
          </p>
          {data.media.mime.startsWith("video/") ? (
            <video {...mediaProps} playsInline />
          ) : (
            <audio {...mediaProps} />
          )}
          <label>
            {l.text}
            <textarea
              aria-label={l.text}
              rows={12}
              value={text}
              maxLength={150000}
              disabled={busy}
              onChange={(e) => {
                setText(e.target.value);
                setSections(undefined);
                setReviewed(false);
              }}
            />
          </label>
          <RecordingSectionsEditor
            text={text}
            sections={sections}
            language={language}
            disabled={busy}
            change={(s) => {
              if (s) setText(text.trim());
              setSections(s);
              setReviewed(false);
            }}
            play={(start, end) => {
              if (player.current) {
                player.current.currentTime = start / 1000;
                until.current = end / 1000;
                void player.current.play().catch(() => {});
              }
            }}
          />
          <label>
            {l.reason}
            <textarea
              aria-label={l.reason}
              rows={2}
              value={reason}
              maxLength={1000}
              disabled={busy}
              onChange={(e) => {
                setReason(e.target.value);
                setReviewed(false);
              }}
            />
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            {l.reviewed}
          </label>
          <button
            disabled={
              busy || text.trim().length < 10 || reason.trim().length < 3
            }
            onClick={() => void action("save")}
          >
            {l.save}
          </button>
          <button
            disabled={
              busy || !latest || !latest.reviewed || published || stale || dirty
            }
            onClick={() => void action("publish")}
          >
            {l.publish}
          </button>
          <details>
            <summary>{l.history}</summary>
            {data.revision?.history.map((h) => (
              <article className="panel" key={h.version}>
                <p>
                  v{h.version} · {h.editor.name} · {h.at} ·{" "}
                  {h.reviewed ? "✓" : "—"}
                </p>
                <p>{h.reason}</p>
                {data.revision?.publications
                  .filter((p) => p.reviewVersion === h.version)
                  .map((p) => (
                    <p key={p.sourceVersion}>
                      {l.published} {p.sourceVersion} · {p.editor.name} · {p.at}
                    </p>
                  ))}
                <p className="preserve-lines">{h.text}</p>
                {h.sections?.map((s, n) => (
                  <p key={n}>
                    {s.speaker} · {s.start}–{s.end} ·{" "}
                    {s.startMs === null ? "?" : s.startMs / 1000}–
                    {s.endMs === null ? "?" : s.endMs / 1000}s
                  </p>
                ))}
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void action("restore", h.version)}
                >
                  {l.restore} v{h.version}
                </button>
              </article>
            ))}
          </details>
        </>
      )}
      <button
        className="secondary"
        disabled={busy}
        onClick={() => {
          epoch.current++;
          controller.current?.abort();
          player.current?.pause();
          setOpen(false);
          setData(null);
        }}
      >
        {l.close}
      </button>
    </section>
  );
}
