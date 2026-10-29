import { z } from "zod";
export const clipSuggestionVersion = "quote-word-alignment-v1";
export const timedWords = z
  .array(
    z
      .object({
        word: z.string().max(200),
        start: z.number().min(0).max(300),
        end: z.number().min(0).max(300),
      })
      .refine((w) => w.end >= w.start),
  )
  .min(1)
  .max(5000)
  .refine((words) =>
    words.every((w, i) => i === 0 || w.start >= words[i - 1].start),
  );
export type TimedWord = z.infer<typeof timedWords>[number];
export const suggestionOutput = z
  .object({
    suggestions: z
      .array(
        z
          .object({
            quote: z.string().min(10).max(600),
            caption: z.string().max(180),
            rationale: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();
export const tokens = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || [];
// Unique contiguous word matches only. An answer quote alone never establishes its spoken time.
export function alignQuote(
  quote: string,
  words: TimedWord[],
  durationMs: number,
) {
  const q = tokens(quote),
    w = words.flatMap((v) =>
      tokens(v.word).map((text) => ({ text, start: v.start, end: v.end })),
    );
  if (q.length < 3) return null;
  const matches: number[] = [];
  for (let i = 0; i <= w.length - q.length; i++)
    if (q.every((v, k) => v === w[i + k].text)) matches.push(i);
  if (matches.length !== 1) return null;
  const at = matches[0],
    startMs = Math.max(0, Math.floor(w[at].start * 1000) - 150),
    endMs = Math.min(
      durationMs,
      Math.ceil(w[at + q.length - 1].end * 1000) + 200,
    );
  if (endMs - startMs < 100 || endMs - startMs > 30000) return null;
  return { startMs, endMs };
}
