"use client";
import { useEffect, useState, useRef } from "react";
import { api } from "@/lib/client";
import { pulseScheduleView } from "@/lib/pulse-schedule";
import { Notice } from "./components";
type Schedule = ReturnType<typeof pulseScheduleView>;
export default function PulseSchedulePanel({
  seriesId,
  latestDate,
  onCreated,
}: {
  seriesId: string;
  latestDate: string;
  onCreated: () => Promise<void>;
}) {
  const [schedule, setSchedule] = useState<Schedule | null>(null),
    [ready, setReady] = useState(false),
    [canEdit, setCanEdit] = useState(false),
    [date, setDate] = useState(""),
    [days, setDays] = useState(28),
    [count, setCount] = useState(3),
    [prefix, setPrefix] = useState("Scheduled wave"),
    [zone, setZone] = useState("America/Los_Angeles"),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef<{ key: string; id: string } | null>(null),
    generation = useRef(0),
    root = `pulse/${seriesId}/schedule`;
  async function load(g = generation.current) {
    const r = await api<{ schedule: Schedule | null; canSchedule: boolean }>(
      root,
    );
    if (g !== generation.current) return;
    setSchedule(r.schedule);
    setCanEdit(r.canSchedule);
    setReady(true);
    if (r.schedule) {
      setDate(r.schedule.nextDate);
      setDays(r.schedule.intervalDays);
      setCount(r.schedule.maxWaves);
      setPrefix(r.schedule.labelPrefix);
      setZone(r.schedule.timeZone);
    }
  }
  useEffect(() => {
    const g = ++generation.current;
    setReady(false);
    setReviewed(false);
    setError("");
    setSchedule(null);
    void load(g).catch((e) => {
      if (g === generation.current) setError(e.message);
    });
    return () => {
      generation.current++;
    };
  }, [root]);
  async function write(op?: "pause" | "resume" | "run") {
    const g = generation.current;
    setBusy(true);
    setError("");
    const payload = op
      ? { version: schedule!.version, op, reviewed }
      : {
          version: schedule?.version || 0,
          nextDate: date,
          intervalDays: days,
          maxWaves: count,
          labelPrefix: prefix,
          timeZone: zone,
          reviewed,
        };
    const key = JSON.stringify(payload);
    if (request.current?.key !== key)
      request.current = { key, id: crypto.randomUUID() };
    try {
      await api(root, op ? "PATCH" : "PUT", {
        ...payload,
        requestId: request.current.id,
      });
      if (g === generation.current) {
        request.current = null;
        setReviewed(false);
        await load(g);
        await onCreated();
      }
    } catch (e) {
      if (g === generation.current) {
        setError((e as Error).message);
        setReviewed(false);
        try {
          await load(g);
        } catch {
          setReady(false);
        }
      }
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  return (
    <section className="panel visual-stack" aria-label="Pulse wave schedule">
      <h4>Automatic draft-wave schedule</h4>
      <p>
        Create one draft wave per due schedule at daily maintenance, using the
        fixed baseline. Every wave still needs design/stimulus review,
        publication and manual fielding. No invitations, interviews, payouts or
        AI calls start automatically. Overdue schedules catch up at most one
        wave per maintenance run.
      </p>
      {error && <Notice>{error}</Notice>}
      {schedule?.error && (
        <Notice>
          {
            {
              permission:
                "The requesting member no longer has scheduling access. Review and resume as an eligible researcher.",
              source:
                "The fixed baseline is unavailable or changed. Review the tracker before resuming.",
              chronology:
                "A wave date changed the sequence. Review and save a new schedule.",
              capacity: "This tracker reached its wave limit.",
            }[schedule.error]
          }
        </Notice>
      )}
      {schedule && (
        <p role="status">
          {schedule.state} · {schedule.createdCount}/{schedule.maxWaves} draft
          waves created · Next date {schedule.nextDate} ({schedule.timeZone})
        </p>
      )}
      <button
        disabled={busy}
        onClick={() => {
          setReviewed(false);
          void load()
            .then(onCreated)
            .catch((e) => setError(e.message));
        }}
      >
        Refresh Pulse schedule
      </button>
      <fieldset disabled={!ready || !canEdit || busy} className="visual-stack">
        <label>
          First/next scheduled date
          <input
            aria-label="Next Pulse date"
            type="date"
            min={latestDate}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setReviewed(false);
            }}
          />
        </label>
        <label>
          Interval in calendar days
          <input
            aria-label="Pulse interval days"
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => {
              setDays(Number(e.target.value));
              setReviewed(false);
            }}
          />
        </label>
        <label>
          Draft waves in this cycle
          <input
            aria-label="Pulse scheduled wave count"
            type="number"
            min={1}
            max={12}
            value={count}
            onChange={(e) => {
              setCount(Number(e.target.value));
              setReviewed(false);
            }}
          />
        </label>
        <label>
          Wave label prefix
          <input
            aria-label="Pulse wave prefix"
            maxLength={100}
            value={prefix}
            onChange={(e) => {
              setPrefix(e.target.value);
              setReviewed(false);
            }}
          />
        </label>
        <label>
          Schedule time zone
          <input
            aria-label="Pulse schedule time zone"
            value={zone}
            onChange={(e) => {
              setZone(e.target.value);
              setReviewed(false);
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
          />
          I reviewed the dates, fixed baseline, draft-only behavior and daily
          catch-up policy.
        </label>
        <button disabled={!reviewed || !date} onClick={() => void write()}>
          Save reviewed Pulse schedule
        </button>
        {schedule && schedule.state !== "complete" && (
          <button
            disabled={!reviewed}
            onClick={() =>
              void write(schedule.state === "scheduled" ? "pause" : "resume")
            }
          >
            {schedule.state === "scheduled"
              ? "Pause Pulse schedule"
              : "Resume Pulse schedule"}
          </button>
        )}
        {schedule?.state === "scheduled" && (
          <button disabled={!reviewed} onClick={() => void write("run")}>
            Run due Pulse schedule now
          </button>
        )}
      </fieldset>
      {schedule?.runs.map((r) => (
        <p key={r.studyId}>
          {r.date}:{" "}
          <a href={`/?study=${r.studyId}&tab=guide`}>Review scheduled draft</a>
        </p>
      ))}
    </section>
  );
}
