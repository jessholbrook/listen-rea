"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
export default function MediaWatermarkControl({
  studyId,
  assetId,
  kind,
  onAsset,
  onBusy,
  disabled,
}: {
  studyId: string;
  assetId: string;
  kind: "image" | "video";
  onAsset: (id: string) => void;
  onBusy: (busy: boolean) => void;
  disabled: boolean;
}) {
  const [enabled, setEnabled] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const path =
    "studies/" +
    studyId +
    "/concept-" +
    (kind === "image" ? "images" : "videos") +
    "/" +
    assetId +
    "/watermark";
  useEffect(() => {
    let current = true;
    setLoaded(false);
    setError("");
    api(path)
      .then((r) => {
        if (current) {
          setEnabled(r.enabled);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [path, retry]);
  return (
    <div className="media-watermark-control">
      <label className="checkbox-label">
        <input
          type="checkbox"
          aria-label={"Watermark this " + kind}
          checked={enabled}
          disabled={disabled || !loaded}
          onChange={async (event) => {
            const next = event.target.checked;
            setEnabled(next);
            onBusy(true);
            setError("");
            try {
              const result = await api(path, "POST", { enabled: next });
              setEnabled(result.enabled);
              onAsset(result.asset.id);
            } catch (e) {
              setEnabled(!next);
              setError((e as Error).message);
            } finally {
              onBusy(false);
            }
          }}
        />
        Watermark this {kind}
      </label>
      <p className="small muted">
        Creates a separate private copy marked “ECHO LAB CONFIDENTIAL”. Turn off
        to use the original. Save and publish for new interviews; existing
        sessions keep their saved copy.
      </p>
      {error && (
        <p role="alert">
          {error}{" "}
          {!loaded && (
            <button
              type="button"
              className="text-button"
              onClick={() => setRetry((n) => n + 1)}
            >
              Retry watermark status
            </button>
          )}
        </p>
      )}
    </div>
  );
}
