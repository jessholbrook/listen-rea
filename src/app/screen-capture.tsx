"use client";
import { copy, participantError } from "@/lib/participant-copy";
import type { Language } from "@/lib/localization";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { screenMime, screenSegmentMs, type ScreenSession } from "@/lib/screen";
import {
  screenDrafts,
  saveScreenDraft,
  deleteScreenDraft,
  type ScreenDraft,
} from "@/lib/screen-drafts";
import { Notice, Spinner } from "./components";
import type { Question } from "@/lib/domain";

export default function ScreenCapture({
  language = "en",
  interviewId,
  version,
  token,
  task,
  onBlocking,
}: {
  language?: Language;
  interviewId: string;
  version: number;
  token: string;
  task: NonNullable<Question["task"]>;
  onBlocking: (b: boolean) => void;
}) {
  const t = (text: string) => copy(language, text);
  const [supported, setSupported] = useState(false),
    [ready, setReady] = useState(false),
    [consent, setConsent] = useState(false),
    [recording, setRecording] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [pending, setPending] = useState(0),
    [recovery, setRecovery] = useState(false),
    [saved, setSaved] = useState(0),
    [seconds, setSeconds] = useState(0);
  const mounted = useRef(true),
    running = useRef(false),
    stream = useRef<MediaStream | null>(null),
    recorder = useRef<MediaRecorder | null>(null),
    capture = useRef<ScreenSession | null>(null),
    sequence = useRef(0),
    epoch = useRef(0),
    pieceStart = useRef(0),
    pieceEnd = useRef(0),
    rotate = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    clock = useRef<ReturnType<typeof setInterval> | undefined>(undefined),
    writes = useRef<Promise<unknown>>(Promise.resolve()),
    uploading = useRef<Promise<void> | null>(null);
  const headers = { "x-interview-token": token };
  const blocked = recording || saving || pending > 0 || recovery || !ready;
  useEffect(() => {
    onBlocking(blocked);
  }, [blocked, onBlocking]);
  async function refresh() {
    const [r, d] = await Promise.all([
      api<{ captures: ScreenSession[] }>(
        `interviews/${interviewId}/captures`,
        "GET",
        undefined,
        headers,
      ),
      screenDrafts(interviewId, version),
    ]);
    if (mounted.current) {
      setSaved(
        r.captures
          .filter((c) => c.turnVersion === version)
          .reduce((n, c) => n + (c.clips?.length || 0), 0),
      );
      setRecovery(
        r.captures.some(
          (c) => c.turnVersion === version && c.status === "recording",
        ),
      );
      setPending(d.length);
    }
    return r.captures;
  }
  useEffect(() => {
    mounted.current = true;
    setSupported(
      !!navigator.mediaDevices?.getDisplayMedia &&
        !!screenMime() &&
        window.isSecureContext &&
        !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
    );
    void refresh()
      .catch((e) => setError(e.message))
      .finally(() => setReady(true));
    const before = (e: BeforeUnloadEvent) => {
      if (running.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => {
      mounted.current = false;
      running.current = false;
      clearTimeout(rotate.current);
      clearInterval(clock.current);
      if (recorder.current) {
        recorder.current.onstop = null;
        if (recorder.current.state !== "inactive") recorder.current.stop();
      }
      stream.current?.getTracks().forEach((t) => t.stop());
      window.removeEventListener("beforeunload", before);
    };
  }, [interviewId, version]);
  async function flush() {
    if (uploading.current) return uploading.current;
    const work = (async () => {
      while (true) {
        const drafts = await screenDrafts(interviewId, version);
        if (mounted.current) setPending(drafts.length);
        if (!drafts.length) break;
        const d = drafts[0];
        const res = await fetch(
          `/api/interviews/${interviewId}/captures/${d.captureId}/clips`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: {
              ...headers,
              "content-type": d.blob.type || "video/webm",
              "x-recording-consent": "yes",
              "x-recording-id": d.id,
              "x-clip-sequence": String(d.sequence),
              "x-clip-offset": String(d.offsetMs),
              "x-recording-duration": String(d.durationMs),
            },
            body: d.blob,
            signal: AbortSignal.timeout(45000),
          },
        );
        if (!res.ok) {
          const r = await res.json();
          throw new Error(
            r.error ||
              t(
                "The clip could not be uploaded. Your saved local clips are retained for retry.",
              ),
          );
        }
        await deleteScreenDraft(d.id);
      }
      await refresh();
    })();
    uploading.current = work;
    try {
      await work;
    } finally {
      uploading.current = null;
    }
  }
  async function finish(status: "stopped" | "interrupted") {
    try {
      await writes.current;
      await flush();
      const all = await refresh();
      for (const c of all.filter(
        (c) => c.turnVersion === version && c.status === "recording",
      ))
        await api(
          `interviews/${interviewId}/captures/${c.id}/finish`,
          "POST",
          { status },
          headers,
        );
      await refresh();
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        setRecovery(true);
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  function stop() {
    if (!running.current) return;
    running.current = false;
    clearTimeout(rotate.current);
    clearInterval(clock.current);
    pieceEnd.current = performance.now();
    setRecording(false);
    setSaving(true);
    if (recorder.current?.state !== "inactive") recorder.current?.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
  }
  function startPiece() {
    const mime = screenMime()!;
    const chunks: BlobPart[] = [];
    const r = new MediaRecorder(stream.current!, {
      mimeType: mime,
      videoBitsPerSecond: 450000,
      audioBitsPerSecond: 48000,
    });
    recorder.current = r;
    pieceStart.current = performance.now();
    const started = pieceStart.current,
      seq = sequence.current++,
      session = capture.current!;
    r.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    r.onerror = () => {
      setError(
        t(
          "The browser stopped recording. Retry saved clips or discard unsaved clips before continuing.",
        ),
      );
      stop();
    };
    r.onstop = () => {
      const end = pieceEnd.current || performance.now(),
        durationMs = Math.round(end - started),
        blob = new Blob(chunks, { type: mime });
      if (blob.size && durationMs >= 100) {
        const d: ScreenDraft = {
          id: crypto.randomUUID(),
          interviewId,
          turnVersion: version,
          captureId: session.id,
          sequence: seq,
          offsetMs: Math.round(started - epoch.current),
          durationMs,
          blob,
          createdAt: Date.now(),
        };
        writes.current = writes.current
          .then(() => saveScreenDraft(d))
          .catch((e) => {
            setError((e as Error).message);
            stop();
            throw e;
          });
        void writes.current
          .then(async () => {
            const drafts = await screenDrafts(interviewId, version);
            if (mounted.current) setPending(drafts.length);
            if (drafts.length >= 5) {
              setError(
                t(
                  "Uploads cannot keep up. Sharing has stopped; retry your saved clips when the connection returns.",
                ),
              );
              stop();
            }
            await flush();
          })
          .catch((e) => {
            if (mounted.current) setError((e as Error).message);
          });
      }
      if (running.current) {
        try {
          startPiece();
        } catch {
          setError(
            t(
              "The browser could not continue recording. Saved clips are retained.",
            ),
          );
          stop();
        }
      }
      if (!running.current) void finish("stopped");
    };
    pieceEnd.current = 0;
    r.start();
    rotate.current = setTimeout(
      () => {
        pieceEnd.current = performance.now();
        if (r.state !== "inactive") r.stop();
      },
      Math.min(
        screenSegmentMs,
        Math.max(
          100,
          task.maxSeconds * 1000 - (performance.now() - epoch.current),
        ),
      ),
    );
  }
  async function start() {
    setSaving(true);
    setError("");
    let display: MediaStream | undefined, mic: MediaStream | undefined;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: 12,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current)
        throw new Error(t("The task was closed before recording started."));
      if (display.getVideoTracks()[0]?.readyState !== "live")
        throw new Error(
          t("Screen sharing ended before recording started. Please try again."),
        );
      stream.current = new MediaStream([
        ...display.getVideoTracks(),
        ...mic.getAudioTracks(),
      ]);
      capture.current = (
        await api(
          `interviews/${interviewId}/captures`,
          "POST",
          { consent: true, version },
          headers,
        )
      ).capture;
      if (
        !mounted.current ||
        display.getVideoTracks()[0]?.readyState !== "live" ||
        mic.getAudioTracks()[0]?.readyState !== "live"
      ) {
        await api(
          `interviews/${interviewId}/captures/${capture.current!.id}/finish`,
          "POST",
          { status: "interrupted" },
          headers,
        );
        throw new Error(
          t(
            "Sharing ended before recording started. Please share again when ready.",
          ),
        );
      }
      running.current = true;
      sequence.current = 0;
      epoch.current = performance.now();
      setSeconds(0);
      setRecording(true);
      setConsent(false);
      setRecovery(true);
      display.getVideoTracks()[0].onended = () => stop();
      mic.getAudioTracks()[0].onended = () => {
        setError(
          t(
            "The microphone stopped. Saved clips are retained; share again when you are ready.",
          ),
        );
        stop();
      };
      clock.current = setInterval(() => {
        const elapsed = (performance.now() - epoch.current) / 1000;
        setSeconds(Math.floor(elapsed));
        if (elapsed >= task.maxSeconds) stop();
      }, 500);
      startPiece();
    } catch (e) {
      display?.getTracks().forEach((t) => t.stop());
      mic?.getTracks().forEach((t) => t.stop());
      running.current = false;
      clearTimeout(rotate.current);
      clearInterval(clock.current);
      setRecording(false);
      setError(
        (e as Error).name === "NotAllowedError"
          ? t(
              "Sharing or microphone permission was declined. You can retry or continue with a written response.",
            )
          : (e as Error).message,
      );
      await refresh().catch(() => {});
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="screen-capture" aria-label={t("Task screen recording")}>
      <h3>{t("Try the task")} </h3>
      {task.url && (
        <a
          className="button"
          href={task.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("Open task website ↗")}{" "}
        </a>
      )}
      <p>
        {t(
          "Work through the task and say what you are thinking. Share only a tab or window you are comfortable showing. Close private content first. Screen video and microphone narration are saved for the study team; camera and system audio are not recorded.",
        )}{" "}
      </p>
      <p className="small muted">
        {t(
          "Recording is optional. You can stop at any time and add a written reflection below. Saved clips stay with this task; restarting sharing creates a separate session. Each session is limited to",
        )}{" "}
        {task.maxSeconds} {t("seconds.")}{" "}
      </p>
      {!supported && ready && (
        <Notice>
          {t(
            "Screen recording is unavailable here. Use a supported desktop browser such as Chrome or Edge over HTTPS, or continue with a written response.",
          )}{" "}
        </Notice>
      )}
      {error && <Notice>{participantError(language, error)}</Notice>}
      {recording ? (
        <div role="status" className="screen-status">
          <strong>
            {t("● Sharing screen and microphone ·")} {seconds}s
          </strong>
          <button type="button" className="button" onClick={stop}>
            {t("Stop sharing and save")}{" "}
          </button>
        </div>
      ) : (
        <>
          <label className="consent-check">
            <input
              type="checkbox"
              checked={consent}
              disabled={saving}
              onChange={(e) => setConsent(e.target.checked)}
            />
            {t(
              "I agree to record my selected screen or window and microphone narration for this task.",
            )}{" "}
          </label>
          <div className="inline">
            <button
              type="button"
              className="button"
              disabled={!supported || !consent || blocked}
              onClick={() => void start()}
            >
              {t("Share screen and microphone")}{" "}
            </button>
            {(pending > 0 || recovery) && (
              <button
                type="button"
                className="button"
                disabled={saving}
                onClick={() => {
                  setSaving(true);
                  setError("");
                  void finish("interrupted");
                }}
              >
                {t("Retry saved clips and close previous session")}{" "}
              </button>
            )}
            {(pending > 0 || recovery) && (
              <button
                type="button"
                className="text-button"
                disabled={saving}
                onClick={async () => {
                  if (
                    !confirm(
                      t(
                        "Discard unsaved local screen clips? Already uploaded clips stay with your response.",
                      ),
                    )
                  )
                    return;
                  setSaving(true);
                  setError("");
                  try {
                    await writes.current.catch(() => {});
                    writes.current = Promise.resolve();
                    for (const d of await screenDrafts(interviewId, version))
                      await deleteScreenDraft(d.id);
                    const all = await refresh();
                    for (const c of all.filter(
                      (c) =>
                        c.turnVersion === version && c.status === "recording",
                    ))
                      await api(
                        `interviews/${interviewId}/captures/${c.id}/finish`,
                        "POST",
                        { status: "interrupted" },
                        headers,
                      );
                    await refresh();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {t("Discard unsaved clips")}{" "}
              </button>
            )}
          </div>
        </>
      )}
      <p role="status" className="small">
        {saving && <Spinner />}
        {saving
          ? t("Saving recording…")
          : `${saved} clips saved${pending ? ` · ${pending} awaiting upload` : ""}`}
      </p>
    </section>
  );
}
