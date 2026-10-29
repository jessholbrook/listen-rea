"use client";
import { useEffect, useRef, useState } from "react";
import type { Language } from "@/lib/localization";
import { richerCopy } from "@/lib/richer-copy";
import {
  liveTranscriptEvent,
  liveTranscriptText,
  type LiveTranscript,
} from "@/lib/live-transcript";
import { api } from "@/lib/client";
import { Notice } from "./components";
export default function StreamingVoice({
  language,
  interviewId,
  version,
  token,
  prompt,
  onTranscript,
  onBusy,
}: {
  language: Language;
  interviewId: string;
  version: number;
  token: string;
  prompt: string;
  onTranscript: (s: string) => void;
  onBusy: (b: boolean) => void;
}) {
  const c = richerCopy(language),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [active, setActive] = useState(false),
    [draft, setDraft] = useState(""),
    [error, setError] = useState("");
  const generation = useRef(0),
    mounted = useRef(true),
    pc = useRef<RTCPeerConnection | null>(null),
    mic = useRef<MediaStream | null>(null),
    player = useRef<HTMLAudioElement | null>(null),
    session = useRef<string | null>(null),
    timeout = useRef<ReturnType<typeof setTimeout> | null>(null),
    transcript = useRef<LiveTranscript>({ parts: [] }),
    callbacks = useRef({ onTranscript, onBusy });
  callbacks.current = { onTranscript, onBusy };
  const root = "interviews/" + interviewId + "/realtime",
    headers = { "x-interview-token": token };
  function stop() {
    generation.current++;
    if (timeout.current) clearTimeout(timeout.current);
    mic.current?.getTracks().forEach((t) => t.stop());
    mic.current = null;
    pc.current?.close();
    pc.current = null;
    if (player.current) {
      player.current.pause();
      player.current.srcObject = null;
    }
    const id = session.current;
    session.current = null;
    if (id)
      void fetch("/api/" + root + "/" + id, {
        method: "DELETE",
        headers,
        keepalive: true,
      }).catch(() => {});
    callbacks.current.onBusy(false);
    if (mounted.current) {
      setBusy(false);
      setActive(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop();
    };
  }, []);
  async function start() {
    const g = ++generation.current;
    setBusy(true);
    setError("");
    callbacks.current.onBusy(true);
    try {
      if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia)
        throw Error(c.voiceUnavailable);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (g !== generation.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      mic.current = stream;
      const peer = new RTCPeerConnection();
      pc.current = peer;
      for (const track of stream.getTracks()) {
        peer.addTrack(track, stream);
        track.onended = () => {
          if (g === generation.current) stop();
        };
      }
      const audio = new Audio();
      audio.autoplay = true;
      player.current = audio;
      peer.ontrack = (e) => {
        if (g !== generation.current) return;
        audio.srcObject = e.streams[0];
        void audio.play().catch(() => {
          setError(c.voiceUnavailable);
          stop();
        });
      };
      peer.onconnectionstatechange = () => {
        if (
          g === generation.current &&
          ["failed", "disconnected", "closed"].includes(peer.connectionState)
        ) {
          setError(c.voiceUnavailable);
          stop();
        }
      };
      const channel = peer.createDataChannel("oai-events");
      let expiresAt = Date.now() + 600000;
      const disconnected = () => {
        if (g === generation.current) {
          setError(c.voiceUnavailable);
          stop();
        }
      };
      channel.onclose = disconnected;
      channel.onerror = disconnected;
      channel.onopen = () => {
        if (g !== generation.current) return;
        if (timeout.current) clearTimeout(timeout.current);
        timeout.current = setTimeout(stop, Math.max(0, expiresAt - Date.now()));
        setActive(true);
        setBusy(false);
        channel.send(
          JSON.stringify({
            type: "response.create",
            response: {
              conversation: "none",
              input: [],
              instructions:
                "Read exactly this question aloud, then wait silently: " +
                JSON.stringify(prompt),
              output_modalities: ["audio"],
            },
          }),
        );
      };
      channel.onmessage = (e) => {
        if (g !== generation.current) return;
        let event: any;
        try {
          event = JSON.parse(e.data);
        } catch {
          return;
        }
        if (
          event.type === "input_audio_buffer.speech_started" &&
          channel.readyState === "open"
        ) {
          channel.send(JSON.stringify({ type: "response.cancel" }));
          channel.send(JSON.stringify({ type: "output_audio_buffer.clear" }));
        }
        transcript.current = liveTranscriptEvent(transcript.current, event);
        const text = liveTranscriptText(transcript.current);
        setDraft(text);
        if (text) callbacks.current.onTranscript(text);
        if (
          event.type === "conversation.item.input_audio_transcription.failed" ||
          (event.type === "error" &&
            ![
              "response_cancel_not_active",
              "output_audio_buffer_empty",
            ].includes(event.error?.code))
        ) {
          setError(c.voiceUnavailable);
          stop();
        }
      };
      await peer.setLocalDescription(await peer.createOffer());
      const result = await api<{ id: string; sdp: string; expiresAt: number }>(
        root,
        "POST",
        {
          requestId: crypto.randomUUID(),
          consent: true,
          version,
          sdp: peer.localDescription!.sdp,
        },
        headers,
      );
      if (g !== generation.current) {
        void fetch("/api/" + root + "/" + result.id, {
          method: "DELETE",
          headers,
          keepalive: true,
        }).catch(() => {});
        return;
      }
      session.current = result.id;
      expiresAt = result.expiresAt;
      await peer.setRemoteDescription({ type: "answer", sdp: result.sdp });
      if (channel.readyState !== "open")
        timeout.current = setTimeout(disconnected, 20000);
    } catch (e) {
      if (g === generation.current) {
        setError(c.voiceUnavailable);
        stop();
      }
    }
  }
  return (
    <section className="visual-stack" aria-label={c.streaming}>
      <p>{c.voiceNotice}</p>
      <label>
        <input
          type="checkbox"
          checked={consent}
          disabled={busy || active}
          onChange={(e) => setConsent(e.target.checked)}
        />
        {c.voiceConsent}
      </label>
      {error && <Notice>{error}</Notice>}
      {active || busy ? (
        <button type="button" onClick={stop}>
          {c.voiceStop}
        </button>
      ) : (
        <button type="button" disabled={!consent} onClick={() => void start()}>
          {c.voiceStart}
        </button>
      )}
      {(active || busy) && (
        <p role="status">{busy ? c.connecting : c.listening}</p>
      )}
      {draft && (
        <p>
          <strong>{c.voiceDraft}</strong>: {draft}
        </p>
      )}
    </section>
  );
}
