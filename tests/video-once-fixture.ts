import { videoGuide } from "./concept-videos-fixture";
export function onceGuide(ids: string[] = []) {
  const g = videoGuide(ids);
  g.questions.splice(2, 0, {
    ...g.questions[1],
    id: "confidence",
    text: "How confident is your rating?",
  });
  g.conceptTest!.concepts.forEach((c) => {
    c.videoOnce = !!c.videoAssetId;
  });
  return g;
}
