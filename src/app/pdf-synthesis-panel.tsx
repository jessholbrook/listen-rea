"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/client";
import {
  pdfSynthesisLabels,
  type PDFSynthesis,
  type PDFSynthesisContent,
} from "@/lib/pdf-synthesis";
import PrivatePDF from "./private-pdf";
import type { Analysis } from "@/lib/domain";
export function PDFSynthesisView({
  synthesis,
  studyId,
  evidence,
  language = "en",
}: {
  synthesis: PDFSynthesis | undefined;
  studyId: string;
  evidence: Analysis["pdfEvidence"];
  language?: "en" | "es" | "fr";
}) {
  const [view, setView] = useState<{ id: string; page: number } | null>(null);
  if (!synthesis) return null;
  const l = pdfSynthesisLabels[language];
  return (
    <section className="panel attachment-synthesis" aria-label={l.title}>
      <h3>{l.title}</h3>
      <p>{l.notice}</p>
      <p>{synthesis.reviewed ? "Reviewed" : "Draft · review required"}</p>
      {synthesis.findings.map((f, n) => (
        <article className="panel" key={n}>
          <h4>{f.title}</h4>
          <p>{f.description}</p>
          {f.citations.map((c, k) => {
            const e = evidence?.find(
              (e) =>
                e.pdfId === c.pdfId &&
                e.verificationVersion === c.verificationVersion,
            );
            return (
              <div key={k} style={{ overflowWrap: "anywhere" }}>
                <blockquote>
                  {l.citation} {c.page}: {c.quote}
                </blockquote>
                {e && (
                  <button
                    type="button"
                    className="button"
                    onClick={() => setView({ id: c.pdfId, page: c.page })}
                  >
                    {l.citation} {c.page}
                  </button>
                )}
                {e && (
                  <a
                    className="text-button"
                    href={`/?study=${encodeURIComponent(studyId)}&tab=responses&interview=${encodeURIComponent(e.interviewId)}&turn=${encodeURIComponent(e.turnId)}`}
                  >
                    {e.reviewerName} · {l.review} {c.verificationVersion} ·{" "}
                    {c.pdfId.slice(0, 8)}
                  </a>
                )}
              </div>
            );
          })}
        </article>
      ))}
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
      {!synthesis.findings.length && <p>No supported findings proposed.</p>}
      <p>
        {l.limits}: {synthesis.limitations}
      </p>
      <p className="muted" style={{ overflowWrap: "anywhere" }}>
        {synthesis.model} · {synthesis.promptVersion} · {synthesis.generatedAt}
        {synthesis.reviewedBy &&
          ` · Reviewed by ${synthesis.reviewedBy.name} · ${synthesis.reviewedAt}`}
      </p>
    </section>
  );
}
export default function PDFSynthesisPanel({
  analysis,
  studyId,
  query,
  ai,
  stale,
  accept,
  onError,
}: {
  analysis: Analysis;
  studyId: string;
  query: string;
  ai: boolean;
  stale: boolean;
  accept: (r: any) => void;
  onError: (s: string) => void;
}) {
  const s = analysis.pdfSynthesis;
  const [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [content, setContent] = useState<PDFSynthesisContent>({
      findings: [],
      limitations: "",
    });
  useEffect(() => {
    setContent({
      findings: structuredClone(s?.findings || []),
      limitations: s?.limitations || "",
    });
    setReviewed(Boolean(s?.reviewed));
  }, [analysis.id, analysis.version, s]);
  async function run(method: string, data?: unknown) {
    setBusy(true);
    try {
      accept(
        await api(`studies/${studyId}/pdf-synthesis${query}`, method, {
          id: analysis.id,
          version: analysis.version,
          ...((data as object) || {}),
        }),
      );
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!analysis.pdfEvidence?.length) return null;
  return (
    <section
      className="panel attachment-synthesis"
      aria-label="PDF synthesis controls"
    >
      <h3>Synthesize verified PDF passages</h3>
      <p>
        AI receives only explicitly included, verified excerpts and their
        PDF/page references. Full documents, participant answers, private
        correction history and reviewer names are not sent. Changing synthesis
        clears report editions and share links; review the synthesis and memo
        again before sharing.
      </p>
      <button
        className="button"
        disabled={!ai || busy || stale}
        onClick={() => {
          if (
            s &&
            !confirm(
              "Replace the existing synthesis and clear report editions and share links?",
            )
          )
            return;
          void run("POST");
        }}
      >
        {busy
          ? "Working…"
          : s
            ? "Regenerate PDF synthesis"
            : "Synthesize PDF passages with AI"}
      </button>
      <PDFSynthesisView
        synthesis={s}
        studyId={studyId}
        evidence={analysis.pdfEvidence}
        language={analysis.reportLanguage}
      />
      {s && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run("PUT", { ...content, reviewed });
          }}
        >
          <fieldset disabled={busy || stale}>
            <legend>Review PDF synthesis</legend>
            {content.findings.map((f, n) => (
              <div key={n}>
                <label>
                  Finding {n + 1} title
                  <input
                    aria-label={`PDF synthesis finding ${n + 1} title`}
                    required
                    minLength={3}
                    maxLength={150}
                    value={f.title}
                    onChange={(e) => {
                      setReviewed(false);
                      setContent({
                        ...content,
                        findings: content.findings.map((f, i) =>
                          i === n ? { ...f, title: e.target.value } : f,
                        ),
                      });
                    }}
                  />
                </label>
                <label>
                  Interpretation
                  <textarea
                    aria-label={`PDF synthesis finding ${n + 1} interpretation`}
                    required
                    minLength={3}
                    maxLength={1500}
                    value={f.description}
                    onChange={(e) => {
                      setReviewed(false);
                      setContent({
                        ...content,
                        findings: content.findings.map((f, i) =>
                          i === n ? { ...f, description: e.target.value } : f,
                        ),
                      });
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setReviewed(false);
                    setContent({
                      ...content,
                      findings: content.findings.filter((_, i) => i !== n),
                    });
                  }}
                >
                  Remove proposed finding {n + 1}
                </button>
              </div>
            ))}
            <label>
              PDF synthesis limitations
              <textarea
                aria-label="PDF synthesis limitations"
                required
                minLength={3}
                maxLength={2000}
                value={content.limitations}
                onChange={(e) => {
                  setReviewed(false);
                  setContent({ ...content, limitations: e.target.value });
                }}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              I checked each interpretation against its cited PDF passages and
              reviewed the limitations.
            </label>
            <button className="button primary" type="submit">
              Save PDF synthesis review
            </button>
            <button
              className="button danger"
              type="button"
              onClick={() => {
                if (
                  confirm(
                    "Discard this synthesis and clear report editions and share links?",
                  )
                )
                  void run("DELETE");
              }}
            >
              Discard PDF synthesis
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
