"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { quantitativeResults } from "@/lib/mixed";
type Results = ReturnType<typeof quantitativeResults>;
export default function MeasuresPanel({
  studyId,
  dataVersion,
}: {
  studyId: string;
  dataVersion: number;
}) {
  const [results, setResults] = useState<Results>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api("studies/" + studyId + "/measures")
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
  }, [studyId, dataVersion]);
  if (error) return <p role="alert">{error}</p>;
  if (!results.length) return null;
  const fmt = (n: number | null) =>
    n === null
      ? "—"
      : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
          n,
        );
  return (
    <section className="panel measures-panel">
      <span className="eyebrow">MEASURED RESPONSES</span>
      <h2>Ratings, rankings & selections</h2>
      <p className="muted">
        Completed, included interviews only. Each published revision is reported
        separately. Counts describe this sample.
      </p>
      {results.map((r) => (
        <article
          key={r.revisionId + ":" + r.questionId}
          className="measure-result"
        >
          {r.conceptName && <span className="badge">{r.conceptName}</span>}
          <h3>{r.prompt}</h3>
          <small>
            Revision {r.revisionId.slice(0, 8)} · {r.answered} answered ·{" "}
            {r.missing} missing after being shown · {r.notAsked} not asked ·{" "}
            {r.eligible} eligible
          </small>
          {r.type === "rating" ? (
            <>
              <p>
                <strong>{fmt(r.mean)}</strong> mean rating
              </p>
              <div className="measure-distribution">
                {r.distribution.map((d) => (
                  <div key={d.value}>
                    <span>{d.value}</span>
                    <progress
                      max={Math.max(r.answered, 1)}
                      value={d.count}
                      aria-label={
                        "Rating " + d.value + ": " + d.count + " participants"
                      }
                    />
                    <span>{d.count}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="table-scroll">
              <table className="measure-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>
                      {r.type === "ranking"
                        ? "Mean rank (1 = highest)"
                        : r.type === "matrix"
                          ? "Mean rating"
                          : "Selected / shown"}
                    </th>
                    <th>
                      {r.type === "ranking" || r.type === "matrix"
                        ? "Answered N"
                        : "Percent of shown"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.label}</td>
                      <td>
                        {r.type === "ranking" || r.type === "matrix"
                          ? fmt(row.mean)
                          : `${row.count} / ${row.exposed}`}
                      </td>
                      <td>
                        {r.type === "ranking" || r.type === "matrix"
                          ? row.values.length
                          : row.exposed
                            ? Math.round((100 * row.count) / row.exposed) + "%"
                            : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
