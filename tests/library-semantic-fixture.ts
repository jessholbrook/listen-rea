import { semanticDimensions } from "../src/lib/library-semantic";
export const semanticUnit = (position = 0) =>
  Array.from({ length: semanticDimensions }, (_, i) =>
    i === position ? 1 : 0,
  );
export const fixtureEmbedding = async (texts: string[]) =>
  texts.map((t) =>
    semanticUnit(
      t.includes("Save draft") ||
        t.includes("progress") ||
        t.includes("unfinished")
        ? 0
        : 1,
    ),
  );
