import { z } from "zod";
import type { Interview, Question, Turn } from "./domain";
export const maxdiffVersion = "cyclic-balanced-v1";
export const maxdiffSchema = z
  .object({
    items: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          text: z.string().trim().min(1).max(500),
          imageAssetId: z.uuid().nullable().optional(),
          imageAlt: z.string().trim().max(500).optional(),
        }),
      )
      .min(4)
      .max(12),
    setSize: z.number().int().min(3).max(5),
    cycles: z.number().int().min(1).max(2).default(1),
  })
  .superRefine((c, ctx) => {
    c.items.forEach((item, n) => {
      if (item.imageAssetId && !item.imageAlt?.trim())
        ctx.addIssue({
          code: "custom",
          message: "Every MaxDiff image needs a text description.",
          path: ["items", n, "imageAlt"],
        });
    });
    if (c.setSize >= c.items.length)
      ctx.addIssue({
        code: "custom",
        message: "Show fewer items per task than the full item list.",
      });
    if (
      new Set(c.items.map((i) => i.id)).size !== c.items.length ||
      new Set(c.items.map((i) => i.text.toLowerCase())).size !== c.items.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Use unique item IDs and distinct labels.",
      });
  });
export type MaxdiffConfig = z.infer<typeof maxdiffSchema>;
export type MaxdiffChoice = { best: string; worst: string };
export type MaxdiffState = {
  version: string;
  tasks: string[][];
  choices: MaxdiffChoice[];
};
export type MaxdiffPrompt = {
  task: number;
  total: number;
  items: MaxdiffConfig["items"];
};
export function designDiagnostics(tasks: number[][], n: number) {
  const exposures = Array(n).fill(0) as number[],
    pairs = Array.from({ length: n }, () => Array(n).fill(0) as number[]);
  for (const task of tasks) {
    for (const a of task) exposures[a]++;
    for (const a of task) for (const b of task) if (a !== b) pairs[a][b]++;
  }
  const seen = new Set([0]),
    queue = [0];
  while (queue.length) {
    const a = queue.shift()!;
    for (let b = 0; b < n; b++)
      if (pairs[a][b] && !seen.has(b)) {
        seen.add(b);
        queue.push(b);
      }
  }
  const counts = pairs.flatMap((row, a) => row.slice(a + 1));
  return {
    exposures,
    pairs,
    pairMin: Math.min(...counts),
    pairMax: Math.max(...counts),
    connected: seen.size === n,
  };
}
const designs = new Map<string, number[][]>();
export function maxdiffDesign(n: number, k: number, cycles = 1) {
  if (
    !Number.isInteger(n) ||
    n < 4 ||
    n > 12 ||
    !Number.isInteger(k) ||
    k < 3 ||
    k > 5 ||
    k >= n ||
    ![1, 2].includes(cycles)
  )
    throw new Error("MAXDIFF_DESIGN");
  const key = `${n}:${k}:${cycles}`;
  if (designs.has(key)) return structuredClone(designs.get(key)!);
  let best: number[][] = [],
    score = Infinity;
  function choose(base: number[], next: number) {
    if (base.length === k) {
      const tasks = Array.from({ length: n }, (_, r) =>
        base.map((v) => (v + r) % n),
      );
      const d = designDiagnostics(tasks, n);
      if (!d.connected) return;
      const values = d.pairs.flatMap((row, a) => row.slice(a + 1));
      const loss = values.reduce((s, v) => s + v * v, 0);
      if (loss < score) {
        score = loss;
        best = tasks;
      }
      return;
    }
    for (let x = next; x < n; x++) choose([...base, x], x + 1);
  }
  choose([0], 1);
  if (!best.length) throw new Error("MAXDIFF_DESIGN");
  const result = Array.from({ length: cycles }, () => best).flat();
  designs.set(key, structuredClone(result));
  return structuredClone(result);
}
function shuffle<T>(values: T[], pick: (n: number) => number) {
  const out = [...values];
  for (let a = out.length - 1; a > 0; a--) {
    const b = pick(a + 1);
    [out[a], out[b]] = [out[b], out[a]];
  }
  return out;
}
export const maxdiffState = (i: Interview, q: Question) =>
  Object.hasOwn(i.maxdiffStates || {}, q.id)
    ? i.maxdiffStates![q.id]
    : undefined;
export const maxdiffCopy = (language: Interview["language"]) =>
  ({
    en: {
      best: "Most important",
      worst: "Least important",
      choose: "Choose one most important and one least important item.",
      task: "Choice task",
    },
    es: {
      best: "Más importante",
      worst: "Menos importante",
      choose: "Elige un elemento más importante y otro menos importante.",
      task: "Tarea de elección",
    },
    fr: {
      best: "Le plus important",
      worst: "Le moins important",
      choose:
        "Choisissez un élément le plus important et un autre le moins important.",
      task: "Choix",
    },
  })[language || "en"];
export function maxdiffPrompt(
  i: Interview,
  q: Question,
): MaxdiffPrompt | undefined {
  const s = maxdiffState(i, q),
    c = q.maxdiff,
    task = s?.tasks[s.choices.length];
  return s && c && task
    ? {
        task: s.choices.length + 1,
        total: s.tasks.length,
        items: task.map((id) => ({
          ...c.items.find((item) => item.id === id)!,
        })),
      }
    : undefined;
}
export function maxdiffText(i: Interview, q: Question) {
  const p = maxdiffPrompt(i, q),
    copy = maxdiffCopy(i.language);
  return p
    ? `${q.text}\n\n${copy.task} ${p.task}/${p.total}. ${copy.choose}`
    : q.text;
}
export function beginMaxdiff(
  i: Interview,
  q: Question,
  pick: (n: number) => number,
) {
  if (!q.maxdiff) return;
  i.maxdiffStates ||= {};
  if (!Object.hasOwn(i.maxdiffStates, q.id)) {
    const mapping = shuffle(
      q.maxdiff.items.map((o) => o.id),
      pick,
    );
    const tasks = shuffle(
      maxdiffDesign(mapping.length, q.maxdiff.setSize, q.maxdiff.cycles).map(
        (task) =>
          shuffle(
            task.map((n) => mapping[n]),
            pick,
          ),
      ),
      pick,
    );
    Object.defineProperty(i.maxdiffStates, q.id, {
      enumerable: true,
      writable: true,
      configurable: true,
      value: { version: maxdiffVersion, tasks, choices: [] },
    });
  }
  i.prompt = maxdiffText(i, q);
}
export function maxdiffInput(i: Interview, q: Question, value: unknown) {
  const choice = z
      .object({ best: z.string(), worst: z.string() })
      .safeParse(value),
    p = maxdiffPrompt(i, q);
  if (
    !choice.success ||
    !p ||
    choice.data.best === choice.data.worst ||
    ![choice.data.best, choice.data.worst].every((id) =>
      p.items.some((item) => item.id === id),
    )
  )
    throw new Error("INVALID_STRUCTURED_ANSWER");
  return choice.data;
}
export function applyMaxdiff(
  i: Interview,
  q: Question,
  value: unknown,
): Pick<Turn, "answer" | "maxdiff"> {
  const choice = maxdiffInput(i, q, value),
    p = maxdiffPrompt(i, q)!,
    s = maxdiffState(i, q)!,
    copy = maxdiffCopy(i.language);
  s.choices.push(choice);
  i.prompt = maxdiffText(i, q);
  return {
    answer: `${copy.best}: ${p.items.find((x) => x.id === choice.best)!.text}\n${copy.worst}: ${p.items.find((x) => x.id === choice.worst)!.text}`,
    maxdiff: { task: p.task, shown: p.items.map((o) => o.id), ...choice },
  };
}
