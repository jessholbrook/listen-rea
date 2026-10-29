"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { Notice } from "./components";
type Source = {
  mediaId: string;
  interviewId: string;
  prompt: string;
  answerPreview: string;
  kind: "audio" | "screen";
  durationMs: number;
  fingerprint: string;
};
type Suggestion = {
  quote: string;
  caption: string;
  rationale: string;
  startMs: number;
  endMs: number;
};
type Draft = {
  id: string;
  mediaId: string;
  fingerprint: string;
  state: string;
  createdAt: string;
  model?: string;
  suggestions?: Suggestion[];
};
export default function ClipSuggestionsPanel({
  studyId,
  onSaved,
}: {
  studyId: string;
  onSaved: () => Promise<void>;
}) {
  const [sources, setSources] = useState<Source[]>([]),
    [drafts, setDrafts] = useState<Draft[]>([]),
    [mediaId, setMediaId] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const generation = useRef(0),
    request = useRef<string | null>(null),
    root = `studies/${studyId}/clip-suggestions`;
  async function load(g = generation.current) {
    const r = await api<{ sources: Source[]; drafts: Draft[] }>(root);
    if (g !== generation.current) return;
    setSources(r.sources);
    setDrafts(r.drafts);
    setMediaId((id) =>
      r.sources.some((s) => s.mediaId === id)
        ? id
        : r.sources[0]?.mediaId || "",
    );
  }
  useEffect(() => {
    const g = ++generation.current;
    void load(g).catch((e) => {
      if (g === generation.current) setError(e.message);
    });
    return () => {
      generation.current++;
    };
  }, [root]);
  const source = sources.find((s) => s.mediaId === mediaId);
  async function generate() {
    const g = generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    if (!request.current) request.current = crypto.randomUUID();
    try {
      await api(root, "POST", {
        requestId: request.current,
        mediaId,
        fingerprint: source!.fingerprint,
        aiConsent: consent,
      });
      if (g === generation.current) {
        request.current = null;
        setConsent(false);
        await load(g);
      }
    } catch (e) {
      if (g === generation.current) {
        setError((e as Error).message);
        await load(g).catch(() => {});
      }
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  return (
    <section className="panel visual-stack" aria-label="AI clip suggestions">
      <h3>AI-assisted clip selection</h3>
      <p>
        Choose one recording (up to 3 MB/five minutes). AI proposes exact answer
        quotes; a separate transcription aligns only unique spoken word matches.
        Missing, repeated or inconsistent speech produces no suggested range.
        Listen before accepting: alignment and captions can be wrong.
      </p>
      {error && <Notice>{error}</Notice>}
      {notice && <p role="status">{notice}</p>}
      <label>
        Suggestion recording
        <select
          aria-label="Suggestion recording"
          value={mediaId}
          disabled={busy}
          onChange={(e) => {
            setMediaId(e.target.value);
            setConsent(false);
            request.current = null;
          }}
        >
          {sources.map((s) => (
            <option key={s.mediaId} value={s.mediaId}>
              {s.prompt.slice(0, 70)} · {s.interviewId.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox-label report-review">
        <input
          type="checkbox"
          checked={consent}
          disabled={busy}
          onChange={(e) => setConsent(e.target.checked)}
        />
        I allow OpenAI to receive this recording and its linked answer for quote
        suggestions and word-timestamp transcription.
      </label>
      <div className="inline">
        <button
          className="button"
          type="button"
          disabled={!source || !consent || busy}
          onClick={() => void generate()}
        >
          {busy ? "Selecting and aligning quotes…" : "Suggest evidence clips"}
        </button>
        <button
          className="button"
          type="button"
          disabled={busy}
          onClick={() => {
            request.current = null;
            setConsent(false);
            setError("");
            void load().catch((e) => setError(e.message));
          }}
        >
          Refresh / start a new request
        </button>
      </div>
      {drafts
        .filter((d) => d.mediaId === mediaId)
        .map((d) => (
          <div className="visual-stack reporting-media-fields" key={d.id}>
            <h4>
              {d.state} · {new Date(d.createdAt).toLocaleString()}
            </h4>
            {d.state === "complete" && !d.suggestions?.length && (
              <p>
                No unambiguous spoken match was found. Use the manual clip
                editor or choose another source.
              </p>
            )}
            {d.state !== "complete" && (
              <p>
                Refresh for current progress. A failed request needs an explicit
                new request; it is not automatically retried.
              </p>
            )}
            {d.suggestions?.map((s, n) => (
              <SuggestedClip
                key={d.id + ":" + n}
                suggestion={s}
                draft={d}
                index={n}
                source={sources.find((s) => s.mediaId === d.mediaId)!}
                root={root}
                saved={async () => {
                  setNotice(
                    "Reviewed clip saved. It is available in Clips & reels.",
                  );
                  await onSaved();
                }}
              />
            ))}
          </div>
        ))}
    </section>
  );
}
function SuggestedClip({
  suggestion,
  draft,
  index,
  source,
  root,
  saved,
}: {
  suggestion: Suggestion;
  draft: Draft;
  index: number;
  source: Source;
  root: string;
  saved: () => Promise<void>;
}) {
  const [form, setForm] = useState({
      name: "Suggested clip " + (index + 1),
      quote: suggestion.quote,
      caption: suggestion.caption,
      startMs: suggestion.startMs,
      endMs: suggestion.endMs,
      reviewed: false,
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    receipt = useRef<{ key: string; id: string } | null>(null),
    player = useRef<HTMLMediaElement | null>(null);
  function change(value: Partial<typeof form>) {
    setForm((v) => ({ ...v, ...value, reviewed: false }));
  }
  async function accept() {
    setBusy(true);
    setError("");
    const key = JSON.stringify(form);
    if (receipt.current?.key !== key)
      receipt.current = { key, id: crypto.randomUUID() };
    try {
      await api(root + "/" + draft.id + "/accept", "POST", {
        ...form,
        mediaId: source.mediaId,
        fingerprint: draft.fingerprint,
        suggestionIndex: index,
        requestId: receipt.current.id,
      });
      await saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!source) return null;
  return (
    <article className="panel visual-stack">
      <p>{suggestion.rationale}</p>
      <p className="small">
        {draft.model} · Whisper word alignment · human review required
      </p>
      {error && <Notice>{error}</Notice>}
      {source.kind === "audio" ? (
        <audio
          ref={(n) => {
            player.current = n;
          }}
          controls
          preload="metadata"
          src={"/api/recordings/" + source.mediaId}
          onTimeUpdate={() => {
            if (
              player.current &&
              player.current.currentTime >= form.endMs / 1000
            )
              player.current.pause();
          }}
        />
      ) : (
        <video
          ref={(n) => {
            player.current = n;
          }}
          controls
          preload="metadata"
          src={"/api/recordings/" + source.mediaId}
          onTimeUpdate={() => {
            if (
              player.current &&
              player.current.currentTime >= form.endMs / 1000
            )
              player.current.pause();
          }}
        />
      )}
      <button
        className="button"
        type="button"
        onClick={() => {
          if (player.current) {
            player.current.currentTime = form.startMs / 1000;
            void player.current.play().catch(() => {});
          }
        }}
      >
        Preview suggested range
      </button>
      <fieldset disabled={busy} className="visual-stack reporting-media-fields">
        <label>
          Suggested clip name
          <input
            aria-label="Suggested clip name"
            maxLength={100}
            value={form.name}
            onChange={(e) => change({ name: e.target.value })}
          />
        </label>
        <label>
          Suggested exact quote
          <textarea
            aria-label="Suggested exact quote"
            maxLength={12000}
            value={form.quote}
            onChange={(e) => change({ quote: e.target.value })}
          />
        </label>
        <div className="mixed-grid">
          <label>
            Suggested start (seconds)
            <input
              aria-label="Suggested start (seconds)"
              type="number"
              step="0.01"
              min={0}
              value={form.startMs / 1000}
              onChange={(e) =>
                change({ startMs: Math.round(Number(e.target.value) * 1000) })
              }
            />
          </label>
          <label>
            Suggested end (seconds)
            <input
              aria-label="Suggested end (seconds)"
              type="number"
              step="0.01"
              min={0.1}
              value={form.endMs / 1000}
              onChange={(e) =>
                change({ endMs: Math.round(Number(e.target.value) * 1000) })
              }
            />
          </label>
        </div>
        <label>
          Suggested caption
          <input
            aria-label="Suggested caption"
            maxLength={180}
            value={form.caption}
            onChange={(e) => change({ caption: e.target.value })}
          />
        </label>
        <label className="checkbox-label report-review">
          <input
            type="checkbox"
            checked={form.reviewed}
            onChange={(e) =>
              setForm((v) => ({ ...v, reviewed: e.target.checked }))
            }
          />
          I listened to this range, checked the exact quote and edited/reviewed
          its timing and caption.
        </label>
        <button
          className="button"
          type="button"
          disabled={!form.reviewed || !form.name.trim()}
          onClick={() => void accept()}
        >
          Save reviewed suggested clip
        </button>
      </fieldset>
    </article>
  );
}
