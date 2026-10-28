"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import {
  dashboardLabels,
  type CollectionDashboard,
} from "@/lib/collection-review";
import type { Language } from "@/lib/localization";
import CollectionHandoffPanel from "./collection-handoff-panel";
import CollectionTasksPanel from "./collection-tasks-panel";
import { taskLabels, type CollectionTask } from "@/lib/collection-tasks";
import LibrarySavedAnswers from "./library-saved-answers";
export default function CollectionReviewPanel({
  id,
  language,
  openSource,
  openBrief,
  close,
}: {
  id: string;
  language: Language;
  openSource: (id: string) => Promise<void>;
  openBrief: (id: string) => void;
  close: () => void;
}) {
  const [handoffRefresh, setHandoffRefresh] = useState(0);
  const [follow, setFollow] = useState<{
    target: CollectionTask["target"];
  } | null>(null);
  const [data, setData] = useState<CollectionDashboard | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [checked, setChecked] = useState(false),
    [answer, setAnswer] = useState<
      CollectionDashboard["answers"][number] | null
    >(null);
  const l = dashboardLabels[language],
    epoch = useRef(0),
    controller = useRef<AbortController | null>(null),
    root = `library/collections/${id}/dashboard`;
  async function run(check = false) {
    const c = new AbortController(),
      g = ++epoch.current;
    controller.current?.abort();
    controller.current = c;
    setBusy(true);
    setError("");
    setNotice("");
    setChecked(false);
    try {
      const v = await api<{ dashboard: CollectionDashboard }>(
        root + (check ? "/check" : ""),
        check ? "POST" : "GET",
        check
          ? {
              collectionVersion: data!.collection.version,
              reviewVersion: data!.reviewVersion,
              signature: data!.signature,
              checked: true,
            }
          : undefined,
        undefined,
        c.signal,
      );
      if (epoch.current === g) {
        setData(v.dashboard);
        setHandoffRefresh((n) => n + 1);
        if (check) setNotice(l.saved);
      }
    } catch (e) {
      if (epoch.current === g) {
        setData(null);
        setError((e as Error).message);
      }
    } finally {
      if (epoch.current === g) setBusy(false);
    }
  }
  useEffect(() => {
    setData(null);
    setFollow(null);
    setAnswer(null);
    void run();
    return () => {
      epoch.current++;
      controller.current?.abort();
    };
  }, [id, language]);
  return (
    <section
      className="panel library-stack"
      aria-label={l.title}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <h3>{l.title}</h3>
      <p className="muted">{l.notice}</p>
      <button disabled={busy} onClick={() => void run()}>
        {l.refresh}
      </button>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {data && (
        <>
          <h4>{data.collection.title}</h4>
          <p>
            {l.coverage}:{" "}
            <strong>
              {data.coverage.cited}/{data.coverage.total}
            </strong>
          </p>
          <p>
            {l.uncited}: {data.coverage.uncited}
          </p>
          <p>
            {l.checked}:{" "}
            {data.checkedAt
              ? new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(data.checkedAt))
              : l.unchecked}
          </p>
          <section aria-label={l.changes}>
            <h4>{l.changes}</h4>
            <p>
              {l.unchecked}: {data.changes.unchecked} · {l.added}:{" "}
              {data.changes.added} · {l.changed}: {data.changes.changed} ·{" "}
              {l.unchanged}: {data.changes.unchanged} · {l.removed}:{" "}
              {data.changes.removed}
            </p>
          </section>
          <label className="check-row">
            <input
              type="checkbox"
              checked={checked}
              disabled={busy || !data.canCheck}
              onChange={(e) => setChecked(e.target.checked)}
            />
            {l.attest}
          </label>
          <button
            disabled={busy || !data.canCheck || !checked}
            onClick={() => void run(true)}
          >
            {l.check}
          </button>
          <CollectionHandoffPanel
            id={id}
            language={language}
            refresh={handoffRefresh}
          />
          <CollectionTasksPanel
            id={id}
            language={language}
            dashboard={data}
            requested={follow}
            changed={() => setHandoffRefresh((n) => n + 1)}
            openTarget={(t) => {
              if (t.kind === "interview") void openSource(t.id);
              else if (t.kind === "brief") openBrief(t.id);
              else {
                const a = data.answers.find((a) => a.id === t.id);
                if (a) setAnswer(a);
                else void run();
              }
            }}
          />
          <section aria-label={l.sources}>
            <h4>{l.sources}</h4>
            {data.interviews.map((i) => (
              <article
                key={i.id}
                data-dashboard-interview={i.id}
                className="panel"
              >
                <h5>{i.title}</h5>
                <p>
                  {i.studyTitle} · v{i.sourceVersion} · {l[i.change]}
                </p>
                <p>
                  {l.citations}: {i.approvedCitations}
                </p>
                <button disabled={busy} onClick={() => void openSource(i.id)}>
                  {l.openSource}
                </button>
                {data.canCheck && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      setFollow({ target: { kind: "interview", id: i.id } })
                    }
                  >
                    {taskLabels[language].follow}
                  </button>
                )}
              </article>
            ))}
          </section>
          <section aria-label={l.findings}>
            <h4>{l.findings}</h4>
            <p>
              {l.draft}:{" "}
              {data.answers.filter((a) => a.status === "draft").length} ·{" "}
              {l.reviewed}:{" "}
              {data.answers.filter((a) => a.status === "reviewed").length} ·{" "}
              {l.approved}:{" "}
              {data.answers.filter((a) => a.status === "approved").length}
            </p>
            {!data.answers.length && <p>{l.emptyAnswers}</p>}
            {data.answers.map((a) => (
              <article
                key={a.id}
                data-dashboard-answer={a.id}
                className="panel"
              >
                <h5>{a.question}</h5>
                <p>
                  {a.scope} · v{a.version} · {l[a.status]}
                </p>
                <button disabled={busy} onClick={() => setAnswer(a)}>
                  {l.openAnswer}
                </button>
                {data.canCheck && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      setFollow({ target: { kind: "answer", id: a.id } })
                    }
                  >
                    {taskLabels[language].follow}
                  </button>
                )}
              </article>
            ))}
          </section>
          <section aria-label={l.briefs}>
            <h4>{l.briefs}</h4>
            {!data.briefs.length && <p>{l.emptyBriefs}</p>}
            {data.briefs.map((b) => (
              <article key={b.id} data-dashboard-brief={b.id} className="panel">
                <h5>{b.title}</h5>
                <p>
                  v{b.version} · {l[b.status]}
                </p>
                <button disabled={busy} onClick={() => openBrief(b.id)}>
                  {l.openBrief}
                </button>
                {data.canCheck && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      setFollow({ target: { kind: "brief", id: b.id } })
                    }
                  >
                    {taskLabels[language].follow}
                  </button>
                )}
              </article>
            ))}
          </section>
          {!data.coverage.total &&
            !data.answers.length &&
            !data.briefs.length && <p>{l.none}</p>}
        </>
      )}
      <button disabled={busy} onClick={close}>
        {l.close}
      </button>
      {answer && (
        <section aria-label={l.openAnswer}>
          <LibrarySavedAnswers
            onlyId={answer.id}
            scope={answer.scope}
            language={language}
            refresh={0}
            openResponse={openSource}
            closed={() => {
              setAnswer(null);
              void run();
            }}
          />
          <button
            onClick={() => {
              setAnswer(null);
              void run();
            }}
          >
            {l.closeAnswer}
          </button>
        </section>
      )}
    </section>
  );
}
