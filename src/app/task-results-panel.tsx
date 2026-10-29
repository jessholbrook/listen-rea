"use client";
import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/client";
import { Modal, Notice } from "./components";
import type { Interview } from "@/lib/domain";
import type { taskAttemptView } from "@/lib/usability-activity";
type Row = ReturnType<typeof taskAttemptView> & {
  included: boolean;
  turnId: string | null;
  prompt: string;
};
type Data = {
  rows: Row[];
  guidance: {
    id: string;
    interviewId: string;
    captureId: string;
    questionId: string;
    model: string;
    createdAt: string;
    guidance: { question: string; visibleContext: string; uncertainty: string };
  }[];
  eligibleResponses: number;
  signature: string;
};
export default function TaskResultsPanel({ studyId }: { studyId: string }) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [source, setSource] = useState<Interview | null>(null),
    [attribute, setAttribute] = useState(""),
    [value, setValue] = useState(""),
    [query, setQuery] = useState(""),
    [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  const root = `studies/${studyId}/usability`;
  useEffect(() => {
    let active = true;
    generation.current++;
    setBusy(false);
    setSource(null);
    setData(null);
    setReviewed(false);
    setError("");
    api<Data>(root + query)
      .then((r) => {
        if (active) setData(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [root, query, refresh]);
  async function inspect(id: string) {
    try {
      const r = await api("studies/" + studyId);
      const i = r.interviews.find(
        (i: Interview) => i.id === id && !i.preview && !i.excluded,
      );
      if (!i) throw Error("Source unavailable. Refresh results.");
      setSource(i);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function download(format = "attempts") {
    const g = generation.current;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/" + root + "/export" + query, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signature: data!.signature, reviewed, format }),
      });
      if (!r.ok) throw Error((await r.json()).error);
      const blob = await r.blob();
      if (g !== generation.current) return;
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download =
        format === "guidance" ? "usability-guidance.csv" : "usability.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (g !== generation.current) return;
      setError((e as Error).message);
      setReviewed(false);
      setData(null);
      setRefresh((n) => n + 1);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  const included = data?.rows.filter((r) => r.included) || [];
  return (
    <section className="panel visual-stack" aria-label="Task control measures">
      <h3>Task timing and reported outcomes</h3>
      <p>
        These intervals measure participant use of Start, Pause, Resume and End
        controls on Echo Lab. Outcomes are participant reports. They do not
        establish clicks, prototype activity, verified success or time spent
        exclusively on the task. Attempts, people and revision/question scopes
        stay separate. Unfinished attempts have no final timing value.
      </p>
      {error && <Notice>{error}</Notice>}
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
          Task attribute
          <input
            aria-label="Task attribute"
            value={attribute}
            onChange={(e) => setAttribute(e.target.value)}
          />
        </label>
        <label>
          Task attribute value
          <input
            aria-label="Task attribute value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <button>Filter task measures</button>
      </form>
      <button onClick={() => setRefresh((n) => n + 1)}>
        Refresh task measures
      </button>
      {data && (
        <>
          <p>
            {included.length} included ended attempts from{" "}
            {new Set(included.map((r) => r.interviewId)).size} responses;{" "}
            {data.eligibleResponses} eligible completed task responses overall.
            Participants without a timer are not zero-duration attempts.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Scope</th>
                  <th>Source</th>
                  <th>State / participant report</th>
                  <th>Active control time</th>
                  <th>Paused control time</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.prompt}
                      <br />
                      <small>
                        Revision {r.revisionId} · {r.questionId}
                      </small>
                    </td>
                    <td>
                      <button onClick={() => void inspect(r.interviewId)}>
                        Inspect task source {r.interviewId.slice(0, 8)}
                      </button>
                    </td>
                    <td>
                      {r.state} / {r.outcome || "not reported"}
                      {!r.included && " · excluded from completed measures"}
                    </td>
                    <td>
                      {r.timing.activeMs === null
                        ? "—"
                        : (r.timing.activeMs / 1000).toFixed(1) + " s"}
                    </td>
                    <td>
                      {r.timing.pausedMs === null
                        ? "—"
                        : (r.timing.pausedMs / 1000).toFixed(1) + " s"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.guidance.length > 0 && (
            <div className="visual-stack">
              <h4>Optional AI guidance shown during tasks</h4>
              <p>
                These are model-generated prompts, not participant statements or
                confirmed observations. Screen images were transient and are not
                retained.
              </p>
              {data.guidance.map((g) => (
                <article className="panel" key={g.id}>
                  <p>{g.guidance.question}</p>
                  <p>{g.guidance.visibleContext}</p>
                  <p>{g.guidance.uncertainty}</p>
                  <small>
                    {g.model} · {g.createdAt} · {g.captureId}
                  </small>
                  <button onClick={() => void inspect(g.interviewId)}>
                    Inspect guidance source {g.interviewId.slice(0, 8)}
                  </button>
                </article>
              ))}
            </div>
          )}
          <label>
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed the scopes, timing definitions and participant-reported
            outcomes.
          </label>
          <button disabled={busy || !reviewed} onClick={() => void download()}>
            Export reviewed task measures CSV
          </button>
          {data.guidance.length > 0 && (
            <button
              disabled={busy || !reviewed}
              onClick={() => void download("guidance")}
            >
              Export reviewed AI guidance CSV
            </button>
          )}
        </>
      )}
      {source && (
        <Modal title="Original task response" onClose={() => setSource(null)}>
          {source.turns.map((t) => (
            <article key={t.id}>
              <p>{t.prompt}</p>
              <blockquote>{t.answer}</blockquote>
              <small>{t.id}</small>
            </article>
          ))}
        </Modal>
      )}
    </section>
  );
}
