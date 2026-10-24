"use client";
import { useState } from "react";
import { pdfEvidenceLabels, type PDFEvidence } from "@/lib/pdf-evidence";
import PrivatePDF from "./private-pdf";
export default function PDFEvidencePanel({
  entries,
  studyId,
  language = "en",
}: {
  entries: PDFEvidence[] | undefined;
  studyId: string;
  language?: "en" | "es" | "fr";
}) {
  const [view, setView] = useState<{ id: string; page: number } | null>(null);
  if (!entries?.length) return null;
  const l = pdfEvidenceLabels[language];
  return (
    <section className="panel pdf-evidence" aria-label={l.title}>
      <h3>{l.title}</h3>
      <p className="muted">{l.notice}</p>
      {entries.map((e) => (
        <article className="panel" key={e.pdfId}>
          <p>
            {l.document} {e.pdfId} · {l.version} {e.verificationVersion}
          </p>
          <p>
            {l.reviewer}: {e.reviewerName} · {e.reviewedAt}
          </p>
          {e.passages.map((p) => (
            <div key={`${p.page}:${p.start}:${p.end}`}>
              <blockquote style={{ whiteSpace: "pre-wrap" }}>
                {p.quote}
              </blockquote>
              {e.ocrPages?.includes(p.page) && <p>{l.ocr}</p>}
              <button
                className="button"
                type="button"
                onClick={() => setView({ id: e.pdfId, page: p.page })}
              >
                {l.page} {p.page}
              </button>
            </div>
          ))}
          {view?.id === e.pdfId && (
            <PrivatePDF
              key={`${view.id}:${view.page}`}
              assetId={e.pdfId}
              studyId={studyId}
              initialPage={view.page}
              autoOpen
              language={language}
            />
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
