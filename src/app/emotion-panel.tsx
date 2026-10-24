"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { emotionResults } from "@/lib/emotion-results";
import { emotionCopy, type Feeling } from "@/lib/emotion";
import { Modal, Spinner } from "./components";
import type { Interview } from "@/lib/domain";
import { responseLanguage } from "@/lib/localization";
type Result = ReturnType<typeof emotionResults>[number];
export default function EmotionPanel({
  studyId,
  dataVersion,
}: {
  studyId: string;
  dataVersion: number;
}) {
  const [results, setResults] = useState<Result[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [attribute, setAttribute] = useState(""),
    [value, setValue] = useState(""),
    [language, setLanguage] = useState(""),
    [query, setQuery] = useState(""),
    [refresh, setRefresh] = useState(0),
    [selection, setSelection] = useState<{
      scope: string;
      feeling: Feeling;
    } | null>(null),
    [source, setSource] = useState<Interview | null>(null);
  const root = `studies/${studyId}/emotions`,
    labels = emotionCopy("en").labels;
  useEffect(() => {
    let active = true;
    setResults(null);
    setSource(null);
    setSelection(null);
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
  async function inspect(id: string) {
    setBusy(true);
    setError("");
    try {
      const r = await api(`studies/${studyId}`),
        i = r.interviews.find(
          (i: Interview) =>
            i.id === id &&
            !i.excluded &&
            !i.preview &&
            !i.origin &&
            i.status !== "withdrawn",
        );
      if (!i) throw new Error("This source is unavailable. Refresh results.");
      setSource(i);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="visual-stack emotion-results">
      <section className="panel visual-stack">
        <div className="panel-heading">
          <h2>Self-reported feelings</h2>
          <button
            className="button"
            disabled={busy}
            onClick={() => setRefresh((n) => n + 1)}
          >
            Refresh feelings
          </button>
        </div>
        <p>
          Optional check-ins record the participant’s own selection, intensity
          and note. These are snapshots at the question, not inferred states or
          clinical scores. They do not establish how a person felt between
          check-ins.
        </p>
        <p>
          Completed, included native interviews enter distributions. Declines,
          missing answers and unfinished interviews remain separate. Percentages
          use reported answers, excluding declines. Intensity stays ordinal; no
          average emotion, sentiment or valence score is generated.
        </p>
        <form
          className="mixed-grid"
          onSubmit={(e) => {
            e.preventDefault();
            const p = new URLSearchParams();
            if (attribute) {
              p.set("attribute", attribute);
              p.set("value", value);
            }
            if (language) p.set("language", language);
            setQuery(p.size ? "?" + p : "");
          }}
        >
          <label>
            Segment attribute
            <input
              maxLength={100}
              value={attribute}
              onChange={(e) => setAttribute(e.target.value)}
            />
          </label>
          <label>
            Exact segment value
            <input
              maxLength={500}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <label>
            Response language
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="">All languages</option>
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
            </select>
          </label>
          <button className="button">Apply feeling filters</button>
        </form>
        <div className="button-row">
          <a className="button" href={`/api/${root}/export${query}`}>
            Export feeling summary
          </a>
          <a
            className="button"
            href={`/api/${root}/export${query ? query + "&kind=sources" : "?kind=sources"}`}
          >
            Export feeling sources
          </a>
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {!results && !error && <Spinner />}
        {results?.length === 0 && (
          <p>
            No feeling check-ins in this selection. Add a Feeling check-in
            question in Study design and publish it. Participants can always
            prefer not to answer.
          </p>
        )}
      </section>
      {results?.map((r) => {
        const scope = JSON.stringify([r.revisionId, r.questionId, r.conceptId]);
        const outcomes =
          selection?.scope === scope
            ? r.outcomes.filter(
                (o) =>
                  o.status === "reported" &&
                  o.report?.feeling === selection.feeling,
              )
            : r.outcomes;
        return (
          <section className="panel visual-stack" key={scope}>
            <h3>{r.question}</h3>
            <p className="mono">
              Revision {r.revisionId.slice(0, 8)} · question {r.questionId}
              {r.conceptId ? ` · concept ${r.conceptId}` : ""} · {r.method}
            </p>
            <p>
              {r.counts.included} reported / {r.counts.complete} completed ·{" "}
              {r.counts.declined} declined · {r.counts.notAsked} not asked ·{" "}
              {r.counts.unanswered} unanswered · {r.counts.invalid} invalid ·{" "}
              {r.counts.incomplete} unfinished · {r.counts.screenedOut} screened
              out
            </p>
            <p>
              Response languages:{" "}
              {r.languages
                .map(
                  (l) =>
                    `${l.language}: ${l.reported} reported, ${l.declined} declined`,
                )
                .join(" · ")}
              . Labels are translated; equivalence across languages and cultures
              has not been validated. Use the language filter to inspect
              separate samples.
            </p>
            <div className="pricing-table">
              <table>
                <caption>Selected feelings and optional intensity</caption>
                <thead>
                  <tr>
                    <th>Feeling</th>
                    <th>Count / reported</th>
                    <th>Percent</th>
                    <th>Slightly</th>
                    <th>Moderately</th>
                    <th>Strongly</th>
                    <th>Intensity not specified</th>
                    <th>Intensity not applicable</th>
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((row) => (
                    <tr key={row.feeling}>
                      <td>
                        <button
                          className="button"
                          onClick={() =>
                            setSelection({ scope, feeling: row.feeling })
                          }
                        >
                          {labels[row.feeling]}
                        </button>
                      </td>
                      <td>
                        {row.count}/{row.denominator}
                      </td>
                      <td>
                        {row.percent === null
                          ? "No data"
                          : row.percent.toFixed(1) + "%"}
                      </td>
                      {row.intensity.map((v) => (
                        <td key={v.level}>{v.count}</td>
                      ))}
                      <td>{row.unspecified}</td>
                      <td>{row.notApplicable}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details>
              <summary>Original check-ins ({outcomes.length})</summary>
              {selection?.scope === scope && (
                <button className="button" onClick={() => setSelection(null)}>
                  Show all feeling sources
                </button>
              )}
              <div className="visual-stack">
                {outcomes.map((o) => (
                  <div key={o.interviewId} className="panel">
                    <p>
                      {o.interviewId.slice(0, 8)} · {o.status} ·{" "}
                      {o.createdAt || "No recorded answer"}
                    </p>
                    <p>
                      {o.report
                        ? labels[o.report.feeling]
                        : "No valid check-in"}
                    </p>
                    <button
                      className="button"
                      disabled={busy || !o.turnId}
                      onClick={() => void inspect(o.interviewId)}
                    >
                      Inspect feeling source
                    </button>
                  </div>
                ))}
              </div>
            </details>
          </section>
        );
      })}
      {source && (
        <Modal
          title="Original feeling check-ins"
          onClose={() => setSource(null)}
        >
          <p>
            Recorded check-in timestamps mark when answers were saved. They are
            not recording offsets or a continuous emotional timeline.
          </p>
          <div className="visual-stack">
            {source.turns
              .filter((t) => t.emotion)
              .map((t) => (
                <div key={t.id} className="panel visual-stack">
                  <small>
                    {source.id.slice(0, 8)} / {t.id.slice(0, 8)} · answer{" "}
                    {source.turns.indexOf(t) + 1} · {t.createdAt} ·{" "}
                    {responseLanguage(source)}
                    {t.conceptId ? ` · concept ${t.conceptId}` : ""}
                  </small>
                  <h4>{t.prompt}</h4>
                  <p className="emotion-answer">{t.answer}</p>
                  <p>Method: {t.emotion!.method}</p>
                </div>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
