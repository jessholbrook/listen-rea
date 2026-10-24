"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { money, type pricingResults } from "@/lib/pricing";
import type { Interview } from "@/lib/domain";
import { Modal, Spinner } from "./components";
type Results = ReturnType<typeof pricingResults>;
function Curve({
  points,
  currency,
  revenue = false,
}: {
  points: Results[number]["points"];
  currency: string;
  revenue?: boolean;
}) {
  const values = points.map((p) =>
      revenue ? p.revenuePerRespondentMinor || 0 : (p.demand || 0) * 100,
    ),
    max = revenue ? Math.max(1, ...values) : 100;
  const x = (n: number) =>
      55 +
      ((points[n].priceMinor - points[0].priceMinor) /
        (points.at(-1)!.priceMinor - points[0].priceMinor)) *
        590,
    y = (v: number) => 205 - (v / max) * 160;
  return (
    <figure className="pricing-curve">
      <figcaption>
        {revenue
          ? "Expected gross revenue per respondent"
          : "Stated demand (%)"}
      </figcaption>
      <svg
        viewBox="0 0 700 260"
        role="img"
        aria-label={revenue ? "Revenue curve" : "Demand curve"}
      >
        <title>
          {revenue
            ? "Price times stated demand; not a sales forecast"
            : "Percentage willing to buy, including nonbuyers in the denominator"}
        </title>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1="55"
              x2="645"
              y1={y(max * f)}
              y2={y(max * f)}
              stroke="#dce2db"
            />
            <text x="48" y={y(max * f) + 4} textAnchor="end">
              {revenue ? money(max * f, currency) : Math.round(max * f) + "%"}
            </text>
          </g>
        ))}
        <polyline
          points={values.map((v, n) => `${x(n)},${y(v)}`).join(" ")}
          fill="none"
          stroke={revenue ? "#4d6e99" : "#4b6b52"}
          strokeWidth="3"
        />
        {values.map((v, n) => (
          <g key={n}>
            <circle
              cx={x(n)}
              cy={y(v)}
              r="5"
              fill={revenue ? "#4d6e99" : "#4b6b52"}
            >
              <title>
                {money(points[n].priceMinor, currency)}:{" "}
                {revenue ? money(v, currency) : v.toFixed(1) + "%"}
              </title>
            </circle>
            {(points.length <= 6 || n === 0 || n === points.length - 1) && (
              <text x={x(n)} y="232" textAnchor="middle">
                {money(points[n].priceMinor, currency)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </figure>
  );
}
export default function PricingPanel({
  studyId,
  dataVersion,
}: {
  studyId: string;
  dataVersion: number;
}) {
  const [results, setResults] = useState<Results | null>(null),
    [error, setError] = useState(""),
    [attribute, setAttribute] = useState(""),
    [value, setValue] = useState(""),
    [query, setQuery] = useState(""),
    [source, setSource] = useState<{
      interview: Interview;
      turnIds: string[];
    } | null>(null),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const root = `studies/${studyId}/pricing`;
  useEffect(() => {
    let active = true;
    setResults(null);
    api(root + query)
      .then((r) => {
        if (active) {
          setResults(r.results);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [studyId, dataVersion, query, refresh]);
  async function open(o: Results[number]["outcomes"][number]) {
    setBusy(true);
    setError("");
    try {
      const detail = await api(`studies/${studyId}`);
      const interview = detail.interviews.find(
        (i: Interview) => i.id === o.interviewId && !i.excluded && !i.preview,
      );
      if (!interview)
        throw new Error(
          "This source is no longer available. Refresh pricing results.",
        );
      setSource({ interview, turnIds: o.turnIds });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="visual-stack">
      <section className="panel visual-stack">
        <div className="panel-heading">
          <h2>Gabor–Granger pricing</h2>
          <button className="button" onClick={() => setRefresh((n) => n + 1)}>
            Refresh pricing results
          </button>
        </div>
        <p>
          Demand and revenue describe stated purchase intentions for the tested
          prices. Nonbuyers stay in the denominator; incomplete and inconsistent
          ladders are separate. Results keep each published revision and concept
          separate.
        </p>
        <p className="small muted">
          Revenue is price × stated demand per included respondent. It excludes
          costs, competitive effects, market size and actual conversion. Higher
          accepted prices imply acceptance of lower unasked prices; the table
          separates observed and inferred responses.
        </p>
        <form
          className="mixed-grid"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(
              attribute
                ? "?" + new URLSearchParams({ attribute, value }).toString()
                : "",
            );
          }}
        >
          <label>
            Segment attribute
            <input
              value={attribute}
              maxLength={100}
              onChange={(e) => setAttribute(e.target.value)}
            />
          </label>
          <label>
            Exact segment value
            <input
              value={value}
              maxLength={500}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <button className="button" type="submit">
            Apply pricing segment
          </button>
        </form>
        <p className="small">
          {query
            ? `Filtered: ${new URLSearchParams(query).get("attribute")} = ${new URLSearchParams(query).get("value")}`
            : "All included participants"}
        </p>
        <div className="panel-actions">
          <a
            className="button"
            href={`/api/${root}/export${query ? query + "&" : "?"}kind=curves`}
            download
          >
            Export pricing curves CSV
          </a>
          <a
            className="button"
            href={`/api/${root}/export${query ? query + "&" : "?"}kind=responses`}
            download
          >
            Export pricing responses CSV
          </a>
        </div>
      </section>
      {error && <p role="alert">{error}</p>}
      {!results && !error && <Spinner />}
      {results?.length === 0 && (
        <section className="panel">
          <p>
            No pricing responses match this view. Add a Gabor–Granger pricing
            question in Study design, publish it, and collect responses. Preview
            interviews do not enter these results.
          </p>
        </section>
      )}
      {results?.map((r) => (
        <section
          className="panel visual-stack"
          key={JSON.stringify([r.revisionId, r.questionId, r.conceptId])}
        >
          <h3>{r.prompt}</h3>
          <p className="small mono">
            Revision {r.revisionId} · Question {r.questionId}
            {r.conceptId && ` · Concept ${r.conceptId}`}
          </p>
          <p>
            {r.counts.denominator} included · {r.counts.nonbuyers} nonbuyers
            retained · {r.counts.inconsistent} inconsistent ·{" "}
            {r.counts.incomplete} incomplete · {r.counts.notAsked} not asked
          </p>
          {r.counts.denominator > 0 ? (
            <>
              <div className="pricing-charts">
                <Curve points={r.points} currency={r.config.currency} />
                <Curve points={r.points} currency={r.config.currency} revenue />
              </div>
              <p>
                <strong>
                  {r.revenueMaxPrices.length
                    ? `Revenue-maximizing tested prices: ${r.revenueMaxPrices.map((p) => money(p, r.config.currency)).join(", ")} ${r.config.unit}${r.revenueMaxPrices.length > 1 ? " (tie)" : ""}`
                    : "No positive stated demand at any tested price."}
                </strong>
              </p>
              <p className="small muted">
                {r.counts.aboveRange} accepted the highest tested price; their
                maximum willingness may be above this range. No interpolation or
                out-of-range optimum is estimated.
              </p>
            </>
          ) : (
            <p>No completed, consistent ladders to calculate a curve.</p>
          )}
          <div className="pricing-table">
            <table>
              <caption>
                Tested prices · {r.config.currency} · {r.config.unit}
              </caption>
              <thead>
                <tr>
                  <th>Price</th>
                  <th>Willing / included</th>
                  <th>Demand</th>
                  <th>Revenue / respondent</th>
                  <th>Observed yes / no</th>
                  <th>Inferred yes / no</th>
                </tr>
              </thead>
              <tbody>
                {r.points.map((p) => (
                  <tr key={p.priceMinor}>
                    <th>{money(p.priceMinor, r.config.currency)}</th>
                    <td>
                      {p.buyers} / {p.denominator}
                    </td>
                    <td>
                      {p.demand === null
                        ? "—"
                        : (p.demand * 100).toFixed(1) + "%"}
                    </td>
                    <td>
                      {p.revenuePerRespondentMinor === null
                        ? "—"
                        : money(p.revenuePerRespondentMinor, r.config.currency)}
                    </td>
                    <td>
                      {p.observedYes} / {p.observedNo}
                    </td>
                    <td>
                      {p.inferredYes} / {p.inferredNo}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>
              Inspect {r.outcomes.length} response outcomes and reasons
            </summary>
            <div className="visual-stack">
              {r.outcomes.map((o) => (
                <article className="visual-observation" key={o.interviewId}>
                  <span className="badge">{o.status.replaceAll("_", " ")}</span>
                  <p className="small mono">Response {o.interviewId}</p>
                  {o.status === "buyer" && (
                    <p>
                      Highest accepted tested price:{" "}
                      {money(o.highestMinor!, r.config.currency)}{" "}
                      {r.config.unit}
                      {o.aboveRange ? " · top of tested range" : ""}
                    </p>
                  )}
                  {o.reason && <blockquote>{o.reason}</blockquote>}
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => open(o)}
                  >
                    Inspect pricing source
                  </button>
                </article>
              ))}
            </div>
          </details>
        </section>
      ))}
      {source && (
        <Modal title="Pricing source" onClose={() => setSource(null)}>
          <p className="small mono">
            Response {source.interview.id} · Revision{" "}
            {source.interview.revisionId}
          </p>
          {source.interview.turns
            .filter((t) => source.turnIds.includes(t.id))
            .map((t) => (
              <article key={t.id}>
                <p className="small mono">
                  Turn {t.id} · {t.pricing?.phase}
                </p>
                <h3>{t.prompt}</h3>
                <blockquote>{t.answer}</blockquote>
              </article>
            ))}
          {!source.turnIds.length && (
            <p>This pricing question was not answered.</p>
          )}
        </Modal>
      )}
    </div>
  );
}
