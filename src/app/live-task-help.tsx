"use client";
import { useState, useRef, useEffect } from "react";
import type { Language } from "@/lib/localization";
import { richerCopy } from "@/lib/richer-copy";
import { api } from "@/lib/client";
import { Notice } from "./components";
export default function LiveTaskHelp({
  language,
  interviewId,
  version,
  token,
  captureId,
  getStream,
}: {
  language: Language;
  interviewId: string;
  version: number;
  token: string;
  captureId: string;
  getStream: () => MediaStream | null;
}) {
  const c = richerCopy(language),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [guidance, setGuidance] = useState<{
      question: string;
      visibleContext: string;
      uncertainty: string;
    } | null>(null),
    [refocused, setRefocused] = useState(false),
    mounted = useRef(true),
    request = useRef<any>(null),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  async function snapshot() {
    const track = getStream()?.getVideoTracks()[0];
    if (!track || track.readyState !== "live")
      throw Error("Screen sharing ended. Share again before requesting help.");
    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = new MediaStream([track]);
    try {
      await Promise.race([
        video.play(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(Error("Screen frame unavailable. Try again.")),
            2000,
          ),
        ),
      ]);
      if (
        !video.videoWidth ||
        !video.videoHeight ||
        track.readyState !== "live"
      )
        throw Error("Screen frame unavailable. Try again.");
      const canvas = document.createElement("canvas");
      let scale = Math.min(
        1,
        960 / Math.max(video.videoWidth, video.videoHeight),
      );
      for (let k = 0; k < 4; k++, scale *= 0.75) {
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        canvas
          .getContext("2d")!
          .drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL("image/jpeg", 0.55);
        if (image.length < 130000) return image;
      }
      throw Error("Screen image is too large. Share a smaller window.");
    } finally {
      video.pause();
      video.srcObject = null;
    }
  }
  async function help() {
    setBusy(true);
    setError("");
    setGuidance(null);
    setRefocused(false);
    try {
      if (!request.current)
        request.current = {
          requestId: crypto.randomUUID(),
          version,
          aiConsent: true,
          image: await snapshot(),
        };
      controller.current = new AbortController();
      const r = await api<{ guidance: NonNullable<typeof guidance> }>(
        `interviews/${interviewId}/captures/${captureId}/live-probe`,
        "POST",
        request.current,
        { "x-interview-token": token },
        controller.current.signal,
      );
      if (mounted.current) {
        setGuidance(r.guidance);
        request.current = null;
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section className="panel visual-stack" aria-label={c.guidance}>
      <h4>{c.guidance}</h4>
      <p>{c.helpNotice}</p>
      <label>
        <input
          type="checkbox"
          checked={consent}
          disabled={busy}
          onChange={(e) => {
            setConsent(e.target.checked);
            request.current = null;
          }}
        />
        {c.screenConsent}
      </label>
      <button
        type="button"
        disabled={!consent || busy}
        onClick={() => void help()}
      >
        {busy ? c.helping : c.help}
      </button>
      <button type="button" onClick={() => setRefocused(true)}>
        {c.refocus}
      </button>
      {error && <Notice>{error}</Notice>}
      {refocused && <p role="status">{c.recovery}</p>}
      {guidance && (
        <div role="status">
          <p>{guidance.question}</p>
          <p className="small">{guidance.visibleContext}</p>
          <p className="small muted">{guidance.uncertainty}</p>
        </div>
      )}
    </section>
  );
}
