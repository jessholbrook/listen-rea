"use client";
import {
  attachmentLabels,
  type AttachmentEvidence,
} from "@/lib/attachment-evidence";
import PrivateConceptImage from "./private-concept-image";
export default function AttachmentEvidencePanel({
  entries,
  studyId,
  language = "en",
}: {
  entries: AttachmentEvidence[] | undefined;
  studyId: string;
  language?: "en" | "es" | "fr";
}) {
  if (!entries?.length) return null;
  const l = attachmentLabels[language];
  return (
    <section className="panel" aria-label={l.title}>
      <h3>{l.title}</h3>
      <p className="muted">{l.notice}</p>
      {entries.map((e) => (
        <article
          className="panel"
          key={e.imageId}
          style={{ overflowWrap: "anywhere" }}
        >
          <p style={{ whiteSpace: "pre-wrap" }}>
            {l.notes}: {e.notes}
          </p>
          <p>
            {l.reviewer}: {e.reviewerName} · {e.reviewedAt} · {l.review}{" "}
            {e.reviewVersion}
          </p>
          <p>
            {l.grounding}: {e.grounding}
          </p>
          <PrivateConceptImage
            assetId={e.imageId}
            studyId={studyId}
            resource="participant-images"
            alt={`${l.image} ${e.imageId}`}
            enlarge
          />
          <a
            className="text-button"
            href={`/?study=${encodeURIComponent(studyId)}&tab=responses&interview=${encodeURIComponent(e.interviewId)}&turn=${encodeURIComponent(e.turnId)}`}
          >
            {l.response} {e.interviewId.slice(0, 8)} · {l.turn}{" "}
            {e.turnId.slice(0, 8)} · {l.image} {e.imageId.slice(0, 8)}
          </a>
        </article>
      ))}
    </section>
  );
}
