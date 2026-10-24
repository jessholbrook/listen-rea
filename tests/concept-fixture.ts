import { templateGuide, guideSchema, type Question } from "../src/lib/domain";
export function conceptGuide() {
  const g = templateGuide("Concept comparison fixture");
  const q = (
    id: string,
    type: Question["type"],
    conceptQuestion = false,
    extra: Partial<Question> = {},
  ): Question => ({
    id,
    type,
    conceptQuestion,
    text: id,
    section: "Questions",
    options: [],
    followUps: 0,
    instructions: "",
    condition: null,
    ...extra,
  });
  const options = [
    { id: "a", text: "Speed", rejects: false },
    { id: "b", text: "Clarity", rejects: false },
  ];
  g.questions = [
    q("shared", "open", false, { text: "Tell us your research context." }),
    q("interest", "rating", true, { text: "How appealing is this idea?" }),
    q("reaction", "open", true, { text: "What stands out about this idea?" }),
    q("features", "multiple", true, {
      text: "Which features matter?",
      options,
    }),
    q("rank", "ranking", true, {
      text: "Rank the selected features",
      section: "Details",
      carryForward: { questionId: "features", mode: "selected" },
    }),
    q("end", "statement", false, { text: "Thank you." }),
  ];
  g.sections = [
    { name: "Details", condition: { questionId: "features", optionId: "a" } },
  ];
  g.conceptTest = {
    concepts: [
      {
        id: "alpha",
        name: "Alpha",
        headline: "Alpha idea",
        description: "A service focused on fast summaries.",
      },
      {
        id: "beta",
        name: "Beta",
        headline: "Beta idea",
        description: "A service focused on traceable evidence.",
      },
    ],
    count: 2,
    randomizeOrder: true,
  };
  return guideSchema.parse(g);
}
