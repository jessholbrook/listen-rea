"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import {
  type Actor,
  type Guide,
  type Study,
  type Revision,
} from "@/lib/domain";
import {
  adviseGuide,
  applyAudience,
  type GuideHistory,
  type WorkflowLibrary,
  type WorkspaceDefaults,
  type Folder,
} from "@/lib/workflow";
import { Modal, Notice, Spinner } from "./components";

export function GuideAdvisor({
  guide,
  select,
}: {
  guide: Guide;
  select: (id: string) => void;
}) {
  const advice = adviseGuide(guide);
  return (
    <section className="panel workflow-advisor" aria-label="Study advisor">
      <div className="eyebrow">A SECOND LOOK</div>
      <h3>Study advisor</h3>
      <p className="muted small">
        Rule-based checks for configuration and question wording. Review
        suggestions in context; this is not a research quality score.
      </p>
      {advice.length ? (
        <ul className="advice-list">
          {advice.map((a) => (
            <li key={a.id}>
              <strong>
                {a.level === "error" ? "Fix configuration" : "Consider"}
              </strong>
              <p>{a.message}</p>
              {a.questionId && (
                <button
                  className="text-button"
                  onClick={() => select(a.questionId!)}
                >
                  Go to question
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>
          No issues found by these checks. Preview the guide and review its fit
          with your research objective.
        </p>
      )}
    </section>
  );
}

export function WorkflowLibraryModal({
  user,
  close,
  changed,
}: {
  user: Actor;
  close: () => void;
  changed: () => Promise<void>;
}) {
  const [data, setData] = useState<WorkflowLibrary | null>(null),
    [defaults, setDefaults] = useState<WorkspaceDefaults | null>(null),
    [folder, setFolder] = useState(""),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api<WorkflowLibrary>("workflow")
      .then((d) => {
        if (active) {
          setData(d);
          setDefaults(d.defaults);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(fn: () => Promise<void>, message: string) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await fn();
      const d = await api<WorkflowLibrary>("workflow");
      setData(d);
      await changed();
      setStatus(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Study resources" onClose={close}>
      <p className="muted">
        Organize studies and reuse the parts your team has reviewed.
      </p>
      {error && <Notice>{error}</Notice>}
      {status && <p role="status">{status}</p>}
      {!data || !defaults ? (
        <Spinner />
      ) : (
        <div className="workflow-stack">
          <section>
            <h3>Folders</h3>
            <p className="small muted">
              Deleting a folder keeps its studies in Unfiled.
            </p>
            {data.folders.map((f) => (
              <FolderRow
                key={f.id}
                folder={f}
                busy={busy}
                rename={(name) =>
                  run(async () => {
                    await api("workflow/folders/" + f.id, "PUT", { name });
                  }, "Folder renamed.")
                }
                remove={() =>
                  run(async () => {
                    await api("workflow/folders/" + f.id, "DELETE");
                  }, "Folder removed; studies kept.")
                }
              />
            ))}
            <form
              className="inline"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api("workflow/folders", "POST", { name: folder });
                  setFolder("");
                }, "Folder created.");
              }}
            >
              <label>
                New folder
                <input
                  required
                  maxLength={100}
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                />
              </label>
              <button className="button" disabled={busy}>
                Create folder
              </button>
            </form>
          </section>
          <section>
            <h3>Saved audiences</h3>
            <p className="small muted">
              Save selected single-choice screeners from a study’s Workflow tab.
              Applying an audience prepends a copy of its screeners for review.
            </p>
            {data.audiences.length ? (
              data.audiences.map((a) => (
                <div className="workflow-row" key={a.id}>
                  <div>
                    <strong>{a.name}</strong>
                    <p>{a.description}</p>
                    <small>{a.questions.length} screening questions</small>
                  </div>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          "Remove this saved audience? Existing studies keep their copies.",
                        )
                      )
                        void run(async () => {
                          await api("workflow/audiences/" + a.id, "DELETE");
                        }, "Saved audience removed.");
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))
            ) : (
              <p>No saved audiences yet.</p>
            )}
          </section>
          <section>
            <h3>Defaults for new studies</h3>
            <p className="muted small">
              New studies copy these values. Existing drafts, published guides
              and ongoing interviews keep their current settings. Only admins
              can change defaults.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const r = await api("workflow/defaults", "PUT", defaults);
                  setDefaults(r.defaults);
                }, "Defaults saved for future studies.");
              }}
            >
              <fieldset disabled={busy || user.role !== "admin"}>
                <label>
                  Default audience
                  <input
                    required
                    minLength={3}
                    maxLength={1000}
                    value={defaults.audience}
                    onChange={(e) =>
                      setDefaults({ ...defaults, audience: e.target.value })
                    }
                  />
                </label>
                <label>
                  Default participant introduction
                  <textarea
                    required
                    minLength={5}
                    maxLength={3000}
                    rows={4}
                    aria-label="Default participant introduction"
                    value={defaults.intro}
                    onChange={(e) =>
                      setDefaults({ ...defaults, intro: e.target.value })
                    }
                  />
                </label>
                <label>
                  Default participant limit
                  <input
                    required
                    type="number"
                    min={1}
                    max={500}
                    value={defaults.limit}
                    onChange={(e) =>
                      setDefaults({
                        ...defaults,
                        limit: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Research guidelines
                  <textarea
                    maxLength={4000}
                    rows={4}
                    aria-label="Research guidelines"
                    value={defaults.guidelines}
                    onChange={(e) =>
                      setDefaults({ ...defaults, guidelines: e.target.value })
                    }
                  />
                </label>
                <p className="muted small">
                  Internal context for AI guide drafting in new studies, such as
                  tone, terminology and brand context. Review generated
                  questions before applying them. These guidelines are not
                  participant-facing text.
                </p>
                <button className="button primary">Save defaults</button>
              </fieldset>
            </form>
          </section>
        </div>
      )}
    </Modal>
  );
}
function FolderRow({
  folder,
  busy,
  rename,
  remove,
}: {
  folder: Folder;
  busy: boolean;
  rename: (name: string) => void;
  remove: () => void;
}) {
  const [name, setName] = useState(folder.name);
  return (
    <form
      className="workflow-row"
      onSubmit={(e) => {
        e.preventDefault();
        rename(name);
      }}
    >
      <label>
        Folder name
        <input
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="inline">
        <button className="button" disabled={busy || name === folder.name}>
          Rename
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => {
            if (
              confirm("Delete this folder? Its studies will remain in Unfiled.")
            )
              remove();
          }}
        >
          Delete folder
        </button>
      </div>
    </form>
  );
}

type HistoryData = { history: GuideHistory[]; revisions: Revision[] };
type Candidate = {
  guide: Guide;
  label: string;
  id: string;
  kind: "audience" | "history" | "revision";
};
export function StudyWorkflow({
  study,
  refresh,
}: {
  study: Study;
  refresh: () => Promise<void>;
}) {
  const [library, setLibrary] = useState<WorkflowLibrary | null>(null),
    [history, setHistory] = useState<HistoryData | null>(null),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [ids, setIds] = useState<string[]>(
      study.draft.questions
        .filter(
          (q) =>
            q.type === "choice" &&
            q.options.some((o) => o.rejects) &&
            !q.conceptQuestion,
        )
        .map((q) => q.id),
    ),
    [candidate, setCandidate] = useState<Candidate | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([
      api<WorkflowLibrary>("workflow"),
      api<HistoryData>(`studies/${study.id}/history`),
    ])
      .then(([l, h]) => {
        if (active) {
          setLibrary(l);
          setHistory(h);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [study.id, study.version]);
  async function run(fn: () => Promise<void>, message: string) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await fn();
      setCandidate(null);
      const [l, h] = await Promise.all([
        api<WorkflowLibrary>("workflow"),
        api<HistoryData>(`studies/${study.id}/history`),
      ]);
      setLibrary(l);
      setHistory(h);
      await refresh();
      setStatus(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setIds(
      study.draft.questions
        .filter(
          (q) =>
            q.type === "choice" &&
            q.options.some((o) => o.rejects) &&
            !q.conceptQuestion,
        )
        .map((q) => q.id),
    );
  }, [study.id, study.version]);
  const eligible = study.draft.questions.filter(
    (q) => q.type === "choice" && !q.conceptQuestion && !q.carryForward,
  );
  return (
    <div className="workflow-stack">
      {error && <Notice>{error}</Notice>}
      {status && <p role="status">{status}</p>}
      <section className="panel">
        <div className="eyebrow">KEEP YOUR WORK CONNECTED</div>
        <h2>Researcher workflow</h2>
        <p className="muted">
          These controls use the saved draft. Save edits in Study design before
          applying a library item or restoring history.
        </p>
        <label>
          Study folder
          <select
            aria-label="Study folder"
            value={study.folderId || ""}
            disabled={busy || !library}
            onChange={(e) => {
              const id = e.target.value || null;
              void run(async () => {
                await api(`studies/${study.id}/folder`, "PUT", {
                  id,
                  version: study.version,
                });
              }, "Study moved.");
            }}
          >
            <option value="">Unfiled</option>
            {library?.folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        {study.researchGuidelines && (
          <details>
            <summary>Research guidelines copied at creation</summary>
            <p className="preserve">{study.researchGuidelines}</p>
          </details>
        )}
      </section>
      <section className="panel">
        <h2>Saved audiences</h2>
        <p className="muted">
          Reuse reviewed screeners. Applying an audience updates the audience
          description and adds its screeners before the current questions.
          Existing questions stay in the draft; review overlapping screeners
          before publishing.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api(`studies/${study.id}/audience`, "POST", {
                name,
                questionIds: ids,
                version: study.version,
              });
              setName("");
            }, "Audience saved to the workspace library.");
          }}
        >
          <label>
            Audience name
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <fieldset disabled={busy}>
            <legend>Screening questions to save</legend>
            {eligible.length ? (
              eligible.map((q) => (
                <label className="checkbox-label" key={q.id}>
                  <input
                    type="checkbox"
                    checked={ids.includes(q.id)}
                    onChange={(e) =>
                      setIds(
                        e.target.checked
                          ? [...ids, q.id]
                          : ids.filter((id) => id !== q.id),
                      )
                    }
                  />
                  {q.text}
                </label>
              ))
            ) : (
              <p>Add single-choice screeners in Study design first.</p>
            )}
          </fieldset>
          <p className="small muted">
            Include any earlier questions used by a selected screener’s routing.
            Screeners cannot depend on questions outside this selection.
          </p>
          <button className="button" disabled={busy || !ids.length}>
            Save audience
          </button>
        </form>
        <div className="workflow-stack">
          {library?.audiences.map((a) => (
            <div className="workflow-row" key={a.id}>
              <div>
                <strong>{a.name}</strong>
                <p>{a.description}</p>
              </div>
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  try {
                    setCandidate({
                      guide: applyAudience(study.draft, a, () =>
                        crypto.randomUUID(),
                      ),
                      label: a.name,
                      id: a.id,
                      kind: "audience",
                    });
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Review audience
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Guide history</h2>
        <p className="muted">
          Restore creates a new saved draft and a history entry. The published
          guide, fielding state, existing responses and interviews stay
          unchanged until you explicitly publish.
        </p>
        {!history ? (
          <Spinner />
        ) : (
          <div className="workflow-stack">
            {history.history.map((h) => (
              <div className="workflow-row" key={h.id}>
                <div>
                  <strong>
                    Draft v{h.version} · {h.action}
                  </strong>
                  <p>
                    {h.guide.title} · {h.actorName}
                  </p>
                  <small>
                    {new Date(h.createdAt).toLocaleString()}
                    {h.restoredFrom ? " · restored from a prior snapshot" : ""}
                  </small>
                </div>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    setCandidate({
                      guide: h.guide,
                      label: `Draft v${h.version}`,
                      id: h.id,
                      kind: "history",
                    })
                  }
                >
                  Review snapshot
                </button>
              </div>
            ))}
            {history.revisions.map((r, n) => (
              <div className="workflow-row" key={r.id}>
                <div>
                  <strong>
                    Published guide {history.revisions.length - n}
                  </strong>
                  <p>
                    {new Date(r.createdAt).toLocaleString()}
                    {study.revisionId === r.id
                      ? " · current published guide"
                      : ""}
                  </p>
                </div>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    setCandidate({
                      guide: r.guide,
                      label: "Published guide",
                      id: r.id,
                      kind: "revision",
                    })
                  }
                >
                  Review snapshot
                </button>
              </div>
            ))}
            {!history.history.length && !history.revisions.length && (
              <p>
                No earlier snapshots available. Your next save will preserve the
                current draft as a baseline.
              </p>
            )}
          </div>
        )}
      </section>
      {candidate && (
        <Modal
          title={
            candidate.kind === "audience"
              ? "Review audience addition"
              : "Review guide restore"
          }
          onClose={() => {
            if (!busy) setCandidate(null);
          }}
        >
          <h3>{candidate.label}</h3>
          <p>
            {candidate.kind === "audience"
              ? "Adds a fresh copy of these screeners to the saved draft. Existing questions are retained."
              : "Replaces the entire saved draft, including its title, introduction, routing and concept setup. This does not republish the study."}
          </p>
          <p>
            <strong>{candidate.guide.title}</strong>
          </p>
          <p>{candidate.guide.goal}</p>
          <p>
            <strong>Audience:</strong> {candidate.guide.audience}
          </p>
          <p className="preserve">{candidate.guide.intro}</p>
          <p>
            Participant limit: {candidate.guide.limit} · Concepts:{" "}
            {candidate.guide.conceptTest?.concepts.length || 0}
          </p>
          <details>
            <summary>Routing and stimulus details</summary>
            <pre className="preserve small">
              {JSON.stringify(candidate.guide, null, 2)}
            </pre>
          </details>
          <ol className="draft-preview">
            {candidate.guide.questions.map((q) => (
              <li key={q.id}>
                <strong>{q.text}</strong>
                <small>
                  {q.type} · {q.section}
                  {q.conceptQuestion ? " · repeated for each concept" : ""}
                </small>
                {q.options.length > 0 && (
                  <p className="small">
                    {q.options
                      .map((o) => o.text + (o.rejects ? " (screens out)" : ""))
                      .join(" / ")}
                  </p>
                )}
              </li>
            ))}
          </ol>
          {error && <Notice>{error}</Notice>}
          <div className="modal-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => setCandidate(null)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void run(
                  async () => {
                    await api(
                      `studies/${study.id}/${candidate.kind === "audience" ? "audience" : "restore"}`,
                      candidate.kind === "audience" ? "PUT" : "POST",
                      {
                        version: study.version,
                        id: candidate.id,
                        source:
                          candidate.kind === "revision"
                            ? "revision"
                            : "history",
                      },
                    );
                  },
                  candidate.kind === "audience"
                    ? "Audience added to the draft. Review screeners before publishing."
                    : "Snapshot restored as a new draft. Published guide unchanged.",
                )
              }
            >
              {busy ? <Spinner /> : null}
              {candidate.kind === "audience"
                ? "Add audience to draft"
                : "Restore as new draft"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
