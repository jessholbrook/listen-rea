"use client";
import { useRef, useState, useEffect } from "react";
import type { Interview } from "@/lib/domain";
import { copy, participantError } from "@/lib/participant-copy";
import { imageAIPermissionText } from "@/lib/participant-image-ai";
import { api } from "@/lib/client";
import PrivateConceptImage from "./private-concept-image";
export default function ParticipantImageUpload({
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
    [aiAllowed, setAiAllowed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const attempt = useRef<{
      file: File;
      description: string;
      aiAllowed: boolean;
      id: string;
    } | null>(null),
    controller = useRef<AbortController | null>(null);
  const language = interview.language || "en",
    t = (s: string) => copy(language, s),
    saved = interview.participantImageDraft?.image;
  useEffect(() => () => controller.current?.abort(), []);
  async function upload() {
    if (!file || !allowed || disabled || busy) return;
    setBusy(true);
    onBusy(true);
    setError("");
    controller.current = new AbortController();
    const timer = setTimeout(() => controller.current?.abort(), 45000);
    try {
      if (file.size > 2 * 1024 * 1024)
        throw new Error("Image uploads must be at most 2 MB.");
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
        "/api/interviews/" + interview.id + "/participant-images",
        {
          method: "POST",
          body: file,
          signal: controller.current.signal,
          headers: {
            "content-type": file.type,
            "x-interview-token": token,
            "x-upload-id": attempt.current.id,
            "x-interview-version": String(interview.version),
            "x-image-description": encodeURIComponent(description),
            "x-image-consent": "yes",
            "x-image-ai-consent": aiAllowed ? "yes" : "no",
          },
        },
      );
      const result = await r.json();
      if (!r.ok)
        throw new Error(
          result.error ||
            "The image could not be uploaded. Retry or continue without an image.",
        );
      onInterview(result.interview);
      setFile(null);
      setDescription("");
      setAllowed(false);
      setAiAllowed(false);
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
        "interviews/" + interview.id + "/participant-images/" + saved!.id,
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
      className="panel participant-image-upload"
      aria-label={t("Optional image attachment")}
    >
      <h3>{t("Optional image attachment")}</h3>
      <p className="muted">
        {t(
          interview.guide.questions[interview.current]?.participantImageAI
            ? "Share only an image you have permission to use. Remove personal details first. AI image review is optional and needs your separate permission below."
            : "Share only an image you have permission to use. Remove personal details first. Images are shared with the research team; AI will not inspect this upload.",
        )}
      </p>
      {saved ? (
        <>
          <PrivateConceptImage
            assetId={saved.id}
            interviewId={interview.id}
            token={token}
            resource="participant-images"
            alt={saved.description}
            language={language}
            enlarge
          />
          <p>{saved.description}</p>
          <p className="muted">
            {saved.aiPermission
              ? t("AI image review permitted for this upload.")
              : t(
                  "This image is shared with the research team only; AI image review was not permitted.",
                )}
          </p>
          <p className="muted">
            {t(
              "To change image permissions, remove this upload and upload it again before answering.",
            )}
          </p>
          <p className="muted">
            {t("This image will be attached when you submit your answer.")}
          </p>
          <button
            className="button secondary"
            type="button"
            disabled={disabled || busy}
            onClick={remove}
          >
            {t("Remove attached image")}
          </button>
        </>
      ) : (
        <>
          <label>
            {t("Choose an image (PNG, JPEG or WebP; up to 2 MB)")}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={disabled || busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                attempt.current = null;
                setAllowed(false);
                setAiAllowed(false);
              }}
            />
          </label>
          <label>
            {t("Describe your image")}
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
              "I agree to share this image with the research team for this study.",
            )}
          </label>
          {interview.guide.questions[interview.current]?.participantImageAI && (
            <label className="consent-check">
              <input
                type="checkbox"
                checked={aiAllowed}
                disabled={disabled || busy}
                onChange={(e) => setAiAllowed(e.target.checked)}
              />
              {t(imageAIPermissionText)}
            </label>
          )}
          <button
            className="button secondary"
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
            {busy ? t("Uploading image…") : t("Upload image")}
          </button>
          <p className="muted">
            {t(
              "You can continue without an image. A selected file is shared only after you choose Upload image.",
            )}
          </p>
        </>
      )}
      {error && <p role="alert">{participantError(language, error)}</p>}
    </section>
  );
}
