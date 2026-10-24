"use client";
import { useEffect, useRef, useState } from "react";
import type { Interview } from "@/lib/domain";
import { timingCopy } from "@/lib/concept-timing";
import { api } from "@/lib/client";
import ConceptStimulus from "./concept-stimulus";
export default function TimedConcept({
  interview: i,
  token,
  onInterview,
}: {
  interview: Interview;
  token: string;
  onInterview: (i: Interview) => void;
}) {
  const p = i.conceptPresentation,
    w = timingCopy(i.language),
    [remaining, setRemaining] = useState(0),
    [syncing, setSyncing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const latest = useRef({ i, token, onInterview });
  latest.current = { i, token, onInterview };
  const path = "interviews/" + i.id + "/concept-presentation";
  async function refresh() {
    setSyncing(true);
    setError(false);
    try {
      const r = await api(path, "GET", undefined, {
        "x-interview-token": latest.current.token,
      });
      latest.current.onInterview(r.interview);
    } catch {
      setError(true);
    } finally {
      setSyncing(false);
    }
  }
  useEffect(() => {
    if (p?.state !== "viewing") {
      setRemaining(0);
      return;
    }
    const initial = Math.max(0, p.endsAt! - p.serverNow),
      start = performance.now();
    let done = false;
    const tick = () => {
      const left = Math.max(0, initial - (performance.now() - start));
      setRemaining(left);
      if (left === 0 && !done) {
        done = true;
        void refresh();
      }
    };
    tick();
    const timer = setInterval(tick, 150);
    return () => clearInterval(timer);
  }, [p?.state, p?.endsAt, p?.serverNow]);
  useEffect(() => {
    if (!p) return;
    const sync = () => {
      if (document.visibilityState === "visible") void refresh();
      else setSyncing(true);
    };
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [path, !!p]);
  if (!p)
    return (
      <ConceptStimulus interview={i} token={token} onInterview={onInterview} />
    );
  async function action(action: "start" | "untimed") {
    setBusy(true);
    setError(false);
    try {
      const current = latest.current.i;
      const r = await api(
        path,
        "POST",
        { conceptId: p!.conceptId, version: current.version, action },
        { "x-interview-token": token },
      );
      onInterview(r.interview);
    } catch {
      setError(true);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  const show =
    !syncing &&
    !error &&
    (p.state === "untimed" || (p.state === "viewing" && remaining > 0));
  return (
    <section className="timed-concept" aria-label={w.title}>
      <div className="timed-concept-status">
        <h2>{w.title}</h2>
        {syncing ? (
          <p role="status">{w.sync}</p>
        ) : p.state === "waiting" ? (
          <>
            <p>{w.intro}</p>
            <p>
              {p.seconds} {w.seconds}
            </p>
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => action("start")}
            >
              {w.start}
            </button>
          </>
        ) : p.state === "viewing" ? (
          <p>
            {w.remaining}:{" "}
            <output aria-live="off">{Math.ceil(remaining / 1000)}</output>{" "}
            {w.seconds}
          </p>
        ) : (
          <p role="status">{p.state === "untimed" ? w.untimed : w.expired}</p>
        )}
        {error && (
          <p role="alert">
            {w.error}{" "}
            <button className="text-button" type="button" onClick={refresh}>
              {w.retry}
            </button>
          </p>
        )}
      </div>
      {show && (
        <ConceptStimulus
          interview={i}
          token={token}
          onInterview={onInterview}
        />
      )}
      {p.state !== "untimed" && (
        <div className="timed-concept-access">
          <p>{w.access}</p>
          <button
            type="button"
            className="button secondary"
            disabled={busy || syncing}
            onClick={() => action("untimed")}
          >
            {w.switch}
          </button>
        </div>
      )}
    </section>
  );
}
