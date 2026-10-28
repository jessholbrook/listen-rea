"use client";
import BackgroundJobsPanel from "./background-jobs-panel";
import type { UnifiedViewConfig } from "@/lib/unified-view-config";
import UnifiedPlanningPanel from "./unified-planning-panel";
import ResearchOperationsPanel from "./research-operations-panel";
import type { ReviewEntry, ActionEntry } from "@/lib/research-operations";
import TeamReviewInboxPanel from "./team-review-inbox-panel";
import ResearchActionCenterPanel from "./research-action-center-panel";
import LibraryCollectionsPanel from "./library-collections-panel";
import CollectionSelector from "./library-collection-selector";
import SourceRevisionsPanel from "./library-source-revisions-panel";
import { sourceRevisionLabels } from "@/lib/library-source-revisions";
import RecordingCitation from "./recording-citation";
import LibraryRecordingsPanel from "./library-recordings-panel";
import LibraryBriefsPanel from "./library-briefs-panel";
import LibrarySemanticTools, { SemanticResult } from "./library-semantic-tools";
import type { SemanticRetrieval } from "@/lib/library-semantic";
import LibraryAttachmentsPanel from "./library-attachments-panel";
import PrivatePPTX from "./private-pptx";
import PrivateDOCX from "./private-docx";
import PrivatePDF from "./private-pdf";
import LibrarySavedAnswers from "./library-saved-answers";
import { libraryAnswerLabels } from "@/lib/library-answers";
import { useEffect, useState, useRef } from "react";
import { api } from "@/lib/client";
import type { Interview, Turn } from "@/lib/domain";
import type { LibraryHit, LibraryCitation } from "@/lib/library";
import { languages, languageNames, type Language } from "@/lib/localization";
import PrivateConceptImage from "./private-concept-image";
import { Modal, Notice, Spinner } from "./components";
type SourceRow = {
  id: string;
  studyId: string;
  studyTitle: string;
  title: string;
  source: string;
  externalId: string;
  createdAt: string;
  attributes: Record<string, string>;
};
type LibraryData = {
  studies: { id: string; title: string }[];
  sources: SourceRow[];
  ai: boolean;
};
type Source = {
  version: number;
  canRevise: boolean;
  language?: Language;
  id: string;
  studyId: string;
  studyTitle: string;
  revisionId: string;
  attributes: Record<string, string>;
  origin: Interview["origin"] | null;
  turns: Turn[];
  media: { id: string; mime: string; duration_ms: number }[];
};
type Preview = {
  valid: boolean;
  fingerprint: string;
  keys: string[];
  rows: {
    line: number;
    identifier: string;
    interviewId: string | null;
    error: string;
    attributes: Record<string, string>;
    previous: Record<string, string | null> | null;
  }[];
};
type ImportItem = {
  language: Language;
  requestId: string;
  externalId: string;
  title: string;
  transcript: string;
  media?: File;
  interviewId?: string;
  state: string;
  error: string;
};
const item = (title: string, transcript = "", media?: File): ImportItem => ({
  language: "en",
  requestId: crypto.randomUUID(),
  externalId: title.slice(0, 100),
  title: title.slice(0, 160),
  transcript,
  media,
  state: "pending",
  error: "",
});
export default function LibraryPanel({
  openStudy,
  changed,
}: {
  openStudy: (id: string) => void;
  changed: () => Promise<void>;
}) {
  const [planningEntry, setPlanningEntry] = useState<UnifiedViewConfig>();
  const [planningLanguage, setPlanningLanguage] = useState<Language>("en");
  const [data, setData] = useState<LibraryData | null>(null),
    [tab, setTab] = useState("search"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const [reviewEntry, setReviewEntry] = useState<ReviewEntry>();
  const [actionEntry, setActionEntry] = useState<ActionEntry>();
  const [collectionId, setCollectionId] = useState("");
  const [initialBriefId, setInitialBriefId] = useState<string | undefined>();
  const [savedRefresh, setSavedRefresh] = useState(0);
  const saveRequest = useRef<{ signature: string; id: string } | null>(null);
  const [mode, setMode] = useState<"keyword" | "semantic">("keyword");
  const [retrievalMeta, setRetrievalMeta] = useState<
    SemanticRetrieval | undefined
  >();
  const [query, setQuery] = useState(""),
    [question, setQuestion] = useState(""),
    [answerLanguage, setAnswerLanguage] = useState<Language>("en"),
    [selected, setSelected] = useState<string[]>([]),
    [attributeKey, setAttributeKey] = useState(""),
    [attributeValue, setAttributeValue] = useState("");
  const [hits, setHits] = useState<LibraryHit[] | null>(null),
    [total, setTotal] = useState(0),
    [answer, setAnswer] = useState<{
      answer: string;
      citations: LibraryCitation[];
      searchedStudies: number;
      evidenceCount: number;
      retrieval?: SemanticRetrieval;
    } | null>(null),
    [source, setSource] = useState<Source | null>(null);
  const [studyId, setStudyId] = useState(""),
    [csv, setCsv] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [queue, setQueue] = useState<ImportItem[]>([]),
    [permission, setPermission] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const clear = () => {
    setRetrievalMeta(undefined);
    setHits(null);
    setAnswer(null);
    setSource(null);
  };
  async function load() {
    const d = await api<LibraryData>("library");
    setData(d);
    setStudyId((s) => s || d.studies[0]?.id || "");
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const filter = {
    ...(collectionId ? { collectionId } : {}),
    studyIds: selected,
    query,
    attribute: attributeKey
      ? { key: attributeKey, value: attributeValue }
      : undefined,
  };
  async function askTranscript(save = false) {
    await run(async () => {
      setAnswer(null);
      const signature = JSON.stringify({
        filter,
        question,
        answerLanguage,
        mode,
      });
      if (!saveRequest.current || saveRequest.current.signature !== signature)
        saveRequest.current = { signature, id: crypto.randomUUID() };
      const r = await api("library/qa", "POST", {
        ...filter,
        retrieval: mode,
        question,
        language: answerLanguage,
        ...(save ? { saveDraft: true, requestId: saveRequest.current.id } : {}),
      });
      setAnswer(r);
      if (r.savedAnswerId) {
        setSavedRefresh((n) => n + 1);
        setStatus(libraryAnswerLabels[answerLanguage].saved);
      }
    });
  }
  async function view(id: string) {
    setSource(null);
    await run(async () =>
      setSource((await api("library/sources/" + id)).source),
    );
  }
  function updateQueue(n: number, changes: Partial<ImportItem>) {
    setQueue((q) => q.map((x, i) => (i === n ? { ...x, ...changes } : x)));
    setReviewed(false);
  }
  async function addFiles(files: File[]) {
    const texts = files.filter((f) => /\.txt$/i.test(f.name)),
      stem = (name: string) => name.replace(/\.[^.]+$/, "").toLocaleLowerCase();
    if (!texts.length)
      throw new Error(
        "Include a reviewed .txt transcript for each interview. Pair media by the same filename stem.",
      );
    if (queue.length + texts.length > 10)
      throw new Error("Import up to ten interviews per queue.");
    const added: ImportItem[] = [];
    for (const f of texts) {
      if (f.size > 48000)
        throw new Error("Each transcript must fit 12,000 characters.");
      const transcript = await f.text();
      if (transcript.length > 12000)
        throw new Error("Each transcript must fit 12,000 characters.");
      const media = files.filter(
        (m) =>
          m !== f && stem(m.name) === stem(f.name) && !/\.txt$/i.test(m.name),
      );
      if (media.length > 1)
        throw new Error("Use one media file per transcript.");
      if (media[0]?.size > 3 * 1024 * 1024)
        throw new Error("Media must be at most 3 MiB.");
      added.push(item(f.name.replace(/\.[^.]+$/, ""), transcript, media[0]));
    }
    if (
      files.some(
        (f) =>
          !/\.txt$/i.test(f.name) &&
          !texts.some((t) => stem(t.name) === stem(f.name)),
      )
    )
      throw new Error(
        "Every media file needs a .txt transcript with the same filename stem.",
      );
    setQueue((q) => [...q, ...added]);
    setReviewed(false);
  }
  async function importQueue() {
    clear();
    let complete = 0;
    for (let n = 0; n < queue.length; n++) {
      const q = queue[n];
      if (q.state === "complete") continue;
      let id = q.interviewId;
      try {
        if (!id) {
          const result = await api("library/imports", "POST", {
            studyId,
            requestId: q.requestId,
            language: q.language,
            externalId: q.externalId,
            title: q.title,
            transcript: q.transcript,
            prompt: "External interview transcript — review speaker labels",
            permissionConfirmed: permission,
            transcriptReviewed: reviewed,
          });
          id = result.interviewId;
          setQueue((v) =>
            v.map((x, i) => (i === n ? { ...x, interviewId: id } : x)),
          );
        }
        if (q.media) {
          const r = await fetch(`/api/library/imports/${id}/media`, {
            method: "POST",
            headers: {
              "Content-Type":
                q.media.type ||
                (/\.wav$/i.test(q.media.name)
                  ? "audio/wav"
                  : /\.mp4$/i.test(q.media.name)
                    ? "video/mp4"
                    : "video/webm"),
            },
            body: q.media,
          });
          const out = await r.json();
          if (!r.ok) throw new Error(out.error || "Media upload failed.");
        }
        setQueue((v) =>
          v.map((x, i) =>
            i === n
              ? { ...x, interviewId: id, state: "complete", error: "" }
              : x,
          ),
        );
        complete++;
      } catch (e) {
        setQueue((v) =>
          v.map((x, i) =>
            i === n
              ? {
                  ...x,
                  interviewId: id,
                  state: "failed",
                  error: (e as Error).message,
                }
              : x,
          ),
        );
      }
    }
    await load();
    await changed();
    setStatus(
      `${complete} interview imports completed in this run. Review each queue result; failed media uploads can be retried.`,
    );
  }
  if (!data && !error) return <Spinner />;
  return (
    <div className="library-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">RESEARCH, WITH ITS SOURCES</div>
          <h1>Research Library</h1>
          <p>
            Find evidence across your workspace, then follow it back to the
            conversation.
          </p>
        </div>
        <button
          className="button"
          disabled={busy}
          onClick={() =>
            run(async () => {
              clear();
              setPreview(null);
              await load();
            })
          }
        >
          Refresh library
        </button>
      </div>
      {error && (
        <div role="alert">
          <Notice>{error}</Notice>
        </div>
      )}
      {status && <p role="status">{status}</p>}
      <nav className="filter-tabs" aria-label="Library sections">
        {[
          ["home", "Operations home"],
          ["search", "Search & ask"],
          ["collections", "Collections"],
          ["actions", "Action center"],
          ["planning", "Research planning"],
          ["reviews", "Review inbox"],
          ["attachments", "Attachment evidence"],
          ["briefs", "Research briefs"],
          ["imports", "Import interviews"],
          ["recordings", "Recording transcription"],
          ["jobs", "Background jobs"],
          ["attributes", "Participant attributes"],
        ].map(([id, label]) => (
          <button
            key={id}
            disabled={busy}
            className={tab === id ? "active" : ""}
            onClick={() => {
              setPlanningEntry(undefined);
              setReviewEntry(undefined);
              setActionEntry(undefined);
              setTab(id);
              if (id === "briefs") setInitialBriefId(undefined);
              setError("");
              setStatus("");
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {data && tab === "home" && (
        <ResearchOperationsPanel
          openPlanning={(entry) => {
            setPlanningEntry(typeof entry === "string" ? undefined : entry);
            setPlanningLanguage(
              typeof entry === "string" ? entry : entry.language,
            );
            setTab("planning");
          }}
          openReviews={(entry) => {
            setReviewEntry(entry);
            setTab("reviews");
          }}
          openActions={(entry) => {
            setActionEntry(entry);
            setTab("actions");
          }}
        />
      )}
      {data && tab === "planning" && (
        <UnifiedPlanningPanel
          initialLanguage={planningLanguage}
          initial={planningEntry}
          openTask={(task, language) => {
            setActionEntry({
              language,
              filters: {
                collectionId: "",
                assignee: "",
                status: "all",
                due: "",
                query: "",
              },
              task,
            });
            setTab("actions");
          }}
          openReview={(entry) => {
            setReviewEntry(entry);
            setTab("reviews");
          }}
        />
      )}
      {data && tab === "reviews" && (
        <TeamReviewInboxPanel
          initial={reviewEntry}
          refresh={savedRefresh}
          openSource={view}
          openBrief={(id) => {
            setInitialBriefId(id);
            setTab("briefs");
          }}
        />
      )}
      {data && tab === "actions" && (
        <ResearchActionCenterPanel
          initial={actionEntry}
          refresh={savedRefresh}
          openSource={view}
          openBrief={(id) => {
            setInitialBriefId(id);
            setTab("briefs");
          }}
        />
      )}
      {data && tab === "collections" && (
        <LibraryCollectionsPanel
          openSource={view}
          openBrief={(id) => {
            setInitialBriefId(id);
            setTab("briefs");
          }}
          search={(id) => {
            clear();
            setCollectionId(id);
            setTab("search");
          }}
        />
      )}
      {data && tab === "jobs" && <BackgroundJobsPanel />}
      {data && tab === "recordings" && (
        <LibraryRecordingsPanel studies={data.studies} openResponse={view} />
      )}
      {data && tab === "briefs" && (
        <LibraryBriefsPanel initialId={initialBriefId} openResponse={view} />
      )}
      {data && tab === "attachments" && (
        <LibraryAttachmentsPanel
          studies={data.studies}
          ai={data.ai}
          openResponse={view}
        />
      )}
      {data && tab === "search" && (
        <>
          <section className="panel library-stack">
            <h2>Find source evidence</h2>
            <p className="muted">
              Only completed, included responses appear. Search uses keywords in
              responses, prompts and study titles. Results retain guide revision
              and concept IDs.
            </p>
            <CollectionSelector
              value={collectionId}
              language={answerLanguage}
              disabled={busy}
              onChange={(id) => {
                clear();
                setCollectionId(id);
              }}
            />
            <LibrarySemanticTools
              scope="transcripts"
              onInvalidate={clear}
              filter={filter}
              language={answerLanguage}
              mode={mode}
              onMode={(v) => {
                clear();
                setMode(v);
              }}
              ai={data.ai}
              disabled={busy}
            />
            <fieldset disabled={busy}>
              <legend>Studies to search</legend>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={!selected.length}
                  onChange={() => {
                    setSelected([]);
                    clear();
                  }}
                />
                All permitted studies ({data.studies.length})
              </label>
              <div className="library-study-options">
                {data.studies.map((s) => (
                  <label className="check-row" key={s.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(s.id)}
                      onChange={(e) => {
                        setSelected((ids) =>
                          e.target.checked
                            ? [...ids, s.id]
                            : ids.filter((id) => id !== s.id),
                        );
                        clear();
                      }}
                    />
                    {s.title}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="library-two">
              <label>
                Attribute name
                <input
                  value={attributeKey}
                  disabled={busy}
                  maxLength={60}
                  onChange={(e) => {
                    setAttributeKey(e.target.value);
                    clear();
                  }}
                  placeholder="segment"
                />
              </label>
              <label>
                Exact attribute value
                <input
                  value={attributeValue}
                  disabled={busy}
                  maxLength={500}
                  onChange={(e) => {
                    setAttributeValue(e.target.value);
                    clear();
                  }}
                  placeholder="Enterprise"
                />
              </label>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  setAnswer(null);
                  setHits(null);
                  const r = await api("library/search", "POST", {
                    ...filter,
                    retrieval: mode,
                  });
                  setRetrievalMeta(r.retrieval);
                  setHits(r.hits);
                  setTotal(r.total);
                });
              }}
            >
              <label>
                Search evidence
                <input
                  value={query}
                  disabled={busy}
                  maxLength={1000}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setHits(null);
                  }}
                  placeholder="feedback decisions"
                />
              </label>
              <button className="button primary" disabled={busy}>
                Search library
              </button>
            </form>
            {hits && (
              <div aria-label="Library search results">
                <SemanticResult
                  value={retrievalMeta}
                  language={answerLanguage}
                />
                <p>
                  {total}{" "}
                  {mode === "semantic"
                    ? "indexed excerpts"
                    : "matching source turns"}
                  {total > 50 ? " · showing the first 50" : ""}.
                </p>
                {hits.map((h) => (
                  <article
                    className="library-result"
                    key={h.semanticChunkId || h.interviewId + h.turnId}
                  >
                    <span className="badge">
                      {h.source === "external"
                        ? "External transcript"
                        : "Echo Lab interview"}
                    </span>
                    <h3>{h.studyTitle}</h3>
                    <p>
                      {h.sourceTitle} {h.externalId && `· ${h.externalId}`}
                    </p>
                    <p className="small muted">{h.prompt}</p>
                    <blockquote lang={h.language || "en"}>{h.quote}</blockquote>
                    {h.recordingSection && (
                      <RecordingCitation
                        value={h.recordingSection}
                        language={h.language || "en"}
                      />
                    )}
                    {h.semanticStart !== undefined && (
                      <p className="muted">
                        Transcript characters {h.semanticStart}–{h.semanticEnd}
                      </p>
                    )}
                    <p className="small mono">
                      Response {h.interviewId} · Turn {h.turnId}
                      <br />
                      Revision {h.revisionId}
                      {h.conceptId && ` · Concept ${h.conceptId}`}
                    </p>
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => view(h.interviewId)}
                    >
                      View source
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
          <section className="panel library-stack">
            <h2>Ask across selected studies</h2>
            <p className="muted">
              AI answers use up to 30 matching source excerpts. Review the cited
              sources and speaker labels. This does not establish prevalence or
              research quality.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void askTranscript();
              }}
            >
              <label>
                Answer language
                <select
                  aria-label="Answer language"
                  value={answerLanguage}
                  disabled={busy}
                  onChange={(e) => {
                    setAnswerLanguage(e.target.value as Language);
                    setAnswer(null);
                  }}
                >
                  {languages.map((l) => (
                    <option key={l} value={l}>
                      {languageNames[l]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Research question
                <textarea
                  aria-label="Research question"
                  value={question}
                  disabled={busy}
                  minLength={5}
                  maxLength={2000}
                  required
                  onChange={(e) => {
                    setQuestion(e.target.value);
                    setAnswer(null);
                  }}
                  placeholder="How do teams use feedback in product decisions?"
                />
              </label>
              <button className="button primary" disabled={busy || !data.ai}>
                Ask library
              </button>
              <button
                type="button"
                disabled={busy || !data.ai || question.trim().length < 5}
                onClick={() => void askTranscript(true)}
              >
                {libraryAnswerLabels[answerLanguage].save}
              </button>
              {!data.ai && (
                <p className="small muted">
                  A hosted AI provider key is required for Q&A. Search and
                  imports remain available.
                </p>
              )}
            </form>
            {answer && (
              <SemanticResult
                value={answer.retrieval}
                language={answerLanguage}
              />
            )}
            {answer && (
              <article aria-label="Library answer">
                <p className="preserve-lines">{answer.answer}</p>
                <p className="small muted">
                  {answer.evidenceCount} retrieved excerpts ·{" "}
                  {answer.searchedStudies} selected studies. The retrieved set
                  may omit relevant evidence.
                </p>
                {answer.citations.map((c, n) => (
                  <div className="library-result" key={n}>
                    <blockquote>{c.quote}</blockquote>
                    {c.recordingSection && (
                      <RecordingCitation value={c.recordingSection} />
                    )}
                    <p>
                      {data.studies.find((s) => s.id === c.studyId)?.title}
                      <br />
                      <span className="mono small">
                        {c.interviewId} / {c.turnId}
                      </span>
                    </p>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => view(c.interviewId)}
                    >
                      View cited source
                    </button>
                  </div>
                ))}
              </article>
            )}
          </section>
          <LibrarySavedAnswers
            scope="transcripts"
            language={answerLanguage}
            refresh={savedRefresh}
            openResponse={view}
          />
        </>
      )}
      {data && tab !== "search" && tab !== "actions" && (
        <label className="panel library-stack">
          Destination study
          <select
            value={studyId}
            disabled={
              busy || (queue.some((q) => q.interviewId) && tab === "imports")
            }
            onChange={(e) => {
              setStudyId(e.target.value);
              setPreview(null);
            }}
          >
            <option value="">Choose a study</option>
            {data.studies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          {!data.studies.length && (
            <span>Create a study before importing.</span>
          )}
        </label>
      )}
      {data && tab === "imports" && (
        <section className="panel library-stack">
          <h2>Import reviewed interviews</h2>
          <Notice>
            Supply a reviewed transcript with speaker labels. Imported text is
            not automatically transcribed or aligned to recording timestamps.
            Each import is one source response in analysis; use one interview
            per import.
          </Notice>
          <p>
            Import up to ten .txt transcripts at a time. Optional audio/video
            files must have the same filename stem (for example, alex.txt and
            alex.mp4). Each transcript supports 12,000 characters; each media
            file supports 3 MiB and ten minutes. Video imports require an audio
            track.
          </p>
          <label>
            Transcript and matching media files
            <input
              type="file"
              multiple
              accept=".txt,.wav,.ogg,.webm,.mp4"
              disabled={busy || queue.length >= 10}
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = "";
                run(() => addFiles(files));
              }}
            />
          </label>
          <button
            className="button"
            disabled={busy || queue.length >= 10}
            onClick={() => {
              setQueue((q) => [
                ...q,
                item("External interview " + (q.length + 1)),
              ]);
              setReviewed(false);
            }}
          >
            Add transcript manually
          </button>
          {queue.map((q, n) => (
            <article key={q.requestId} className="library-result library-stack">
              <h3>
                Import {n + 1} · {q.state}
              </h3>
              <label>
                Source title
                <input
                  value={q.title}
                  maxLength={160}
                  disabled={busy || !!q.interviewId}
                  onChange={(e) => updateQueue(n, { title: e.target.value })}
                />
              </label>
              <label>
                External identifier
                <input
                  value={q.externalId}
                  maxLength={100}
                  disabled={busy || !!q.interviewId}
                  onChange={(e) =>
                    updateQueue(n, { externalId: e.target.value })
                  }
                />
              </label>
              <label>
                Transcript language
                <select
                  aria-label="Transcript language"
                  value={q.language}
                  disabled={busy || !!q.interviewId}
                  onChange={(e) =>
                    updateQueue(n, { language: e.target.value as Language })
                  }
                >
                  {languages.map((l) => (
                    <option key={l} value={l}>
                      {languageNames[l]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Reviewed transcript
                <textarea
                  aria-label="Reviewed transcript"
                  value={q.transcript}
                  minLength={10}
                  maxLength={12000}
                  disabled={busy || !!q.interviewId}
                  onChange={(e) =>
                    updateQueue(n, { transcript: e.target.value })
                  }
                />
              </label>
              <p className="small">
                {q.media?.name || "Transcript only"}
                {q.interviewId && ` · Saved response ${q.interviewId}`}
              </p>
              {q.error && (
                <Notice>
                  {q.error}
                  {q.interviewId
                    ? " The transcript is saved; retry will attach the same media. Delete the response to replace the import."
                    : ""}
                </Notice>
              )}
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setQueue((v) => v.filter((_, i) => i !== n))}
              >
                Remove from queue
              </button>
            </article>
          ))}
          <label className="check-row">
            <input
              type="checkbox"
              checked={permission}
              disabled={busy}
              onChange={(e) => setPermission(e.target.checked)}
            />
            I have permission to store and analyze these transcripts and
            recordings.
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed every transcript, its speaker labels and its matching
            recording.
          </label>
          <button
            className="button primary"
            disabled={
              busy ||
              !studyId ||
              !queue.length ||
              !permission ||
              !reviewed ||
              queue.every((q) => q.state === "complete")
            }
            onClick={() => run(importQueue)}
          >
            {busy ? "Importing…" : "Import / retry queue"}
          </button>
          <h3>Saved external interviews in this study</h3>
          {data.sources
            .filter((s) => s.source === "external" && s.studyId === studyId)
            .map((s) => (
              <div key={s.id} className="library-result">
                <strong>{s.title}</strong>
                <p>{s.externalId}</p>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => view(s.id)}
                >
                  View source
                </button>
              </div>
            ))}
        </section>
      )}
      {data && tab === "attributes" && (
        <section className="panel library-stack">
          <h2>Match participant attributes</h2>
          <p>
            Use response_id, or external_id for imports, as the first CSV
            column. Add up to 20 attribute columns and 200 rows. Matching is
            exact within the selected study. Blank cells replace existing values
            with an empty string; other attributes are retained.
          </p>
          {studyId && (
            <a
              className="button"
              href={`/api/library/attributes/${studyId}/template`}
              download
            >
              Download response ID template
            </a>
          )}
          <label>
            Attribute CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f)
                  run(async () => {
                    if (f.size > 240000) throw new Error("CSV is too large.");
                    setCsv(await f.text());
                    setPreview(null);
                  });
              }}
            />
          </label>
          <label>
            Attribute CSV
            <textarea
              aria-label="Attribute CSV"
              value={csv}
              disabled={busy}
              maxLength={120000}
              rows={8}
              placeholder={"external_id,segment\nalex,Enterprise"}
              onChange={(e) => {
                setCsv(e.target.value);
                setPreview(null);
              }}
            />
          </label>
          <button
            className="button"
            disabled={busy || !studyId || !csv}
            onClick={() =>
              run(async () =>
                setPreview(
                  await api(`library/attributes/${studyId}/preview`, "POST", {
                    csv,
                  }),
                ),
              )
            }
          >
            Preview matches
          </button>
          {preview && (
            <>
              <p>
                {preview.valid
                  ? "All rows matched. Review replacements before applying."
                  : "Fix every error, then preview again. No attributes have been changed."}
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Row / identifier</th>
                      <th>Match</th>
                      <th>Changes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.line}>
                        <td>
                          {r.line} · {r.identifier}
                        </td>
                        <td>{r.error || r.interviewId}</td>
                        <td>
                          {Object.entries(r.attributes).map(([k, v]) => (
                            <p key={k}>
                              {k}: {r.previous?.[k] ?? "(unset)"} →{" "}
                              {v || "(empty)"}
                            </p>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                className="button primary"
                disabled={busy || !preview.valid}
                onClick={() =>
                  run(async () => {
                    clear();
                    const r = await api(
                      `library/attributes/${studyId}/apply`,
                      "POST",
                      { csv, fingerprint: preview.fingerprint },
                    );
                    setPreview(null);
                    await load();
                    await changed();
                    setStatus(
                      `Updated ${r.updated} responses. Existing analysis and report exports now require refresh/review.`,
                    );
                  })
                }
              >
                Apply attribute changes
              </button>
            </>
          )}
        </section>
      )}
      {source && (
        <Modal title="Library source" onClose={() => setSource(null)}>
          <p>
            {source.studyTitle} · {source.origin?.title || "Echo Lab interview"}
          </p>
          {source.origin && (
            <Notice>
              External transcript · ID {source.origin.externalId} · imported by{" "}
              {source.origin.importedBy} on{" "}
              {new Date(source.origin.importedAt).toLocaleDateString()}.
              Permission and transcript review were attested by the importer.
              Confirm who is speaking before quoting.
            </Notice>
          )}
          {source.origin?.recordingRevision && (
            <p>
              {sourceRevisionLabels[source.language || "en"].published}{" "}
              {source.origin.recordingRevision.sourceVersion} ·{" "}
              {source.origin.recordingRevision.editor.name} ·{" "}
              {source.origin.recordingRevision.at}
            </p>
          )}
          <p className="mono small">
            Response {source.id}
            <br />
            Revision {source.revisionId}
          </p>
          <p>
            {Object.entries(source.attributes)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" · ")}
          </p>
          {source.canRevise && (
            <SourceRevisionsPanel
              key={source.id}
              id={source.id}
              language={source.language || "en"}
              onPublished={() => {
                clear();
                setSavedRefresh((n) => n + 1);
                void run(async () => {
                  await load();
                  await changed();
                  setStatus(sourceRevisionLabels[source.language || "en"].done);
                });
              }}
            />
          )}
          {source.media
            .filter(
              (m) => m.mime.startsWith("audio/") || m.mime.startsWith("video/"),
            )
            .map((m) =>
              m.mime.startsWith("video/") ? (
                <video
                  key={m.id}
                  controls
                  playsInline
                  preload="metadata"
                  src={`/api/recordings/${m.id}`}
                />
              ) : (
                <audio
                  key={m.id}
                  controls
                  preload="metadata"
                  src={`/api/recordings/${m.id}`}
                />
              ),
            )}
          {source.turns.map((t) => (
            <article key={t.id} className="library-result">
              <h3>{t.prompt}</h3>
              {t.participantPPTX && (
                <section className="panel">
                  <PrivatePPTX
                    assetId={t.participantPPTX.id}
                    studyId={source.studyId}
                  />
                  <p>{t.participantPPTX.description}</p>
                </section>
              )}
              {t.participantDOCX && (
                <section className="panel">
                  <PrivateDOCX
                    assetId={t.participantDOCX.id}
                    studyId={source.studyId}
                  />
                  <p>{t.participantDOCX.description}</p>
                </section>
              )}
              {t.participantPDF && (
                <section className="panel">
                  <h4>Participant PDF attachment</h4>
                  <PrivatePDF
                    assetId={t.participantPDF.id}
                    studyId={source.studyId}
                  />
                  <p>{t.participantPDF.description}</p>
                </section>
              )}
              {t.participantImage && (
                <>
                  <PrivateConceptImage
                    studyId={source.studyId}
                    assetId={t.participantImage.id}
                    resource="participant-images"
                    alt={t.participantImage.description}
                    enlarge
                  />
                  <p>{t.participantImage.description}</p>
                </>
              )}
              <p className="small mono">
                Turn {t.id}
                {t.conceptId && ` · Concept ${t.conceptId}`}
              </p>
              {t.recordingSection && (
                <RecordingCitation
                  value={t.recordingSection}
                  language={source.language || "en"}
                />
              )}
              <p className="preserve-lines" lang={source.language || "en"}>
                {t.answer}
              </p>
            </article>
          ))}
          <div className="modal-actions">
            <button
              className="button"
              onClick={() => {
                setSource(null);
                openStudy(source.studyId);
              }}
            >
              Open study responses
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    "Delete this source and its media? Derived reports, clips and sharing will be cleared.",
                  )
                )
                  run(async () => {
                    const r = await api(
                      `studies/${source.studyId}/responses/${source.id}`,
                      "DELETE",
                    );
                    clear();
                    setSavedRefresh((n) => n + 1);
                    await load();
                    await changed();
                    setStatus(
                      r.mediaCleanupPending
                        ? "Source removed; private media cleanup will retry."
                        : "Source and private media deleted.",
                    );
                  });
              }}
            >
              Delete source
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
