"use client";
import { useEffect, useState, useRef } from "react";
import { api } from "@/lib/client";
import type { HBSummary } from "@/lib/maxdiff-hierarchical";
import { Notice } from "./components";
type Estimate = {
  id: string;
  text: string;
  score: HBSummary;
  utility?: HBSummary;
};
type Model = {
  method: string;
  signature: string;
  sourceFingerprint: string;
  diagnostics: {
    ready: boolean;
    maxRhat: number | null;
    minESS: number;
    chains: number;
    draws: number;
    reason: string | null;
    acceptance: number[];
  };
  items: Estimate[];
  individual: { interviewId: string; items: Estimate[] }[];
  portfolio: {
    candidateCount: number;
    size: number;
    top: number;
    candidates: {
      items: { id: string; text: string }[];
      coverage: number;
      low: number;
      high: number;
    }[];
  } | null;
};
export default function MaxdiffHierarchicalPanel({
  root,
  query,
  scope,
  respondents,
  items,
  tasks,
  inspect,
}: {
  root: string;
  query: string;
  scope: {
    revisionId: string;
    questionId: string;
    conceptId: string | null;
    sourceFingerprint: string;
  };
  respondents: number;
  items: number;
  tasks: number;
  inspect: (id: string) => void;
}) {
  const [size, setSize] = useState(2),
    [top, setTop] = useState(1),
    [model, setModel] = useState<Model | null>(null),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setBusy(false);
    setModel(null);
    setReviewed(false);
    setError("");
    return () => {
      generation.current++;
    };
  }, [scope.sourceFingerprint, query]);
  const bounded =
    respondents >= 10 && respondents <= 100 && items <= 8 && tasks <= 1600;
  async function fit() {
    const g = generation.current;
    setBusy(true);
    setError("");
    setModel(null);
    setReviewed(false);
    try {
      const result = (
        await api(root + "/hierarchical" + query, "POST", {
          ...scope,
          portfolioSize: size,
          topItems: top,
        })
      ).model;
      if (g === generation.current) setModel(result);
    } catch (e) {
      if (g === generation.current) setError((e as Error).message);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  async function download(format: "summary" | "individual" | "portfolio") {
    if (!model) return;
    const g = generation.current;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/" + root + "/hierarchical/export" + query,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...scope,
            portfolioSize: size,
            topItems: top,
            signature: model.signature,
            reviewed,
            format,
          }),
        },
      );
      if (!response.ok) {
        const r = await response.json();
        throw Error(r.error || "Model export unavailable.");
      }
      const blob = await response.blob();
      if (g !== generation.current) return;
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `maxdiff-hierarchical-${format}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (g === generation.current) {
        setError((e as Error).message);
        setModel(null);
        setReviewed(false);
      }
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  const bounds = (s: HBSummary) =>
    `${s.mean.toFixed(1)} (${s.low.toFixed(1)}–${s.high.toFixed(1)})`;
  return (
    <section
      className="panel visual-stack"
      aria-label="Hierarchical MaxDiff and portfolios"
    >
      <h4>Hierarchical Bayesian model · experimental</h4>
      <p>
        Estimate individual preferences with partial pooling under an isotropic
        normal hierarchy. Four sampling chains provide posterior ranges and
        diagnostics. Relative preference scores sum to 100 within this item
        list. Human method validation remains pending.
      </p>
      <p className="small">
        Supported: 10–100 complete respondents, 4–8 items and up to 1,600 tasks.
        Split/folded R-hat must be ≤ 1.10 and effective sample sizes ≥ 50;
        unresolved autocorrelation withholds estimates.
      </p>
      <fieldset disabled={busy} className="mixed-grid">
        <label>
          Portfolio size
          <select
            aria-label="Portfolio size"
            value={size}
            onChange={(e) => {
              setSize(Number(e.target.value));
              setModel(null);
              setReviewed(false);
            }}
          >
            {Array.from(
              { length: Math.min(4, items - 1) },
              (_, k) => k + 1,
            ).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label>
          Top items per respondent
          <select
            aria-label="Top items per respondent"
            value={top}
            onChange={(e) => {
              setTop(Number(e.target.value));
              setModel(null);
              setReviewed(false);
            }}
          >
            {Array.from(
              { length: Math.min(3, items - 1) },
              (_, k) => k + 1,
            ).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
      </fieldset>
      <button disabled={busy || !bounded} onClick={() => void fit()}>
        {busy ? "Sampling…" : "Fit hierarchical model and portfolios"}
      </button>
      {error && <Notice>{error}</Notice>}
      {model && (
        <>
          <p role="status">
            Max split/folded R-hat:{" "}
            {model.diagnostics.maxRhat?.toFixed(3) || "unavailable"} · Min ESS:{" "}
            {model.diagnostics.minESS.toFixed(0)} · {model.diagnostics.chains}{" "}
            chains × {model.diagnostics.draws} draws
          </p>
          {!model.diagnostics.ready ? (
            <Notice>{model.diagnostics.reason}</Notice>
          ) : (
            <>
              <h4>
                Average respondent preference score · mean (95% posterior range)
              </h4>
              <ul>
                {model.items.map((i) => (
                  <li key={i.id}>
                    {i.text}: {bounds(i.score)}
                  </li>
                ))}
              </ul>
              <h4>Portfolio preference coverage</h4>
              <p>
                The objective is the posterior expected percentage of these
                respondents whose top {top} preferences include at least one
                selected item. Every supported combination is evaluated. This
                measures sample preference coverage; it does not estimate market
                reach or purchase probability. Ranges describe posterior
                uncertainty and do not establish ranking differences.
              </p>
              <p>{model.portfolio?.candidateCount} combinations evaluated</p>
              <ol>
                {model.portfolio?.candidates.slice(0, 10).map((c, k) => (
                  <li key={k}>
                    {c.items.map((i) => i.text).join(" + ")}:{" "}
                    {c.coverage.toFixed(1)}% ({c.low.toFixed(1)}–
                    {c.high.toFixed(1)}%)
                  </li>
                ))}
              </ol>
              <details>
                <summary>
                  Respondent-level estimates and original sources
                </summary>
                {model.individual.map((p) => (
                  <article className="panel" key={p.interviewId}>
                    <button onClick={() => inspect(p.interviewId)}>
                      Inspect source {p.interviewId.slice(0, 8)}
                    </button>
                    <ul>
                      {p.items.map((i) => (
                        <li key={i.id}>
                          {i.text}: {bounds(i.score)}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </details>
              <label>
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={busy}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                I reviewed the model diagnostics, scope, assumptions and
                portfolio objective.
              </label>
              <div className="inline">
                {(["summary", "individual", "portfolio"] as const).map((f) => (
                  <button
                    key={f}
                    disabled={busy || !reviewed}
                    onClick={() => void download(f)}
                  >
                    Export hierarchical {f} CSV
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
