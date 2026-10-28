"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/client";
import {
  synthesisLabels,
  type AttachmentSynthesis,
  type AttachmentSynthesisContent,
} from "@/lib/attachment-synthesis";
import type { Analysis } from "@/lib/domain";
export function SynthesisView({
  synthesis,
  studyId,
  evidence,
  language = "en",
}: {
  synthesis: AttachmentSynthesis | undefined;
  studyId: string;
  evidence: Analysis["attachmentEvidence"];
  language?: "en" | "es" | "fr";
}) {
  if (!synthesis) return null;
  const l = synthesisLabels[language];
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
                e.imageId === c.imageId && e.reviewVersion === c.reviewVersion,
            );
            return (
              <div key={k} style={{ overflowWrap: "anywhere" }}>
                <blockquote>
                  {l.citation}: {c.quote}
                </blockquote>
                {e && (
                  <a
                    className="text-button"
                    href={`/?study=${encodeURIComponent(studyId)}&tab=responses&interview=${encodeURIComponent(e.interviewId)}&turn=${encodeURIComponent(e.turnId)}`}
                  >
                    {e.reviewerName} · {l.review} {c.reviewVersion} ·{" "}
                    {c.imageId.slice(0, 8)}
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
export default function AttachmentSynthesisPanel({
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
  const s = analysis.attachmentSynthesis;
  const [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [content, setContent] = useState<AttachmentSynthesisContent>({
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
        await api(`studies/${studyId}/attachment-synthesis${query}`, method, {
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
  if (!analysis.attachmentEvidence?.length) return null;
  return (
    <section
      className="panel attachment-synthesis"
      aria-label="Observation synthesis controls"
    >
      <h3>Synthesize included observations</h3>
      <p>
        AI receives only the included written researcher notes and source
        references. Images, participant answers, private correction history and
        reviewer names are not sent. Changing synthesis clears report editions
        and share links; review the synthesis and memo again before sharing.
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
            ? "Regenerate observation synthesis"
            : "Synthesize observations with AI"}
      </button>
      <SynthesisView
        synthesis={s}
        studyId={studyId}
        evidence={analysis.attachmentEvidence}
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
            <legend>Review observation synthesis</legend>
            {content.findings.map((f, n) => (
              <div key={n}>
                <label>
                  Finding {n + 1} title
                  <input
                    aria-label={`Synthesis finding ${n + 1} title`}
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
                    aria-label={`Synthesis finding ${n + 1} interpretation`}
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
                aria-label="Synthesis limitations"
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
              I checked each interpretation against its cited researcher notes
              and reviewed the limitations.
            </label>
            <button className="button primary" type="submit">
              Save synthesis review
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
              Discard observation synthesis
            </button>
          </fieldset>
        </form>
      )}
    </section>
  );
}
