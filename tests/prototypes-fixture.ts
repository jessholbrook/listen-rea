import { imageGuide } from "./concept-images-fixture";
export const alphaPrototype =
  "https://prototype.example.test/alpha?mode=demo#screen-1";
export const betaPrototype =
  "https://prototype.example.test/beta?mode=demo#screen-2";
export function prototypeGuide() {
  const g = imageGuide();
  g.conceptTest!.concepts.forEach((c, n) => {
    c.prototypeUrl = n ? betaPrototype : alphaPrototype;
    c.taskInstructions = n
      ? "Find the evidence behind a summary.\nReturn here to rate the idea."
      : "Create a summary from the example notes.\nReturn here to rate the idea.";
  });
  return g;
}
