"use client";
import { useRef, useState, useEffect } from "react";
import type { Interview } from "@/lib/domain";
import { docxLabels, docxMime } from "@/lib/participant-docx";
import { api } from "@/lib/client";
import { docxAILabels } from "@/lib/participant-docx-ai";
import PrivateDOCX from "./private-docx";
export default function ParticipantDOCXUpload({
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
    saved = interview.participantDOCXDraft?.docx,
    l = docxLabels[interview.language || "en"],
    aiLabels = docxAILabels[interview.language || "en"],
    canAI = Boolean(
      interview.guide.questions[interview.current]?.participantDOCXAI,
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
        throw Error("DOCX uploads must be at most 3 MB.");
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
          `/api/interviews/${interview.id}/participant-docx`,
          {
            method: "POST",
            body: file,
            signal: controller.current.signal,
            headers: {
              "content-type": docxMime,
              "x-interview-token": token,
              "x-upload-id": attempt.current.id,
              "x-interview-version": String(interview.version),
              "x-docx-description": encodeURIComponent(description),
              "x-docx-consent": "yes",
              "x-docx-ai-consent": aiAllowed && canAI ? "yes" : "no",
            },
          },
        ),
        result = await r.json();
      if (!r.ok) throw Error(result.error || "DOCX preparation failed.");
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
        `interviews/${interview.id}/participant-docx/${saved!.id}`,
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
          <PrivateDOCX
            assetId={saved.id}
            interviewId={interview.id}
            token={token}
            language={interview.language}
          />
          <p>
            {saved.description} · {saved.paragraphs} {l.paragraph.toLowerCase()}
            s
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
              accept={docxMime + ",.docx"}
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
