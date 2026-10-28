"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import {
  pptxObservationQALabels,
  type PPTXObservationQA,
} from "@/lib/pptx-observation-qa";
import type { Analysis } from "@/lib/domain";
export default function PPTXObservationQAPanel({
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
    [answer, setAnswer] = useState<PPTXObservationQA | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const l = pptxObservationQALabels[analysis.reportLanguage || "en"];
  if (!analysis.pptxObservations?.length) return null;
  return (
    <section
      className="panel attachment-synthesis pptx-observation-qa"
      aria-label={l.title}
    >
      <h3>{l.title}</h3>
      <p>{l.notice}</p>
      <p className="muted">
        OpenAI receives your question and the latest included researcher notes,
        corrections, grounding judgments and review references. PPTX files,
        prepared slides, original interview questions, participant answers,
        reviewer names and private revision history are not sent through this
        request.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || stale || !ai) return;
          setBusy(true);
          setError("");
          setAnswer(null);
          try {
            const r = await api(
              `studies/${studyId}/pptx-observation-qa${query}`,
              "POST",
              {
                id: analysis.id,
                version: analysis.version,
                question: question.trim(),
                saveDraft:
                  (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
                    "value",
                  ) === "yes",
              },
            );
            if (active.current) {
              if (r.analysis) accept(r);
              else setAnswer(r);
            }
          } catch (e) {
            if (active.current) setError((e as Error).message);
          } finally {
            if (active.current) setBusy(false);
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
            style={{
              whiteSpace: "normal",
              maxWidth: "100%",
              textAlign: "left",
            }}
            type="submit"
            disabled={!ai || busy || stale || question.trim().length < 5}
          >
            {busy ? "Working…" : l.ask}
          </button>
          <button
            className="button"
            style={{
              whiteSpace: "normal",
              maxWidth: "100%",
              textAlign: "left",
            }}
            type="submit"
            name="saveDraft"
            value="yes"
            disabled={!ai || busy || stale || question.trim().length < 5}
          >
            Ask and save PPTX answer draft
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
            const source = analysis.pptxObservations?.find(
              (e) =>
                e.pptxId === c.pptxId && e.reviewVersion === c.reviewVersion,
            );
            return (
              <div key={n} style={{ overflowWrap: "anywhere" }}>
                <blockquote>
                  {l[c.field]}: {c.quote}
                </blockquote>
                {source && (
                  <a
                    className="text-button"
                    href={`/?study=${encodeURIComponent(studyId)}&tab=responses&interview=${encodeURIComponent(source.interviewId)}&turn=${encodeURIComponent(source.turnId)}`}
                  >
                    {source.reviewerName} · {l.review} {c.reviewVersion} ·{" "}
                    {c.pptxId.slice(0, 8)}
                  </a>
                )}
              </div>
            );
          })}
          <p className="muted">
            {answer.model} · {new Date(answer.generatedAt).toLocaleString()}
          </p>
          <button
            className="button"
            style={{
              whiteSpace: "normal",
              maxWidth: "100%",
              textAlign: "left",
            }}
            type="button"
            onClick={() => setAnswer(null)}
          >
            {l.clear}
          </button>
        </section>
      )}
    </section>
  );
}
