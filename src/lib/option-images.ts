import { videoAnswerBlocked } from "./video-once";
import type { Interview } from "./domain";
import { maxdiffPrompt } from "./maxdiff";
import { optionsFor } from "./mixed";
import { conceptPresentation } from "./concept-timing";
export function currentImageOptions(i: Interview, at = Date.now()) {
  const q = i.guide.questions[i.current],
    p = conceptPresentation(i, at);
  if (
    i.status !== "active" ||
    videoAnswerBlocked(i) ||
    !q ||
    !["choice", "multiple", "ranking", "maxdiff"].includes(q.type) ||
    p?.state === "waiting" ||
    p?.state === "viewing"
  )
    return [];
  return q.type === "maxdiff"
    ? maxdiffPrompt(i, q)?.items || []
    : optionsFor(i, q);
}
