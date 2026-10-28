"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/client";
import {
  docxSynthesisLabels,
  type DOCXSynthesis,
  type DOCXSynthesisContent,
} from "@/lib/docx-synthesis";
import type { DOCXEvidence } from "@/lib/docx-evidence";
import type { DOCXPassage } from "@/lib/docx-text";
import type { Analysis } from "@/lib/domain";
export function DOCXSynthesisView({
  synthesis,
  studyId,
  evidence,
  language = "en",
}: {
  synthesis: DOCXSynthesis | undefined;
  studyId: string;
  evidence: Analysis["docxEvidence"];
  language?: "en" | "es" | "fr";
}) {
  const [view, setView] = useState<{
      id: string;
      paragraph: number;
      start: number;
      end: number;
      quote: string;
      text: string;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setView(null);
  }, [synthesis, evidence]);
  async function show(e: DOCXEvidence, c: DOCXPassage) {
    setError("");
    setBusy(true);
    setView(null);
    try {
      const r = await api(
          `studies/${studyId}/participant-docx/${e.docxId}/text`,
        ),
        latest = r.verification?.history.at(-1),
        text = r.paragraphs[c.paragraph - 1];
      if (
        r.source !== e.source ||
        r.digest !== e.digest ||
        latest?.version !== e.verificationVersion ||
        !latest.includeInReports ||
        text?.slice(c.start, c.end) !== c.quote
      )
        throw new Error(
          "DOCX evidence changed. Regenerate the analysis and synthesis.",
        );
      setView({ id: e.docxId, ...c, text });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!synthesis) return null;
  const l = docxSynthesisLabels[language];
  return (
    <section className="panel attachment-synthesis" aria-label={l.title}>
      <h3>{l.title}</h3>
      <p>{l.notice}</p>
      <p>{synthesis.reviewed ? "Reviewed" : "Draft · review required"}</p>
      {error && <p role="alert">{error}</p>}
      {synthesis.findings.map((f, n) => (
        <article className="panel" key={n}>
          <h4>{f.title}</h4>
          <p>{f.description}</p>
          {f.citations.map((c, k) => {
            const e = evidence?.find(
              (e) =>
                e.docxId === c.docxId &&
                e.verificationVersion === c.verificationVersion,
            );
            return (
              <div key={k} style={{ overflowWrap: "anywhere" }}>
                <blockquote>
                  {l.citation} {c.paragraph} · {l.characters} {c.start + 1}–
                  {c.end}: {c.quote}
                </blockquote>
                {e && (
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() => void show(e, c)}
                  >
                    {l.citation} {c.paragraph}
                  </button>
                )}
                {e && (
                  <a
                    className="text-button"
                    href={`/?study=${encodeURIComponent(studyId)}&tab=responses&interview=${encodeURIComponent(e.interviewId)}&turn=${encodeURIComponent(e.turnId)}`}
                  >
                    {e.reviewerName} · {l.review} {c.verificationVersion} ·{" "}
                    {c.docxId.slice(0, 8)}
                  </a>
                )}
              </div>
            );
          })}
        </article>
      ))}
      {view && (
        <div
          style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
          aria-label={`${l.citation} ${view.paragraph}`}
        >
          <strong>
            {l.citation} {view.paragraph}
          </strong>
          <p>
            {view.text.slice(0, view.start)}
            <mark>{view.quote}</mark>
            {view.text.slice(view.end)}
          </p>
        </div>
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
export default function DOCXSynthesisPanel({
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
  const s = analysis.docxSynthesis;
  const [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [content, setContent] = useState<DOCXSynthesisContent>({
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
        await api(`studies/${studyId}/docx-synthesis${query}`, method, {
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
  if (!analysis.docxEvidence?.length) return null;
  return (
    <section
      className="panel attachment-synthesis"
      aria-label="DOCX synthesis controls"
    >
      <h3>Synthesize verified DOCX passages</h3>
      <p>
        AI receives only explicitly included, verified excerpts and their
        DOCX/paragraph/character references. Full documents, participant
        answers, private correction history and reviewer names are not sent.
        Changing synthesis clears report editions and share links; review the
        synthesis and memo again before sharing.
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
            ? "Regenerate DOCX synthesis"
            : "Synthesize DOCX passages with AI"}
      </button>
      <DOCXSynthesisView
        synthesis={s}
        studyId={studyId}
        evidence={analysis.docxEvidence}
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
            <legend>Review DOCX synthesis</legend>
            {content.findings.map((f, n) => (
              <div key={n}>
                <label>
                  Finding {n + 1} title
                  <input
                    aria-label={`DOCX synthesis finding ${n + 1} title`}
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
                    aria-label={`DOCX synthesis finding ${n + 1} interpretation`}
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
              DOCX synthesis limitations
              <textarea
                aria-label="DOCX synthesis limitations"
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
              I checked each interpretation against its cited DOCX passages and
              reviewed the limitations.
            </label>
            <button className="button primary" type="submit">
              Save DOCX synthesis review
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
              Discard DOCX synthesis
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
