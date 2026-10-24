"use client";
import { useRef, useState, useEffect } from "react";
import type { Interview } from "@/lib/domain";
import { pptxLabels, pptxMime } from "@/lib/participant-pptx";
import { api } from "@/lib/client";
import { pptxAILabels } from "@/lib/participant-pptx-ai";
import PrivatePPTX from "./private-pptx";
export default function ParticipantPPTXUpload({
  interview,
  token,
  disabled,
  onBusy,
  onInterview,
}: {
  interview: Interview;
  token: string;
  disabled: boolean;
  onBusy: (v: boolean) => void;
  onInterview: (i: Interview) => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [description, setDescription] = useState(""),
    [allowed, setAllowed] = useState(false),
    [aiAllowed, setAIAllowed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const attempt = useRef<{
      file: File;
      description: string;
      id: string;
      aiAllowed: boolean;
    } | null>(null),
    controller = useRef<AbortController | null>(null),
    saved = interview.participantPPTXDraft?.pptx,
    l = pptxLabels[interview.language || "en"],
    aiLabels = pptxAILabels[interview.language || "en"],
    canAI = Boolean(
      interview.guide.questions[interview.current]?.participantPPTXAI,
    );
  useEffect(() => () => controller.current?.abort(), []);
  async function upload() {
    if (!file || !allowed || disabled || busy) return;
    setBusy(true);
    onBusy(true);
    setError("");
    controller.current = new AbortController();
    const timer = setTimeout(() => controller.current?.abort(), 30000);
    try {
      if (file.size > 3 * 1024 * 1024)
        throw Error("PPTX uploads must be at most 3 MB.");
      if (
        !attempt.current ||
        attempt.current.file !== file ||
        attempt.current.description !== description ||
        attempt.current.aiAllowed !== aiAllowed
      )
        attempt.current = {
          file,
          description,
          aiAllowed,
          id: crypto.randomUUID(),
        };
      const r = await fetch(
          `/api/interviews/${interview.id}/participant-pptx`,
          {
            method: "POST",
            body: file,
            signal: controller.current.signal,
            headers: {
              "content-type": pptxMime,
              "x-interview-token": token,
              "x-upload-id": attempt.current.id,
              "x-interview-version": String(interview.version),
              "x-pptx-description": encodeURIComponent(description),
              "x-pptx-consent": "yes",
              "x-pptx-ai-consent": aiAllowed && canAI ? "yes" : "no",
            },
          },
        ),
        result = await r.json();
      if (!r.ok) throw Error(result.error || "PPTX preparation failed.");
      onInterview(result.interview);
      setFile(null);
      setDescription("");
      setAllowed(false);
      setAIAllowed(false);
      attempt.current = null;
    } catch (e) {
      setError(
        (e as Error).name === "AbortError"
          ? "The upload timed out. Reload to check whether it was saved, or retry the same file."
          : (e as Error).message,
      );
    } finally {
      clearTimeout(timer);
      setBusy(false);
      onBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const r = await api(
        `interviews/${interview.id}/participant-pptx/${saved!.id}`,
        "DELETE",
        undefined,
        {
          "x-interview-token": token,
          "x-interview-version": String(interview.version),
        },
      );
      onInterview(r.interview);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section className="panel participant-image-upload" aria-label={l.title}>
      <h3>{l.title}</h3>
      <p>{l.notice}</p>
      {saved ? (
        <>
          <PrivatePPTX
            assetId={saved.id}
            interviewId={interview.id}
            token={token}
            language={interview.language}
          />
          <p>
            {saved.description} · {saved.slides} {l.slide.toLowerCase()}s
          </p>
          <p>{l.pending}</p>
          <p>{saved.aiPermission ? aiLabels.granted : aiLabels.declined}</p>
          <button
            className="button"
            type="button"
            disabled={disabled || busy}
            onClick={remove}
          >
            {l.remove}
          </button>
        </>
      ) : (
        <>
          <label>
            {l.choose}
            <input
              type="file"
              accept={pptxMime + ",.pptx"}
              disabled={disabled || busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                attempt.current = null;
                setAllowed(false);
                setAIAllowed(false);
              }}
            />
          </label>
          <label>
            {l.description}
            <textarea
              rows={2}
              maxLength={500}
              value={description}
              disabled={disabled || busy}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="consent-check">
            <input
              type="checkbox"
              checked={allowed}
              disabled={disabled || busy}
              onChange={(e) => setAllowed(e.target.checked)}
            />
            {l.consent}
          </label>
          {canAI && (
            <>
              <label className="consent-check">
                <input
                  type="checkbox"
                  checked={aiAllowed}
                  disabled={disabled || busy}
                  onChange={(e) => setAIAllowed(e.target.checked)}
                />
                {aiLabels.permission}
              </label>
              <p className="muted">{aiLabels.notice}</p>
            </>
          )}
          <button
            className="button"
            type="button"
            disabled={
              disabled ||
              busy ||
              !file ||
              !allowed ||
              description.trim().length < 3
            }
            onClick={upload}
          >
            {busy ? l.uploading : l.upload}
          </button>
          <p className="muted">{l.optional}</p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
