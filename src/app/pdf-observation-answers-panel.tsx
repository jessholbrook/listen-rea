"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import {
  includedPDFObservationAnswers,
  pdfObservationAnswerLabels,
  pdfObservationAnswersText,
  type SavedPDFObservationAnswer,
  type PDFObservationAnswerEvidence,
} from "@/lib/pdf-observation-answers";
import { pdfObservationQALabels } from "@/lib/pdf-observation-qa";
import type { Analysis } from "@/lib/domain";
export function PDFObservationAnswersView({
  entries,
  studyId,
  language = "en",
}: {
  entries: PDFObservationAnswerEvidence[] | undefined;
  studyId: string;
  language?: "en" | "es" | "fr";
}) {
  if (!entries?.length) return null;
  const l = pdfObservationAnswerLabels[language];
  return (
    <section className="panel attachment-synthesis" aria-label={l.title}>
      <h3>{l.title}</h3>
      <p>{l.notice}</p>
      {entries.map((e) => (
        <article className="panel" key={e.id}>
          <p style={{ whiteSpace: "pre-wrap" }}>
            {pdfObservationAnswersText([e], language)}
          </p>
          {e.citations.map((c, n) => {
            const source = e.sources.find(
              (s) => s.pdfId === c.pdfId && s.reviewVersion === c.reviewVersion,
            );
            return (
              source && (
                <a
                  key={n}
                  className="text-button"
                  href={`/?study=${encodeURIComponent(studyId)}&tab=responses&interview=${encodeURIComponent(source.interviewId)}&turn=${encodeURIComponent(source.turnId)}`}
                >
                  {source.reviewerName} ·{" "}
                  {pdfObservationQALabels[language][c.field]} ·{" "}
                  {c.pdfId.slice(0, 8)} · {c.reviewVersion}
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
  saved: SavedPDFObservationAnswer;
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
    [error, setError] = useState("");
  async function run(method: string) {
    setBusy(true);
    setError("");
    try {
      accept(
        await api(
          `studies/${studyId}/pdf-observation-answers${query}`,
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
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      className="panel attachment-synthesis"
      aria-label={`Saved PDF answer ${saved.id}`}
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
            Saved PDF answer
            <textarea
              aria-label="Saved PDF answer"
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
                {c.field}: {c.quote} · {c.pdfId} · Review {c.reviewVersion}
              </blockquote>
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
            I reviewed this answer against its cited researcher notes or
            corrections.
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={include}
              disabled={!reviewed || !citations.length}
              onChange={(e) => setInclude(e.target.checked)}
            />
            Include this reviewed PDF answer in report appendices
          </label>
          <p className="muted">
            Only the latest explicitly included review is shared. Saving
            inclusion or changing an included answer clears report editions and
            share links and requires memo review again.
          </p>
          <button className="button primary" type="submit">
            Save PDF answer review
          </button>
          <button
            className="button danger"
            type="button"
            onClick={() => {
              if (
                confirm(
                  "Delete this saved PDF answer? Included answers also revoke report editions and share links.",
                )
              )
                void run("DELETE");
            }}
          >
            Delete saved PDF answer
          </button>
        </fieldset>
      </form>
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
                {c.field}: {c.quote} · {c.pdfId} · Review {c.reviewVersion}
              </blockquote>
            ))}
          </section>
        ))}
      </details>
    </article>
  );
}
export default function PDFObservationAnswersPanel({
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
  if (!analysis.pdfObservationAnswers?.length) return null;
  return (
    <section
      className="panel attachment-synthesis"
      aria-label="Saved PDF observation answers"
    >
      <h3>Saved PDF observation answers</h3>
      <p>
        Drafts and review history stay internal. Only reviewed answers you
        explicitly include enter report appendices. These interpret researcher
        annotations, not participant evidence or independently verified PDF
        facts.
      </p>
      {analysis.pdfObservationAnswers.map((s) => (
        <SavedAnswerEditor
          key={`${analysis.id}:${analysis.version}:${s.id}`}
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
