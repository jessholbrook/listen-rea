import { templateGuide, guideSchema, type Question } from "../src/lib/domain";
export function optionImageGuide(ids: string[] = []) {
  const g = templateGuide("Image answer fixture");
  const question = (
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
  const option = (id: string, text: string, index: number) => ({
    id,
    text,
    rejects: false,
    ...(ids[index]
      ? { imageAssetId: ids[index], imageAlt: text + " image description" }
      : {}),
  });
  g.sections = [];
  g.conceptTest = null;
  g.questions = [
    question("pick", "choice", {
      text: "Which design do you prefer?",
      randomizeOptions: true,
      options: [
        option("a", "Green design", 0),
        option("b", "Purple design", 1),
      ],
    }),
    question("remaining", "multiple", {
      text: "Select the other design",
      carryForward: { questionId: "pick", mode: "unselected" },
      selection: { min: 1, max: 1 },
    }),
    question("rank", "ranking", {
      text: "Rank the other design",
      carryForward: { questionId: "pick", mode: "unselected" },
    }),
    question("more", "multiple", {
      text: "Which extras would you use?",
      options: [
        option("c", "Blue extra", 2),
        { id: "none", text: "No extras", rejects: false },
      ],
    }),
    question("end", "statement", { text: "Thank you." }),
  ];
  return guideSchema.parse(g);
}
