import { conceptGuide } from "./concept-fixture";
export function imageGuide(ids: string[] = []) {
  const g = conceptGuide();
  g.sections = [];
  g.questions = [
    {
      ...g.questions[0],
      type: "choice",
      text: "Ready to review the concepts?",
      options: [
        { id: "go", text: "Ready", rejects: false },
        { id: "later", text: "Later", rejects: true },
      ],
    },
    g.questions[1],
    g.questions.at(-1)!,
  ];
  g.conceptTest!.randomizeOrder = false;
  g.conceptTest!.concepts.forEach((c, n) => {
    c.imageAssetId = ids[n] || null;
    c.imageAlt = "Concept " + c.name + " image";
  });
  return g;
}
