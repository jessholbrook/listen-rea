export const modelVersion = "pooled-joint-bw-logit-v1";
export const ridge = 1;
export type ModelChoice = { set: number[]; best: number; worst: number };
type Block = { set: number[]; count: number };
function aggregate(rows: ModelChoice[], n: number) {
  const observed = Array(n).fill(0) as number[],
    groups = new Map<string, Block>();
  for (const row of rows) {
    const set = [...row.set].sort((a, b) => a - b);
    if (
      set.length < 3 ||
      new Set(set).size !== set.length ||
      set.some((v) => !Number.isInteger(v) || v < 0 || v >= n) ||
      row.best === row.worst ||
      !set.includes(row.best) ||
      !set.includes(row.worst)
    )
      throw new Error("MAXDIFF_MODEL_INPUT");
    const key = set.join(",");
    if (!groups.has(key)) groups.set(key, { set, count: 0 });
    groups.get(key)!.count++;
    observed[row.best]++;
    observed[row.worst]--;
  }
  return { observed, blocks: [...groups.values()] };
}
function evaluate(
  u: number[],
  observed: number[],
  blocks: Block[],
  derivatives: boolean,
) {
  const n = u.length,
    g = u.map((v) => ridge * v),
    h = Array.from({ length: n }, (_, a) =>
      Array.from({ length: n }, (_, b) => (a === b ? ridge : 0)),
    );
  let loss = u.reduce(
    (s, v, a) => s + 0.5 * ridge * v * v - v * observed[a],
    0,
  );
  for (const { set, count } of blocks) {
    const terms: { a: number; b: number; v: number }[] = [];
    let max = -Infinity;
    for (const a of set)
      for (const b of set)
        if (a !== b) {
          const v = u[a] - u[b];
          terms.push({ a, b, v });
          max = Math.max(max, v);
        }
    const denom = terms.reduce((s, t) => s + Math.exp(t.v - max), 0);
    loss += count * (max + Math.log(denom));
    if (!derivatives) continue;
    const mean = Array(n).fill(0) as number[];
    for (const { a, b, v } of terms) {
      const p = Math.exp(v - max) / denom;
      mean[a] += p;
      mean[b] -= p;
      h[a][a] += count * p;
      h[b][b] += count * p;
      h[a][b] -= count * p;
      h[b][a] -= count * p;
    }
    for (const a of set) {
      g[a] += count * mean[a];
      for (const b of set) h[a][b] -= count * mean[a] * mean[b];
    }
  }
  for (let a = 0; a < n; a++) g[a] -= observed[a];
  return { loss, gradient: g, hessian: h };
}
export function modelObjective(u: number[], rows: ModelChoice[]) {
  const a = aggregate(rows, u.length);
  return evaluate(u, a.observed, a.blocks, true);
}
function solve(matrix: number[][], rhs: number[]) {
  const a = matrix.map((row, n) => [...row, rhs[n]]),
    n = rhs.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    if (Math.abs(a[c][c]) < 1e-12) throw new Error("MAXDIFF_SINGULAR");
    const scale = a[c][c];
    for (let b = c; b <= n; b++) a[c][b] /= scale;
    for (let r = 0; r < n; r++)
      if (r !== c) {
        const factor = a[r][c];
        for (let b = c; b <= n; b++) a[r][b] -= factor * a[c][b];
      }
  }
  return a.map((row) => row[n]);
}
export const shares = (u: number[]) => {
  const max = Math.max(...u),
    v = u.map((x) => Math.exp(x - max)),
    sum = v.reduce((a, b) => a + b, 0);
  return v.map((x) => (100 * x) / sum);
};
export function fitMaxdiff(rows: ModelChoice[], n: number) {
  if (n < 4 || n > 12 || !rows.length) throw new Error("MAXDIFF_MODEL_INPUT");
  const a = aggregate(rows, n);
  let u = Array(n).fill(0) as number[],
    iteration = 0,
    converged = false;
  for (; iteration < 50; iteration++) {
    const e = evaluate(u, a.observed, a.blocks, true);
    if (Math.max(...e.gradient.map(Math.abs)) < 1e-7) {
      converged = true;
      break;
    }
    const step = solve(e.hessian, e.gradient),
      slope = e.gradient.reduce((s, v, k) => s + v * step[k], 0);
    let rate = 1,
      accepted = false;
    for (let b = 0; b < 30; b++) {
      const next = u.map((v, k) => v - rate * step[k]);
      if (
        evaluate(next, a.observed, a.blocks, false).loss <=
        e.loss - 1e-4 * rate * slope
      ) {
        u = next;
        accepted = true;
        break;
      }
      rate /= 2;
    }
    if (!accepted) break;
  }
  const gradient = Math.max(
    ...evaluate(u, a.observed, a.blocks, true).gradient.map(Math.abs),
  );
  if (gradient < 1e-6) converged = true;
  return {
    utilities: u,
    scores: shares(u),
    converged,
    iterations: iteration,
    gradient,
    loss: evaluate(u, a.observed, a.blocks, false).loss,
  };
}
export function seeded(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (1664525 * x + 1013904223) >>> 0;
    return x / 4294967296;
  };
}
export function seedFor(text: string) {
  let s = 2166136261;
  for (let n = 0; n < text.length; n++)
    s = Math.imul(s ^ text.charCodeAt(n), 16777619);
  return s >>> 0;
}
export function bootstrapMaxdiff(
  respondents: ModelChoice[][],
  n: number,
  seed: number,
  reps = 100,
) {
  if (
    respondents.length < 10 ||
    new Set(respondents.map((r) => JSON.stringify(r))).size < 3
  )
    return {
      intervals: null,
      requested: reps,
      completed: 0,
      reason:
        "At least 10 complete respondents and 3 distinct response patterns are required.",
    };
  const random = seeded(seed),
    samples: number[][] = [];
  for (let r = 0; r < reps; r++) {
    const rows = Array.from(
        { length: respondents.length },
        () => respondents[Math.floor(random() * respondents.length)],
      ).flat(),
      fit = fitMaxdiff(rows, n);
    if (fit.converged) samples.push(fit.scores);
  }
  if (samples.length < reps * 0.95)
    return {
      intervals: null,
      requested: reps,
      completed: samples.length,
      reason: "Too few bootstrap fits converged.",
    };
  const quantile = (v: number[], p: number) => {
    const sorted = [...v].sort((a, b) => a - b),
      at = (sorted.length - 1) * p,
      lo = Math.floor(at),
      f = at - lo;
    return (
      sorted[lo] * (1 - f) + sorted[Math.min(lo + 1, sorted.length - 1)] * f
    );
  };
  return {
    intervals: Array.from({ length: n }, (_, k) => ({
      low: quantile(
        samples.map((s) => s[k]),
        0.025,
      ),
      high: quantile(
        samples.map((s) => s[k]),
        0.975,
      ),
    })),
    requested: reps,
    completed: samples.length,
    reason: null,
  };
}
