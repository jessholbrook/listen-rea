"use client";
import RecordingCitation from "./recording-citation";
import { useEffect, useRef, useState } from "react";
import { transcriptAnswerLabels } from "@/lib/library-transcript-answers";
import { SemanticResult } from "./library-semantic-tools";
import { api } from "@/lib/client";
import {
  libraryAnswerLabels,
  type SavedLibraryAnswer,
  type SavedLibrarySource,
} from "@/lib/library-answers";
import {
  libraryAttachmentLabels,
  type LibraryAttachmentHit,
} from "@/lib/library-attachments";
import type { Language } from "@/lib/localization";
import { Modal, Notice } from "./components";
type Row = {
  id: string;
  question: string;
  language: Language;
  createdAt: string;
  version: number;
  reviewed: boolean;
  includeInExports: boolean;
};
type Details = Omit<
  SavedLibraryAnswer,
  "workspaceId" | "requestId" | "inputHash" | "dependencies"
>;

export default function LibrarySavedAnswers({
  language,
  refresh,
  openResponse,
  scope = "attachments",
  onlyId,
  closed,
}: {
  scope?: "attachments" | "transcripts";
  onlyId?: string;
  closed?: () => void;
  language: Language;
  refresh: number;
  openResponse: (id: string) => Promise<void>;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [selected, setSelected] = useState<Details | null>(null),
    [text, setText] = useState(""),
    [citations, setCitations] = useState<string[]>([]),
    [reviewed, setReviewed] = useState(false),
    [include, setInclude] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [canEdit, setCanEdit] = useState(false),
    [source, setSource] = useState<SavedLibrarySource | null>(null);
  const epoch = useRef(0),
    abort = useRef<AbortController | null>(null),
    l = {
      ...libraryAnswerLabels[language],
      ...(scope === "transcripts"
        ? {
            title: transcriptAnswerLabels[language].title,
            notice: transcriptAnswerLabels[language].notice,
            warning: transcriptAnswerLabels[language].warning,
          }
        : {}),
    },
    e = libraryAttachmentLabels[language];
  const root =
    scope === "transcripts" ? "library/answers" : "library/attachments/answers";
  function reset() {
    epoch.current++;
    abort.current?.abort();
    setSelected(null);
    setSource(null);
    setText("");
    setCitations([]);
    setReviewed(false);
    setInclude(false);
    setBusy(false);
    setError("");
  }
  function populate(s: Details) {
    setSelected(s);
    const r = s.history.at(-1)!;
    setText(r.answer);
    setCitations(r.citations.map((c) => c.evidenceId));
    setReviewed(r.reviewed);
    setInclude(r.includeInExports);
    setSource(null);
  }
  async function list(
    signal?: AbortSignal,
  ): Promise<{ answers: Row[]; canEdit: boolean; answer?: Details }> {
    if (onlyId) {
      const r = await api<{ answer: Details; canEdit: boolean }>(
        root + "/" + onlyId,
        "GET",
        undefined,
        undefined,
        signal,
      );
      const a = r.answer,
        v = a.history.at(-1)!;
      return {
        answer: a,
        canEdit: r.canEdit,
        answers: [
          {
            id: a.id,
            question: a.original.question,
            language: a.language,
            createdAt: a.createdAt,
            version: v.version,
            reviewed: v.reviewed,
            includeInExports: v.includeInExports,
          },
        ],
      };
    }
    return api<{ answers: Row[]; canEdit: boolean }>(
      root,
      "GET",
      undefined,
      undefined,
      signal,
    );
  }
  async function load() {
    reset();
    const generation = ++epoch.current,
      controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    try {
      const r = await list(controller.signal);
      if (epoch.current === generation) {
        setRows(r.answers);
        setCanEdit(r.canEdit);
        if (r.answer) populate(r.answer);
      }
    } catch (err) {
      if (epoch.current === generation) setError((err as Error).message);
    } finally {
      if (epoch.current === generation) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      epoch.current++;
      abort.current?.abort();
    };
  }, [language, refresh, scope, onlyId]);
  async function action(
    type: "open" | "update" | "withdraw" | "delete" | "source" | "md" | "csv",
    id?: string,
  ) {
    abort.current?.abort();
    const generation = ++epoch.current,
      controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    setSource(null);
    try {
      if (type === "md" || type === "csv") {
        const r = await fetch(
          "/api/" + root + "/" + selected!.id + "/export?format=" + type,
          {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!r.ok) {
          const j = await r.json();
          throw Error(j.error || "Download failed.");
        }
        const blob = await r.blob();
        if (epoch.current !== generation) return;
        const url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = "echo-lab-library-answer-" + selected!.id + "." + type;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
      if (type === "source") {
        const r = await api<{ source: SavedLibrarySource }>(
          scope === "transcripts"
            ? root + "/" + selected!.id + "/source"
            : "library/attachments/source",
          "POST",
          scope === "transcripts" ? { id } : { ...selected!.filter, id },
          undefined,
          controller.signal,
        );
        if (epoch.current === generation) setSource(r.source);
        return;
      }
      if (type === "open") {
        const r = await api<{ answer: Details }>(
          root + "/" + id,
          "GET",
          undefined,
          undefined,
          controller.signal,
        );
        if (epoch.current === generation) populate(r.answer);
        return;
      }
      const previous = selected!.history.at(-1)!;
      const r = await api<{ answer: Details }>(
        root + "/" + selected!.id,
        type === "delete" ? "DELETE" : "PUT",
        type === "delete"
          ? { version: previous.version }
          : {
              version: previous.version,
              answer: type === "withdraw" ? previous.answer : text,
              citations:
                type === "withdraw"
                  ? previous.citations
                  : selected!.sources
                      .filter((h) => citations.includes(h.id))
                      .map((h) => ({ evidenceId: h.id, quote: h.text })),
              reviewed: type === "withdraw" ? previous.reviewed : reviewed,
              includeInExports: type === "withdraw" ? false : include,
            },
        undefined,
        controller.signal,
      );
      if (epoch.current !== generation) return;
      if (type === "delete") setSelected(null);
      else populate(r.answer);
      const refreshed = await list(controller.signal);
      if (epoch.current === generation) {
        setRows(refreshed.answers);
        setCanEdit(refreshed.canEdit);
      }
    } catch (err) {
      if (epoch.current !== generation) return;
      setSelected(null);
      setSource(null);
      setError((err as Error).message);
      try {
        const r = await list(controller.signal);
        if (epoch.current === generation) {
          setRows(r.answers);
          setCanEdit(r.canEdit);
        }
      } catch {
        if (epoch.current === generation) setRows([]);
      }
    } finally {
      if (epoch.current === generation) setBusy(false);
    }
  }
  const latest = selected?.history.at(-1),
    dirty =
      !!selected &&
      !!latest &&
      (text !== latest.answer ||
        reviewed !== latest.reviewed ||
        include !== latest.includeInExports ||
        JSON.stringify([...citations].sort()) !==
          JSON.stringify(latest.citations.map((c) => c.evidenceId).sort()));
  return (
    <section
      className="panel library-stack"
      aria-label={l.title}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <h3>{l.title}</h3>
      <p className="muted">{l.notice}</p>
      <button className="secondary" disabled={busy} onClick={() => void load()}>
        {l.refresh}
      </button>
      {error && (
        <div role="alert">
          <Notice>{error}</Notice>
        </div>
      )}
      {busy && <p role="status">{e.working}</p>}
      {!rows.length && !busy && <p>{l.empty}</p>}
      {rows.map((r) => (
        <article key={r.id} className="panel" data-saved-answer-id={r.id}>
          <p>{r.question}</p>
          <p className="muted">
            {r.language.toUpperCase()} · {l.revision} {r.version} ·{" "}
            {r.includeInExports && r.reviewed ? l.approved : l.draft}
          </p>
          <button disabled={busy} onClick={() => action("open", r.id)}>
            {l.open}
          </button>
        </article>
      ))}
      {selected && latest && (
        <Modal
          title={l.open}
          onClose={() => {
            reset();
            closed?.();
          }}
        >
          <p>
            {l.question}: {selected.original.question}
          </p>
          <SemanticResult
            value={selected.original.retrieval}
            language={language}
          />
          <p className="muted">
            {selected.original.model} · {selected.original.promptVersion} ·{" "}
            {selected.original.generatedAt}
          </p>
          <label>
            {l.answer}
            <textarea
              aria-label={l.answer}
              maxLength={6000}
              disabled={!canEdit || busy}
              value={text}
              onChange={(v) => {
                setText(v.target.value);
                setReviewed(false);
                setInclude(false);
              }}
            />
          </label>
          <h4>{l.sources}</h4>
          {selected.sources.map((h) => (
            <article className="panel" key={h.id}>
              <label className="check-row">
                <input
                  type="checkbox"
                  disabled={!canEdit || busy}
                  checked={citations.includes(h.id)}
                  onChange={(v) => {
                    setCitations((ids) =>
                      v.target.checked
                        ? [...ids, h.id]
                        : ids.filter((x) => x !== h.id),
                    );
                    setReviewed(false);
                    setInclude(false);
                  }}
                />
                {l.citation} · {h.format.toUpperCase()} ·{" "}
                {h.kind === "transcript"
                  ? transcriptAnswerLabels[language].source
                  : h.kind === "passage"
                    ? e.passage
                    : e.observation}
                {h.field ? " · " + e[h.field] : ""}
              </label>
              <blockquote>{h.text}</blockquote>
              {h.format === "transcript" && h.transcript.recordingSection && (
                <RecordingCitation
                  value={h.transcript.recordingSection}
                  language={language}
                />
              )}
              <p className="muted">
                {h.studyTitle} · {h.revisionId}
                {h.conceptId ? " · " + h.conceptId : ""}
              </p>
              {h.locator && (
                <p>
                  {h.locator.unit === "turn"
                    ? transcriptAnswerLabels[language].turn
                    : e[h.locator.unit]}{" "}
                  {h.locator.number} · {e.characters} {h.locator.start}–
                  {h.locator.end}
                  {h.ocr ? " · " + e.ocr : ""}
                </p>
              )}
              <p className="muted">
                {h.format === "transcript"
                  ? `${h.transcript.source} · ${h.transcript.language} · ${h.transcript.prompt}`
                  : `${e.review} v${h.version} · ${h.reviewerName} · ${h.reviewedAt}`}
                {h.grounding ? " · " + h.grounding : ""}
              </p>
              <button
                disabled={busy}
                className="secondary"
                onClick={() => action("source", h.id)}
              >
                {e.source}
              </button>
            </article>
          ))}
          {source && (
            <section aria-label={e.original}>
              <h4>{e.original}</h4>
              <blockquote>{source.text}</blockquote>
              <button
                disabled={busy}
                onClick={() => {
                  const id = source.interviewId;
                  reset();
                  void openResponse(id);
                }}
              >
                {e.response}
              </button>
            </section>
          )}
          <label className="check-row">
            <input
              type="checkbox"
              disabled={!canEdit || busy || !citations.length}
              checked={reviewed}
              onChange={(v) => {
                setReviewed(v.target.checked);
                if (!v.target.checked) setInclude(false);
              }}
            />
            {l.reviewed}
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              disabled={!canEdit || busy || !reviewed}
              checked={include}
              onChange={(v) => setInclude(v.target.checked)}
            />
            {l.include}
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              disabled={!canEdit || busy || !text.trim() || !citations.length}
              onClick={() => action("update")}
            >
              {l.update}
            </button>
            <button
              className="secondary"
              disabled={!canEdit || busy || !latest.includeInExports}
              onClick={() => action("withdraw")}
            >
              {l.withdraw}
            </button>
            <button
              className="secondary"
              disabled={
                busy || dirty || !latest.reviewed || !latest.includeInExports
              }
              onClick={() => action("md")}
            >
              {l.markdown}
            </button>
            <button
              className="secondary"
              disabled={
                busy || dirty || !latest.reviewed || !latest.includeInExports
              }
              onClick={() => action("csv")}
            >
              {l.csv}
            </button>
            <button
              className="danger"
              disabled={!canEdit || busy}
              onClick={() => {
                if (confirm(l.remove + "?")) void action("delete");
              }}
            >
              {l.remove}
            </button>
            <button className="secondary" onClick={reset}>
              {l.close}
            </button>
          </div>
          <details>
            <summary>{l.original}</summary>
            <p style={{ whiteSpace: "pre-wrap" }}>{selected.original.answer}</p>
            {selected.original.citations.map((c) => (
              <blockquote key={c.evidenceId}>{c.quote}</blockquote>
            ))}
          </details>
          <details>
            <summary>
              {l.history} ({selected.history.length})
            </summary>
            {selected.history.map((r) => (
              <article key={r.version}>
                <p>
                  {l.revision} {r.version} · {r.editor.name} · {r.at} ·{" "}
                  {r.reviewed && r.includeInExports ? l.approved : l.draft}
                </p>
                <p style={{ whiteSpace: "pre-wrap" }}>{r.answer}</p>
                {r.citations.map((c) => (
                  <blockquote key={c.evidenceId}>{c.quote}</blockquote>
                ))}
              </article>
            ))}
          </details>
        </Modal>
      )}
    </section>
  );
}
