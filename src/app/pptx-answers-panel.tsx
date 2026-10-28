"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import {
  includedPPTXAnswers,
  pptxAnswerLabels,
  pptxAnswersText,
  type SavedPPTXAnswer,
  type PPTXAnswerEvidence,
} from "@/lib/pptx-answers";
import PPTXEvidencePanel from "./pptx-evidence-panel";
import { pptxQALabels } from "@/lib/pptx-qa";
import type { Analysis } from "@/lib/domain";
export function PPTXAnswersView({
  entries,
  studyId,
  language = "en",
}: {
  entries: PPTXAnswerEvidence[] | undefined;
  studyId: string;
  language?: "en" | "es" | "fr";
}) {
  if (!entries?.length) return null;
  const l = pptxAnswerLabels[language];
  return (
    <section className="panel attachment-synthesis" aria-label={l.title}>
      <h3>{l.title}</h3>
      <p>{l.notice}</p>
      {entries.map((e) => (
        <article
          style={{ overflowWrap: "anywhere" }}
          className="panel"
          key={e.id}
        >
          <p style={{ whiteSpace: "pre-wrap" }}>
            {pptxAnswersText([e], language)}
          </p>
          {e.citations.map((c, n) => {
            const source = e.sources.find(
              (s) =>
                s.pptxId === c.pptxId &&
                s.verificationVersion === c.verificationVersion,
            );
            return (
              source && (
                <a
                  key={n}
                  className="text-button"
                  href={`/?study=${encodeURIComponent(studyId)}&tab=responses&interview=${encodeURIComponent(source.interviewId)}&turn=${encodeURIComponent(source.turnId)}`}
                >
                  {source.reviewerName} · {pptxQALabels[language].slide}{" "}
                  {c.slide} · {c.pptxId.slice(0, 8)} · {c.verificationVersion}
                </a>
              )
            );
          })}
        </article>
      ))}
    </section>
  );
}
function SavedAnswerEditor({
  saved,
  analysis,
  studyId,
  query,
  stale,
  accept,
}: {
  saved: SavedPPTXAnswer;
  analysis: Analysis;
  studyId: string;
  query: string;
  stale: boolean;
  accept: (r: any) => void;
}) {
  const r = saved.history.at(-1)!;
  const [answer, setAnswer] = useState(r.answer),
    [citations, setCitations] = useState(r.citations),
    [reviewed, setReviewed] = useState(r.reviewed),
    [include, setInclude] = useState(r.includeInReports),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [view, setView] = useState(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function run(method: string) {
    if (busy || stale) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(
        `studies/${studyId}/pptx-answers${query}`,
        method,
        {
          id: analysis.id,
          version: analysis.version,
          answerId: saved.id,
          answerVersion: r.version,
          ...(method === "PUT"
            ? { answer, citations, reviewed, includeInReports: include }
            : {}),
        },
      );
      if (active.current) accept(result);
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <article
      className="panel attachment-synthesis"
      aria-label={`Saved PPTX passage answer ${saved.id}`}
    >
      <h4>{saved.original.question}</h4>
      <p>
        {r.reviewed ? "Reviewed" : "Private draft · review required"} ·{" "}
        {r.includeInReports ? "Included in reports" : "Internal only"} · Answer
        revision {r.version}
      </p>
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run("PUT");
        }}
      >
        <fieldset disabled={busy || stale}>
          <label>
            Saved PPTX passage answer
            <textarea
              aria-label="Saved PPTX passage answer"
              required
              minLength={3}
              maxLength={6000}
              value={answer}
              onChange={(e) => {
                setAnswer(e.target.value);
                setReviewed(false);
                setInclude(false);
              }}
            />
          </label>
          {citations.map((c, n) => (
            <div key={n}>
              <blockquote>
                PPTX slide {c.slide}: {c.quote} · {c.pptxId} · Verification{" "}
                {c.verificationVersion}
              </blockquote>
              <button
                className="button"
                style={{
                  whiteSpace: "normal",
                  maxWidth: "100%",
                  textAlign: "left",
                }}
                type="button"
                onClick={() => setView(true)}
              >
                Compare saved answer PPTX slide {c.slide}
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setCitations(citations.filter((_, i) => i !== n));
                  setReviewed(false);
                  setInclude(false);
                }}
              >
                Remove saved answer citation {n + 1}
              </button>
            </div>
          ))}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => {
                setReviewed(e.target.checked);
                if (!e.target.checked) setInclude(false);
              }}
            />
            I reviewed this answer against its selected passages and prepared
            PPTX slides.
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={include}
              disabled={!reviewed || !citations.length}
              onChange={(e) => setInclude(e.target.checked)}
            />
            Include this reviewed PPTX answer in report appendices
          </label>
          <p className="muted">
            Only the latest explicitly included review is shared. Saving
            inclusion or changing an included answer clears report editions and
            share links and requires memo review again.
          </p>
          <button className="button primary" type="submit">
            Save PPTX passage answer review
          </button>
          <button
            className="button danger"
            type="button"
            onClick={() => {
              if (
                confirm(
                  "Delete this saved PPTX answer? Included answers also revoke report editions and share links.",
                )
              )
                void run("DELETE");
            }}
          >
            Delete saved PPTX passage answer
          </button>
        </fieldset>
      </form>
      {view && (
        <PPTXEvidencePanel
          entries={saved.sources
            .map((s) => ({
              ...s,
              passages: s.passages.filter((p) =>
                citations.some(
                  (c) =>
                    c.pptxId === s.pptxId &&
                    c.verificationVersion === s.verificationVersion &&
                    c.slide === p.slide &&
                    c.start === p.start &&
                    c.end === p.end &&
                    c.quote === p.quote,
                ),
              ),
            }))
            .filter((s) => s.passages.length)}
          studyId={studyId}
          language={analysis.reportLanguage}
        />
      )}
      <details>
        <summary>
          Original AI answer and review history ({saved.history.length})
        </summary>
        <p>Original question: {saved.original.question}</p>
        <p style={{ whiteSpace: "pre-wrap" }}>{saved.original.answer}</p>
        <p>
          {saved.original.model} · {saved.original.promptVersion} ·{" "}
          {saved.original.generatedAt}
        </p>
        {[...saved.history].reverse().map((h) => (
          <section key={h.version}>
            <p>
              Answer revision {h.version} · {h.editor.name} · {h.at} ·{" "}
              {h.reviewed ? "Reviewed" : "Draft"} ·{" "}
              {h.includeInReports ? "Included" : "Internal only"}
            </p>
            <p style={{ whiteSpace: "pre-wrap" }}>{h.answer}</p>
            {h.citations.map((c, n) => (
              <blockquote key={n}>
                PPTX slide {c.slide}: {c.quote} · {c.pptxId} · Verification{" "}
                {c.verificationVersion}
              </blockquote>
            ))}
          </section>
        ))}
      </details>
    </article>
  );
}
export default function PPTXAnswersPanel({
  analysis,
  studyId,
  query,
  stale,
  accept,
}: {
  analysis: Analysis;
  studyId: string;
  query: string;
  stale: boolean;
  accept: (r: any) => void;
}) {
  if (!analysis.pptxAnswers?.length) return null;
  return (
    <section
      className="panel attachment-synthesis"
      aria-label="Saved PPTX passage answers"
    >
      <h3>Saved PPTX passage answers</h3>
      <p>
        Drafts and review history stay internal. Only reviewed answers you
        explicitly include enter report appendices. These interpret selected
        PPTX excerpts, not participant statements or independently verified
        document facts.
      </p>
      {analysis.pptxAnswers.map((s) => (
        <SavedAnswerEditor
          key={`${studyId}:${query}:${analysis.id}:${analysis.version}:${stale}:${s.id}`}
          saved={s}
          analysis={analysis}
          studyId={studyId}
          query={query}
          stale={stale}
          accept={accept}
        />
      ))}
    </section>
  );
}
