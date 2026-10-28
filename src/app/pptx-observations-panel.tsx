"use client";
import {
  pptxObservationLabels,
  pptxObservationText,
  type PPTXObservation,
} from "@/lib/pptx-observations";
import PrivatePPTX from "./private-pptx";
export default function PPTXObservationsPanel({
  entries,
  studyId,
  language = "en",
}: {
  entries: PPTXObservation[] | undefined;
  studyId: string;
  language?: "en" | "es" | "fr";
}) {
  if (!entries?.length) return null;
  const l = pptxObservationLabels[language];
  return (
    <section className="panel" aria-label={l.title}>
      <h3>{l.title}</h3>
      <p className="muted">{l.notice}</p>
      {entries.map((e) => (
        <article
          className="panel"
          key={e.pptxId}
          style={{ overflowWrap: "anywhere" }}
        >
          <p style={{ whiteSpace: "pre-wrap" }}>
            {pptxObservationText(e, language)}
          </p>
          <PrivatePPTX
            assetId={e.pptxId}
            studyId={studyId}
            highlight={
              e.question?.slide && e.question.quote
                ? { slide: e.question.slide, quote: e.question.quote }
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
