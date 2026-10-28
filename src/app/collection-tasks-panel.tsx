"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import {
  taskLabels,
  type TaskPlan,
  type TaskView,
  type CollectionTask,
} from "@/lib/collection-tasks";
import type { CollectionDashboard } from "@/lib/collection-review";
import type { Language } from "@/lib/localization";
type Target = CollectionTask["target"];
type Draft = {
  title: string;
  assigneeId: string;
  dueDate: string;
  status: TaskView["status"];
  target: Target;
  requestId: string;
  existing?: TaskView;
};
export default function CollectionTasksPanel({
  id,
  language,
  dashboard,
  requested,
  changed,
  openTarget,
}: {
  id: string;
  language: Language;
  dashboard: CollectionDashboard;
  requested: { target: Target } | null;
  changed?: () => void;
  openTarget: (target: NonNullable<Target>) => void;
}) {
  const l = taskLabels[language],
    root = `library/collections/${id}/tasks`,
    epoch = useRef(0),
    controller = useRef<AbortController | null>(null),
    titleInput = useRef<HTMLInputElement | null>(null);
  const [plan, setPlan] = useState<(TaskPlan & { userId: string }) | null>(
      null,
    ),
    [draft, setDraft] = useState<Draft | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [filter, setFilter] = useState("all");
  function start(target: Target = null) {
    setNotice("");
    setDraft({
      title: "",
      assigneeId: "",
      dueDate: "",
      status: "open",
      target,
      requestId: crypto.randomUUID(),
    });
  }
  async function run(action?: () => Promise<unknown>, message = "") {
    const g = ++epoch.current,
      c = new AbortController();
    controller.current?.abort();
    controller.current = c;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (action) await action();
      if (g !== epoch.current) return;
      const data = await api<TaskPlan & { userId: string }>(
        root,
        "GET",
        undefined,
        undefined,
        c.signal,
      );
      if (g === epoch.current) {
        setPlan(data);
        if (action) {
          setDraft(null);
          changed?.();
        }
        setNotice(message);
      }
    } catch (e) {
      if (g === epoch.current) {
        setError((e as Error).message);
        setPlan(null);
        setDraft(null);
      }
    } finally {
      if (g === epoch.current) setBusy(false);
    }
  }
  useEffect(() => {
    setPlan(null);
    setDraft(null);
    setFilter("all");
    void run();
    return () => {
      epoch.current++;
      controller.current?.abort();
    };
  }, [id, language, dashboard.signature]);
  useEffect(() => {
    if (requested) start(requested.target);
  }, [requested]);
  useEffect(() => {
    if (draft) {
      titleInput.current?.focus();
      titleInput.current?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }
  }, [draft?.requestId]);
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const overdue = (t: TaskView) =>
    t.status !== "completed" && !!t.dueDate && t.dueDate < today();
  const targetName = (t: Target) =>
    !t
      ? l.general
      : t.kind === "interview"
        ? dashboard.interviews.find((i) => i.id === t.id)?.title
        : t.kind === "answer"
          ? dashboard.answers.find((a) => a.id === t.id)?.question
          : dashboard.briefs.find((b) => b.id === t.id)?.title;
  const targets: { target: NonNullable<Target>; name: string }[] = [
    ...dashboard.interviews.map((i) => ({
      target: { kind: "interview" as const, id: i.id },
      name: i.title,
    })),
    ...dashboard.answers.map((a) => ({
      target: { kind: "answer" as const, id: a.id },
      name: a.question,
    })),
    ...dashboard.briefs.map((b) => ({
      target: { kind: "brief" as const, id: b.id },
      name: b.title,
    })),
  ];
  return (
    <section
      className="panel library-stack"
      aria-label={l.title}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <h4>{l.title}</h4>
      <p className="muted">{l.notice}</p>
      <button disabled={busy} onClick={() => void run()}>
        {l.refresh}
      </button>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {plan && (
        <>
          <p>
            {l.count}: {plan.tasks.length} · {l.done}:{" "}
            {plan.tasks.filter((t) => t.status === "completed").length} ·{" "}
            {l.overdue}: {plan.tasks.filter(overdue).length}
          </p>
          <label>
            {l.filter}
            <select
              aria-label={l.filter}
              value={filter}
              disabled={busy}
              onChange={(e) => setFilter(e.target.value)}
            >
              {(["all", "mine", "overdue", "active", "completed"] as const).map(
                (k) => (
                  <option key={k} value={k}>
                    {l[k]}
                  </option>
                ),
              )}
            </select>
          </label>
          {plan.canEdit && (
            <button disabled={busy} onClick={() => start()}>
              {l.add}
            </button>
          )}
          {draft && plan.canEdit && (
            <form
              className="panel library-stack"
              aria-label={draft.existing ? l.edit : l.add}
              onSubmit={(e) => {
                e.preventDefault();
                const content = {
                  title: draft.title,
                  assigneeId: draft.assigneeId || null,
                  dueDate: draft.dueDate || null,
                  status: draft.status,
                };
                void run(
                  () =>
                    api(
                      root + (draft.existing ? "/" + draft.existing.id : ""),
                      draft.existing ? "PUT" : "POST",
                      draft.existing
                        ? { ...content, version: draft.existing.version }
                        : {
                            ...content,
                            requestId: draft.requestId,
                            target: draft.target,
                          },
                    ),
                  l.saved,
                );
              }}
            >
              <label>
                {l.task}
                <input
                  ref={titleInput}
                  required
                  minLength={3}
                  maxLength={160}
                  value={draft.title}
                  disabled={busy}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                />
              </label>
              <label>
                {l.assignee}
                <select
                  aria-label={l.assignee}
                  value={draft.assigneeId}
                  disabled={busy}
                  onChange={(e) =>
                    setDraft({ ...draft, assigneeId: e.target.value })
                  }
                >
                  <option value="">{l.unassigned}</option>
                  {plan.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {l.due}
                <input
                  type="date"
                  min="2000-01-01"
                  max="2100-12-31"
                  value={draft.dueDate}
                  disabled={busy}
                  onChange={(e) =>
                    setDraft({ ...draft, dueDate: e.target.value })
                  }
                />
              </label>
              <label>
                {l.status}
                <select
                  aria-label={l.status}
                  value={draft.status}
                  disabled={busy}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      status: e.target.value as Draft["status"],
                    })
                  }
                >
                  {(["open", "in_progress", "completed"] as const).map((k) => (
                    <option key={k} value={k}>
                      {l[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {l.target}
                <select
                  aria-label={l.target}
                  disabled={busy || !!draft.existing}
                  value={
                    draft.target
                      ? `${draft.target.kind}:${draft.target.id}`
                      : ""
                  }
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      target:
                        targets.find(
                          (t) =>
                            `${t.target.kind}:${t.target.id}` ===
                            e.target.value,
                        )?.target || null,
                    })
                  }
                >
                  <option value="">{l.general}</option>
                  {targets.map((t) => (
                    <option
                      key={`${t.target.kind}:${t.target.id}`}
                      value={`${t.target.kind}:${t.target.id}`}
                    >
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy} type="submit">
                {l.save}
              </button>
              <button
                disabled={busy}
                type="button"
                onClick={() => setDraft(null)}
              >
                {l.cancel}
              </button>
            </form>
          )}
          {(() => {
            const tasks = plan.tasks
              .filter((t) =>
                filter === "mine"
                  ? t.assigneeId === plan.userId
                  : filter === "overdue"
                    ? overdue(t)
                    : filter === "active"
                      ? t.status !== "completed"
                      : filter === "completed"
                        ? t.status === "completed"
                        : true,
              )
              .sort(
                (a, b) =>
                  Number(a.status === "completed") -
                    Number(b.status === "completed") ||
                  (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
                  a.createdAt.localeCompare(b.createdAt),
              );
            return tasks.length ? (
              tasks.map((t) => (
                <article
                  key={t.id}
                  data-collection-task={t.id}
                  className="panel"
                >
                  <h5>{t.title}</h5>
                  <p>
                    {l[t.status]} ·{" "}
                    {plan.members.find((m) => m.id === t.assigneeId)?.name ||
                      l.unassigned}
                  </p>
                  {t.completedAt && (
                    <p>
                      {l.completed}:{" "}
                      <time dateTime={t.completedAt}>
                        {new Intl.DateTimeFormat(language, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(t.completedAt))}
                      </time>
                    </p>
                  )}
                  {t.dueDate && (
                    <p>
                      {l.due}: <time dateTime={t.dueDate}>{t.dueDate}</time>
                      {overdue(t) ? ` · ${l.overdue}` : ""}
                    </p>
                  )}
                  <p>
                    {l.target}: {targetName(t.target) || l.source}
                  </p>
                  {t.target && (
                    <button
                      disabled={busy}
                      onClick={() => openTarget(t.target!)}
                    >
                      {l.source}
                    </button>
                  )}
                  {plan.canEdit && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setNotice("");
                          setDraft({
                            title: t.title,
                            assigneeId: t.assigneeId || "",
                            dueDate: t.dueDate || "",
                            status: t.status,
                            target: t.target,
                            requestId: crypto.randomUUID(),
                            existing: t,
                          });
                        }}
                      >
                        {l.edit}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(l.confirm))
                            void run(
                              () =>
                                api(root + "/" + t.id, "DELETE", {
                                  version: t.version,
                                }),
                              l.deleted,
                            );
                        }}
                      >
                        {l.remove}
                      </button>
                    </>
                  )}
                </article>
              ))
            ) : (
              <p>{l.empty}</p>
            );
          })()}
        </>
      )}
    </section>
  );
}
