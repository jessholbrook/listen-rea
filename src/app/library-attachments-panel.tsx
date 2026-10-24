"use client";
import CollectionSelector from "./library-collection-selector";
import { useEffect, useRef, useState } from "react";
import LibrarySemanticTools, { SemanticResult } from "./library-semantic-tools";
import type { SemanticRetrieval } from "@/lib/library-semantic";
import LibrarySavedAnswers from "./library-saved-answers";
import { libraryAnswerLabels } from "@/lib/library-answers";
import { api } from "@/lib/client";
import { languages, languageNames, type Language } from "@/lib/localization";
import { Modal, Notice } from "./components";
import {
  attachmentFormats,
  attachmentKinds,
  libraryAttachmentLabels,
  type AttachmentFormat,
  type AttachmentKind,
  type LibraryAttachmentHit,
  type LibraryAttachmentAnswer,
} from "@/lib/library-attachments";
type Results = {
  hits: LibraryAttachmentHit[];
  total: number;
  searchedStudies: number;
  limited: boolean;
  retrieval?: SemanticRetrieval;
};
export default function LibraryAttachmentsPanel({
  studies,
  ai,
  openResponse,
}: {
  studies: { id: string; title: string }[];
  ai: boolean;
  openResponse: (id: string) => Promise<void>;
}) {
  const [collectionId, setCollectionId] = useState("");
  const [mode, setMode] = useState<"keyword" | "semantic">("keyword");
  const [language, setLanguage] = useState<Language>("en"),
    [selected, setSelected] = useState<string[]>([]),
    [formats, setFormats] = useState<AttachmentFormat[]>([
      ...attachmentFormats,
    ]),
    [kinds, setKinds] = useState<AttachmentKind[]>([...attachmentKinds]),
    [query, setQuery] = useState(""),
    [question, setQuestion] = useState(""),
    [attributeKey, setAttributeKey] = useState(""),
    [attributeValue, setAttributeValue] = useState(""),
    [results, setResults] = useState<Results | null>(null),
    [answer, setAnswer] = useState<LibraryAttachmentAnswer | null>(null),
    [source, setSource] = useState<LibraryAttachmentHit | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [savedRefresh, setSavedRefresh] = useState(0);
  const saveRequest = useRef<string | null>(null);
  const epoch = useRef(0),
    controller = useRef<AbortController | null>(null);
  const l = libraryAttachmentLabels[language];
  function invalidate() {
    saveRequest.current = null;
    epoch.current++;
    controller.current?.abort();
    controller.current = null;
    setResults(null);
    setAnswer(null);
    setSource(null);
    setError("");
    setBusy(false);
  }
  useEffect(() => {
    invalidate();
    return () => {
      epoch.current++;
      controller.current?.abort();
    };
  }, [studies]);
  const filter = () => ({
    ...(collectionId ? { collectionId } : {}),
    studyIds: selected,
    formats,
    kinds,
    query,
    ...(attributeKey.trim()
      ? { attribute: { key: attributeKey.trim(), value: attributeValue } }
      : {}),
  });
  async function request(
    action: "search" | "qa" | "source",
    id?: string,
    saveDraft = false,
  ) {
    controller.current?.abort();
    const generation = ++epoch.current;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setSource(null);
    if (action !== "source") {
      setAnswer(null);
      setResults(null);
    }
    try {
      const r = await api<
        Results & LibraryAttachmentAnswer & { source: LibraryAttachmentHit }
      >(
        "library/attachments/" + action,
        "POST",
        {
          ...filter(),
          ...(action !== "source" ? { retrieval: mode } : {}),
          ...(action === "qa"
            ? {
                question,
                language,
                ...(saveDraft
                  ? {
                      saveDraft: true,
                      requestId: (saveRequest.current ||= crypto.randomUUID()),
                    }
                  : {}),
              }
            : {}),
          ...(id ? { id } : {}),
        },
        undefined,
        abort.signal,
      );
      if (epoch.current !== generation) return;
      if (action === "search") setResults(r);
      if (action === "qa") {
        setAnswer(r);
        if (r.savedAnswerId) {
          saveRequest.current = null;
          setSavedRefresh((v) => v + 1);
        }
      }
      if (action === "source") setSource(r.source);
    } catch (e) {
      if (epoch.current !== generation) return;
      setResults(null);
      setAnswer(null);
      setSource(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (epoch.current === generation) setBusy(false);
    }
  }
  function context(h: LibraryAttachmentHit) {
    return (
      <>
        <p className="muted">
          {h.studyTitle} · {h.format.toUpperCase()} ·{" "}
          {h.kind === "passage" ? l.passage : l.observation}
        </p>
        <p className="muted">
          {l.original}: {h.revisionId}
          {h.conceptId ? " · " + h.conceptId : ""}
        </p>
        {h.locator && (
          <p>
            {l[h.locator.unit]} {h.locator.number} · {l.characters}{" "}
            {h.locator.start}–{h.locator.end} {h.ocr ? " · " + l.ocr : ""}
          </p>
        )}
        {h.field && (
          <p>
            {l[h.field]} · {h.grounding}
          </p>
        )}
        <p className="muted">
          {l.review}: v{h.version} · {h.reviewerName} · {h.reviewedAt}
        </p>
      </>
    );
  }
  const valid = formats.length > 0 && kinds.length > 0;
  return (
    <section
      className="panel library-stack"
      aria-label={l.title}
      style={{ overflowWrap: "anywhere", minWidth: 0 }}
    >
      <h2>{l.title}</h2>
      <CollectionSelector
        value={collectionId}
        language={language}
        disabled={busy}
        onChange={(id) => {
          invalidate();
          setCollectionId(id);
        }}
      />
      <p className="muted">{l.notice}</p>
      <p className="muted">{l.payload}</p>
      <label>
        {l.language}
        <select
          aria-label={l.language}
          value={language}
          onChange={(e) => {
            invalidate();
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
      <LibrarySemanticTools
        scope="attachments"
        onInvalidate={invalidate}
        filter={filter()}
        language={language}
        mode={mode}
        onMode={(v) => {
          invalidate();
          setMode(v);
        }}
        ai={ai}
      />
      <fieldset>
        <legend>{l.studies}</legend>
        <label className="check-row">
          <input
            type="checkbox"
            checked={!selected.length}
            onChange={() => {
              invalidate();
              setSelected([]);
            }}
          />
          {l.all}
        </label>
        {studies.map((s) => (
          <label className="check-row" key={s.id}>
            <input
              type="checkbox"
              checked={selected.includes(s.id)}
              onChange={(e) => {
                invalidate();
                setSelected((ids) =>
                  e.target.checked
                    ? [...ids, s.id]
                    : ids.filter((id) => id !== s.id),
                );
              }}
            />
            {s.title}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{l.formats}</legend>
        {attachmentFormats.map((f) => (
          <label className="check-row" key={f}>
            <input
              type="checkbox"
              checked={formats.includes(f)}
              onChange={(e) => {
                invalidate();
                setFormats((v) =>
                  e.target.checked ? [...v, f] : v.filter((x) => x !== f),
                );
              }}
            />
            {f.toUpperCase()}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{l.kinds}</legend>
        {attachmentKinds.map((k) => (
          <label className="check-row" key={k}>
            <input
              type="checkbox"
              checked={kinds.includes(k)}
              onChange={(e) => {
                invalidate();
                setKinds((v) =>
                  e.target.checked ? [...v, k] : v.filter((x) => x !== k),
                );
              }}
            />
            {l[k]}
          </label>
        ))}
      </fieldset>
      <label>
        {l.attributeKey}
        <input
          maxLength={60}
          value={attributeKey}
          onChange={(e) => {
            invalidate();
            setAttributeKey(e.target.value);
          }}
        />
      </label>
      <label>
        {l.attributeValue}
        <input
          maxLength={500}
          value={attributeValue}
          onChange={(e) => {
            invalidate();
            setAttributeValue(e.target.value);
          }}
        />
      </label>
      <label>
        {l.query}
        <input
          maxLength={1000}
          value={query}
          onChange={(e) => {
            invalidate();
            setQuery(e.target.value);
          }}
        />
      </label>
      <label>
        {l.question}
        <textarea
          aria-label={l.question}
          maxLength={2000}
          value={question}
          onChange={(e) => {
            invalidate();
            setQuestion(e.target.value);
          }}
        />
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button disabled={busy || !valid} onClick={() => request("search")}>
          {l.search}
        </button>
        <button
          disabled={busy || !valid || !ai || question.trim().length < 5}
          onClick={() => request("qa")}
        >
          {l.ask}
        </button>
        <button
          disabled={busy || !valid || !ai || question.trim().length < 5}
          onClick={() => request("qa", undefined, true)}
        >
          {libraryAnswerLabels[language].save}
        </button>
        <button className="secondary" onClick={invalidate}>
          {l.clear}
        </button>
      </div>
      <p className="muted">{l.refresh}</p>
      {busy && <p role="status">{l.working}</p>}
      {error && (
        <div role="alert">
          <Notice>{error}</Notice>
        </div>
      )}
      {results && (
        <div aria-live="polite">
          <p>
            {l.results}: {results.total}
            {results.limited ? " (50)" : ""} · {l.searched}:{" "}
            {results.searchedStudies}
          </p>
          <SemanticResult value={results.retrieval} language={language} />
          {!results.hits.length && <p>{l.empty}</p>}
          {results.hits.map((h) => (
            <article key={h.id} className="panel" data-evidence-id={h.id}>
              {context(h)}
              <blockquote style={{ whiteSpace: "pre-wrap" }}>
                {h.text}
              </blockquote>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => request("source", h.id)}
              >
                {l.source}
              </button>
            </article>
          ))}
        </div>
      )}
      {answer?.savedAnswerId && (
        <p role="status">{libraryAnswerLabels[language].saved}</p>
      )}
      {answer && (
        <section aria-label={l.ask} aria-live="polite">
          <h3>{l.ask}</h3>
          <SemanticResult value={answer.retrieval} language={language} />
          <p style={{ whiteSpace: "pre-wrap" }}>{answer.answer}</p>
          <p className="muted">
            {l.searched}: {answer.searchedStudies} · {l.considered}:{" "}
            {answer.evidenceCount}
          </p>
          {answer.generated && (
            <p className="muted">
              {answer.model} · {answer.promptVersion} · {answer.generatedAt}
            </p>
          )}
          {answer.citations.map((c, i) => (
            <article className="panel" key={c.evidenceId + i}>
              {context(c.source)}
              <blockquote>{c.quote}</blockquote>
              <button
                disabled={busy}
                onClick={() => request("source", c.evidenceId)}
              >
                {l.source}
              </button>
            </article>
          ))}
        </section>
      )}
      <LibrarySavedAnswers
        language={language}
        refresh={savedRefresh}
        openResponse={openResponse}
      />
      {source && (
        <Modal title={l.original} onClose={() => setSource(null)}>
          {context(source)}
          <blockquote
            style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
          >
            {source.text}
          </blockquote>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              onClick={() => {
                const id = source.interviewId;
                setSource(null);
                void openResponse(id);
              }}
            >
              {l.response}
            </button>
            <button className="secondary" onClick={() => setSource(null)}>
              {l.close}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
