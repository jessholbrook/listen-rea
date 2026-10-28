"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { docxQALabels, type DOCXQA } from "@/lib/docx-qa";
import type { Analysis } from "@/lib/domain";
export default function DOCXQAPanel({
  analysis,
  studyId,
  query,
  ai,
  stale,
  accept,
}: {
  analysis: Analysis;
  studyId: string;
  query: string;
  ai: boolean;
  stale: boolean;
  accept: (r: any) => void;
}) {
  const [question, setQuestion] = useState(""),
    [answer, setAnswer] = useState<DOCXQA | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [view, setView] = useState<{
      paragraph: number;
      start: number;
      end: number;
      quote: string;
      text: string;
    } | null>(null),
    [viewBusy, setViewBusy] = useState(false);
  const active = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      generation.current++;
    };
  }, []);
  const language = analysis.reportLanguage || "en",
    l = docxQALabels[language];
  if (!analysis.docxEvidence?.length) return null;
  return (
    <section
      className="panel attachment-synthesis docx-qa"
      aria-label={l.title}
    >
      <h3>{l.title}</h3>
      <p>{l.notice}</p>
      <p className="muted">{l.payload}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || stale || !ai) return;
          const request = ++generation.current;
          setBusy(true);
          setAnswer(null);
          setView(null);
          setViewBusy(false);
          setError("");
          try {
            const r = await api(`studies/${studyId}/docx-qa${query}`, "POST", {
              id: analysis.id,
              version: analysis.version,
              question: question.trim(),
              saveDraft:
                (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
                  "value",
                ) === "yes",
            });
            if (active.current && request === generation.current) {
              if (r.analysis) accept(r);
              else setAnswer(r);
            }
          } catch (err) {
            if (active.current && request === generation.current)
              setError((err as Error).message);
          } finally {
            if (active.current && request === generation.current)
              setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy || stale}>
          <label>
            {l.question}
            <textarea
              aria-label={l.question}
              required
              minLength={5}
              maxLength={2000}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </label>
          <button
            className="button"
            type="submit"
            disabled={!ai || busy || stale || question.trim().length < 5}
          >
            {busy ? l.working : l.ask}
          </button>
          <button
            className="button"
            type="submit"
            name="saveDraft"
            value="yes"
            disabled={!ai || busy || stale || question.trim().length < 5}
          >
            {l.save}
          </button>
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
      {answer && (
        <section aria-label={l.answer}>
          <h4>{l.answer}</h4>
          <p>
            <strong>{l.question}: </strong>
            {answer.question}
          </p>
          <p style={{ whiteSpace: "pre-wrap" }}>{answer.answer}</p>
          {answer.citations.map((c, n) => {
            const source = analysis.docxEvidence?.find(
              (e) =>
                e.docxId === c.docxId &&
                e.verificationVersion === c.verificationVersion,
            );
            return (
              <div key={n} style={{ overflowWrap: "anywhere" }}>
                <blockquote>{c.quote}</blockquote>
                <p>
                  {l.verification} {c.verificationVersion} · {l.characters}{" "}
                  {c.start + 1}–{c.end}
                </p>
                <button
                  className="button"
                  type="button"
                  disabled={viewBusy}
                  onClick={async () => {
                    if (!source) return;
                    const request = generation.current;
                    setViewBusy(true);
                    setView(null);
                    setError("");
                    try {
                      const r = await api(
                          `studies/${studyId}/participant-docx/${c.docxId}/text`,
                        ),
                        latest = r.verification?.history.at(-1),
                        text = r.paragraphs[c.paragraph - 1];
                      if (
                        r.source !== source.source ||
                        r.digest !== source.digest ||
                        latest?.version !== c.verificationVersion ||
                        !latest.includeInReports ||
                        text?.slice(c.start, c.end) !== c.quote
                      )
                        throw new Error(
                          "DOCX evidence changed. Reload before asking again.",
                        );
                      if (active.current && request === generation.current)
                        setView({ ...c, text });
                    } catch (err) {
                      if (active.current && request === generation.current)
                        setError((err as Error).message);
                    } finally {
                      if (active.current && request === generation.current)
                        setViewBusy(false);
                    }
                  }}
                >
                  {l.paragraph} {c.paragraph}
                </button>
                {source && (
                  <a
                    className="text-button"
                    href={`/?study=${encodeURIComponent(studyId)}&tab=responses&interview=${encodeURIComponent(source.interviewId)}&turn=${encodeURIComponent(source.turnId)}`}
                  >
                    {l.source} · {source.reviewerName} · {c.docxId.slice(0, 8)}
                  </a>
                )}
              </div>
            );
          })}
          {view && (
            <div
              style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
              aria-label={`${l.paragraph} ${view.paragraph}`}
            >
              <strong>
                {l.paragraph} {view.paragraph}
              </strong>
              <p>
                {view.text.slice(0, view.start)}
                <mark>{view.quote}</mark>
                {view.text.slice(view.end)}
              </p>
            </div>
          )}
          <p className="muted">
            {answer.model} · {answer.promptVersion} ·{" "}
            {new Date(answer.generatedAt).toLocaleString()}
          </p>
          <button
            className="button"
            type="button"
            onClick={() => {
              generation.current++;
              setAnswer(null);
              setView(null);
              setViewBusy(false);
            }}
          >
            {l.clear}
          </button>
        </section>
      )}
    </section>
  );
}
