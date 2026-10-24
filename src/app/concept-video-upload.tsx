"use client";
import MediaWatermarkControl from "./media-watermark-control";
import { useRef, useState } from "react";
import { conceptVideoMaxInput } from "@/lib/concept-videos";
import PrivateConceptVideo from "./private-concept-video";
export default function ConceptVideoUpload({
  studyId,
  assetId,
  alt,
  onVideo,
  onBusy,
}: {
  studyId: string;
  assetId?: string | null;
  alt: string;
  onVideo: (id: string | null) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<{ file: File; id: string } | null>(null);
  async function upload() {
    const request = pending.current;
    if (!request) return;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const r = await fetch("/api/studies/" + studyId + "/concept-videos", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": request.file.type,
          "x-upload-id": request.id,
        },
        body: request.file,
      });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error || "Video upload failed.");
      onVideo(out.video.id);
      pending.current = null;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <div className="concept-video-upload">
      <label>
        Upload concept video
        <input
          type="file"
          accept="video/mp4,video/webm"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (
              !["video/mp4", "video/webm"].includes(file.type) ||
              file.size > conceptVideoMaxInput
            ) {
              setError(
                "Choose an MP4 or WebM video up to 3 MB and 60 seconds.",
              );
              return;
            }
            pending.current = { file, id: crypto.randomUUID() };
            await upload();
          }}
        />
      </label>
      {busy && <p role="status">Preparing video…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          {pending.current && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={upload}
            >
              Retry video upload
            </button>
          )}
        </div>
      )}
      {assetId && (
        <>
          <PrivateConceptVideo
            studyId={studyId}
            assetId={assetId}
            alt={alt || "Uploaded concept video"}
          />
          <MediaWatermarkControl
            studyId={studyId}
            assetId={assetId}
            kind="video"
            disabled={busy}
            onAsset={(id) => onVideo(id)}
            onBusy={(next) => {
              setBusy(next);
              onBusy(next);
            }}
          />
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => onVideo(null)}
          >
            Remove uploaded video from concept
          </button>
        </>
      )}
    </div>
  );
}
