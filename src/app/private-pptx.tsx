"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import {
  pptxSnapshot,
  pptxLabels,
  type PPTXSnapshot,
} from "@/lib/participant-pptx";
export default function PrivatePPTX({
  assetId,
  studyId,
  interviewId,
  token,
  language = "en",
  highlight,
}: {
  assetId: string;
  studyId?: string;
  interviewId?: string;
  token?: string;
  language?: "en" | "es" | "fr";
  highlight?: { slide: number; quote: string };
}) {
  const [snapshot, setSnapshot] = useState<PPTXSnapshot | null>(null),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const l = pptxLabels[language];
  async function view() {
    if (open) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const path = studyId ? `studies/${studyId}` : `interviews/${interviewId}`;
      setSnapshot(
        pptxSnapshot.parse(
          await api(
            `${path}/participant-pptx/${assetId}`,
            "GET",
            undefined,
            token ? { "x-interview-token": token } : {},
          ),
        ),
      );
      setOpen(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="attachment-synthesis" aria-label={l.snapshot}>
      <button className="button" type="button" disabled={busy} onClick={view}>
        {open ? l.hide : l.view}
      </button>
      {error && <p role="alert">{error}</p>}
      {open && snapshot && (
        <>
          <p className="muted">{l.notice}</p>
          <button
            className="button"
            type="button"
            onClick={() => {
              const url = URL.createObjectURL(
                  new Blob(
                    [
                      snapshot.slides
                        .map((p, n) => `${l.slide} ${n + 1}\n${p}`)
                        .join("\n\n"),
                    ],
                    { type: "text/plain;charset=utf-8" },
                  ),
                ),
                a = document.createElement("a");
              a.href = url;
              a.download = "echo-lab-pptx-text.txt";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            {l.download}
          </button>
          <div
            style={{
              maxHeight: 420,
              overflow: "auto",
              overflowWrap: "anywhere",
            }}
          >
            {snapshot.slides.map((p, n) => (
              <article key={n}>
                <strong>
                  {l.slide} {n + 1}
                </strong>
                <p style={{ whiteSpace: "pre-wrap" }}>
                  {highlight?.slide === n + 1 && p.includes(highlight.quote) ? (
                    <>
                      {p.slice(0, p.indexOf(highlight.quote))}
                      <mark>{highlight.quote}</mark>
                      {p.slice(
                        p.indexOf(highlight.quote) + highlight.quote.length,
                      )}
                    </>
                  ) : (
                    p
                  )}
                </p>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
