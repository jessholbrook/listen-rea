"use client";
import TaskResultsPanel from "./task-results-panel";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import {
  stamp,
  type VisualData,
  type VisualObservation,
  type VisualHistory,
} from "@/lib/visual";
import { Modal, Notice, Spinner } from "./components";
type Form = {
  atMs: number;
  description: string;
  interpretation: string;
  uncertainty: string;
  tag: VisualObservation["tag"];
  status: VisualObservation["status"];
  reviewed: boolean;
  quote: string;
  relation: "context" | "consistent" | "possible_tension";
  note: string;
};
const empty = (): Form => ({
  atMs: 0,
  description: "",
  interpretation: "",
  uncertainty: "",
  tag: "visible_content",
  status: "pending",
  reviewed: false,
  quote: "",
  relation: "context",
  note: "",
});
export default function VisualPanel({ studyId }: { studyId: string }) {
  const [data, setData] = useState<VisualData | null>(null),
    [mediaId, setMediaId] = useState(""),
    [runId, setRunId] = useState(""),
    [startMs, setStart] = useState(0),
    [endMs, setEnd] = useState(3000),
    [frameCount, setFrameCount] = useState(3),
    [permission, setPermission] = useState(false),
    [form, setForm] = useState<Form>(empty),
    [editing, setEditing] = useState<VisualObservation | null>(null),
    [filter, setFilter] = useState("all"),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [question, setQuestion] = useState(""),
    [allVideos, setAllVideos] = useState(false),
    [answer, setAnswer] = useState<{
      answer: string;
      citations: { observationId: string; quote: string }[];
    } | null>(null),
    [history, setHistory] = useState<VisualHistory[] | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const video = useRef<HTMLVideoElement>(null),
    root = `studies/${studyId}/visual`,
    src = data?.sources.find((m) => m.mediaId === mediaId),
    run = data?.runs.find((r) => r.id === runId),
    observations = (data?.observations || []).filter(
      (o) => o.mediaId === mediaId,
    ),
    shown = observations.filter(
      (o) =>
        (filter === "all" || o.status === filter) &&
        (o.description + " " + o.interpretation)
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
    );
  async function load() {
    const d = await api<VisualData>(root);
    setData(d);
    setMediaId((id) =>
      d.sources.some((s) => s.mediaId === id)
        ? id
        : d.sources[0]?.mediaId || "",
    );
    setRunId((id) =>
      d.runs.some((r) => r.id === id) ? id : d.runs[0]?.id || "",
    );
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [studyId]);
  useEffect(() => {
    if (!data) return;
    const s = data.sources.find((s) => s.mediaId === mediaId);
    setStart(0);
    setEnd(Math.min(3000, s?.durationMs || 3000));
    setEditing(null);
    setForm(empty());
    setPermission(false);
    setAnswer(null);
    setRunId(data.runs.find((r) => r.mediaId === mediaId)?.id || "");
  }, [mediaId]);
  function patch(changes: Partial<Form>) {
    setForm((f) => ({ ...f, ...changes, reviewed: false }));
  }
  function edit(o: VisualObservation) {
    setEditing(o);
    setForm({
      atMs: o.atMs,
      description: o.description,
      interpretation: o.interpretation,
      uncertainty: o.uncertainty,
      tag: o.tag,
      status: o.status,
      reviewed: o.reviewed,
      quote: o.claim?.quote || "",
      relation: o.claim?.relation || "context",
      note: o.claim?.note || "",
    });
    seek(o.atMs);
    setAnswer(null);
  }
  function seek(ms: number) {
    if (video.current) {
      video.current.currentTime = ms / 1000;
      video.current.pause();
    }
  }
  async function act(fn: () => Promise<void>, message?: string) {
    setBusy(true);
    setError("");
    setStatus("");
    setAnswer(null);
    try {
      await fn();
      if (message) setStatus(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function generate(retry?: NonNullable<VisualData["runs"]>[number]) {
    const payload = retry
      ? {
          mediaId: retry.mediaId,
          requestId: retry.requestId,
          startMs: retry.startMs,
          endMs: retry.endMs,
          frameCount: retry.frameCount,
          sendToProvider: permission,
        }
      : {
          mediaId,
          requestId: crypto.randomUUID(),
          startMs,
          endMs,
          frameCount,
          sendToProvider: permission,
        };
    const r = await api(`${root}/runs`, "POST", payload);
    await load();
    setRunId(r.run.id);
    if (r.run.state !== "complete")
      throw new Error(
        r.run.error ||
          "Analysis did not finish. Retry after the lease expires.",
      );
    setStatus(
      r.reused
        ? "Completed analysis reused; existing review decisions were preserved."
        : "Visual proposals saved as pending. Review the recording and each description before confirming.",
    );
  }
  if (!data && !error) return <Spinner />;
  return (
    <div className="visual-stack">
      <TaskResultsPanel studyId={studyId} />
      {error && (
        <div role="alert">
          <Notice>{error}</Notice>
        </div>
      )}
      {status && <p role="status">{status}</p>}
      <section className="panel visual-stack">
        <div className="panel-heading">
          <div>
            <h2>Visual Insights</h2>
            <p className="muted">
              A reviewable record of visible screen states, with timestamps and
              source evidence.
            </p>
          </div>
          <button className="button" disabled={busy} onClick={() => act(load)}>
            Refresh visual evidence
          </button>
        </div>
        <Notice>
          Sampled frames cannot establish click counts, task success, intention,
          emotion or activity in gaps. AI proposals stay pending until you
          review them. Participant accounts are linked separately from what is
          visible.
        </Notice>
        {!data?.sources.length ? (
          <p>
            Complete an included interview with a saved screen recording or
            imported video to begin. Screen-sharing sessions must be closed.
          </p>
        ) : (
          <>
            <label>
              Visual source
              <select
                aria-label="Visual source"
                value={mediaId}
                disabled={busy}
                onChange={(e) => setMediaId(e.target.value)}
              >
                {data.sources.map((s) => (
                  <option key={s.mediaId} value={s.mediaId}>
                    {s.origin === "screen"
                      ? "Screen session"
                      : "Imported video"}{" "}
                    · {s.prompt.slice(0, 55)} · {s.interviewId.slice(0, 8)} ·{" "}
                    {s.captureId
                      ? `session offset ${stamp(s.offsetMs)}`
                      : "single video"}
                  </option>
                ))}
              </select>
            </label>
            {src && (
              <>
                <video
                  onLoadedMetadata={() => {
                    if (pendingSeek.current !== null) {
                      seek(pendingSeek.current);
                      pendingSeek.current = null;
                    }
                  }}
                  key={src.mediaId}
                  ref={video}
                  controls
                  playsInline
                  preload="metadata"
                  src={`/api/recordings/${src.mediaId}`}
                />
                <p className="small muted">
                  Video length {stamp(src.durationMs)}
                  {src.captureId
                    ? ` · Capture ${src.captureId} · This clip starts at session time ${stamp(src.offsetMs)}. Separate capture sessions have independent clocks.`
                    : " · External interview video; no task or narration timing is inferred."}
                </p>
                <p className="small mono">
                  Response {src.interviewId} / Turn {src.turnId}
                  <br />
                  Revision {src.revisionId}
                  {src.conceptId && ` · Concept ${src.conceptId}`}
                </p>
                <details>
                  <summary>Linked participant account</summary>
                  <p className="preserve-lines" lang={src.language}>
                    {src.account}
                  </p>
                  <p className="small muted">
                    {src.origin === "screen"
                      ? "This is the task’s written reflection, not an automatic transcript of screen narration."
                      : "This is the imported transcript. Review speaker labels before attributing a statement."}
                  </p>
                </details>
              </>
            )}
          </>
        )}
      </section>
      {src && data && (
        <>
          <section className="panel visual-stack">
            <h3>Propose observations from sampled frames</h3>
            <p>
              Choose a 0.5–30 second range. The server samples 3–6 frames,
              records their decoded video timestamps and sends those images to
              the configured AI provider. No audio is included. Unsampled
              intervals remain unobserved.
            </p>
            <div className="visual-range">
              <label>
                Sample start (seconds)
                <input
                  type="number"
                  min={0}
                  max={src.durationMs / 1000}
                  step={0.1}
                  value={startMs / 1000}
                  disabled={busy}
                  onChange={(e) =>
                    setStart(Math.round(Number(e.target.value) * 1000))
                  }
                />
              </label>
              <label>
                Sample end (seconds)
                <input
                  type="number"
                  min={0.5}
                  max={src.durationMs / 1000}
                  step={0.1}
                  value={endMs / 1000}
                  disabled={busy}
                  onChange={(e) =>
                    setEnd(Math.round(Number(e.target.value) * 1000))
                  }
                />
              </label>
              <label>
                Number of frames
                <select
                  aria-label="Number of frames"
                  value={frameCount}
                  disabled={busy}
                  onChange={(e) => setFrameCount(Number(e.target.value))}
                >
                  {[3, 4, 5, 6].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={permission}
                disabled={busy}
                onChange={(e) => setPermission(e.target.checked)}
              />
              Send these sampled screen images to the connected AI provider for
              this analysis.
            </label>
            <button
              className="button primary"
              disabled={busy || !permission || !data.ai}
              onClick={() => act(() => generate())}
            >
              {busy ? "Working…" : "Generate visual proposals"}
            </button>
            {!data.ai && (
              <p className="small muted">
                AI is not configured here. Manual annotations and review remain
                available.
              </p>
            )}
            {!!data.runs.filter((r) => r.mediaId === mediaId).length && (
              <>
                <label>
                  Analysis run
                  <select
                    aria-label="Analysis run"
                    value={runId}
                    disabled={busy}
                    onChange={(e) => setRunId(e.target.value)}
                  >
                    {data.runs
                      .filter((r) => r.mediaId === mediaId)
                      .map((r) => (
                        <option value={r.id} key={r.id}>
                          {r.state} · {stamp(r.startMs)}–{stamp(r.endMs)} ·
                          attempt {r.attempts}
                        </option>
                      ))}
                  </select>
                </label>
                {run?.mediaId === mediaId && (
                  <>
                    <p className="small muted">
                      {run.state} · {run.model} · {run.promptVersion} ·{" "}
                      {run.language}
                      {run.error && ` · ${run.error}`}
                    </p>
                    <div className="visual-frames">
                      {run.frames.map((f) => (
                        <button
                          className="visual-frame"
                          key={f.id}
                          onClick={() => seek(f.atMs)}
                        >
                          <img
                            loading="lazy"
                            src={`/api/${root}/runs/${run.id}/frames/${f.id}`}
                            alt={`${f.id} at source video ${stamp(f.atMs)}`}
                          />
                          <span>
                            {f.id} · video {stamp(f.atMs)}
                            {src.captureId &&
                              ` · session ${stamp(src.offsetMs + f.atMs)}`}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="panel-actions">
                      <button
                        className="button"
                        disabled={busy || !permission || !data.ai}
                        onClick={() => act(() => generate(run))}
                      >
                        {run.state === "complete"
                          ? "Reuse completed run"
                          : "Retry this analysis"}
                      </button>
                      <button
                        className="button danger"
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              "Delete this analysis and its observations/history?",
                            )
                          )
                            act(async () => {
                              await api(`${root}/runs/${run.id}`, "DELETE");
                              setRunId("");
                              await load();
                            }, "Analysis and its observations deleted.");
                        }}
                      >
                        Delete analysis run
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
          <section className="panel visual-stack">
            <h3>
              {editing ? "Edit visual observation" : "Add a manual observation"}
            </h3>
            <p>
              Describe what you can see. Keep interpretation and uncertainty in
              their own fields. Review the recording before confirming.
            </p>
            <label>
              Observation time (seconds)
              <input
                type="number"
                min={0}
                max={(src.durationMs - 1) / 1000}
                step={0.001}
                value={form.atMs / 1000}
                disabled={busy || editing?.origin === "ai"}
                onChange={(e) =>
                  patch({ atMs: Math.round(Number(e.target.value) * 1000) })
                }
              />
            </label>
            <button
              className="button"
              disabled={busy || editing?.origin === "ai"}
              onClick={() =>
                patch({
                  atMs: Math.min(
                    src.durationMs - 1,
                    Math.round((video.current?.currentTime || 0) * 1000),
                  ),
                })
              }
            >
              Use playback time
            </button>
            <label>
              Visible observation
              <textarea
                aria-label="Visible observation"
                value={form.description}
                maxLength={1500}
                disabled={busy}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </label>
            <label>
              Researcher interpretation
              <textarea
                aria-label="Researcher interpretation"
                value={form.interpretation}
                maxLength={1500}
                disabled={busy}
                onChange={(e) => patch({ interpretation: e.target.value })}
              />
            </label>
            <label>
              Uncertainty and coverage
              <textarea
                aria-label="Uncertainty and coverage"
                value={form.uncertainty}
                maxLength={1000}
                disabled={busy}
                onChange={(e) => patch({ uncertainty: e.target.value })}
              />
            </label>
            <div className="library-two">
              <label>
                Observation category
                <select
                  aria-label="Observation category"
                  value={form.tag}
                  disabled={busy}
                  onChange={(e) =>
                    patch({ tag: e.target.value as Form["tag"] })
                  }
                >
                  {[
                    "visible_content",
                    "visible_change",
                    "navigation_cue",
                    "unclear",
                  ].map((t) => (
                    <option value={t} key={t}>
                      {t.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Review status
                <select
                  aria-label="Review status"
                  value={form.status}
                  disabled={busy}
                  onChange={(e) =>
                    patch({ status: e.target.value as Form["status"] })
                  }
                >
                  {["pending", "confirmed", "rejected"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
            </div>
            <details>
              <summary>
                Compare with the linked participant account (optional)
              </summary>
              <p className="small muted">
                Copy an exact quote from the account above. A possible tension
                is an interpretation for review, not a verified contradiction.
              </p>
              <label>
                Exact account quote
                <textarea
                  aria-label="Exact account quote"
                  value={form.quote}
                  maxLength={12000}
                  disabled={busy}
                  onChange={(e) => patch({ quote: e.target.value })}
                />
              </label>
              <label>
                Account relationship
                <select
                  aria-label="Account relationship"
                  value={form.relation}
                  disabled={busy}
                  onChange={(e) =>
                    patch({ relation: e.target.value as Form["relation"] })
                  }
                >
                  <option value="context">Context</option>
                  <option value="consistent">
                    Consistent with the visible state
                  </option>
                  <option value="possible_tension">
                    Possible tension to investigate
                  </option>
                </select>
              </label>
              <label>
                Comparison interpretation
                <textarea
                  aria-label="Comparison interpretation"
                  value={form.note}
                  maxLength={1500}
                  disabled={busy}
                  onChange={(e) => patch({ note: e.target.value })}
                />
              </label>
            </details>
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.reviewed}
                disabled={busy}
                onChange={(e) =>
                  setForm((f) => ({ ...f, reviewed: e.target.checked }))
                }
              />
              I reviewed the video time, visible description, interpretation,
              uncertainty and any account comparison.
            </label>
            {editing?.origin === "ai" && (
              <p className="small muted">
                AI source frames: {editing.frameIds.join(", ")} ·{" "}
                {editing.model} · {editing.promptVersion}. Its timestamp stays
                attached to those frames; create a manual note to use another
                time.
              </p>
            )}
            <div className="panel-actions">
              <button
                className="button primary"
                disabled={busy || form.description.trim().length < 3}
                onClick={() =>
                  act(async () => {
                    const { quote, relation, note, ...fields } = form,
                      payload = {
                        ...fields,
                        claim: quote ? { quote, relation, note } : null,
                      };
                    if (editing)
                      await api(`${root}/observations/${editing.id}`, "PUT", {
                        ...payload,
                        version: editing.version,
                      });
                    else
                      await api(`${root}/observations`, "POST", {
                        ...payload,
                        mediaId,
                      });
                    setEditing(null);
                    setForm(empty());
                    await load();
                  }, "Observation saved. Only confirmed, reviewed notes enter exports and Q&A.")
                }
              >
                Save observation
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setForm(empty());
                }}
              >
                Start a new manual note
              </button>
            </div>
          </section>
          <section className="panel visual-stack">
            <div className="panel-heading">
              <h3>Observation log</h3>
              <a className="button" href={`/api/${root}/export`} download>
                Export reviewed observations CSV
              </a>
            </div>
            <p>
              {
                observations.filter(
                  (o) => o.status === "confirmed" && o.reviewed,
                ).length
              }{" "}
              confirmed notes ·{" "}
              {observations.filter((o) => o.status === "pending").length}{" "}
              pending proposals/notes. These are annotation counts, not people,
              clicks or task outcomes.
            </p>
            <div className="library-two">
              <label>
                Filter observations
                <select
                  aria-label="Filter observations"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  {["all", "pending", "confirmed", "rejected"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                Search observation text
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
            </div>
            {!shown.length ? (
              <p>No matching observations.</p>
            ) : (
              shown.map((o) => (
                <article className="visual-observation" key={o.id}>
                  <span className="badge">
                    {o.status} · {o.origin}
                  </span>
                  <h4>{o.description}</h4>
                  <button className="text-button" onClick={() => seek(o.atMs)}>
                    Jump to {stamp(o.atMs)}
                  </button>
                  {src.captureId && (
                    <p className="small muted">
                      Capture time {stamp(src.offsetMs + o.atMs)} ·{" "}
                      {src.captureId}
                    </p>
                  )}
                  <p>
                    <strong>Interpretation:</strong>{" "}
                    {o.interpretation || "None recorded."}
                  </p>
                  <p>
                    <strong>Uncertainty:</strong>{" "}
                    {o.uncertainty || "Review coverage and gaps."}
                  </p>
                  {o.claim && (
                    <blockquote>
                      <p>{o.claim.quote}</p>
                      <p>
                        {o.claim.relation.replaceAll("_", " ")} · {o.claim.note}
                      </p>
                    </blockquote>
                  )}
                  <p className="small muted">
                    v{o.version} ·{" "}
                    {o.frameIds.join(", ") || "Manual video annotation"}
                    {o.reviewedBy && ` · Reviewed by ${o.reviewedBy}`}
                  </p>
                  <div className="panel-actions">
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => edit(o)}
                    >
                      Edit / review observation
                    </button>
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        act(async () =>
                          setHistory(
                            (await api(`${root}/observations/${o.id}/history`))
                              .history,
                          ),
                        )
                      }
                    >
                      View observation history
                    </button>
                    <button
                      className="button danger"
                      disabled={busy}
                      onClick={() => {
                        if (confirm("Delete this observation and its history?"))
                          act(async () => {
                            await api(
                              `${root}/observations/${o.id}`,
                              "DELETE",
                              { version: o.version },
                            );
                            if (editing?.id === o.id) {
                              setEditing(null);
                              setForm(empty());
                            }
                            await load();
                          }, "Observation and history deleted.");
                      }}
                    >
                      Delete observation
                    </button>
                  </div>
                </article>
              ))
            )}
          </section>
          <section className="panel visual-stack">
            <h3>Ask about reviewed visual evidence</h3>
            <p>
              Answers use confirmed notes and exact observation citations. They
              do not establish behavioral metrics or verify participant
              accounts.
            </p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={allVideos}
                disabled={busy}
                onChange={(e) => {
                  setAllVideos(e.target.checked);
                  setAnswer(null);
                }}
              />
              Use reviewed notes from all videos in this study
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                act(async () =>
                  setAnswer(
                    await api(`${root}/qa`, "POST", {
                      question,
                      mediaId: allVideos ? undefined : mediaId,
                    }),
                  ),
                );
              }}
            >
              <label>
                Visual research question
                <textarea
                  aria-label="Visual research question"
                  value={question}
                  minLength={5}
                  maxLength={2000}
                  disabled={busy}
                  onChange={(e) => {
                    setQuestion(e.target.value);
                    setAnswer(null);
                  }}
                  required
                />
              </label>
              <button className="button primary" disabled={busy || !data.ai}>
                Ask reviewed evidence
              </button>
            </form>
            {answer && (
              <article aria-label="Visual evidence answer">
                <p className="preserve-lines">{answer.answer}</p>
                {answer.citations.map((c, n) => {
                  const o = data.observations.find(
                    (o) => o.id === c.observationId,
                  );
                  return (
                    <div key={n}>
                      <blockquote>{c.quote}</blockquote>
                      <p className="small mono">
                        Observation {c.observationId}
                      </p>
                      {o && (
                        <button
                          className="text-button"
                          onClick={() => {
                            if (o.mediaId !== mediaId) {
                              pendingSeek.current = o.atMs;
                              setMediaId(o.mediaId);
                            } else seek(o.atMs);
                          }}
                        >
                          Open cited video at {stamp(o.atMs)}
                        </button>
                      )}
                    </div>
                  );
                })}
              </article>
            )}
          </section>
        </>
      )}
      {history && (
        <Modal
          title="Visual observation history"
          onClose={() => setHistory(null)}
        >
          {history.map((h) => (
            <article className="visual-observation" key={h.id}>
              <strong>
                v{h.observation.version} · {h.observation.status}
              </strong>
              <p>{h.observation.description}</p>
              <p>Interpretation: {h.observation.interpretation}</p>
              <p>Uncertainty: {h.observation.uncertainty}</p>
              <p className="small muted">
                {h.actorName} · {new Date(h.createdAt).toLocaleString()}
              </p>
            </article>
          ))}
        </Modal>
      )}
    </div>
  );
}
