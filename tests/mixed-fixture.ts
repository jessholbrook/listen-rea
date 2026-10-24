import { templateGuide, guideSchema, type Question } from "../src/lib/domain";
export function mixedGuide() {
  const g = templateGuide("Mixed-method fixture");
  const q = (
    id: string,
    type: Question["type"],
    extra: Partial<Question> = {},
  ): Question => ({
    id,
    type,
    text: id,
    section: "Questions",
    options: [],
    followUps: 0,
    instructions: "",
    condition: null,
    ...extra,
  });
  const option = (id: string) => ({
    id,
    text: id.toUpperCase(),
    rejects: false,
  });
  g.questions = [
    q("source", "multiple", {
      text: "Which tools do you use?",
      options: ["a", "b", "c"].map(option),
      randomizeOptions: true,
    }),
    q("rating", "rating", {
      text: "How useful is the process?",
      section: "Scores",
      scale: {
        min: 0,
        max: 10,
        lowLabel: "Not useful",
        highLabel: "Very useful",
      },
    }),
    q("rank", "ranking", {
      text: "Rank the tools you selected",
      carryForward: { questionId: "source", mode: "selected" },
      randomizeOptions: true,
    }),
    q("matrix", "matrix", {
      text: "Rate each activity",
      section: "Scores",
      options: ["speed", "clarity"].map(option),
    }),
    q("remaining", "multiple", {
      text: "Select tools you might try",
      carryForward: { questionId: "source", mode: "unselected" },
    }),
    q("end", "statement", { text: "Thank you." }),
  ];
  g.sections = [
    { name: "Scores", condition: { questionId: "source", optionId: "a" } },
  ];
  return guideSchema.parse(g);
}
