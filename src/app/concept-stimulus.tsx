import SingleViewVideo from "./single-view-video";
import type { Interview } from "@/lib/domain";
import { conceptFor } from "@/lib/concepts";
import PrivateConceptImage from "./private-concept-image";
import { prototypeCopy } from "@/lib/prototypes";
import { ExternalLink } from "lucide-react";
import PrivateConceptVideo from "./private-concept-video";
import { conceptVideoCopy } from "@/lib/concept-videos";
export default function ConceptStimulus({
  interview,
  token,
  onInterview,
}: {
  interview: Interview;
  token: string;
  onInterview?: (i: Interview) => void;
}) {
  const concept = conceptFor(interview);
  if (!concept) return null;
  const words = prototypeCopy(interview.language);
  const videoWords = conceptVideoCopy(interview.language);
  const ids = [
    ...new Set(
      interview.guide.questions.flatMap((q) =>
        q.conceptId ? [q.conceptId] : [],
      ),
    ),
  ];
  return (
    <aside className="concept-stimulus" aria-label="Concept to evaluate">
      <span className="eyebrow">
        CONCEPT {ids.indexOf(concept.id) + 1} OF {ids.length}
      </span>
      <h2>{concept.headline}</h2>
      <p>{concept.description}</p>
      {concept.imageAssetId && (
        <PrivateConceptImage
          key={concept.imageAssetId}
          interviewId={interview.id}
          assetId={concept.imageAssetId}
          token={token}
          alt={concept.imageAlt || concept.headline}
          language={interview.language}
        />
      )}
      {concept.imageUrl && (
        <img
          src={concept.imageUrl}
          alt={concept.imageAlt || concept.headline}
          referrerPolicy="no-referrer"
        />
      )}
      {concept.videoAssetId && (
        <section className="concept-video-stimulus">
          {concept.videoOnce ? (
            onInterview && (
              <SingleViewVideo
                key={concept.id}
                interview={interview}
                assetId={concept.videoAssetId}
                token={token}
                alt={videoWords.video + ": " + concept.headline}
                onInterview={onInterview}
              />
            )
          ) : (
            <PrivateConceptVideo
              key={concept.videoAssetId}
              interviewId={interview.id}
              assetId={concept.videoAssetId}
              token={token}
              alt={videoWords.video + ": " + concept.headline}
              language={interview.language}
            />
          )}
          <details className="concept-video-transcript">
            <summary>{videoWords.text}</summary>
            <p>{concept.videoTranscript}</p>
          </details>
        </section>
      )}
      {(concept.taskInstructions || concept.prototypeUrl) && (
        <section className="prototype-task" aria-label={words.task}>
          <h3>{words.task}</h3>
          <p>{concept.taskInstructions}</p>
          {concept.prototypeUrl && (
            <>
              <p className="prototype-destination">
                {words.destination}:{" "}
                <bdi>{new URL(concept.prototypeUrl).origin}</bdi>
              </p>
              <a
                className="button primary"
                href={concept.prototypeUrl}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                {words.open} <ExternalLink size={15} aria-hidden="true" />
              </a>
              <p className="small">{words.notice}</p>
              <p className="small">{words.external}</p>
            </>
          )}
        </section>
      )}
    </aside>
  );
}
