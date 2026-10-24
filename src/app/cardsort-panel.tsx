"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { cardsortResults } from "@/lib/cardsort-results";
import type { Interview } from "@/lib/domain";
import { Modal, Spinner } from "./components";
type Result = ReturnType<typeof cardsortResults>[number];
type Selection =
  | { scope: string; kind: "placement"; cardId: string; groupId: string | null }
  | { scope: string; kind: "pair"; a: string; b: string };
export default function CardsortPanel({
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
    [selection, setSelection] = useState<Selection | null>(null),
    [source, setSource] = useState<{
      interview: Interview;
      ids: string[];
    } | null>(null);
  const root = `studies/${studyId}/cardsort`;
  useEffect(() => {
    let active = true;
    setResults(null);
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
  async function inspect(o: Result["outcomes"][number]) {
    setBusy(true);
    setError("");
    try {
      const d = await api("studies/" + studyId),
        interview = d.interviews.find(
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
  const cellStyle = (percent: number | null) => ({
    backgroundColor:
      percent === null
        ? "#f3f5f1"
        : `rgba(89,124,87,${0.06 + (percent / 100) * 0.45})`,
  });
  return (
    <div className="visual-stack cardsort-results">
      <section className="panel visual-stack">
        <div className="panel-heading">
          <h2>Card-sort results</h2>
          <button
            className="button"
            disabled={busy}
            onClick={() => setRefresh((n) => n + 1)}
          >
            Refresh card-sort results
          </button>
        </div>
        <p>
          Closed sorting into researcher-defined groups. Completed, included
          interviews enter the summaries; unconfirmed drafts and unfinished
          interviews remain separate. Each revision and concept is reported
          independently.
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
            Card-sort segment attribute
            <input
              value={attribute}
              maxLength={100}
              onChange={(e) => setAttribute(e.target.value)}
            />
          </label>
          <label>
            Card-sort exact segment value
            <input
              value={value}
              maxLength={500}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <button className="button">Apply card-sort segment</button>
        </form>
        <p className="small">
          {query
            ? `Filtered: ${new URLSearchParams(query).get("attribute")} = ${new URLSearchParams(query).get("value")}`
            : "All included participants"}
        </p>
        <div className="panel-actions">
          {(["summary", "assignments", "pairs"] as const).map((kind) => (
            <a
              key={kind}
              className="button"
              href={`/api/${root}/export${query ? query + "&" : "?"}kind=${kind}`}
              download
            >
              Export card-sort {kind} CSV
            </a>
          ))}
        </div>
      </section>
      {error && <p role="alert">{error}</p>}
      {!results && !error && <Spinner />}
      {results?.length === 0 && (
        <section className="panel">
          <p>
            No card-sort responses match this view. Add a Closed card sort in
            Study design, publish it, and collect responses. Preview interviews
            stay out of results.
          </p>
        </section>
      )}
      {results?.map((r) => {
        const scope = JSON.stringify([r.revisionId, r.questionId, r.conceptId]),
          chosen = selection?.scope === scope ? selection : null;
        const outcomes = r.outcomes.filter((o) => {
          if (!chosen) return true;
          if (o.status !== "included") return false;
          if (chosen.kind === "placement")
            return o.assignments.some(
              (a) => a.cardId === chosen.cardId && a.groupId === chosen.groupId,
            );
          const a = o.assignments.find((x) => x.cardId === chosen.a),
            b = o.assignments.find((x) => x.cardId === chosen.b);
          return (
            a &&
            b &&
            a.groupId !== null &&
            b.groupId !== null &&
            a.groupId === b.groupId
          );
        });
        return (
          <section className="panel visual-stack" key={scope}>
            <h3>{r.prompt}</h3>
            <p className="small mono">
              Revision {r.revisionId} · Question {r.questionId}
              {r.conceptId && ` · Concept ${r.conceptId}`}
            </p>
            <p>
              {r.counts.included} included · {r.counts.incomplete} incomplete ·{" "}
              {r.counts.notAsked} not asked · {r.counts.invalid} invalid
            </p>
            <h4>Card-to-group assignments</h4>
            <p className="small muted">
              Cells show count / included respondents and percentage. Uncertain
              placements stay in this denominator. Select a cell to inspect
              matching source outcomes.
            </p>
            <div className="pricing-table">
              <table>
                <caption>Confirmed placements by card and group</caption>
                <thead>
                  <tr>
                    <th>Card</th>
                    {r.config.groups.map((g) => (
                      <th key={g.id}>{g.text}</th>
                    ))}
                    <th>Uncertain</th>
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((card) => (
                    <tr key={card.id}>
                      <th>{card.text}</th>
                      {[
                        ...card.groups.map((g) => ({
                          id: g.id as string | null,
                          text: g.text,
                          count: g.count,
                          percent: g.percent,
                        })),
                        {
                          id: null,
                          text: "Uncertain",
                          count: card.uncertain,
                          percent: card.denominator
                            ? (100 * card.uncertain) / card.denominator
                            : null,
                        },
                      ].map((g) => (
                        <td key={JSON.stringify(g.id)}>
                          <button
                            className="cardsort-cell"
                            aria-label={`${card.text} in ${g.text}`}
                            style={cellStyle(g.percent)}
                            onClick={() =>
                              setSelection({
                                scope,
                                kind: "placement",
                                cardId: card.id,
                                groupId: g.id,
                              })
                            }
                          >
                            {g.count}/{card.denominator}
                            <br />
                            {g.percent === null
                              ? "—"
                              : g.percent.toFixed(1) + "%"}
                          </button>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details>
              <summary>Co-sorting matrix</summary>
              <p className="small muted">
                A pair’s denominator includes only people who placed both cards
                in real groups. Two uncertain responses do not count as
                co-sorting. These are descriptive associations under the
                supplied categories, not an inferred taxonomy or task-success
                measure.
              </p>
              <div className="pricing-table">
                <table>
                  <caption>Same real group / both assigned</caption>
                  <thead>
                    <tr>
                      <th>Card</th>
                      {r.config.cards.map((c) => (
                        <th key={c.id}>{c.text}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {r.config.cards.map((a) => (
                      <tr key={a.id}>
                        <th>{a.text}</th>
                        {r.config.cards.map((b) => {
                          const pair = r.pairs.find(
                            (p) =>
                              (p.cardA === a.id && p.cardB === b.id) ||
                              (p.cardA === b.id && p.cardB === a.id),
                          )!;
                          return (
                            <td key={b.id}>
                              <button
                                className="cardsort-cell"
                                aria-label={`${a.text} with ${b.text}`}
                                style={cellStyle(pair.percent)}
                                onClick={() =>
                                  setSelection({
                                    scope,
                                    kind: "pair",
                                    a: a.id,
                                    b: b.id,
                                  })
                                }
                              >
                                {pair.together}/{pair.bothAssigned}
                                <br />
                                {pair.percent === null
                                  ? "—"
                                  : pair.percent.toFixed(1) + "%"}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            <details open={!!chosen}>
              <summary>
                Inspect {outcomes.length} card-sort outcomes
                {chosen ? " · selected cell" : ""}
              </summary>
              {chosen && (
                <button className="button" onClick={() => setSelection(null)}>
                  Show all card-sort outcomes
                </button>
              )}
              <div className="visual-stack">
                {outcomes.map((o) => (
                  <article className="visual-observation" key={o.interviewId}>
                    <span className="badge">
                      {o.status.replaceAll("_", " ")}
                    </span>
                    <p className="small mono">Response {o.interviewId}</p>
                    <p>
                      {o.assignments.length
                        ? "Confirmed sort"
                        : `${o.draft.length} draft placements · unconfirmed`}
                    </p>
                    {o.reason && <blockquote>{o.reason}</blockquote>}
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => inspect(o)}
                    >
                      Inspect card-sort source
                    </button>
                  </article>
                ))}
              </div>
            </details>
          </section>
        );
      })}
      {source && (
        <Modal title="Card-sort source" onClose={() => setSource(null)}>
          <p className="small mono">
            Response {source.interview.id} · Revision{" "}
            {source.interview.revisionId}
          </p>
          {source.interview.turns
            .filter((t) => source.ids.includes(t.id))
            .map((t) => (
              <article key={t.id}>
                <p className="small mono">
                  Turn {t.id} · {t.cardsort?.phase}
                </p>
                <h3>{t.prompt}</h3>
                <blockquote className="preserve-lines">{t.answer}</blockquote>
              </article>
            ))}
          {!source.ids.length && (
            <p>
              No confirmed sort answer was saved. Draft placements have no
              answer-turn evidence.
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
