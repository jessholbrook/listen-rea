"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { maxdiffResults } from "@/lib/maxdiff-results";
import type { Interview } from "@/lib/domain";
import { Modal, Spinner } from "./components";
type Result = Omit<ReturnType<typeof maxdiffResults>[number], "respondents"> & {
  sourceFingerprint: string;
};
type Model = {
  method: string;
  ridge: number;
  sourceFingerprint: string;
  computedAt: string;
  seed: number;
  bootstrap: { requested: number; completed: number; reason: string | null };
  fit: { iterations: number; gradient: number };
  items: {
    id: string;
    text: string;
    utility: number;
    score: number;
    interval: { low: number; high: number } | null;
  }[];
};
export default function MaxdiffPanel({
  studyId,
  dataVersion,
}: {
  studyId: string;
  dataVersion: number;
}) {
  const [results, setResults] = useState<Result[] | null>(null),
    [error, setError] = useState(""),
    [attribute, setAttribute] = useState(""),
    [value, setValue] = useState(""),
    [query, setQuery] = useState(""),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false),
    [models, setModels] = useState<Record<string, Model>>({}),
    [selected, setSelected] = useState(""),
    [source, setSource] = useState<{
      interview: Interview;
      ids: string[];
    } | null>(null);
  const root = `studies/${studyId}/maxdiff`;
  useEffect(() => {
    let active = true;
    setResults(null);
    setSelected("");
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
  async function fit(r: Result, download = false) {
    setBusy(true);
    setError("");
    try {
      const output = await api(root + "/model" + query, "POST", {
        revisionId: r.revisionId,
        questionId: r.questionId,
        conceptId: r.conceptId,
        sourceFingerprint: r.sourceFingerprint,
      });
      setModels((m) => ({ ...m, [r.sourceFingerprint]: output.model }));
      if (download) {
        const url = URL.createObjectURL(
            new Blob([output.csv], { type: "text/csv;charset=utf-8" }),
          ),
          a = document.createElement("a");
        a.href = url;
        a.download = "maxdiff-pooled-model.csv";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 500);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function inspect(o: Result["outcomes"][number]) {
    setBusy(true);
    setError("");
    try {
      const detail = await api("studies/" + studyId),
        interview = detail.interviews.find(
          (i: Interview) => i.id === o.interviewId && !i.excluded && !i.preview,
        );
      if (!interview)
        throw new Error("This source is no longer available. Refresh results.");
      setSource({ interview, ids: o.turns.map((t) => t.id) });
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
          <h2>MaxDiff preferences</h2>
          <button
            className="button"
            disabled={busy}
            onClick={() => setRefresh((n) => n + 1)}
          >
            Refresh MaxDiff results
          </button>
        </div>
        <p>
          Repeated best/worst choices reveal relative priorities within this
          item list. Descriptive counts and pooled model estimates are shown
          separately. This release does not implement Hierarchical Bayes,
          individual utilities or portfolio optimization.
        </p>
        <form
          className="mixed-grid"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(
              attribute ? "?" + new URLSearchParams({ attribute, value }) : "",
            );
          }}
        >
          <label>
            MaxDiff segment attribute
            <input
              value={attribute}
              maxLength={100}
              onChange={(e) => setAttribute(e.target.value)}
            />
          </label>
          <label>
            MaxDiff exact segment value
            <input
              value={value}
              maxLength={500}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <button className="button">Apply MaxDiff segment</button>
        </form>
        <p className="small">
          {query
            ? `Filtered: ${new URLSearchParams(query).get("attribute")} = ${new URLSearchParams(query).get("value")}`
            : "All included participants"}{" "}
          · completed interviews only; unfinished tasks remain separate.
        </p>
        <div className="panel-actions">
          <a
            className="button"
            href={`/api/${root}/export${query ? query + "&" : "?"}kind=counts`}
            download
          >
            Export MaxDiff counts CSV
          </a>
          <a
            className="button"
            href={`/api/${root}/export${query ? query + "&" : "?"}kind=tasks`}
            download
          >
            Export MaxDiff task data CSV
          </a>
        </div>
      </section>
      {error && <p role="alert">{error}</p>}
      {!results && !error && <Spinner />}
      {results?.length === 0 && (
        <section className="panel">
          <p>
            No MaxDiff responses match this view. Add a MaxDiff question in
            Study design, publish it, and collect responses. Preview interviews
            do not enter these results.
          </p>
        </section>
      )}
      {results?.map((r) => {
        const model = models[r.sourceFingerprint],
          chosen = selected.startsWith(r.sourceFingerprint + ":")
            ? selected.slice(65)
            : "";
        return (
          <section className="panel visual-stack" key={r.sourceFingerprint}>
            <h3>{r.prompt}</h3>
            <p className="small mono">
              Revision {r.revisionId} · Question {r.questionId}
              {r.conceptId && ` · Concept ${r.conceptId}`}
            </p>
            <p>
              {r.counts.included} included respondents · {r.counts.tasks}{" "}
              completed tasks · {r.counts.incomplete} incomplete ·{" "}
              {r.counts.notAsked} not asked · {r.counts.invalid} invalid
            </p>
            <p className="small muted">
              Design {r.design.version}: {r.design.tasksPerRespondent} tasks per
              person, {r.config.setSize} items per task, equal item exposure.
              Pair co-occurrences {r.design.pairMin}–{r.design.pairMax};
              comparisons are{" "}
              {r.design.connected ? "connected" : "disconnected"}. Pair counts
              may be unequal even when item exposures are balanced.
            </p>
            <div className="pricing-table">
              <table>
                <caption>Descriptive choices · not model utilities</caption>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Exposures</th>
                    <th>Best</th>
                    <th>Worst</th>
                    <th>Net count</th>
                    <th>Net / exposure</th>
                  </tr>
                </thead>
                <tbody>
                  {r.items.map((item) => (
                    <tr key={item.id}>
                      <th>{item.text}</th>
                      <td>{item.exposures}</td>
                      <td>{item.best}</td>
                      <td>{item.worst}</td>
                      <td>{item.net}</td>
                      <td>
                        {item.netPerExposure === null
                          ? "—"
                          : item.netPerExposure.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel-actions">
              <button
                className="button primary"
                disabled={busy || !r.counts.included}
                onClick={() => fit(r)}
              >
                Fit pooled model
              </button>
              <button
                className="button"
                disabled={busy || !r.counts.included}
                onClick={() => fit(r, true)}
              >
                Fit & export model CSV
              </button>
            </div>
            {model && (
              <section
                className="visual-stack"
                aria-label="Pooled MaxDiff model"
              >
                <h4>Pooled best–worst logit</h4>
                <p className="small muted">
                  Relative preference scores sum to 100 within this list. They
                  are a transformation of pooled utilities, not purchase
                  probabilities or HB estimates. Overlapping ranges do not
                  establish a rank difference. Item buttons filter the source
                  outcomes below.
                </p>
                <div className="maxdiff-bars">
                  {[...model.items]
                    .sort((a, b) => b.score - a.score)
                    .map((item) => (
                      <div key={item.id}>
                        <div className="maxdiff-bar">
                          <button
                            className="text-button"
                            onClick={() =>
                              setSelected(
                                chosen === item.id
                                  ? ""
                                  : r.sourceFingerprint + ":" + item.id,
                              )
                            }
                          >
                            {item.text}
                          </button>
                          <progress
                            max={100}
                            value={item.score}
                            aria-label={`${item.text} relative preference score`}
                          />
                          <strong>{item.score.toFixed(1)}</strong>
                        </div>
                        <p className="small muted">
                          Utility {item.utility.toFixed(3)} ·{" "}
                          {item.interval
                            ? `95% respondent-bootstrap range ${item.interval.low.toFixed(1)}–${item.interval.high.toFixed(1)}`
                            : "Bootstrap range unavailable"}
                        </p>
                      </div>
                    ))}
                </div>
                <p className="small muted">
                  {model.bootstrap.reason ||
                    `${model.bootstrap.completed}/${model.bootstrap.requested} respondent bootstrap fits. Ranges reflect resampling these respondents under the pooled model; they are not posterior or individual-level intervals.`}
                </p>
                <details>
                  <summary>Model method and reproducibility</summary>
                  <p className="small mono">
                    {model.method} · ridge {model.ridge} ·{" "}
                    {model.fit.iterations} iterations · seed {model.seed} ·{" "}
                    {model.computedAt} · source {model.sourceFingerprint}
                  </p>
                  <p className="small">
                    Scores are 100 × exp(utility) / sum(exp(utility)). Fitting
                    uses all ordered best/worst pairs in each shown set. No
                    individual-level or population representativeness claim
                    follows from this fit. Estimates are recomputed on demand;
                    exports recheck current sources.
                  </p>
                </details>
              </section>
            )}
            <details open={!!chosen}>
              <summary>
                Inspect {r.outcomes.length} response outcomes
                {chosen
                  ? " · filtered to respondents who selected the item best or worst"
                  : ""}
              </summary>
              {chosen && (
                <button className="button" onClick={() => setSelected("")}>
                  Show all MaxDiff outcomes
                </button>
              )}
              <div className="visual-stack">
                {r.outcomes
                  .filter(
                    (o) =>
                      !chosen ||
                      o.choices.some(
                        (c) => c.best === chosen || c.worst === chosen,
                      ),
                  )
                  .map((o) => (
                    <article className="visual-observation" key={o.interviewId}>
                      <span className="badge">
                        {o.status.replaceAll("_", " ")}
                      </span>
                      <p className="small mono">Response {o.interviewId}</p>
                      <p>
                        {o.answered} / {o.total} tasks answered
                      </p>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => inspect(o)}
                      >
                        Inspect MaxDiff source
                      </button>
                    </article>
                  ))}
              </div>
            </details>
          </section>
        );
      })}
      {source && (
        <Modal title="MaxDiff source" onClose={() => setSource(null)}>
          <p className="small mono">
            Response {source.interview.id} · Revision{" "}
            {source.interview.revisionId}
          </p>
          {source.interview.turns
            .filter((t) => source.ids.includes(t.id))
            .map((t) => (
              <article key={t.id}>
                <p className="small mono">
                  Turn {t.id} · Task {t.maxdiff?.task}
                </p>
                <h3>{t.prompt}</h3>
                <p className="small">
                  Shown:{" "}
                  {t.maxdiff?.shown
                    .map(
                      (id) =>
                        source.interview.guide.questions
                          .find((q) => q.id === t.questionId)
                          ?.maxdiff?.items.find((item) => item.id === id)
                          ?.text || id,
                    )
                    .join(" · ")}
                </p>
                <blockquote>{t.answer}</blockquote>
              </article>
            ))}
          {!source.ids.length && <p>No MaxDiff answers were saved.</p>}
        </Modal>
      )}
    </div>
  );
}
