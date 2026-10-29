"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { richerCopy } from "@/lib/richer-copy";
import type { Language } from "@/lib/localization";
import type { taskAttemptView } from "@/lib/usability-activity";
import { Notice } from "./components";
type Attempt = ReturnType<typeof taskAttemptView>;
export default function TaskTimer({
  interviewId,
  token,
  version,
  language,
  onBlocking,
}: {
  interviewId: string;
  token: string;
  version: number;
  language: Language;
  onBlocking: (b: boolean) => void;
}) {
  const c = richerCopy(language),
    [attempt, setAttempt] = useState<Attempt | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [outcome, setOutcome] = useState("completed"),
    [reviewed, setReviewed] = useState(false),
    mounted = useRef(true),
    receipt = useRef<{ key: string; id: string } | null>(null);
  const root = `interviews/${interviewId}/usability`,
    headers = { "x-interview-token": token };
  async function load() {
    const r = await api<{ attempts: Attempt[] }>(
      root,
      "GET",
      undefined,
      headers,
    );
    if (mounted.current) {
      setAttempt(r.attempts.at(-1) || null);
      setReady(true);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load().catch((e) => {
      setError(e.message);
      setReady(true);
    });
    return () => {
      mounted.current = false;
      onBlocking(false);
    };
  }, []);
  useEffect(() => {
    onBlocking(busy || (!!attempt && attempt.state !== "ended"));
  }, [busy, attempt, onBlocking]);
  async function write(op: "start" | "pause" | "resume" | "end") {
    setBusy(true);
    setError("");
    const input = {
        version,
        op,
        ...(op === "start"
          ? {}
          : { attemptId: attempt!.id, attemptVersion: attempt!.version }),
        ...(op === "end" ? { reviewed, outcome } : {}),
      },
      key = JSON.stringify(input);
    if (receipt.current?.key !== key)
      receipt.current = { key, id: crypto.randomUUID() };
    try {
      const r = await api<{ attempt: Attempt }>(
        root,
        "POST",
        { ...input, requestId: receipt.current.id },
        headers,
      );
      if (mounted.current) {
        setAttempt(r.attempt);
        setReviewed(false);
        receipt.current = null;
      }
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        await load().catch(() => {});
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section className="panel visual-stack" aria-label={c.timer}>
      <h4>{c.timer}</h4>
      <p>{c.timerNotice}</p>
      {error && <Notice>{error}</Notice>}
      {attempt && (
        <p role="status">
          {c[attempt.state]} ·{" "}
          {attempt.timing.activeMs === null
            ? "—"
            : Math.round(attempt.timing.activeMs / 1000) + " s"}
        </p>
      )}
      <fieldset disabled={!ready || busy}>
        {!attempt || attempt.state === "ended" ? (
          <button type="button" onClick={() => void write("start")}>
            {c.start}
          </button>
        ) : (
          <div className="visual-stack">
            <button
              type="button"
              onClick={() =>
                void write(attempt.state === "running" ? "pause" : "resume")
              }
            >
              {attempt.state === "running" ? c.pause : c.resume}
            </button>
            <label>
              {c.outcome}
              <select
                aria-label={c.outcome}
                value={outcome}
                onChange={(e) => {
                  setOutcome(e.target.value);
                  setReviewed(false);
                }}
              >
                <option value="completed">{c.completed}</option>
                <option value="not_completed">{c.not_completed}</option>
                <option value="skipped">{c.skipped}</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              {c.timerReview}
            </label>
            <button
              type="button"
              disabled={!reviewed}
              onClick={() => void write("end")}
            >
              {c.end}
            </button>
          </div>
        )}
      </fieldset>
    </section>
  );
}
