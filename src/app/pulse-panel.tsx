"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { Study } from "@/lib/domain";
import type { PulseSeries, pulseWaveResults } from "@/lib/pulse";
import { Modal, Spinner } from "./components";
type Wave = ReturnType<typeof pulseWaveResults>;
type Data = { series: PulseSeries; waves: Wave[] };
const date = () => new Date().toISOString().slice(0, 10);
const number = (v: number | null, suffix = "") =>
  v === null ? "No data" : v.toFixed(1) + suffix;
export default function PulsePanel({
  study,
  open,
}: {
  study: Study;
  open: (id: string, tab?: string) => Promise<void>;
}) {
  const [data, setData] = useState<Data | null>(null),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(study.title + " tracker"),
    [label, setLabel] = useState("Wave 1"),
    [waveDate, setWaveDate] = useState(date()),
    [recruitment, setRecruitment] = useState(""),
    [attribute, setAttribute] = useState(""),
    [value, setValue] = useState(""),
    [query, setQuery] = useState(""),
    [editWave, setEditWave] = useState<string | null>(null),
    [waveForm, setWaveForm] = useState(false),
    [codes, setCodes] = useState<
      PulseSeries["codebooks"][number]["codes"] | null
    >(null),
    [source, setSource] = useState<Wave["sources"][number] | null>(null),
    [assignments, setAssignments] = useState<
      { codeId: string; turnId: string }[]
    >([]);
  async function load(q = query) {
    const links = await api<{ series: PulseSeries[] }>(
      `studies/${study.id}/pulse`,
    );
    setData(
      links.series.length ? await api(`pulse/${links.series[0].id}${q}`) : null,
    );
    setReady(true);
  }
  useEffect(() => {
    let live = true;
    setReady(false);
    const fetchData = async () => {
      try {
        const links = await api<{ series: PulseSeries[] }>(
          `studies/${study.id}/pulse`,
        );
        const d = links.series.length
          ? await api<Data>(`pulse/${links.series[0].id}${query}`)
          : null;
        if (live) {
          setData(d);
          setReady(true);
        }
      } catch (e) {
        if (live) {
          setError((e as Error).message);
          setReady(true);
        }
      }
    };
    void fetchData();
    return () => {
      live = false;
    };
  }, [study.id, study.dataVersion, query]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function change(action: string, body: object) {
    return api(`pulse/${data!.series.id}/${action}`, "POST", {
      ...body,
      version: data!.series.version,
    });
  }
  const book = data?.series.codebooks.at(-1);
  const delta = (
    current: Wave,
    previous: Wave | undefined,
    a: number | null,
    b: number | null,
    suffix = "",
  ) =>
    current.comparable && previous?.comparable && a !== null && b !== null
      ? `${a - b >= 0 ? "+" : ""}${(a - b).toFixed(1)}${suffix}`
      : "Not compared";
  return (
    <div className="visual-stack pulse-results">
      <section className="panel visual-stack">
        <div className="panel-heading">
          <h2>Pulse</h2>
          <button
            className="button"
            disabled={busy}
            onClick={() => run(() => load())}
          >
            Refresh Pulse
          </button>
        </div>
        <p>
          Track recurring questions and reviewed themes across research waves.
          Each wave uses a separate study. Sample composition and recruitment
          must be checked by the team; a matching design alone does not
          establish a representative or paired sample.
        </p>
        {error && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
        {!ready ? (
          <Spinner />
        ) : !data ? (
          <form
            className="visual-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api(`studies/${study.id}/pulse`, "POST", {
                  name,
                  label,
                  date: waveDate,
                  recruitment,
                  version: study.version,
                });
                await load();
              });
            }}
          >
            <h3>Create a recurring tracker</h3>
            <p>
              The published guide becomes the fixed baseline. Publish this study
              first. All baseline questions recur; append timely questions after
              them in later waves.
            </p>
            <label>
              Tracker name
              <input
                required
                minLength={3}
                maxLength={160}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Wave label
              <input
                required
                minLength={3}
                maxLength={160}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <label>
              Wave date
              <input
                type="date"
                required
                value={waveDate}
                onChange={(e) => setWaveDate(e.target.value)}
              />
            </label>
            <label>
              Recruitment protocol
              <textarea
                required
                minLength={3}
                maxLength={2000}
                value={recruitment}
                onChange={(e) => setRecruitment(e.target.value)}
                placeholder="Source, eligibility, market, quotas and sampling approach to repeat"
              />
            </label>
            <button
              className="button primary"
              disabled={busy || !study.revisionId}
            >
              Create Pulse tracker
            </button>
          </form>
        ) : (
          <>
            <h3>{data.series.name}</h3>
            <p>
              Fixed baseline: {data.series.baseline.questions.length} recurring
              questions · {data.series.baseline.audience}
            </p>
            <p>Recruitment baseline: {data.series.recruitment}</p>
            <div className="button-row">
              <button
                className="button primary"
                disabled={busy}
                onClick={() => {
                  setEditWave(null);
                  setLabel(`Wave ${data.waves.length + 1}`);
                  setWaveDate(date());
                  setRecruitment(data.series.recruitment);
                  setWaveForm(true);
                }}
              >
                Create next wave
              </button>
              <button
                className="button"
                disabled={busy}
                onClick={() => setCodes(structuredClone(book!.codes))}
              >
                Edit shared codebook
              </button>
              <a
                className="button"
                href={`/api/pulse/${data.series.id}/export${query}`}
              >
                Export wave comparison
              </a>
            </div>
            <a
              className="button"
              href={`/api/pulse/${data.series.id}/export${query ? query + "&kind=evidence" : "?kind=evidence"}`}
            >
              Export recurring evidence
            </a>
            <p>
              Waves are created as drafts. Review, publish and launch each
              through Study design and Fielding. Dates are planning metadata;
              recruitment and scheduling are manual.
            </p>
            <form
              className="mixed-grid"
              onSubmit={(e) => {
                e.preventDefault();
                setQuery(
                  attribute
                    ? "?" + new URLSearchParams({ attribute, value })
                    : "",
                );
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
              <button className="button" disabled={busy}>
                Apply Pulse segment
              </button>
            </form>
            <p>
              Rating means and choice percentages use valid answers from
              completed, included native interviews in each wave’s current
              published revision. Missing answers, unfinished interviews and
              other revisions remain separate. No forecasts, significance tests
              or causal conclusions are generated.
            </p>
          </>
        )}
      </section>
      {data?.waves.map((w, index) => {
        const prev = data.waves[index - 1];
        return (
          <section className="panel visual-stack" key={w.studyId}>
            <div className="panel-heading">
              <h3>
                {w.label} · {w.date}
              </h3>
              <button
                className="button"
                onClick={() => void open(w.studyId, "guide")}
              >
                Open wave study
              </button>
            </div>
            <p>
              {w.fielding} · {w.counts.included} included / {w.counts.complete}{" "}
              complete · {w.counts.incomplete} unfinished ·{" "}
              {w.counts.screenedOut} screened out · {w.counts.otherRevisions} in
              other revisions
            </p>
            <p>
              {w.comparable
                ? "Design checks passed. Deltas describe these samples only."
                : "Comparison withheld. Review the flags and sample before interpreting change."}
            </p>
            {w.warnings.length > 0 && (
              <ul>
                {w.warnings.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
            <p>Recruitment: {w.recruitment}</p>
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                setEditWave(w.studyId);
                setLabel(w.label);
                setWaveDate(w.date);
                setRecruitment(w.recruitment);
                setWaveForm(true);
              }}
            >
              Edit wave details
            </button>
            <div className="pricing-table">
              <table>
                <thead>
                  <tr>
                    <th>Recurring measure</th>
                    <th>Value</th>
                    <th>Valid answers</th>
                    <th>Missing / not asked</th>
                    <th>Change vs previous wave</th>
                  </tr>
                </thead>
                <tbody>
                  {w.metrics.flatMap((m) =>
                    m.type === "rating"
                      ? [
                          <tr key={m.id}>
                            <td>{m.text} · mean</td>
                            <td>{number(m.mean)}</td>
                            <td>{m.denominator}</td>
                            <td>{m.missing}</td>
                            <td>
                              {delta(
                                w,
                                prev,
                                m.mean,
                                prev?.metrics.find((p) => p.id === m.id)
                                  ?.mean ?? null,
                              )}
                            </td>
                          </tr>,
                        ]
                      : m.options.map((o) => (
                          <tr key={m.id + o.id}>
                            <td>
                              {m.text} · {o.text}
                            </td>
                            <td>
                              {number(o.percent, "%")} ({o.count})
                            </td>
                            <td>{m.denominator}</td>
                            <td>{m.missing}</td>
                            <td>
                              {delta(
                                w,
                                prev,
                                o.percent,
                                prev?.metrics
                                  .find((p) => p.id === m.id)
                                  ?.options.find((p) => p.id === o.id)
                                  ?.percent ?? null,
                                " pp",
                              )}
                            </td>
                          </tr>
                        )),
                  )}
                </tbody>
              </table>
            </div>
            <h4>Shared coding · version {w.codebookVersion}</h4>
            <p>
              {w.counts.reviewed} reviewed; {w.counts.unreviewed} unreviewed. A
              saved review with no codes means no matching theme. Unreviewed
              responses never count as an absence. Multiple mentions count once
              per participant.
            </p>
            {w.themes.map((t) => (
              <details key={t.id}>
                <summary>
                  {t.name}: {t.count}/{t.denominator} reviewed (
                  {number(t.percent, "%")}) ·{" "}
                  {delta(
                    w,
                    prev,
                    t.percent,
                    prev?.themes.find((p) => p.id === t.id)?.percent ?? null,
                    " pp",
                  )}
                </summary>
                <p>{t.definition}</p>
                {t.evidence.map((e) => (
                  <blockquote key={e.interviewId + e.turnId}>
                    <p>{e.answer}</p>
                    <small>
                      {e.interviewId.slice(0, 8)} / {e.turnId.slice(0, 8)}
                    </small>
                  </blockquote>
                ))}
              </details>
            ))}
            {w.timely.length > 0 && (
              <details>
                <summary>
                  {w.timely.length} timely questions, excluded from recurring
                  metrics and coding
                </summary>
                {w.timely.map((q) => (
                  <p key={q.id}>{q.text}</p>
                ))}
              </details>
            )}
            <details>
              <summary>Review recurring answers ({w.sources.length})</summary>
              <div className="visual-stack">
                {w.sources.map((s) => (
                  <button
                    key={s.id}
                    className="button"
                    disabled={busy || !book?.codes.length}
                    onClick={() => {
                      setSource(s);
                      setAssignments(
                        structuredClone(s.review?.assignments || []),
                      );
                    }}
                  >
                    Review {s.id.slice(0, 8)} ·{" "}
                    {s.review ? "coded" : "unreviewed"}
                  </button>
                ))}
              </div>
            </details>
          </section>
        );
      })}
      {waveForm && data && (
        <Modal
          title={editWave ? "Edit wave details" : "Create next wave"}
          onClose={() => setWaveForm(false)}
        >
          <form
            className="visual-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const r = await change(editWave ? "wave" : "waves", {
                  label,
                  date: waveDate,
                  recruitment,
                  ...(editWave ? { studyId: editWave } : {}),
                });
                await load();
                setWaveForm(false);
                if (r.study) await open(r.study.id, "pulse");
              });
            }}
          >
            <label>
              Wave label
              <input
                required
                minLength={3}
                maxLength={160}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <label>
              Wave date
              <input
                required
                type="date"
                value={waveDate}
                onChange={(e) => setWaveDate(e.target.value)}
              />
            </label>
            <label>
              Recruitment protocol
              <textarea
                required
                minLength={3}
                maxLength={2000}
                value={recruitment}
                onChange={(e) => setRecruitment(e.target.value)}
              />
            </label>
            <button className="button primary" disabled={busy}>
              {editWave ? "Save wave details" : "Create draft wave"}
            </button>
          </form>
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
      {codes && (
        <Modal title="Shared codebook" onClose={() => setCodes(null)}>
          <form
            className="visual-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await change("codebook", { codes });
                await load();
                setCodes(null);
              });
            }}
          >
            <p>
              Every save creates a new definition version. Existing reviews must
              be checked again; different coding versions are never combined.
              Codes should describe recurring answers, with explicit inclusion
              and exclusion criteria.
            </p>
            {codes.map((c, n) => (
              <div className="panel visual-stack" key={c.id}>
                <label>
                  Code {n + 1} name
                  <input
                    required
                    maxLength={100}
                    value={c.name}
                    onChange={(e) =>
                      setCodes(
                        codes.map((v, k) =>
                          k === n ? { ...v, name: e.target.value } : v,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Code {n + 1} definition
                  <textarea
                    required
                    minLength={3}
                    maxLength={1500}
                    value={c.definition}
                    onChange={(e) =>
                      setCodes(
                        codes.map((v, k) =>
                          k === n ? { ...v, definition: e.target.value } : v,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="button"
                  onClick={() => setCodes(codes.filter((_, k) => k !== n))}
                >
                  Remove code {n + 1}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="button"
              disabled={codes.length >= 30}
              onClick={() =>
                setCodes([
                  ...codes,
                  { id: crypto.randomUUID(), name: "", definition: "" },
                ])
              }
            >
              Add code
            </button>
            <button className="button primary" disabled={busy}>
              Save codebook version
            </button>
          </form>
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
      {source && (
        <Modal title="Review recurring answers" onClose={() => setSource(null)}>
          <form
            className="visual-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await change("review", {
                  interviewId: source.id,
                  sourceVersion: source.version,
                  codebookVersion: book!.version,
                  assignments,
                });
                await load();
                setSource(null);
              });
            }}
          >
            <p>
              Review every recurring answer. Save an empty review when none of
              the defined themes apply.
            </p>
            {source.turns.map((t) => (
              <div key={t.id} className="panel visual-stack">
                <h4>{t.prompt}</h4>
                <p className="pulse-answer">{t.answer}</p>
                <small>
                  {source.id.slice(0, 8)} / {t.id.slice(0, 8)}
                </small>
                {book?.codes.map((c) => (
                  <label key={c.id} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={assignments.some(
                        (a) => a.turnId === t.id && a.codeId === c.id,
                      )}
                      onChange={(e) =>
                        setAssignments(
                          e.target.checked
                            ? [...assignments, { codeId: c.id, turnId: t.id }]
                            : assignments.filter(
                                (a) => a.turnId !== t.id || a.codeId !== c.id,
                              ),
                        )
                      }
                    />
                    {c.name} — {c.definition}
                  </label>
                ))}
              </div>
            ))}
            <button className="button primary" disabled={busy}>
              Save reviewed coding
            </button>
          </form>
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
    </div>
  );
}
