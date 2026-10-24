"use client";
import { useEffect, useRef, useState } from "react";
import HandoffFeedbackPanel from "./handoff-feedback-panel";
import { feedbackLabels } from "@/lib/handoff-feedback";
import { api } from "@/lib/client";
import { languages, languageNames, type Language } from "@/lib/localization";
import {
  handoffLabels,
  type HandoffDetails,
  type HandoffContent,
} from "@/lib/collection-handoff";
export default function CollectionHandoffPanel({
  id,
  language,
  refresh,
  expectedId,
}: {
  id: string;
  language: Language;
  refresh: number;
  expectedId?: string;
}) {
  const l = handoffLabels[language],
    root = `library/collections/${id}/handoff`,
    epoch = useRef(0),
    controller = useRef<AbortController | null>(null),
    requestId = useRef("");
  const [data, setData] = useState<HandoffDetails | null>(null),
    [draft, setDraft] = useState<HandoffContent | null>(null),
    [feedbackDirty, setFeedbackDirty] = useState(false),
    [dirty, setDirty] = useState(false),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  function apply(v: HandoffDetails) {
    setData(v);
    const p = v.packet;
    setDraft(
      p
        ? {
            title: p.title,
            summary: p.summary,
            language: p.language,
            answerIds: p.answerIds,
            taskIds: p.taskIds,
          }
        : {
            title: v.collection.title,
            summary: "",
            language,
            answerIds: [],
            taskIds: [],
          },
    );
    setDirty(false);
    setFeedbackDirty(false);
    setChecked(false);
    if (!p) requestId.current = crypto.randomUUID();
  }
  async function run(action?: () => Promise<unknown>, message = "") {
    const g = ++epoch.current,
      c = new AbortController();
    controller.current?.abort();
    controller.current = c;
    setBusy(true);
    setError("");
    setNotice("");
    setChecked(false);
    try {
      if (action) await action();
      if (g !== epoch.current) return;
      const v = await api<HandoffDetails>(
        root,
        "GET",
        undefined,
        undefined,
        c.signal,
      );
      if (g === epoch.current) {
        if (expectedId && v.packet?.id !== expectedId)
          throw Error(
            "This inbox packet is no longer current. Close it and refresh the inbox.",
          );
        apply(v);
        setNotice(message);
      }
    } catch (e) {
      if (g === epoch.current) {
        setData(null);
        setDraft(null);
        setError((e as Error).message);
      }
    } finally {
      if (g === epoch.current) setBusy(false);
    }
  }
  useEffect(() => {
    setData(null);
    setDraft(null);
    void run();
    return () => {
      epoch.current++;
      controller.current?.abort();
    };
  }, [id, language, refresh, expectedId]);
  useEffect(() => {
    if (feedbackDirty) setChecked(false);
  }, [feedbackDirty]);
  function edit(v: Partial<HandoffContent>) {
    setDraft((d) => ({ ...d!, ...v }));
    setDirty(true);
    setChecked(false);
    setNotice("");
  }
  function select(key: "answerIds" | "taskIds", value: string, on: boolean) {
    edit({
      [key]: on
        ? [...draft![key], value]
        : draft![key].filter((id) => id !== value),
    });
  }
  async function download(format: "md" | "csv") {
    if (!data?.packet || dirty) return;
    const p = data.packet,
      q = new URLSearchParams({
        id: p.id,
        version: String(p.version),
        signature: data.signature,
        format,
      });
    await run(async () => {
      const r = await fetch(`/api/${root}/export?${q}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!r.ok) throw Error((await r.json()).error || "Download failed.");
      const blob = await r.blob(),
        url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = `echo-lab-handoff-${p.id}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  const eligible =
    !!data &&
    !!draft &&
    draft.answerIds.every((id) =>
      data.answers.some((a) => a.id === id && a.approved),
    ) &&
    draft.taskIds.every((id) =>
      data.tasks.some((t) => t.id === id && t.status !== "completed"),
    );
  return (
    <section
      className="panel library-stack"
      aria-label={l.title}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <h4>{l.title}</h4>
      <p className="muted">{l.notice}</p>
      <button className="button" disabled={busy} onClick={() => void run()}>
        {l.refresh}
      </button>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {data && draft && (
        <>
          <p>
            {data.packet
              ? data.packet.canExport && !dirty
                ? l.approved
                : l.draft
              : l.none}
          </p>
          <form
            className="library-stack"
            aria-label={l.title}
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  api(
                    root,
                    data.packet ? "PUT" : "POST",
                    data.packet
                      ? {
                          ...draft,
                          id: data.packet.id,
                          version: data.packet.version,
                        }
                      : { ...draft, requestId: requestId.current },
                  ),
                l.saved,
              );
            }}
          >
            <fieldset
              className="library-stack"
              disabled={busy || !data.canEdit || feedbackDirty}
            >
              <label>
                {l.name}
                <input
                  aria-label={l.name}
                  minLength={3}
                  maxLength={160}
                  required
                  value={draft.title}
                  onChange={(e) => edit({ title: e.target.value })}
                />
              </label>
              <label>
                {l.summary}
                <textarea
                  aria-label={l.summary}
                  maxLength={8000}
                  rows={5}
                  value={draft.summary}
                  onChange={(e) => edit({ summary: e.target.value })}
                />
              </label>
              <label>
                {l.language}
                <select
                  aria-label={l.language}
                  value={draft.language}
                  onChange={(e) =>
                    edit({ language: e.target.value as Language })
                  }
                >
                  {languages.map((k) => (
                    <option key={k} value={k}>
                      {languageNames[k]}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend>
                  {l.findings} ({draft.answerIds.length}/20)
                </legend>
                {data.answers.map((a) => (
                  <label className="check-row" key={a.id}>
                    <input
                      type="checkbox"
                      checked={draft.answerIds.includes(a.id)}
                      disabled={
                        !draft.answerIds.includes(a.id) &&
                        (!a.approved || draft.answerIds.length >= 20)
                      }
                      onChange={(e) =>
                        select("answerIds", a.id, e.target.checked)
                      }
                    />
                    {a.question} · v{a.version} ·{" "}
                    {a.approved ? l.approved : l.draft}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>
                  {l.tasks} ({draft.taskIds.length}/50)
                </legend>
                {data.tasks.map((t) => (
                  <label className="check-row" key={t.id}>
                    <input
                      type="checkbox"
                      checked={draft.taskIds.includes(t.id)}
                      disabled={
                        !draft.taskIds.includes(t.id) &&
                        (t.status === "completed" || draft.taskIds.length >= 50)
                      }
                      onChange={(e) =>
                        select("taskIds", t.id, e.target.checked)
                      }
                    />
                    {t.title} · {l[t.status]}
                  </label>
                ))}
              </fieldset>
              {!eligible && <p role="status">{l.changed}</p>}
              <button
                className="button"
                type="submit"
                disabled={
                  feedbackDirty || !eligible || (!dirty && !!data.packet)
                }
              >
                {data.packet ? l.save : l.create}
              </button>
            </fieldset>
          </form>
          {data.packet && (
            <>
              {data.feedback && (
                <HandoffFeedbackPanel
                  key={
                    data.packet.id +
                    ":" +
                    data.packet.version +
                    ":" +
                    data.feedback.version
                  }
                  data={data}
                  language={language}
                  disabled={busy || dirty}
                  eligible={eligible}
                  onDirty={setFeedbackDirty}
                  onAction={(input) =>
                    void run(
                      () => api(root + "/feedback", "POST", input),
                      feedbackLabels[language].saved,
                    )
                  }
                />
              )}
              <h5>{l.preview}</h5>
              <pre
                className="preserve-lines"
                style={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  maxHeight: 420,
                  overflowY: "auto",
                }}
              >
                {data.preview}
              </pre>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={
                    busy ||
                    dirty ||
                    feedbackDirty ||
                    data.feedback?.ready === false ||
                    !eligible ||
                    !data.canEdit
                  }
                  onChange={(e) => setChecked(e.target.checked)}
                />
                {l.attest}
              </label>
              <button
                className="button"
                disabled={
                  busy ||
                  dirty ||
                  feedbackDirty ||
                  data.feedback?.ready === false ||
                  !eligible ||
                  !checked ||
                  !data.canEdit
                }
                onClick={() =>
                  void run(
                    () =>
                      api(root + "/review", "POST", {
                        id: data.packet!.id,
                        version: data.packet!.version,
                        signature: data.signature,
                        reviewed: true,
                      }),
                    l.reviewed,
                  )
                }
              >
                {l.approve}
              </button>
              {data.canEdit && (
                <button
                  className="button"
                  disabled={
                    busy || feedbackDirty || !data.packet.canExport || dirty
                  }
                  onClick={() =>
                    void run(
                      () =>
                        api(root + "/review", "POST", {
                          id: data.packet!.id,
                          version: data.packet!.version,
                          signature: data.signature,
                          reviewed: false,
                        }),
                      l.reviewed,
                    )
                  }
                >
                  {l.withdraw}
                </button>
              )}
              <div className="toolbar">
                <button
                  className="button"
                  disabled={
                    busy || dirty || feedbackDirty || !data.packet.canExport
                  }
                  onClick={() => void download("md")}
                >
                  {l.md}
                </button>
                <button
                  className="button"
                  disabled={
                    busy || dirty || feedbackDirty || !data.packet.canExport
                  }
                  onClick={() => void download("csv")}
                >
                  {l.csv}
                </button>
              </div>
              {data.canEdit && (
                <button
                  className="button danger"
                  disabled={busy || feedbackDirty}
                  onClick={() => {
                    if (confirm(l.confirm))
                      void run(
                        () =>
                          api(root, "DELETE", {
                            id: data.packet!.id,
                            version: data.packet!.version,
                          }),
                        l.deleted,
                      );
                  }}
                >
                  {l.remove}
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
