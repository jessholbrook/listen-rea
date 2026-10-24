"use client";
import { useRef, useState, useEffect } from "react";
import type { Interview } from "@/lib/domain";
import { copy, participantError } from "@/lib/participant-copy";
import { api } from "@/lib/client";
import { pdfAIPermissionText } from "@/lib/participant-pdf-ai";
import PrivatePDF from "./private-pdf";
export default function ParticipantPDFUpload({
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
    controller = useRef<AbortController | null>(null);
  const language = interview.language || "en",
    t = (s: string) => copy(language, s),
    saved = interview.participantPDFDraft?.pdf,
    canAI = Boolean(
      interview.guide.questions[interview.current]?.participantPDFAI,
    );
  useEffect(() => () => controller.current?.abort(), []);
  async function upload() {
    if (!file || !allowed || disabled || busy) return;
    setBusy(true);
    onBusy(true);
    setError("");
    controller.current = new AbortController();
    const timer = setTimeout(() => controller.current?.abort(), 45000);
    try {
      if (file.size > 3 * 1024 * 1024)
        throw Error("PDF uploads must be at most 3 MB.");
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
        `/api/interviews/${interview.id}/participant-pdfs`,
        {
          method: "POST",
          body: file,
          signal: controller.current.signal,
          headers: {
            "content-type": file.type,
            "x-interview-token": token,
            "x-upload-id": attempt.current.id,
            "x-interview-version": String(interview.version),
            "x-pdf-description": encodeURIComponent(description),
            "x-pdf-consent": "yes",
            "x-pdf-ai-consent": aiAllowed ? "yes" : "no",
          },
        },
      );
      const result = await r.json();
      if (!r.ok)
        throw Error(
          result.error ||
            "The PDF could not be uploaded. Retry or continue without a PDF.",
        );
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
        `interviews/${interview.id}/participant-pdfs/${saved!.id}`,
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
    <section
      className="panel participant-image-upload participant-pdf-upload"
      aria-label={t("Optional PDF attachment")}
    >
      <h3>{t("Optional PDF attachment")}</h3>
      <p className="muted">
        {t(
          "Sharing a PDF does not enable AI interview follow-ups. Remove personal details first.",
        )}
      </p>
      {saved ? (
        <>
          <PrivatePDF
            assetId={saved.id}
            interviewId={interview.id}
            token={token}
            language={language}
          />
          <p>{saved.description}</p>
          <p className="muted">
            {t(
              saved.aiPermission
                ? "AI PDF follow-up permission saved for this upload."
                : "No AI PDF follow-up permission was granted for this upload.",
            )}
          </p>
          <p>
            {t("Pages")}: {saved.pages}
          </p>
          <p className="muted">
            {t("This PDF will be attached when you submit your answer.")}
          </p>
          <button
            type="button"
            className="button secondary"
            disabled={disabled || busy}
            onClick={remove}
          >
            {t("Remove attached PDF")}
          </button>
        </>
      ) : (
        <>
          <label>
            {t("Choose a PDF (up to 3 MB; 1–20 pages)")}
            <input
              type="file"
              accept="application/pdf"
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
            {t("Describe your PDF")}
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
            {t(
              "I agree to share this PDF with the research team for this study.",
            )}
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
                {t(pdfAIPermissionText)}
              </label>
              <p className="muted">
                {t(
                  "Optional: up to 1,000 extracted characters per page may be sent to OpenAI with your answer and description. Scans and unreadable text may be skipped. You can share without permitting an AI follow-up.",
                )}
              </p>
            </>
          )}
          <button
            type="button"
            className="button secondary"
            disabled={
              disabled ||
              busy ||
              !file ||
              !allowed ||
              description.trim().length < 3
            }
            onClick={upload}
          >
            {t(busy ? "Uploading PDF…" : "Upload PDF")}
          </button>
          <p className="muted">
            {t(
              "You can continue without a PDF. A selected file is shared only after you choose Upload PDF.",
            )}
          </p>
        </>
      )}
      {error && <p role="alert">{participantError(language, error)}</p>}
    </section>
  );
}
