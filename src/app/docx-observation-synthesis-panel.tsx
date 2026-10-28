"use client";
import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/client";
import {
  docxObservationSynthesisLabels,
  type DOCXObservationSynthesis,
  type DOCXObservationSynthesisContent,
} from "@/lib/docx-observation-synthesis";
import type { Analysis } from "@/lib/domain";
export function DOCXObservationSynthesisView({
  synthesis,
  studyId,
  evidence,
  language = "en",
}: {
  synthesis: DOCXObservationSynthesis | undefined;
  studyId: string;
  evidence: Analysis["docxObservations"];
  language?: "en" | "es" | "fr";
}) {
  if (!synthesis) return null;
  const l = docxObservationSynthesisLabels[language];
  return (
    <section
      className="panel attachment-synthesis docx-observation-synthesis"
      aria-label={l.title}
    >
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
                e.docxId === c.docxId && e.reviewVersion === c.reviewVersion,
            );
            return (
              <div key={k} style={{ overflowWrap: "anywhere" }}>
                <blockquote>
                  {l[c.field]}: {c.quote}
                </blockquote>
                {e && (
                  <a
                    className="text-button"
                    href={`/?study=${encodeURIComponent(studyId)}&tab=responses&interview=${encodeURIComponent(e.interviewId)}&turn=${encodeURIComponent(e.turnId)}`}
                  >
                    {e.reviewerName} · {l.review} {c.reviewVersion} ·{" "}
                    {c.docxId.slice(0, 8)}
                  </a>
                )}
              </div>
            );
          })}
        </article>
      ))}
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
export default function DOCXObservationSynthesisPanel({
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
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const s = analysis.docxObservationSynthesis;
  const [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [content, setContent] = useState<DOCXObservationSynthesisContent>({
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
      const result = await api(
        `studies/${studyId}/docx-observation-synthesis${query}`,
        method,
        {
          id: analysis.id,
          version: analysis.version,
          ...((data as object) || {}),
        },
      );
      if (active.current) accept(result);
    } catch (e) {
      if (active.current) onError((e as Error).message);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  if (!analysis.docxObservations?.length) return null;
  return (
    <section
      className="panel attachment-synthesis docx-observation-synthesis"
      aria-label="DOCX observation synthesis controls"
    >
      <h3>Synthesize included DOCX observations</h3>
      <p>
        AI receives only the latest included researcher DOCX notes, corrections,
        grounding judgments and review references. DOCX files, prepared
        paragraph text, original questions, participant answers, private review
        history and reviewer names are not sent. Changing synthesis clears
        report editions and share links; review the synthesis and memo again
        before sharing.
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
            ? "Regenerate DOCX observation synthesis"
            : "Synthesize DOCX observations with AI"}
      </button>
      <DOCXObservationSynthesisView
        synthesis={s}
        studyId={studyId}
        evidence={analysis.docxObservations}
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
            <legend>Review DOCX observation synthesis</legend>
            {content.findings.map((f, n) => (
              <div key={n}>
                <label>
                  Finding {n + 1} title
                  <input
                    aria-label={`DOCX observation synthesis finding ${n + 1} title`}
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
                    aria-label={`DOCX observation synthesis finding ${n + 1} interpretation`}
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
              Synthesis limitations
              <textarea
                aria-label="DOCX observation synthesis limitations"
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
              I checked each interpretation against its cited researcher DOCX
              notes or corrections and reviewed the limitations.
            </label>
            <button className="button primary" type="submit">
              Save DOCX observation synthesis review
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
              Discard DOCX observation synthesis
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
