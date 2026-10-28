"use client";
import { useEffect, useState } from "react";
import type { ConceptImage } from "@/lib/concept-images";
import { api } from "@/lib/client";
export default function ConceptImageLibrary({
  studyId,
  usedIds,
  refreshKey,
}: {
  studyId: string;
  usedIds: string[];
  refreshKey: string;
}) {
  const [images, setImages] = useState<ConceptImage[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const path = "studies/" + studyId + "/concept-images";
  useEffect(() => {
    let current = true;
    api(path)
      .then((r) => {
        if (current) setImages(r.images);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [path, refreshKey]);
  return (
    <details className="concept-image-library">
      <summary>Uploaded images ({images.length})</summary>
      <p className="small muted">
        Remove an image from the concept or answer option to stop using it in
        new interviews. Images retained by saved guides, history, interviews or
        trackers remain available to those versions. Unused uploads can be
        deleted here.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {images.map((image, n) => (
        <div className="concept-image-row" key={image.id}>
          <span>
            Image {n + 1} · {image.width} × {image.height} ·{" "}
            {Math.ceil(image.bytes / 1024)} KB
            {image.sourceAssetId ? " · Watermarked copy" : ""}
            {usedIds.includes(image.id) ? " · In this draft" : ""}
          </span>
          <button
            type="button"
            className="text-button"
            disabled={busy || usedIds.includes(image.id)}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api(path + "/" + image.id, "DELETE");
                setImages((images) => images.filter((i) => i.id !== image.id));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete unused image {n + 1}
          </button>
        </div>
      ))}
    </details>
  );
}
