"use client";
import { useRef, useState } from "react";
import {
  recordingRangeLabel,
  sectionLabels,
  type ReviewedRecordingSection,
} from "@/lib/recording-sections";
import type { Language } from "@/lib/localization";
export default function RecordingCitation({
  value,
  language = "en",
}: {
  value: ReviewedRecordingSection;
  language?: Language;
}) {
  const ref = useRef<HTMLMediaElement | null>(null),
    [open, setOpen] = useState(false),
    l = sectionLabels[language];
  const props = {
    controls: true,
    preload: "none",
    src: `/api/recordings/${value.mediaId}#t=${value.startMs / 1000},${value.endMs / 1000}`,
    ref: (node: HTMLMediaElement | null) => {
      ref.current = node;
    },
    onPlay: () => {
      const p = ref.current;
      if (
        p &&
        (p.currentTime < value.startMs / 1000 ||
          p.currentTime >= value.endMs / 1000)
      )
        p.currentTime = value.startMs / 1000;
    },
    onTimeUpdate: () => {
      const p = ref.current;
      if (p && p.currentTime >= value.endMs / 1000) p.pause();
    },
  };
  return (
    <details
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        if (!e.currentTarget.open) ref.current?.pause();
      }}
    >
      <summary>{recordingRangeLabel(value)}</summary>
      <p className="small muted">
        {l.reviewer} {value.reviewedBy.name} · {value.reviewedAt}
      </p>
      {open && (
        <>
          {value.mime.startsWith("video/") ? (
            <video {...props} playsInline />
          ) : (
            <audio {...props} />
          )}
          <button
            className="secondary"
            onClick={() => {
              if (ref.current) {
                ref.current.currentTime = value.startMs / 1000;
                void ref.current.play().catch(() => {});
              }
            }}
          >
            {l.play}
          </button>
        </>
      )}
    </details>
  );
}
