"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import { pptxSnapshot } from "@/lib/participant-pptx";
import { pptxEvidenceLabels, type PPTXEvidence } from "@/lib/pptx-evidence";
export default function PPTXEvidencePanel({
  entries,
  studyId,
  language = "en",
}: {
  entries: PPTXEvidence[] | undefined;
  studyId: string;
  language?: "en" | "es" | "fr";
}) {
  const [view, setView] = useState<{
      id: string;
      slide: number;
      start: number;
      end: number;
      quote: string;
      text: string;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (!entries?.length) return null;
  const l = pptxEvidenceLabels[language];
  return (
    <section className="panel pdf-evidence" aria-label={l.title}>
      <h3>{l.title}</h3>
      <p className="muted">{l.notice}</p>
      {error && <p role="alert">{error}</p>}
      {entries.map((e) => (
        <article
          className="panel"
          key={e.pptxId}
          style={{ overflowWrap: "anywhere" }}
        >
          <p>
            {l.document} {e.pptxId} · {l.version} {e.verificationVersion}
          </p>
          <p>
            {l.reviewer}: {e.reviewerName} · {e.reviewedAt}
          </p>
          {e.passages.map((p) => (
            <div key={`${p.slide}:${p.start}:${p.end}`}>
              <blockquote style={{ whiteSpace: "pre-wrap" }}>
                {p.quote}
              </blockquote>
              <p>
                {l.slide} {p.slide} · {l.characters} {p.start + 1}–{p.end}
              </p>
              <button
                className="button"
                style={{
                  whiteSpace: "normal",
                  maxWidth: "100%",
                  textAlign: "left",
                }}
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  setView(null);
                  try {
                    // Revalidate saved inclusion/source/version before displaying live context.
                    const r = await api(
                        `studies/${studyId}/participant-pptx/${e.pptxId}/text`,
                      ),
                      latest = r.verification?.history.at(-1);
                    if (
                      r.source !== e.source ||
                      r.digest !== e.digest ||
                      latest?.version !== e.verificationVersion ||
                      !latest.includeInReports
                    )
                      throw new Error(
                        "PPTX evidence changed. Regenerate the analysis and report.",
                      );
                    const { slides } = pptxSnapshot.parse({
                        version: 1,
                        slides: r.slides,
                      }),
                      text = slides[p.slide - 1];
                    if (text?.slice(p.start, p.end) !== p.quote)
                      throw new Error(
                        "PPTX passage no longer matches its prepared slide.",
                      );
                    setView({ id: e.pptxId, ...p, text });
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {l.view} · {l.slide} {p.slide}
              </button>
            </div>
          ))}
          {view?.id === e.pptxId && (
            <div
              aria-label={`${l.slide} ${view.slide}`}
              style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
            >
              <strong>
                {l.slide} {view.slide}
              </strong>
              <p>
                {view.text.slice(0, view.start)}
                <mark>{view.quote}</mark>
                {view.text.slice(view.end)}
              </p>
            </div>
          )}
          <a
            className="text-button"
            href={`/?study=${encodeURIComponent(studyId)}&tab=responses&interview=${encodeURIComponent(e.interviewId)}&turn=${encodeURIComponent(e.turnId)}`}
          >
            {l.response} {e.interviewId.slice(0, 8)} · {l.turn}{" "}
            {e.turnId.slice(0, 8)}
          </a>
        </article>
      ))}
    </section>
  );
}
