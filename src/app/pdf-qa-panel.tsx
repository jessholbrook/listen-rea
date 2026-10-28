"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { pdfQALabels, type PDFQA } from "@/lib/pdf-qa";
import { pdfEvidenceLabels } from "@/lib/pdf-evidence";
import type { Analysis } from "@/lib/domain";
import PrivatePDF from "./private-pdf";
export default function PDFQAPanel({
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
    [answer, setAnswer] = useState<PDFQA | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [view, setView] = useState<{ id: string; page: number } | null>(null);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const language = analysis.reportLanguage || "en",
    l = pdfQALabels[language];
  if (!analysis.pdfEvidence?.length) return null;
  return (
    <section className="panel attachment-synthesis pdf-qa" aria-label={l.title}>
      <h3>{l.title}</h3>
      <p>{l.notice}</p>
      <p className="muted">{l.payload}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || stale || !ai) return;
          setBusy(true);
          setError("");
          setAnswer(null);
          setView(null);
          try {
            const r = await api(`studies/${studyId}/pdf-qa${query}`, "POST", {
              id: analysis.id,
              version: analysis.version,
              question: question.trim(),
              saveDraft:
                (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
                  "value",
                ) === "yes",
            });
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
            const source = analysis.pdfEvidence?.find(
              (e) =>
                e.pdfId === c.pdfId &&
                e.verificationVersion === c.verificationVersion,
            );
            return (
              <div key={n} style={{ overflowWrap: "anywhere" }}>
                <blockquote>{c.quote}</blockquote>
                <p>
                  {l.verification} {c.verificationVersion} · {l.characters}{" "}
                  {c.start + 1}–{c.end}
                </p>
                {source?.ocrPages?.includes(c.page) && (
                  <p>{pdfEvidenceLabels[language].ocr}</p>
                )}
                <button
                  className="button"
                  type="button"
                  onClick={() => setView({ id: c.pdfId, page: c.page })}
                >
                  {l.page} {c.page}
                </button>
                {source && (
                  <a
                    className="text-button"
                    href={`/?study=${encodeURIComponent(studyId)}&tab=responses&interview=${encodeURIComponent(source.interviewId)}&turn=${encodeURIComponent(source.turnId)}`}
                  >
                    {l.source} · {source.reviewerName} · {c.pdfId.slice(0, 8)}
                  </a>
                )}
              </div>
            );
          })}
          {view && (
            <PrivatePDF
              key={`${view.id}:${view.page}`}
              assetId={view.id}
              studyId={studyId}
              initialPage={view.page}
              autoOpen
              language={language}
            />
          )}
          <p className="muted">
            {answer.model} · {new Date(answer.generatedAt).toLocaleString()}
          </p>
          <button
            className="button"
            type="button"
            onClick={() => {
              setAnswer(null);
              setView(null);
            }}
          >
            {l.clear}
          </button>
        </section>
      )}
    </section>
  );
}
