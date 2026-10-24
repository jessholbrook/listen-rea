"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import { docxSnapshot } from "@/lib/participant-docx";
import { docxEvidenceLabels, type DOCXEvidence } from "@/lib/docx-evidence";
export default function DOCXEvidencePanel({
  entries,
  studyId,
  language = "en",
}: {
  entries: DOCXEvidence[] | undefined;
  studyId: string;
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
  if (!entries?.length) return null;
  const l = docxEvidenceLabels[language];
  return (
    <section className="panel pdf-evidence" aria-label={l.title}>
      <h3>{l.title}</h3>
      <p className="muted">{l.notice}</p>
      {error && <p role="alert">{error}</p>}
      {entries.map((e) => (
        <article className="panel" key={e.docxId}>
          <p>
            {l.document} {e.docxId} · {l.version} {e.verificationVersion}
          </p>
          <p>
            {l.reviewer}: {e.reviewerName} · {e.reviewedAt}
          </p>
          {e.passages.map((p) => (
            <div key={`${p.paragraph}:${p.start}:${p.end}`}>
              <blockquote style={{ whiteSpace: "pre-wrap" }}>
                {p.quote}
              </blockquote>
              <p>
                {l.paragraph} {p.paragraph} · {l.characters} {p.start + 1}–
                {p.end}
              </p>
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  setView(null);
                  try {
                    // Revalidate saved inclusion/source/version before displaying live context.
                    const r = await api(
                        `studies/${studyId}/participant-docx/${e.docxId}/text`,
                      ),
                      latest = r.verification?.history.at(-1);
                    if (
                      r.source !== e.source ||
                      r.digest !== e.digest ||
                      latest?.version !== e.verificationVersion ||
                      !latest.includeInReports
                    )
                      throw new Error(
                        "DOCX evidence changed. Regenerate the analysis and report.",
                      );
                    const { paragraphs } = docxSnapshot.parse({
                        version: 1,
                        paragraphs: r.paragraphs,
                      }),
                      text = paragraphs[p.paragraph - 1];
                    if (text?.slice(p.start, p.end) !== p.quote)
                      throw new Error(
                        "DOCX passage no longer matches its prepared paragraph.",
                      );
                    setView({ id: e.docxId, ...p, text });
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {l.view} · {l.paragraph} {p.paragraph}
              </button>
            </div>
          ))}
          {view?.id === e.docxId && (
            <div
              aria-label={`${l.paragraph} ${view.paragraph}`}
              style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
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
