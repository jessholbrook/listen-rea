"use client";
import ReviewPlansPanel from "./review-plans-panel";
import { useEffect, useRef, useState } from "react";
import type { HandoffDetails } from "@/lib/collection-handoff";
import { feedbackLabels, type FeedbackInput } from "@/lib/handoff-feedback";
import { localCalendarDay } from "@/lib/research-action-center";
import { deadlineLabels, reviewOverdue } from "@/lib/review-deadlines";
import type { Language } from "@/lib/localization";
export default function HandoffFeedbackPanel({
  data,
  language,
  disabled: externalDisabled,
  eligible,
  onAction,
  onDirty,
}: {
  data: HandoffDetails;
  language: Language;
  disabled: boolean;
  eligible: boolean;
  onAction: (input: FeedbackInput) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const r = data.feedback!,
    p = data.packet!,
    l = feedbackLabels[language],
    dl = deadlineLabels[language],
    [planActive, setPlanActive] = useState(false),
    disabled = externalDisabled || planActive,
    [today, setToday] = useState(localCalendarDay),
    [dates, setDates] = useState<Record<string, string>>(
      Object.fromEntries(r.reviewers.map((v) => [v.id, v.dueDate || ""])),
    ),
    [reviewers, setReviewers] = useState(r.reviewers.map((v) => v.id)),
    [body, setBody] = useState(""),
    requestId = useRef(crypto.randomUUID());
  const assignmentDirty =
      JSON.stringify([...reviewers].sort()) !==
      JSON.stringify(r.reviewers.map((v) => v.id).sort()),
    commentDirty = body.trim().length > 0,
    deadlineDirty = r.reviewers.some(
      (v) => (dates[v.id] || "") !== (v.dueDate || ""),
    ),
    pending = assignmentDirty || commentDirty || deadlineDirty;
  useEffect(() => {
    onDirty(pending || planActive);
  }, [pending, planActive, onDirty]);
  useEffect(() => {
    const tick = () => setToday(localCalendarDay()),
      timer = window.setInterval(tick, 60000);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, []);
  function send(action: Record<string, unknown>) {
    onAction({
      ...action,
      id: p.id,
      packetVersion: p.version,
      version: r.version,
      signature: data.signature,
    } as FeedbackInput);
  }
  const mine = r.reviewers.find((v) => v.id === r.userId),
    options = [
      ...r.members,
      ...r.reviewers
        .filter((v) => !r.members.some((m) => m.id === v.id))
        .map((v) => ({ id: v.id, name: l.unavailable })),
    ];
  return (
    <section
      className="panel library-stack handoff-feedback"
      aria-label={l.title}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <h5>{l.title}</h5>
      <p className="muted">{l.notice}</p>
      <p>{r.ready ? l.ready : l.blocked}</p>
      {data.canEdit && (
        <ReviewPlansPanel
          language={language}
          members={r.members}
          disabled={externalDisabled || pending}
          onDirty={setPlanActive}
          onApply={send}
        />
      )}
      <fieldset
        disabled={disabled || !data.canEdit || commentDirty || deadlineDirty}
      >
        <legend>
          {l.reviewers} ({reviewers.length}/10)
        </legend>
        {options.map((m) => (
          <label className="check-row" key={m.id}>
            <input
              type="checkbox"
              checked={reviewers.includes(m.id)}
              disabled={!reviewers.includes(m.id) && reviewers.length >= 10}
              onChange={(e) =>
                setReviewers(
                  e.target.checked
                    ? [...reviewers, m.id]
                    : reviewers.filter((id) => id !== m.id),
                )
              }
            />
            {m.name}
          </label>
        ))}
        <button
          className="button"
          disabled={!assignmentDirty}
          onClick={() => send({ op: "assign", reviewerIds: reviewers })}
        >
          {l.assign}
        </button>
      </fieldset>
      {!!r.reviewers.length && <p className="muted">{dl.notice}</p>}
      {r.reviewers.map((v) => {
        const dirty = (dates[v.id] || "") !== (v.dueDate || "");
        return (
          <div
            className="library-stack"
            key={v.id}
            data-handoff-reviewer={v.id}
          >
            <p>
              {v.name || l.unavailable} ·{" "}
              {v.approvedAt ? l.approved : l.pending}
            </p>
            <p>
              {dl.due}:{" "}
              {v.dueDate ? (
                <time dateTime={v.dueDate}>{v.dueDate}</time>
              ) : (
                dl.none
              )}
              {reviewOverdue(v, today)
                ? ` · ${dl.overdue}`
                : !v.approvedAt && v.dueDate === today
                  ? ` · ${dl.today}`
                  : ""}
            </p>
            {data.canEdit && (
              <form
                className="library-stack"
                aria-label={`${dl.due}: ${v.name || l.unavailable}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  send({
                    op: "deadline",
                    reviewerId: v.id,
                    dueDate: dates[v.id] || null,
                  });
                }}
              >
                <label>
                  {dl.due}
                  <input
                    aria-label={dl.due}
                    type="date"
                    min="2000-01-01"
                    max="2100-12-31"
                    value={dates[v.id] || ""}
                    disabled={
                      disabled ||
                      assignmentDirty ||
                      commentDirty ||
                      (deadlineDirty && !dirty)
                    }
                    onChange={(e) =>
                      setDates({ ...dates, [v.id]: e.target.value })
                    }
                  />
                </label>
                <button
                  className="button"
                  type="submit"
                  disabled={
                    disabled || assignmentDirty || commentDirty || !dirty
                  }
                >
                  {dl.save}
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={
                    disabled ||
                    assignmentDirty ||
                    commentDirty ||
                    !dates[v.id] ||
                    (deadlineDirty && !dirty)
                  }
                  onClick={() => setDates({ ...dates, [v.id]: "" })}
                >
                  {dl.clear}
                </button>
              </form>
            )}
          </div>
        );
      })}
      {mine && data.canEdit && (
        <button
          className="button"
          disabled={
            disabled ||
            pending ||
            !r.canDecide ||
            (!mine.approvedAt &&
              (!eligible || r.comments.some((c) => !c.resolvedAt)))
          }
          onClick={() => send({ op: "decision", approved: !mine.approvedAt })}
        >
          {mine.approvedAt ? l.withdraw : l.approve}
        </button>
      )}
      <h5>{l.comments}</h5>
      {!r.comments.length && <p>{l.none}</p>}
      {r.comments.map((c) => (
        <article key={c.id} data-handoff-comment={c.id} className="panel">
          <p>
            {c.author || l.former} ·{" "}
            <time dateTime={c.createdAt}>
              {new Intl.DateTimeFormat(language, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(c.createdAt))}
            </time>{" "}
            · {c.resolvedAt ? l.resolved : l.open}
          </p>
          <p className="preserve-lines" style={{ whiteSpace: "pre-wrap" }}>
            {c.body}
          </p>
          {c.resolvedAt && (
            <p>
              {l.resolved}: {c.resolvedBy || l.former}
            </p>
          )}
          {data.canEdit && (
            <div className="toolbar">
              <button
                className="button"
                disabled={disabled || pending}
                onClick={() =>
                  send({
                    op: "resolve",
                    commentId: c.id,
                    resolved: !c.resolvedAt,
                  })
                }
              >
                {c.resolvedAt ? l.reopen : l.resolve}
              </button>
              {c.canDelete && (
                <button
                  className="button danger"
                  disabled={disabled || pending}
                  onClick={() => {
                    if (confirm(l.confirm))
                      send({ op: "delete_comment", commentId: c.id });
                  }}
                >
                  {l.remove}
                </button>
              )}
            </div>
          )}
        </article>
      ))}
      {data.canEdit && (
        <form
          className="library-stack"
          aria-label={l.add}
          onSubmit={(e) => {
            e.preventDefault();
            send({ op: "comment", requestId: requestId.current, body });
          }}
        >
          <label>
            {l.comment}
            <textarea
              aria-label={l.comment}
              maxLength={2000}
              required
              rows={3}
              disabled={
                disabled ||
                assignmentDirty ||
                deadlineDirty ||
                r.remainingComments === 0
              }
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <p>
            {l.remaining}: {r.remainingComments}
          </p>
          <button
            className="button"
            type="submit"
            disabled={
              disabled ||
              assignmentDirty ||
              deadlineDirty ||
              !commentDirty ||
              r.remainingComments === 0
            }
          >
            {l.add}
          </button>
        </form>
      )}
    </section>
  );
}
