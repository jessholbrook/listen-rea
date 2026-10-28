"use client";
import {
  docxObservationLabels,
  docxObservationText,
  type DOCXObservation,
} from "@/lib/docx-observations";
import PrivateDOCX from "./private-docx";
export default function DOCXObservationsPanel({
  entries,
  studyId,
  language = "en",
}: {
  entries: DOCXObservation[] | undefined;
  studyId: string;
  language?: "en" | "es" | "fr";
}) {
  if (!entries?.length) return null;
  const l = docxObservationLabels[language];
  return (
    <section className="panel" aria-label={l.title}>
      <h3>{l.title}</h3>
      <p className="muted">{l.notice}</p>
      {entries.map((e) => (
        <article
          className="panel"
          key={e.docxId}
          style={{ overflowWrap: "anywhere" }}
        >
          <p style={{ whiteSpace: "pre-wrap" }}>
            {docxObservationText(e, language)}
          </p>
          <PrivateDOCX
            assetId={e.docxId}
            studyId={studyId}
            highlight={
              e.question?.paragraph && e.question.quote
                ? { paragraph: e.question.paragraph, quote: e.question.quote }
                : undefined
            }
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
