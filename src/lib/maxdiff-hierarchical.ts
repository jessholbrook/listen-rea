import { fitMaxdiff, seeded, shares, type ModelChoice } from "./maxdiff-model";
export const hierarchicalVersion = "hierarchical-isotropic-joint-bw-v1";
export const hbPrior = { shape: 2, scale: 1, kappa: 0.1 };
export function helmert(n: number) {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n - 1 }, (_, j) =>
      i <= j
        ? 1 / Math.sqrt((j + 1) * (j + 2))
        : i === j + 1
          ? -(j + 1) / Math.sqrt((j + 1) * (j + 2))
          : 0,
    ),
  );
}
export function contrastUtilities(beta: number[], basis: number[][]) {
  return basis.map((row) => row.reduce((s, v, k) => s + v * beta[k], 0));
}
export function jointLogLikelihood(u: number[], rows: ModelChoice[]) {
  let log = 0;
  for (const row of rows) {
    const terms: number[] = [];
    for (const a of row.set)
      for (const b of row.set) if (a !== b) terms.push(u[a] - u[b]);
    const max = Math.max(...terms);
    log +=
      u[row.best] -
      u[row.worst] -
      max -
      Math.log(terms.reduce((s, v) => s + Math.exp(v - max), 0));
  }
  return log;
}
export function normalDraw(random: () => number) {
  return (
    Math.sqrt(-2 * Math.log(Math.max(1e-15, random()))) *
    Math.cos(2 * Math.PI * random())
  );
}
export function gammaDraw(shape: number, random: () => number): number {
  if (!(shape > 0)) throw Error("HB_SHAPE");
  if (shape < 1)
    return (
      gammaDraw(shape + 1, random) * Math.max(1e-15, random()) ** (1 / shape)
    );
  const d = shape - 1 / 3,
    c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = normalDraw(random),
      v0 = 1 + c * x;
    if (v0 <= 0) continue;
    const v = v0 ** 3,
      u = random();
    if (
      u < 1 - 0.0331 * x ** 4 ||
      Math.log(Math.max(u, 1e-15)) < 0.5 * x * x + d * (1 - v + Math.log(v))
    )
      return d * v;
  }
}
export function hyperConditional(beta: number[][]) {
  const n = beta.length,
    d = beta[0].length,
    mean = Array.from(
      { length: d },
      (_, k) => beta.reduce((s, r) => s + r[k], 0) / n,
    );
  const sum = beta.reduce(
    (s, r) => s + r.reduce((t, v, k) => t + (v - mean[k]) ** 2, 0),
    0,
  );
  return {
    shape: hbPrior.shape + (n * d) / 2,
    scale:
      hbPrior.scale +
      0.5 * sum +
      ((0.5 * hbPrior.kappa * n) / (hbPrior.kappa + n)) *
        mean.reduce((s, v) => s + v * v, 0),
    mean: mean.map((v) => (n * v) / (n + hbPrior.kappa)),
    meanPrecision: n + hbPrior.kappa,
  };
}
export function quantile(v: number[], p: number) {
  const s = [...v].sort((a, b) => a - b),
    x = (s.length - 1) * p,
    k = Math.floor(x);
  return s[k] + (s[Math.min(k + 1, s.length - 1)] - s[k]) * (x - k);
}
const average = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
export function chainDiagnostics(chains: number[][]) {
  const n = Math.floor(chains[0].length / 2),
    split = chains.flatMap((c) => [c.slice(0, n), c.slice(c.length - n)]),
    m = split.length;
  const means = split.map(average),
    mean = average(means),
    vars = split.map(
      (s, k) => s.reduce((a, v) => a + (v - means[k]) ** 2, 0) / (n - 1),
    );
  const w = average(vars),
    b = (n * means.reduce((s, v) => s + (v - mean) ** 2, 0)) / (m - 1),
    v = ((n - 1) / n) * w + b / n;
  if (!Number.isFinite(v) || v <= 0 || w <= 0)
    return { rhat: Infinity, ess: 0, truncated: true };
  let sum = 0,
    previous = Infinity,
    stopped = false;
  function rho(lag: number) {
    const cov = average(
      split.map((s, k) => {
        let total = 0;
        for (let t = 0; t < n - lag; t++)
          total += (s[t] - means[k]) * (s[t + lag] - means[k]);
        return total / n;
      }),
    );
    return 1 - (w - cov) / v;
  }
  for (let lag = 1; lag < Math.min(1000, n - 2); lag += 2) {
    const pair = rho(lag) + rho(lag + 1);
    if (pair < 0) {
      stopped = true;
      break;
    }
    const monotone = Math.min(previous, pair);
    sum += monotone;
    previous = monotone;
  }
  return {
    rhat: Math.max(1, Math.sqrt(v / w)),
    ess: Math.min(m * n, (m * n) / (1 + 2 * sum)),
    truncated: !stopped,
  };
}
function combinations(n: number, k: number) {
  const out: number[][] = [];
  function add(start: number, v: number[]) {
    if (v.length === k) {
      out.push(v);
      return;
    }
    for (let j = start; j < n; j++) add(j + 1, [...v, j]);
  }
  add(0, []);
  return out;
}
export function portfolioCoverage(
  topMasks: Uint16Array[],
  n: number,
  size: number,
  respondents: number,
) {
  if (!Number.isInteger(size) || size < 1 || size > Math.min(4, n - 1))
    throw Error("HB_PORTFOLIO_SIZE");
  const candidates = combinations(n, size).map((items) => {
    const mask = items.reduce((v, k) => v | (1 << k), 0),
      draws = topMasks.map(
        (v) =>
          (100 * Array.from(v).filter((x) => x & mask).length) / respondents,
      );
    return {
      items,
      coverage: average(draws),
      low: quantile(draws, 0.025),
      high: quantile(draws, 0.975),
    };
  });
  candidates.sort(
    (a, b) =>
      b.coverage - a.coverage ||
      a.items.join(",").localeCompare(b.items.join(",")),
  );
  return { candidateCount: candidates.length, candidates };
}
export type HBSummary = { mean: number; low: number; high: number };
export function fitHierarchical(
  respondents: ModelChoice[][],
  n: number,
  seed: number,
  portfolio: { size: number; top: number },
  options: {
    chains?: number;
    warmup?: number;
    draws?: number;
    budgetMs?: number;
  } = {},
) {
  const chains = options.chains ?? 4,
    warmup = options.warmup ?? 1000,
    draws = options.draws ?? 2000,
    budget = options.budgetMs ?? 45000,
    start = performance.now();
  if (
    n < 4 ||
    n > 8 ||
    respondents.length < 10 ||
    respondents.length > 100 ||
    respondents.flat().length > 1600 ||
    respondents.some(
      (r) => !r.length || new Set(r.flatMap((t) => t.set)).size !== n,
    )
  )
    throw Error("HB_BOUNDS");
  if (
    !Number.isInteger(portfolio.top) ||
    portfolio.top < 1 ||
    portfolio.top > Math.min(3, n - 1)
  )
    throw Error("HB_PORTFOLIO_TOP");
  if (chains < 2 || draws < 100 || warmup < 50)
    throw Error("HB_SAMPLING_SETTINGS");
  portfolioCoverage(
    [new Uint16Array(respondents.length).fill(1)],
    n,
    portfolio.size,
    respondents.length,
  );
  const validated = fitMaxdiff(respondents.flat(), n);
  if (!validated.converged) throw Error("HB_INITIAL_FIT");
  const basis = helmert(n),
    d = n - 1,
    count = respondents.length,
    parameters = d + 1 + count * d,
    samples: Float64Array[] = [];
  const acceptance: number[] = [];
  for (let chain = 0; chain < chains; chain++) {
    const random = seeded((seed + Math.imul(chain + 1, 2654435761)) >>> 0),
      buffer = new Float64Array(draws * parameters);
    let mu = Array.from({ length: d }, () => normalDraw(random)),
      variance = 0.5 + random();
    const beta = respondents.map(() => mu.map((v) => v + normalDraw(random))),
      step = respondents.map(() => 0.7 / Math.sqrt(d)),
      accepted = respondents.map(() => 0);
    let postAccepted = 0;
    let likelihood = beta.map((v, r) =>
      jointLogLikelihood(contrastUtilities(v, basis), respondents[r]),
    );
    for (let iteration = 0; iteration < warmup + draws; iteration++) {
      if (iteration % 25 === 0 && performance.now() - start > budget)
        throw Error("HB_TIME_BUDGET");
      for (let r = 0; r < count; r++) {
        const candidate = beta[r].map((v) => v + normalDraw(random) * step[r]),
          ll = jointLogLikelihood(
            contrastUtilities(candidate, basis),
            respondents[r],
          );
        const priorDiff =
          candidate.reduce(
            (s, v, k) => s - (v - mu[k]) ** 2 + (beta[r][k] - mu[k]) ** 2,
            0,
          ) /
          (2 * variance);
        if (
          Math.log(Math.max(1e-15, random())) <
          ll - likelihood[r] + priorDiff
        ) {
          beta[r] = candidate;
          likelihood[r] = ll;
          accepted[r]++;
          if (iteration >= warmup) postAccepted++;
        }
      }
      const h = hyperConditional(beta);
      variance = h.scale / gammaDraw(h.shape, random);
      mu = h.mean.map(
        (v) => v + Math.sqrt(variance / h.meanPrecision) * normalDraw(random),
      );
      if (iteration < warmup && (iteration + 1) % 50 === 0) {
        for (let r = 0; r < count; r++) {
          step[r] = Math.max(
            0.01,
            Math.min(3, step[r] * Math.exp(0.8 * (accepted[r] / 50 - 0.3))),
          );
          accepted[r] = 0;
        }
      }
      if (iteration >= warmup) {
        const offset = (iteration - warmup) * parameters;
        for (let k = 0; k < d; k++) buffer[offset + k] = mu[k];
        buffer[offset + d] = variance;
        for (let r = 0; r < count; r++)
          for (let k = 0; k < d; k++)
            buffer[offset + d + 1 + r * d + k] = beta[r][k];
      }
    }
    samples.push(buffer);
    acceptance.push(postAccepted / (draws * count));
  }
  let maxRhat = 1,
    minESS = Infinity,
    truncated = 0;
  for (let k = 0; k < parameters; k++) {
    if (performance.now() - start > budget) throw Error("HB_TIME_BUDGET");
    const values = samples.map((s) =>
      Array.from({ length: draws }, (_, t) => s[t * parameters + k]),
    );
    const diag = chainDiagnostics(values),
      median = quantile(values.flat(), 0.5),
      folded = chainDiagnostics(
        values.map((c) => c.map((v) => Math.abs(v - median))),
      );
    maxRhat = Math.max(maxRhat, diag.rhat, folded.rhat);
    minESS = Math.min(minESS, diag.ess);
    if (diag.truncated) truncated++;
  }
  const ready =
    Number.isFinite(maxRhat) &&
    maxRhat <= 1.1 &&
    minESS >= 50 &&
    truncated === 0;
  const diagnostics = {
    chains,
    warmup,
    draws,
    parameters,
    maxRhat: Number.isFinite(maxRhat) ? maxRhat : null,
    minESS: Number.isFinite(minESS) ? minESS : 0,
    truncated,
    acceptance,
    ready,
    reason: ready
      ? null
      : "Sampling diagnostics did not pass (split/folded R-hat ≤ 1.10, ESS ≥ 50, autocorrelation resolved within 1,000 lags). Scores and portfolio results are withheld.",
    elapsedMs: Math.round(performance.now() - start),
  };
  const totalDraws = chains * draws;
  const summary = (v: number[]): HBSummary => ({
    mean: average(v),
    low: quantile(v, 0.025),
    high: quantile(v, 0.975),
  });
  const individual: Array<{ utilities: HBSummary[]; scores: HBSummary[] }> = [],
    groupScores = Array.from(
      { length: n },
      () => Array(totalDraws).fill(0) as number[],
    ),
    topMasks = Array.from({ length: totalDraws }, () => new Uint16Array(count));
  if (ready)
    for (let r = 0; r < count; r++) {
      const utility = Array.from({ length: n }, () => [] as number[]),
        score = Array.from({ length: n }, () => [] as number[]);
      for (let chain = 0; chain < chains; chain++)
        for (let t = 0; t < draws; t++) {
          const offset = t * parameters + d + 1 + r * d,
            u = contrastUtilities(
              Array.from(samples[chain].subarray(offset, offset + d)),
              basis,
            ),
            s = shares(u),
            at = chain * draws + t;
          for (let k = 0; k < n; k++) {
            utility[k].push(u[k]);
            score[k].push(s[k]);
            groupScores[k][at] += s[k] / count;
          }
          const top = s
            .map((v, k) => ({ v, k }))
            .sort((a, b) => b.v - a.v || a.k - b.k)
            .slice(0, portfolio.top);
          topMasks[at][r] = top.reduce((mask, x) => mask | (1 << x.k), 0);
        }
      individual.push({
        utilities: utility.map(summary),
        scores: score.map(summary),
      });
    }
  return {
    method: hierarchicalVersion,
    prior: hbPrior,
    basis: "orthonormal Helmert sum-zero utilities",
    seed,
    diagnostics,
    individual,
    items: ready ? groupScores.map(summary) : [],
    portfolio: ready
      ? {
          ...portfolio,
          ...portfolioCoverage(topMasks, n, portfolio.size, count),
        }
      : null,
  };
}
