"use client";
import MediaWatermarkControl from "./media-watermark-control";
import { useRef, useState } from "react";
import { conceptImageMaxInput } from "@/lib/concept-images";
import PrivateConceptImage from "./private-concept-image";
export default function ConceptImageUpload({
  studyId,
  assetId,
  alt,
  onImage,
  onBusy,
  purpose = "concept",
}: {
  studyId: string;
  assetId?: string | null;
  alt: string;
  onImage: (id: string | null) => void;
  onBusy: (busy: boolean) => void;
  purpose?: "concept" | "answer";
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
      const r = await fetch("/api/studies/" + studyId + "/concept-images", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": request.file.type,
          "x-upload-id": request.id,
        },
        body: request.file,
      });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error || "Image upload failed.");
      onImage(out.image.id);
      pending.current = null;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <div className="concept-image-upload">
      <label>
        {purpose === "answer" ? "Upload answer image" : "Upload concept image"}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (
              !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
              file.size > conceptImageMaxInput
            ) {
              setError("Choose a PNG, JPEG or WebP image up to 2 MB.");
              return;
            }
            pending.current = { file, id: crypto.randomUUID() };
            await upload();
          }}
        />
      </label>
      {busy && <p role="status">Preparing image…</p>}
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
              Retry image upload
            </button>
          )}
        </div>
      )}
      {assetId && (
        <>
          <PrivateConceptImage
            studyId={studyId}
            assetId={assetId}
            alt={alt || "Uploaded concept image"}
          />
          <MediaWatermarkControl
            studyId={studyId}
            assetId={assetId}
            kind="image"
            disabled={busy}
            onAsset={(id) => onImage(id)}
            onBusy={(next) => {
              setBusy(next);
              onBusy(next);
            }}
          />
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => onImage(null)}
          >
            {purpose === "answer"
              ? "Remove answer image"
              : "Remove uploaded image from concept"}
          </button>
        </>
      )}
    </div>
  );
}
