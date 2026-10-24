import { imageGuide } from "./concept-images-fixture";
export function timedGuide(seconds = 1) {
  const g = imageGuide();
  g.questions.splice(2, 0, {
    ...g.questions[1],
    id: "confidence",
    text: "How confident is your answer?",
  });
  g.conceptTest!.concepts.forEach((c) => {
    c.exposureSeconds = seconds;
  });
  return g;
}
