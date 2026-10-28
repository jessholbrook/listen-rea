"use client";
import { useEffect, useState } from "react";
import type { ConceptVideo } from "@/lib/concept-videos";
import { api } from "@/lib/client";
export default function ConceptVideoLibrary({
  studyId,
  usedIds,
  refreshKey,
}: {
  studyId: string;
  usedIds: string[];
  refreshKey: string;
}) {
  const [videos, setVideos] = useState<ConceptVideo[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const path = "studies/" + studyId + "/concept-videos";
  useEffect(() => {
    let current = true;
    api(path)
      .then((r) => {
        if (current) setVideos(r.videos);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [path, refreshKey]);
  return (
    <details className="concept-video-library">
      <summary>Uploaded videos ({videos.length})</summary>
      <p className="small muted">
        Remove an video from the concept to stop using it in new interviews.
        Videos retained by saved guides, history, interviews or trackers remain
        available to those versions. Unused uploads can be deleted here. Delete
        unused watermarked copies before their originals.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {videos.map((video, n) => (
        <div className="concept-video-row" key={video.id}>
          <span>
            Video {n + 1} · {video.width} × {video.height} ·{" "}
            {Math.ceil(video.durationMs / 1000)} s ·{" "}
            {Math.ceil(video.bytes / 1024)} KB
            {video.sourceAssetId ? " · Watermarked copy" : ""}
            {usedIds.includes(video.id) ? " · In this draft" : ""}
          </span>
          <button
            type="button"
            className="text-button"
            disabled={busy || usedIds.includes(video.id)}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api(path + "/" + video.id, "DELETE");
                setVideos((videos) => videos.filter((i) => i.id !== video.id));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete unused video {n + 1}
          </button>
        </div>
      ))}
    </details>
  );
}
