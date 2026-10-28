"use client";
import RecordingCitation from "./recording-citation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import {
  briefLabels,
  type BriefDetails,
  type BriefSection,
} from "@/lib/library-briefs";
import { languages, languageNames, type Language } from "@/lib/localization";
import { transcriptAnswerLabels } from "@/lib/library-transcript-answers";
import { libraryAttachmentLabels } from "@/lib/library-attachments";
import type { SavedLibrarySource } from "@/lib/library-answers";
import { Modal, Notice } from "./components";
import { SemanticResult } from "./library-semantic-tools";
type AnswerRow = {
  scope?: "attachments" | "transcripts";
  id: string;
  question: string;
  version: number;
  reviewed: boolean;
  includeInExports: boolean;
};
type Row = {
  id: string;
  title: string;
  language: Language;
  version: number;
  sectionCount: number;
  current: boolean;
  canExport: boolean;
};
const root = "library/briefs";
export default function LibraryBriefsPanel({
  openResponse,
  initialId,
}: {
  initialId?: string;
  openResponse: (id: string) => Promise<void>;
}) {
  const [language, setLanguage] = useState<Language>("en"),
    [rows, setRows] = useState<Row[]>([]),
    [answers, setAnswers] = useState<AnswerRow[]>([]),
    [selected, setSelected] = useState<BriefDetails | null>(null),
    [editing, setEditing] = useState(false),
    [title, setTitle] = useState(""),
    [summary, setSummary] = useState(""),
    [sections, setSections] = useState<BriefSection[]>([]),
    [reviewed, setReviewed] = useState(false),
    [include, setInclude] = useState(false),
    [dirty, setDirty] = useState(false),
    [canEdit, setCanEdit] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [source, setSource] = useState<SavedLibrarySource | null>(null);
  const epoch = useRef(0),
    abort = useRef<AbortController | null>(null),
    requestId = useRef(crypto.randomUUID()),
    l = briefLabels[language];
  const approved = answers.filter((a) => a.reviewed && a.includeInExports);
  function invalidate() {
    epoch.current++;
    abort.current?.abort();
    setBusy(false);
    setError("");
    setNotice("");
    setSource(null);
  }
  function changed() {
    setDirty(true);
    setReviewed(false);
    setInclude(false);
    setNotice("");
    requestId.current = crypto.randomUUID();
  }
  function populate(b: BriefDetails) {
    setSelected(b);
    setTitle(b.title);
    setSummary(b.summary);
    setSections(
      b.sections.map(({ answerId, answerVersion, heading, commentary }) => ({
        answerId,
        answerVersion,
        heading,
        commentary,
      })),
    );
    setReviewed(b.reviewed);
    setInclude(b.includeInExports);
    setEditing(true);
    setDirty(false);
  }
  function close() {
    invalidate();
    setSelected(null);
    setEditing(false);
    setSections([]);
    setReviewed(false);
    setInclude(false);
    setDirty(false);
  }
  async function fetchLists(signal: AbortSignal) {
    const [r, a] = await Promise.all([
      api<{ briefs: Row[]; canEdit: boolean }>(
        root,
        "GET",
        undefined,
        undefined,
        signal,
      ),
      api<{ answers: AnswerRow[] }>(
        "library/answers?scope=all",
        "GET",
        undefined,
        undefined,
        signal,
      ),
    ]);
    return { rows: r.briefs, canEdit: r.canEdit, answers: a.answers };
  }
  async function run(
    action: (signal: AbortSignal, generation: number) => Promise<void>,
  ) {
    invalidate();
    const controller = new AbortController(),
      generation = ++epoch.current;
    abort.current = controller;
    setBusy(true);
    try {
      await action(controller.signal, generation);
    } catch (e) {
      if (epoch.current === generation) {
        setSource(null);
        setSelected(null);
        setEditing(false);
        setError((e as Error).message);
      }
    } finally {
      if (epoch.current === generation) setBusy(false);
    }
  }
  function applyLists(r: Awaited<ReturnType<typeof fetchLists>>) {
    setRows(r.rows);
    setAnswers(r.answers);
    setCanEdit(r.canEdit);
  }
  async function load() {
    await run(async (signal, generation) => {
      const r = await fetchLists(signal);
      let b: BriefDetails | undefined;
      if (selected)
        b = (
          await api<{ brief: BriefDetails }>(
            root + "/" + selected.id,
            "GET",
            undefined,
            undefined,
            signal,
          )
        ).brief;
      if (epoch.current !== generation) return;
      applyLists(r);
      if (b) populate(b);
    });
  }
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await load();
      if (initialId && !cancelled) await open(initialId);
    })();
    return () => {
      cancelled = true;
      epoch.current++;
      abort.current?.abort();
    };
  }, [language, initialId]);
  async function open(id: string) {
    await run(async (signal, generation) => {
      const r = await api<{ brief: BriefDetails; canEdit: boolean }>(
        root + "/" + id,
        "GET",
        undefined,
        undefined,
        signal,
      );
      if (epoch.current === generation) {
        populate(r.brief);
        setCanEdit(r.canEdit);
      }
    });
  }
  async function save(withdraw = false) {
    await run(async (signal, generation) => {
      const content = withdraw
        ? {
            title: selected!.title,
            summary: selected!.summary,
            language: selected!.language,
            sections: selected!.sections.map(
              ({ answerId, answerVersion, heading, commentary }) => ({
                answerId,
                answerVersion,
                heading,
                commentary,
              }),
            ),
          }
        : { title, summary, language, sections };
      const r = await api<{ brief: BriefDetails }>(
        root + (selected ? "/" + selected.id : ""),
        selected ? "PUT" : "POST",
        selected
          ? {
              ...content,
              version: selected.version,
              reviewed: withdraw ? selected.reviewed : reviewed,
              includeInExports: withdraw ? false : include,
            }
          : { ...content, requestId: requestId.current },
        undefined,
        signal,
      );
      const lists = await fetchLists(signal);
      if (epoch.current === generation) {
        populate(r.brief);
        applyLists(lists);
        setNotice(l.saved);
      }
    });
  }
  async function download(format: "md" | "csv") {
    await run(async (signal, generation) => {
      const r = await fetch(
        "/api/" + root + "/" + selected!.id + "/export?format=" + format,
        { credentials: "same-origin", cache: "no-store", signal },
      );
      if (!r.ok) throw Error((await r.json()).error || "Download failed.");
      const blob = await r.blob();
      if (epoch.current !== generation) return;
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = "echo-lab-brief-" + selected!.id + "." + format;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  function editSection(i: number, value: Partial<BriefSection>) {
    setSections((s) => s.map((v, n) => (n === i ? { ...v, ...value } : v)));
    changed();
  }
  function move(i: number, direction: number) {
    setSections((s) => {
      const next = [...s];
      [next[i], next[i + direction]] = [next[i + direction], next[i]];
      return next;
    });
    changed();
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
            close();
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
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          {l.refresh}
        </button>
        <button
          disabled={busy || !canEdit || !approved.length}
          onClick={() => {
            close();
            setTitle("");
            setSummary("");
            setSections([]);
            setEditing(true);
            setDirty(true);
            requestId.current = crypto.randomUUID();
          }}
        >
          {l.create}
        </button>
      </div>
      {busy && <p role="status">{l.working}</p>}
      {error && (
        <div role="alert">
          <Notice>{error}</Notice>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {!rows.length && <p>{l.empty}</p>}
      {rows.map((r) => (
        <article key={r.id} className="library-hit">
          <strong>{r.title}</strong>
          <p>
            {l.revision} {r.version} · {r.sectionCount} ·{" "}
            {r.canExport ? l.approved : l.draft}
            {!r.current ? " · " + l.stale : ""}
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void open(r.id)}
          >
            {l.open}
          </button>
        </article>
      ))}
      {editing && (
        <section
          className="panel library-stack"
          aria-label={l.title + " · " + l.revision}
        >
          <h3>{selected ? `${l.revision} ${selected.version}` : l.draft}</h3>
          <label>
            {l.name}
            <input
              aria-label={l.name}
              value={title}
              maxLength={160}
              disabled={busy || !canEdit}
              onChange={(e) => {
                setTitle(e.target.value);
                changed();
              }}
            />
          </label>
          <label>
            {l.summary}
            <textarea
              aria-label={l.summary}
              value={summary}
              maxLength={8000}
              disabled={busy || !canEdit}
              onChange={(e) => {
                setSummary(e.target.value);
                changed();
              }}
            />
          </label>
          {selected && !selected.current && <Notice>{l.stale}</Notice>}
          <fieldset disabled={busy || !canEdit}>
            <legend>{l.eligible}</legend>
            {!approved.length && <p>{l.none}</p>}
            {approved.map((a) => (
              <label key={a.id} style={{ display: "block", marginBlock: 8 }}>
                <input
                  type="checkbox"
                  checked={sections.some((s) => s.answerId === a.id)}
                  disabled={
                    sections.length >= 20 &&
                    !sections.some((s) => s.answerId === a.id)
                  }
                  onChange={(e) => {
                    setSections((s) =>
                      e.target.checked
                        ? [
                            ...s,
                            {
                              answerId: a.id,
                              answerVersion: a.version,
                              heading: "",
                              commentary: "",
                            },
                          ]
                        : s.filter((v) => v.answerId !== a.id),
                    );
                    changed();
                  }}
                />
                {a.question} · v{a.version} ·{" "}
                {a.scope === "transcripts"
                  ? transcriptAnswerLabels[language].source
                  : libraryAttachmentLabels[language].title}
              </label>
            ))}
          </fieldset>
          <button
            className="secondary"
            disabled={
              busy ||
              !canEdit ||
              !sections.length ||
              sections.some((s) => !approved.some((a) => a.id === s.answerId))
            }
            onClick={() => {
              setSections((s) =>
                s.map((v) => ({
                  ...v,
                  answerVersion: approved.find((a) => a.id === v.answerId)!
                    .version,
                })),
              );
              changed();
            }}
          >
            {l.refreshVersions}
          </button>
          {sections.map((s, i) => {
            const detail = selected?.sections.find(
                (d) =>
                  d.answerId === s.answerId &&
                  d.answerVersion === s.answerVersion,
              ),
              answer = detail?.answer;
            return (
              <article
                key={s.answerId}
                className="panel library-stack"
                data-brief-answer-id={s.answerId}
              >
                <p>
                  {i + 1}.{" "}
                  {answer?.original.question ||
                    answers.find((a) => a.id === s.answerId)?.question ||
                    s.answerId}{" "}
                  · {l.answerRevision} {s.answerVersion}
                </p>
                <label>
                  {l.heading}
                  <input
                    aria-label={`${l.heading} ${i + 1}`}
                    value={s.heading}
                    maxLength={160}
                    disabled={busy || !canEdit}
                    onChange={(e) =>
                      editSection(i, { heading: e.target.value })
                    }
                  />
                </label>
                <label>
                  {l.commentary}
                  <textarea
                    aria-label={`${l.commentary} ${i + 1}`}
                    value={s.commentary}
                    maxLength={4000}
                    disabled={busy || !canEdit}
                    onChange={(e) =>
                      editSection(i, { commentary: e.target.value })
                    }
                  />
                </label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="secondary"
                    disabled={busy || !canEdit || i === 0}
                    onClick={() => move(i, -1)}
                  >
                    {l.up}
                  </button>
                  <button
                    className="secondary"
                    disabled={busy || !canEdit || i === sections.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    {l.down}
                  </button>
                  <button
                    className="secondary"
                    disabled={busy || !canEdit}
                    onClick={() => {
                      setSections((v) => v.filter((_, n) => i !== n));
                      changed();
                    }}
                  >
                    {l.removeSection}
                  </button>
                </div>
                {answer && (
                  <>
                    <p style={{ whiteSpace: "pre-wrap" }}>
                      {answer.revision.answer}
                    </p>
                    <p className="muted">
                      {answer.revision.editor.name} · {answer.revision.at} ·{" "}
                      {answer.original.model}
                    </p>
                    <SemanticResult
                      value={answer.original.retrieval}
                      language={language}
                    />
                    <h4>{l.sources}</h4>
                    {answer.sources.map((h) => (
                      <div key={h.id}>
                        <blockquote
                          style={{ whiteSpace: "pre-wrap", marginInline: 0 }}
                        >
                          {h.text}
                        </blockquote>
                        {h.format === "transcript" &&
                          h.transcript.recordingSection && (
                            <RecordingCitation
                              value={h.transcript.recordingSection}
                              language={language}
                            />
                          )}
                        <p>
                          {h.studyTitle} · {h.format.toUpperCase()} · {h.kind} ·{" "}
                          {h.field}
                          {h.locator
                            ? ` · ${h.locator.unit} ${h.locator.number} · ${h.locator.start}–${h.locator.end}`
                            : ""}
                        </p>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(async (signal, generation) => {
                              const r = await api<{
                                source: SavedLibrarySource;
                              }>(
                                "library/answers/" + answer.id + "/source",
                                "POST",
                                { id: h.id },
                                undefined,
                                signal,
                              );
                              if (epoch.current === generation)
                                setSource(r.source);
                            })
                          }
                        >
                          {l.source}
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </article>
            );
          })}
          <label>
            <input
              type="checkbox"
              checked={reviewed}
              disabled={
                busy ||
                !canEdit ||
                !selected ||
                sections.some(
                  (s) =>
                    !selected.sections.some(
                      (d) =>
                        d.answerId === s.answerId &&
                        d.answerVersion === s.answerVersion &&
                        d.state === "current",
                    ),
                )
              }
              onChange={(e) => {
                setReviewed(e.target.checked);
                if (!e.target.checked) setInclude(false);
                setDirty(true);
              }}
            />
            {l.reviewed}
          </label>
          <label>
            <input
              type="checkbox"
              checked={include}
              disabled={busy || !canEdit || !selected || !reviewed}
              onChange={(e) => {
                setInclude(e.target.checked);
                setDirty(true);
              }}
            />
            {l.approve}
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              disabled={busy || !canEdit || !title.trim() || !sections.length}
              onClick={() => void save()}
            >
              {l.save}
            </button>
            <button
              className="secondary"
              disabled={busy || dirty || !selected?.canExport}
              onClick={() => void download("md")}
            >
              {l.md}
            </button>
            <button
              className="secondary"
              disabled={busy || dirty || !selected?.canExport}
              onClick={() => void download("csv")}
            >
              {l.csv}
            </button>
            <button
              className="secondary"
              disabled={busy || !canEdit || !selected?.canExport}
              onClick={() => void save(true)}
            >
              {l.withdraw}
            </button>
            <button
              className="secondary"
              disabled={busy || !canEdit || !selected}
              onClick={() => {
                if (confirm(l.confirm))
                  void run(async (signal, generation) => {
                    await api(
                      root + "/" + selected!.id,
                      "DELETE",
                      { version: selected!.version },
                      undefined,
                      signal,
                    );
                    const lists = await fetchLists(signal);
                    if (epoch.current === generation) {
                      setSelected(null);
                      setEditing(false);
                      applyLists(lists);
                    }
                  });
              }}
            >
              {l.remove}
            </button>
            <button className="secondary" disabled={busy} onClick={close}>
              {l.close}
            </button>
          </div>
        </section>
      )}
      {source && (
        <Modal title={l.sources} onClose={() => setSource(null)}>
          <blockquote style={{ whiteSpace: "pre-wrap", marginInline: 0 }}>
            {source.text}
          </blockquote>
          <p>
            {source.studyTitle} · {source.format} · {source.kind} ·{" "}
            {source.field}
          </p>
          <button
            onClick={() => {
              const id = source.interviewId;
              setSource(null);
              void openResponse(id);
            }}
          >
            {l.response}
          </button>
        </Modal>
      )}
    </section>
  );
}
