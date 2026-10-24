"use client";
import { useEffect, useRef, useState } from "react";
import type { Interview } from "@/lib/domain";
import { api } from "@/lib/client";
import { videoOnceCopy } from "@/lib/video-once";
import PrivateConceptVideo from "./private-concept-video";
export default function SingleViewVideo({
  interview: i,
  token,
  assetId,
  alt,
  onInterview,
}: {
  interview: Interview;
  token: string;
  assetId: string;
  alt: string;
  onInterview: (i: Interview) => void;
}) {
  const p = i.videoPresentation,
    w = videoOnceCopy(i.language),
    latest = useRef({ i, onInterview });
  latest.current = { i, onInterview };
  const player = useRef<HTMLVideoElement>(null),
    wrapper = useRef<HTMLDivElement>(null),
    requestId = useRef("");
  const played = useRef(false),
    progress = useRef(0);
  const [viewToken, setViewToken] = useState(""),
    [src, setSrc] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0),
    [closed, setClosed] = useState(false),
    [playing, setPlaying] = useState(false),
    [remaining, setRemaining] = useState(0),
    [syncing, setSyncing] = useState(false),
    [fullscreen, setFullscreen] = useState(false),
    [volume, setVolume] = useState(1);
  const path = "interviews/" + i.id + "/video-presentation";
  async function refresh(clearError = true) {
    setSyncing(true);
    try {
      const r = await api(path, "GET", undefined, {
        "x-interview-token": token,
      });
      latest.current.onInterview(r.interview);
      if (clearError) setError(false);
    } catch {
      setError(true);
    } finally {
      setSyncing(false);
    }
  }
  async function action(action: "start" | "finish" | "skip" | "alternative") {
    if (!p) return;
    setBusy(true);
    setError(false);
    if (action !== "start") player.current?.pause();
    if (!requestId.current) requestId.current = crypto.randomUUID();
    try {
      const r = await api(
        path,
        "POST",
        {
          conceptId: p.conceptId,
          version: latest.current.i.version,
          action,
          ...(action === "start" ? { requestId: requestId.current } : {}),
        },
        {
          "x-interview-token": token,
          ...(viewToken ? { "x-video-view-token": viewToken } : {}),
        },
      );
      latest.current.onInterview(r.interview);
      if (r.viewToken) setViewToken(r.viewToken);
    } catch {
      await refresh(false);
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setFullscreen(!!document.fullscreenEnabled);
    const visibility = () => {
      if (document.visibilityState === "hidden") player.current?.pause();
      else void refresh();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [path]);
  useEffect(() => {
    if (p?.state !== "playing") return;
    const initial = Math.max(0, p.endsAt! - p.serverNow),
      start = performance.now();
    let done = false;
    const tick = () => {
      const left = Math.max(0, initial - (performance.now() - start));
      setRemaining(left);
      if (!left && !done) {
        done = true;
        setClosed(true);
        player.current?.pause();
        void refresh();
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [p?.state, p?.endsAt, p?.serverNow]);
  useEffect(() => {
    if (!viewToken || p?.state !== "playing") return;
    const abort = new AbortController();
    let current = true,
      url = "";
    setFailed(false);
    setSrc("");
    void fetch("/api/interviews/" + i.id + "/concept-videos/" + assetId, {
      signal: abort.signal,
      cache: "no-store",
      headers: { "x-interview-token": token, "x-video-view-token": viewToken },
    })
      .then(async (r) => {
        if (!r.ok) throw Error();
        const blob = await r.blob();
        if (!current) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [viewToken, p?.state, assetId, token, retry]);
  useEffect(() => {
    const video = player.current;
    return () => {
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
    };
  }, [src]);
  if (!p) return null;
  if (p.state === "alternative")
    return (
      <section className="single-view-video">
        <p role="status">{w.alternative}</p>
        <PrivateConceptVideo
          assetId={assetId}
          interviewId={i.id}
          token={token}
          alt={alt}
          language={i.language}
        />
      </section>
    );
  const active = p.state === "playing" && !!viewToken && !closed;
  return (
    <section className="single-view-video" aria-label={w.title}>
      <h3>{w.title}</h3>
      {p.state === "ready" ? (
        <>
          <p>{w.intro}</p>
          <button
            type="button"
            className="button primary"
            disabled={busy || syncing}
            onClick={() => action("start")}
          >
            {w.start}
          </button>
        </>
      ) : p.state === "used" || closed ? (
        <p role="status">{p.state === "used" ? w.used : w.closing}</p>
      ) : !viewToken ? (
        <p>{w.interrupted}</p>
      ) : null}
      {syncing && <p role="status">{w.sync}</p>}
      {active && (
        <>
          <p>
            {w.remaining}:{" "}
            <output aria-live="off">{Math.ceil(remaining / 1000)}</output>
          </p>
          {failed ? (
            <div role="alert">
              <p>{w.loadError}</p>
              {!played.current && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setRetry((n) => n + 1)}
                >
                  {w.retryLoad}
                </button>
              )}
            </div>
          ) : !src ? (
            <p role="status">{w.loading}</p>
          ) : (
            <div ref={wrapper} className="single-view-player">
              <video
                ref={player}
                playsInline
                preload="metadata"
                src={src}
                aria-label={alt}
                onPlay={() => {
                  played.current = true;
                  setPlaying(true);
                }}
                onPause={() => setPlaying(false)}
                onTimeUpdate={() => {
                  if (player.current)
                    progress.current = Math.max(
                      progress.current,
                      player.current.currentTime,
                    );
                }}
                onSeeking={() => {
                  if (
                    player.current &&
                    Math.abs(player.current.currentTime - progress.current) >
                      0.3
                  )
                    player.current.currentTime = progress.current;
                }}
                onRateChange={() => {
                  if (player.current) player.current.playbackRate = 1;
                }}
                onEnded={() => {
                  setClosed(true);
                  void action("finish");
                }}
                onError={() => {
                  setFailed(true);
                  if (played.current) setClosed(true);
                }}
              />
              <div className="single-view-controls">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || syncing}
                  onClick={() => {
                    const v = player.current;
                    if (v) {
                      if (v.paused) void v.play().catch(() => setFailed(true));
                      else v.pause();
                    }
                  }}
                >
                  {playing ? w.pause : w.play}
                </button>
                <label>
                  {w.volume}
                  <input
                    type="range"
                    aria-label={w.volume}
                    min={0}
                    max={1}
                    step={0.1}
                    value={volume}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      setVolume(n);
                      if (player.current) player.current.volume = n;
                    }}
                  />
                </label>
                {fullscreen && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      void wrapper.current?.requestFullscreen().catch(() => {})
                    }
                  >
                    {w.fullscreen}
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert">
          {w.error}{" "}
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() =>
              closed && viewToken && p.state === "playing"
                ? action("finish")
                : requestId.current &&
                    !viewToken &&
                    (p.state === "ready" || p.state === "playing")
                  ? action("start")
                  : refresh()
            }
          >
            {w.retry}
          </button>
        </p>
      )}
      {p.state !== "used" && (
        <button
          type="button"
          className="button secondary"
          disabled={busy || syncing}
          onClick={() => action("skip")}
        >
          {w.skip}
        </button>
      )}
      <p className="small">{w.access}</p>
      <button
        type="button"
        className="text-button"
        disabled={busy || syncing}
        onClick={() => action("alternative")}
      >
        {w.switch}
      </button>
    </section>
  );
}
