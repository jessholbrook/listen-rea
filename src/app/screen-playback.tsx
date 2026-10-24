"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { ScreenSession } from "@/lib/screen";
import { clipAt } from "@/lib/screen";
import { Notice, Spinner } from "./components";
const stamp = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
export default function ScreenPlayback({
  studyId,
  interviewId,
  questionId,
}: {
  studyId: string;
  interviewId: string;
  questionId?: string;
}) {
  const [sessions, setSessions] = useState<ScreenSession[] | null>(null),
    [error, setError] = useState(""),
    [choice, setChoice] = useState(""),
    [clipId, setClipId] = useState(""),
    [position, setPosition] = useState(0),
    [gap, setGap] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    seek = useRef<number | null>(null);
  useEffect(() => {
    let active = true;
    api<{ captures: ScreenSession[] }>(
      `studies/${studyId}/captures?interview=${encodeURIComponent(interviewId)}`,
    )
      .then((r) => {
        if (!active) return;
        const filtered = r.captures
          .filter((c) => !questionId || c.questionId === questionId)
          .reverse();
        setSessions(filtered);
        setChoice(filtered[0]?.id || "");
        setClipId(filtered[0]?.clips?.[0]?.id || "");
        setPosition(filtered[0]?.clips?.[0]?.offsetMs || 0);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [studyId, interviewId, questionId]);
  const s = sessions?.find((c) => c.id === choice),
    clips = s?.clips || [],
    current = clips.find((c) => c.id === clipId),
    end = clips.length ? clips.at(-1)!.offsetMs + clips.at(-1)!.durationMs : 0;
  function jump(ms: number) {
    const match = clipAt(clips, ms);
    setPosition(ms);
    setGap(!match);
    if (!match) {
      video.current?.pause();
      return;
    }
    seek.current = Math.max(0, (ms - match.offsetMs) / 1000);
    if (match.id === clipId && video.current) {
      video.current.currentTime = seek.current;
      seek.current = null;
    } else setClipId(match.id);
  }
  if (error) return <Notice>{error}</Notice>;
  if (!sessions) return <Spinner />;
  if (!sessions.length) return null;
  return (
    <section className="screen-playback" aria-label="Screen recording playback">
      <h3>Task screen recordings</h3>
      <label>
        Recording session
        <select
          aria-label="Recording session"
          value={choice}
          onChange={(e) => {
            const c = sessions.find((s) => s.id === e.target.value)!;
            setChoice(c.id);
            setClipId(c.clips?.[0]?.id || "");
            setPosition(c.clips?.[0]?.offsetMs || 0);
            setGap(false);
            seek.current = 0;
          }}
        >
          {sessions.map((c, n) => (
            <option key={c.id} value={c.id}>
              Session {n + 1} · {c.prompt.slice(0, 70)}
            </option>
          ))}
        </select>
      </label>
      <p>{s?.prompt}</p>
      <p className="small muted">
        {s?.status === "recording"
          ? "Unclosed session (sharing may have stopped)"
          : s?.status}{" "}
        · Consent {s && new Date(s.consentAt).toLocaleString()} · {clips.length}{" "}
        saved clips. Video and narration share the same recording clock. Gaps
        and separate sessions are retained.
      </p>
      {current && !gap && (
        <video
          key={clipId}
          ref={video}
          controls
          preload="metadata"
          playsInline
          src={`/api/recordings/${clipId}`}
          onLoadedMetadata={() => {
            if (seek.current !== null && video.current) {
              video.current.currentTime = seek.current;
              seek.current = null;
            }
          }}
          onTimeUpdate={() => {
            if (!gap && video.current)
              setPosition(
                current.offsetMs +
                  Math.min(
                    current.durationMs,
                    video.current.currentTime * 1000,
                  ),
              );
          }}
          onError={() =>
            setError(
              "This screen clip could not be played. Try another saved clip or reload the response.",
            )
          }
        />
      )}
      {end > 0 && (
        <label>
          Session timeline · {stamp(position)} / {stamp(end)}
          <input
            aria-label="Session timeline"
            type="range"
            min={0}
            max={Math.max(0, end - 1)}
            step={100}
            value={Math.min(position, end - 1)}
            onChange={(e) => jump(Number(e.target.value))}
          />
        </label>
      )}
      {gap && (
        <p role="status">
          There is no saved recording at this point. Choose a saved clip below.
        </p>
      )}
      {!clips.length && <p>No clips were saved in this session.</p>}
      <div className="screen-clips">
        {clips.map((c, n) => (
          <button
            type="button"
            className={"button " + (c.id === clipId ? "selected" : "")}
            key={c.id}
            onClick={() => jump(c.offsetMs)}
          >
            Clip {n + 1} · {stamp(c.offsetMs)}–
            {stamp(c.offsetMs + c.durationMs)}
          </button>
        ))}
      </div>
      <p className="small muted">
        Written reflections are linked to the task, not word-level narration
        timestamps. AI analysis uses written responses; screen narration is not
        automatically transcribed. Task success and behavior must be reviewed
        manually.
      </p>
    </section>
  );
}
