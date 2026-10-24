"use client";
import { copy, participantError } from "@/lib/participant-copy";
import type { Language } from "@/lib/localization";
import { useState, useEffect, useRef } from "react";
import {
  Mic,
  Square,
  Volume2,
  RefreshCw,
  Headphones,
  PauseCircle,
} from "lucide-react";
import { api } from "@/lib/client";
import { newVoiceActivity, voiceActivity } from "@/lib/voice";
import {
  loadVoiceDraft,
  saveVoiceDraft,
  deleteVoiceDraft,
  type VoiceDraft,
} from "@/lib/voice-drafts";
import { Spinner, Notice } from "./components";
type Saved = { audioId: string; durationMs: number };
export default function VoiceInput({
  language = "en",
  interviewId,
  token,
  version,
  prompt,
  provider,
  onAudio,
  onTranscript,
  onBusy,
  onVoiceAnswer,
}: {
  language?: Language;
  interviewId: string;
  token: string;
  version: number;
  prompt: string;
  provider: boolean;
  onAudio: (v: Saved | null) => void;
  onTranscript: (s: string) => void;
  onBusy: (b: boolean) => void;
  onVoiceAnswer: (text: string, audio: Saved) => Promise<boolean>;
}) {
  const t = (text: string) => copy(language, text);
  const [allowed, setAllowed] = useState(false),
    [recording, setRecording] = useState(false),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState<Saved | null>(null),
    [audioUrl, setAudioUrl] = useState(""),
    [error, setError] = useState(""),
    [seconds, setSeconds] = useState(0),
    [speaking, setSpeaking] = useState(false),
    [conversation, setConversation] = useState(false),
    [status, setStatus] = useState("");
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    player = useRef<HTMLAudioElement | null>(null),
    mounted = useRef(true),
    url = useRef(""),
    speechUrl = useRef(""),
    timer = useRef<ReturnType<typeof setInterval> | null>(null),
    started = useRef(0),
    draft = useRef<VoiceDraft | null>(null),
    controller = useRef<AbortController | null>(null),
    audioContext = useRef<AudioContext | null>(null),
    auto = useRef(false),
    readingGeneration = useRef(0),
    discardRecording = useRef(false);
  const callbacks = useRef({ onAudio, onTranscript, onBusy, onVoiceAnswer });
  callbacks.current = { onAudio, onTranscript, onBusy, onVoiceAnswer };
  const storage = "recording:" + interviewId + ":" + version,
    consentKey = "voice-consent:" + interviewId,
    modeKey = "voice-mode:" + interviewId;
  const headers = { "x-interview-token": token };
  function lock(v: boolean) {
    if (mounted.current) setBusy(v);
    callbacks.current.onBusy(v);
  }
  function mode(v: boolean) {
    auto.current = v;
    setConversation(v);
    localStorage.setItem(modeKey, String(v));
  }
  function stopReading() {
    readingGeneration.current++;
    controller.current?.abort();
    player.current?.pause();
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    if (speechUrl.current) {
      URL.revokeObjectURL(speechUrl.current);
      speechUrl.current = "";
    }
  }
  function audio(blob: Blob) {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = URL.createObjectURL(blob);
    setAudioUrl(url.current);
  }
  useEffect(() => {
    mounted.current = true;
    const consent = localStorage.getItem(consentKey) === "true";
    setAllowed(consent);
    const resume =
      consent && provider && localStorage.getItem(modeKey) === "true";
    auto.current = resume;
    setConversation(resume);
    void (async () => {
      try {
        const recovery = await loadVoiceDraft(storage);
        if (!mounted.current) return;
        if (recovery) {
          draft.current = recovery;
          audio(recovery.blob);
          if (recovery.audioId) {
            const value = {
              audioId: recovery.audioId,
              durationMs: recovery.durationMs,
            };
            setSaved(value);
            callbacks.current.onAudio(value);
          }
          if (recovery.text) callbacks.current.onTranscript(recovery.text);
          mode(false);
          setStatus(
            t(
              "Recovered your saved recording. Review or retry it before continuing.",
            ),
          );
          return;
        }
        const existing = JSON.parse(localStorage.getItem(storage) || "null");
        if (existing) {
          setSaved(existing);
          callbacks.current.onAudio(existing);
          const r = await fetch(
            "/api/interviews/" + interviewId + "/recording/" + existing.audioId,
            { headers },
          );
          if (r.ok && mounted.current) audio(await r.blob());
          mode(false);
          return;
        }
        if (resume) await read(true);
      } catch {
        if (resume && mounted.current) await read(true);
      }
    })();
    return () => {
      mounted.current = false;
      readingGeneration.current++;
      controller.current?.abort();
      if (timer.current) clearInterval(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      player.current?.pause();
      window.speechSynthesis?.cancel();
      void audioContext.current?.close();
      if (url.current) URL.revokeObjectURL(url.current);
      if (speechUrl.current) URL.revokeObjectURL(speechUrl.current);
      callbacks.current.onBusy(false);
    };
  }, []);
  async function persist(value: VoiceDraft) {
    draft.current = value;
    try {
      await saveVoiceDraft(value);
    } catch {
      if (mounted.current)
        setStatus(
          t(
            "Browser draft recovery is unavailable. Keep this tab open until your recording is saved.",
          ),
        );
    }
  }
  async function transcribe(value: Saved) {
    controller.current = new AbortController();
    setStatus(t("Turning your recording into text…"));
    const result = await api(
      "interviews/" + interviewId + "/transcribe",
      "POST",
      { audioId: value.audioId },
      headers,
      controller.current.signal,
    );
    if (!mounted.current) return;
    callbacks.current.onTranscript(result.text);
    if (draft.current) await persist({ ...draft.current, text: result.text });
    if (auto.current && result.text.trim()) {
      setStatus(t("Saving your answer…"));
      const ok = await callbacks.current.onVoiceAnswer(result.text, value);
      if (ok) await deleteVoiceDraft(storage);
      else {
        mode(false);
        setStatus(
          t("Your answer is ready. Review it and retry when you’re ready."),
        );
      }
    } else
      setStatus(
        t("Recording saved. Review the written answer before continuing."),
      );
  }
  async function saveRecording(value: VoiceDraft) {
    lock(true);
    setError("");
    try {
      controller.current = new AbortController();
      let current = value;
      let savedValue: Saved;
      if (!current.audioId) {
        if (!current.recordingId) {
          current = { ...current, recordingId: crypto.randomUUID() };
          await persist(current);
        }
        setStatus(t("Saving your recording…"));
        const r = await fetch("/api/interviews/" + interviewId + "/recording", {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": current.blob.type,
            "x-recording-consent": "yes",
            "x-recording-id": current.recordingId!,
            "x-recording-duration": String(current.durationMs),
          },
          body: current.blob,
          signal: controller.current.signal,
        });
        const result = await r.json();
        if (!r.ok) throw new Error(result.error);
        savedValue = {
          audioId: result.audioId,
          durationMs: current.durationMs,
        };
        current = { ...current, audioId: result.audioId };
        await persist(current);
      } else
        savedValue = {
          audioId: current.audioId,
          durationMs: current.durationMs,
        };
      if (!mounted.current) return;
      setSaved(savedValue);
      callbacks.current.onAudio(savedValue);
      localStorage.setItem(storage, JSON.stringify(savedValue));
      if (provider) await transcribe(savedValue);
      else setStatus(t("Recording saved. Type a written answer to continue."));
    } catch (e) {
      if (mounted.current) {
        mode(false);
        setError(
          (e as Error).name === "AbortError"
            ? t("Request canceled. Your recording draft is preserved.")
            : (e as Error).message +
                t(" Your recording draft is preserved; retry or use text."),
        );
      }
    } finally {
      if (mounted.current) lock(false);
    }
  }
  async function start() {
    stopReading();
    setError("");
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          t(
            "Microphone recording requires HTTPS or localhost. You can type your answer.",
          ),
        );
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (!mounted.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((m) => MediaRecorder.isTypeSupported(m));
      if (!mime)
        throw new Error(
          t("This browser cannot record a supported format. Use text instead."),
        );
      const r = new MediaRecorder(media, {
        mimeType: mime,
        audioBitsPerSecond: 64000,
      });
      recorder.current = r;
      const chunks: BlobPart[] = [];
      discardRecording.current = false;
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onstop = () => {
        media.getTracks().forEach((t) => t.stop());
        if (timer.current) clearInterval(timer.current);
        void audioContext.current?.close();
        audioContext.current = null;
        if (!mounted.current) return;
        setRecording(false);
        callbacks.current.onBusy(false);
        if (discardRecording.current) return;
        const blob = new Blob(chunks, { type: mime }),
          durationMs = Math.min(300000, Date.now() - started.current);
        if (blob.size > 3 * 1024 * 1024) {
          mode(false);
          setError(t("Recording exceeded 3 MB. Try a shorter answer."));
          return;
        }
        if (durationMs < 200) {
          setError(t("That recording was too short. Try again."));
          return;
        }
        lock(true);
        audio(blob);
        const value = { key: storage, blob, durationMs, createdAt: Date.now() };
        void persist(value).then(() => saveRecording(value));
      };
      started.current = Date.now();
      setSeconds(0);
      setSaved(null);
      callbacks.current.onAudio(null);
      localStorage.removeItem(storage);
      setRecording(true);
      setStatus(
        auto.current
          ? t("Listening. Pause for a moment when you’re done.")
          : t("Recording your answer…"),
      );
      callbacks.current.onBusy(true);
      r.start(250);
      let activity = newVoiceActivity(Date.now());
      let analyser: AnalyserNode | null = null,
        buffer: Float32Array<ArrayBuffer> | null = null;
      if (auto.current) {
        const ctx = new AudioContext();
        audioContext.current = ctx;
        await ctx.resume();
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        ctx.createMediaStreamSource(media).connect(analyser);
        buffer = new Float32Array(analyser.fftSize);
      }
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started.current) / 1000);
        setSeconds(elapsed);
        if (elapsed >= 299 && r.state === "recording") {
          r.stop();
          return;
        }
        if (analyser && buffer && r.state === "recording") {
          analyser.getFloatTimeDomainData(buffer);
          const rms = Math.sqrt(
            buffer.reduce((n, v) => n + v * v, 0) / buffer.length,
          );
          const update = voiceActivity(activity, rms, Date.now());
          activity = update.state;
          if (update.finish) r.stop();
          else if (update.idle) {
            discardRecording.current = true;
            r.stop();
            mode(false);
            setStatus(
              t("No speech detected. Start recording when you’re ready."),
            );
          }
        }
      }, 100);
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      if (recorder.current?.state === "recording") {
        discardRecording.current = true;
        recorder.current.stop();
      }
      mode(false);
      setError((e as Error).message);
      setRecording(false);
      callbacks.current.onBusy(false);
    }
  }
  async function read(listenAfter = false) {
    if (speaking && !listenAfter) {
      stopReading();
      return;
    }
    stopReading();
    const generation = readingGeneration.current;
    setSpeaking(true);
    setStatus(t("Reading the question…"));
    setError("");
    const ended = () => {
      if (!mounted.current || generation !== readingGeneration.current) return;
      setSpeaking(false);
      if (speechUrl.current) {
        URL.revokeObjectURL(speechUrl.current);
        speechUrl.current = "";
      }
      if (listenAfter && auto.current) void start();
      else setStatus(t("Ready for your answer."));
    };
    if (!provider) {
      if (!window.speechSynthesis) {
        setError(t("Read aloud is unavailable in this browser."));
        setSpeaking(false);
        return;
      }
      const speech = new SpeechSynthesisUtterance(prompt);
      speech.lang = language;
      speech.onend = ended;
      speech.onerror = () => {
        setSpeaking(false);
        mode(false);
        setError(
          t("Read aloud could not start. Please type or record your answer."),
        );
      };
      speechSynthesis.speak(speech);
      return;
    }
    controller.current = new AbortController();
    try {
      const r = await fetch("/api/interviews/" + interviewId + "/speech", {
        method: "POST",
        headers,
        signal: controller.current.signal,
      });
      if (!r.ok) {
        const result = await r.json();
        throw new Error(result.error);
      }
      const blob = await r.blob();
      if (!mounted.current || generation !== readingGeneration.current) return;
      const a = new Audio(URL.createObjectURL(blob));
      speechUrl.current = a.src;
      player.current = a;
      a.onended = ended;
      a.onerror = () => {
        setSpeaking(false);
        mode(false);
        setError(t("Audio playback failed. Use the record button or text."));
      };
      await a.play();
    } catch (e) {
      if (!mounted.current || generation !== readingGeneration.current) return;
      setSpeaking(false);
      mode(false);
      setError((e as Error).message);
    }
  }
  async function conversationStart() {
    setError("");
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      mic.getTracks().forEach((t) => t.stop());
      mode(true);
      await read(true);
    } catch (e) {
      mode(false);
      setError(
        t(
          "Microphone permission is needed for hands-free mode. You can still use text.",
        ),
      );
    }
  }
  function pause() {
    mode(false);
    stopReading();
    if (recording) {
      recorder.current?.stop();
    }
    setStatus(
      t("Conversation paused. Nothing further will be recorded automatically."),
    );
  }
  return (
    <div className="voice-input">
      <div className="audio-controls">
        <button
          type="button"
          className="record-button"
          disabled={busy || recording}
          onClick={() => read()}
        >
          <Volume2 size={15} />
          {speaking ? t("Stop reading") : t("Read question aloud")}
        </button>
        {speaking && allowed && (
          <button type="button" className="record-button" onClick={start}>
            <Mic size={15} />
            {t("Interrupt & answer")}{" "}
          </button>
        )}
      </div>
      <label className="consent-check record-consent">
        <input
          type="checkbox"
          checked={allowed}
          disabled={recording || busy || speaking}
          onChange={(e) => {
            setAllowed(e.target.checked);
            localStorage.setItem(consentKey, String(e.target.checked));
            if (!e.target.checked) pause();
          }}
        />{" "}
        {t("I agree to record my voice for the study team.")}{" "}
        {provider
          ? t("Audio is sent to the connected provider for transcription.")
          : t(
              "Transcription is not connected. Type a written answer alongside your recording.",
            )}
      </label>
      <div className="audio-controls">
        {recording ? (
          <button
            type="button"
            className="record-button recording"
            onClick={() => recorder.current?.stop()}
          >
            <Square size={14} />
            <i />
            {t("Stop recording ·")} {Math.floor(seconds / 60)}:
            {String(seconds % 60).padStart(2, "0")}
          </button>
        ) : (
          <button
            type="button"
            className="record-button"
            disabled={!allowed || busy || speaking}
            onClick={start}
          >
            <Mic size={15} />
            {saved ? t("Record again") : t("Record an answer")}
          </button>
        )}
        {provider && !conversation && (
          <button
            type="button"
            className="record-button"
            disabled={!allowed || busy || recording || speaking}
            onClick={conversationStart}
          >
            <Headphones size={15} />
            {t("Start hands-free")}{" "}
          </button>
        )}
        {conversation && (
          <button type="button" className="record-button" onClick={pause}>
            <PauseCircle size={15} />
            {t("Pause conversation")}{" "}
          </button>
        )}
        {busy && (
          <>
            <span className="audio-note">
              <Spinner /> {status}
            </span>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                mode(false);
                controller.current?.abort();
              }}
            >
              {t("Cancel request")}{" "}
            </button>
          </>
        )}
        {!busy && status && (
          <span className="audio-note" role="status">
            {status}
          </span>
        )}
        {audioUrl && <audio controls src={audioUrl} preload="metadata" />}
        {draft.current && !busy && !recording && (
          <button
            type="button"
            className="text-button"
            onClick={() => saveRecording(draft.current!)}
          >
            <RefreshCw size={13} />{" "}
            {saved && provider ? t("Retry transcription") : t("Retry saving")}
          </button>
        )}
      </div>
      {provider && (
        <p className="audio-note">
          {t(
            "Hands-free mode submits transcribed answers automatically after a pause. You can pause the conversation or interrupt read-aloud at any time. Use manual recording to review each transcript first.",
          )}{" "}
        </p>
      )}
      {error && <Notice>{participantError(language, error)}</Notice>}
    </div>
  );
}
