import { guideSchema } from "../src/lib/domain";
import { optionImageGuide } from "./option-images-fixture";
export function rankingMaxdiffImageGuide(ids: string[] = []) {
  const g = optionImageGuide();
  const item = (n: number) => ({
    id: String(n),
    text: ["Green package", "Purple package", "Blue package", "Amber package"][
      n
    ],
    ...(ids[n]
      ? {
          imageAssetId: ids[n],
          imageAlt: [
            "Green leaf box",
            "Purple circle box",
            "Blue wave box",
            "Amber star box",
          ][n],
        }
      : {}),
  });
  g.questions = [
    {
      ...g.questions[0],
      id: "rank",
      type: "ranking",
      text: "Rank the package designs",
      randomizeOptions: true,
      options: [0, 1, 2, 3].map((n) => ({ ...item(n), rejects: false })),
    },
    {
      ...g.questions[0],
      id: "maxdiff",
      type: "maxdiff",
      text: "Which package designs work best and worst?",
      options: [],
      maxdiff: { items: [0, 1, 2, 3].map(item), setSize: 3, cycles: 1 },
    },
    g.questions.at(-1)!,
  ];
  return guideSchema.parse(g);
}
