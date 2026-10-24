"use client";
import {
  pdfObservationLabels,
  pdfObservationText,
  type PDFObservation,
} from "@/lib/pdf-observations";
import PrivatePDF from "./private-pdf";
export default function PDFObservationsPanel({
  entries,
  studyId,
  language = "en",
}: {
  entries: PDFObservation[] | undefined;
  studyId: string;
  language?: "en" | "es" | "fr";
}) {
  if (!entries?.length) return null;
  const l = pdfObservationLabels[language];
  return (
    <section className="panel" aria-label={l.title}>
      <h3>{l.title}</h3>
      <p className="muted">{l.notice}</p>
      {entries.map((e) => (
        <article
          className="panel"
          key={e.pdfId}
          style={{ overflowWrap: "anywhere" }}
        >
          <p style={{ whiteSpace: "pre-wrap" }}>
            {pdfObservationText(e, language)}
          </p>
          <PrivatePDF
            assetId={e.pdfId}
            studyId={studyId}
            initialPage={e.question?.page || 1}
            language={language}
          />
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
