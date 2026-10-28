"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { backgroundLabels, type BackgroundView } from "@/lib/background-jobs";
import type { Language } from "@/lib/localization";
import { Notice } from "./components";
export type BackgroundTarget = {
  id: string;
  studyId: string;
  kind: "transcription" | "render";
  version: number;
  label: string;
};
export default function BackgroundJobsPanel({
  language = "en",
  studyId,
  targetId,
  targets = [],
}: {
  language?: Language;
  studyId?: string;
  targetId?: string;
  targets?: BackgroundTarget[];
}) {
  const l = backgroundLabels[language];
  const [jobs, setJobs] = useState<BackgroundView[]>([]),
    [canEdit, setCanEdit] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(""),
    [approved, setApproved] = useState(false);
  const generation = useRef(0),
    working = useRef(false),
    request = useRef<{ key: string; id: string } | null>(null);
  const query = new URLSearchParams({
      ...(studyId ? { studyId } : {}),
      ...(targetId ? { targetId } : {}),
    }).toString(),
    root = "background-jobs" + (query ? "?" + query : "");
  async function load(g = generation.current) {
    const r = await api<{ jobs: BackgroundView[]; canEdit: boolean }>(root);
    if (generation.current === g) {
      setJobs(r.jobs);
      setCanEdit(r.canEdit);
    }
  }
  useEffect(() => {
    const g = ++generation.current;
    setJobs([]);
    setError("");
    setSelected("");
    setApproved(false);
    request.current = null;
    void load(g).catch((e) => {
      if (generation.current === g) setError(e.message);
    });
    const timer = setInterval(() => {
      if (!working.current && !document.hidden)
        void load(g).catch((e) => {
          if (generation.current === g) {
            setJobs([]);
            setError(e.message);
          }
        });
    }, 5000);
    return () => {
      generation.current++;
      clearInterval(timer);
    };
    // Scope changes discard private UI state; writes are never automatically retried.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);
  const target = targets.find((t) => t.id === selected);
  async function mutate(fn: () => Promise<unknown>) {
    const g = generation.current;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      if (generation.current === g) {
        setApproved(false);
        await load(g);
      }
    } catch (e) {
      if (generation.current === g) {
        setError((e as Error).message);
        try {
          await load(g);
        } catch {
          setJobs([]);
        }
      }
    } finally {
      working.current = false;
      if (generation.current === g) setBusy(false);
    }
  }
  return (
    <section
      className="panel library-stack"
      aria-label={l.title}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <h3>{l.title}</h3>
      <p className="muted">{l.notice}</p>
      {error && <Notice>{error}</Notice>}
      <button disabled={busy} onClick={() => void mutate(() => load())}>
        {l.refresh}
      </button>
      {targets.length > 0 && (
        <fieldset disabled={busy || !canEdit} className="library-stack">
          <label>
            {language === "es"
              ? "Fuente"
              : language === "fr"
                ? "Source"
                : "Source"}
            <select
              aria-label={
                language === "es"
                  ? "Fuente para el trabajo"
                  : language === "fr"
                    ? "Source de la tâche"
                    : "Job source"
              }
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setApproved(false);
                request.current = null;
              }}
            >
              <option value="">—</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} · {t.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            {l.permission}
          </label>
          <button
            disabled={!target || !approved}
            onClick={() =>
              void mutate(async () => {
                if (!target) return;
                const key = `${target.kind}:${target.id}:${target.version}`;
                if (request.current?.key !== key)
                  request.current = { key, id: crypto.randomUUID() };
                await api("background-jobs", "POST", {
                  requestId: request.current.id,
                  kind: target.kind,
                  targetId: target.id,
                  studyId: target.studyId,
                  version: target.version,
                  permissionConfirmed: true,
                });
              })
            }
          >
            {l.start}
          </button>
        </fieldset>
      )}
      {jobs.length === 0 && <p>{l.empty}</p>}
      {jobs.map((j) => (
        <article key={j.id} className="report-job">
          <strong>
            {l[j.kind]} · {j.targetId}
          </strong>
          <p role="status">
            {l[j.state]} · {j.completed}/{j.total} · {l.attempts}: {j.attempts}
          </p>
          {j.dispatchPending && j.state === "queued" && <p>{l.pending}</p>}
          {j.error && <p>{l.error}</p>}
          {canEdit && !["complete", "cancelled"].includes(j.state) && (
            <div className="inline">
              <button
                disabled={busy}
                onClick={() => {
                  if (window.confirm(l.confirm))
                    void mutate(() =>
                      api("background-jobs/" + j.id, "PATCH", {
                        version: j.version,
                        op: "cancel",
                      }),
                    );
                }}
              >
                {l.cancel}
              </button>
              {j.state === "failed" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void mutate(() =>
                      api("background-jobs/" + j.id, "PATCH", {
                        version: j.version,
                        op: "retry",
                      }),
                    )
                  }
                >
                  {l.retry}
                </button>
              )}
              {j.state === "queued" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void mutate(() =>
                      api("background-jobs/" + j.id, "PATCH", {
                        version: j.version,
                        op: "dispatch",
                      }),
                    )
                  }
                >
                  {l.dispatch}
                </button>
              )}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
