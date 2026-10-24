"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { PPTXPassage, PPTXTextView } from "@/lib/pptx-text";

export default function PPTXTextPanel({
  studyId,
  pptxId,
}: {
  studyId: string;
  pptxId: string;
}) {
  const path = `studies/${studyId}/participant-pptx/${pptxId}/text`;
  const [saved, setSaved] = useState<PPTXTextView | null>(null),
    [passages, setPassages] = useState<PPTXPassage[]>([]),
    [slide, setSlide] = useState(1),
    [cited, setCited] = useState<PPTXPassage | null>(null),
    [attested, setAttested] = useState(false),
    [includeInReports, setIncludeInReports] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const textArea = useRef<HTMLTextAreaElement>(null);
  function adopt(r: PPTXTextView) {
    setSaved(r);
    setPassages(r.verification?.history.at(-1)?.passages || []);
    setAttested(false);
    setIncludeInReports(
      r.verification?.history.at(-1)?.includeInReports || false,
    );
  }
  useEffect(() => {
    let active = true;
    api(path)
      .then((r) => {
        if (active) adopt(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [path]);
  useEffect(() => {
    if (cited && cited.slide === slide) {
      textArea.current?.focus();
      textArea.current?.setSelectionRange(cited.start, cited.end);
    }
  }, [slide, cited]);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function view(p: PPTXPassage) {
    setSlide(p.slide);
    setCited({ ...p });
  }
  function citation(p: PPTXPassage) {
    return `PPTX slide ${p.slide} · characters ${p.start + 1}–${p.end}`;
  }
  return (
    <section
      className="panel pdf-text"
      aria-label="PPTX text and verified passages"
    >
      <h4>PPTX text and verified passages</h4>
      <p className="muted">
        Select exact text from the prepared snapshot and check each passage in
        its slide before verifying. Slide numbers refer to this prepared text,
        not a rendered presentation. Verification records your review, not
        whether a document claim is true. Only explicitly included selections
        and reviewer attribution appear in new analysis and report appendices,
        including shared reports and exports. Raw text and history stay private.
        This step sends no text to AI.
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button
        className="button"
        type="button"
        disabled={busy}
        onClick={() =>
          act(async () => {
            adopt(await api(path));
            setMessage("Saved PPTX verification reloaded.");
          })
        }
      >
        Reload PPTX verification
      </button>
      {saved && (
        <fieldset disabled={busy}>
          <label>
            Prepared slide
            <select
              aria-label="Prepared PPTX slide"
              value={slide}
              onChange={(e) => {
                setSlide(Number(e.target.value));
                setCited(null);
              }}
            >
              {saved.slides.map((_, n) => (
                <option key={n} value={n + 1}>
                  Slide {n + 1}
                </option>
              ))}
            </select>
          </label>
          <label>
            Prepared text · slide {slide}
            <textarea
              ref={textArea}
              aria-label="Prepared PPTX slide text"
              rows={7}
              readOnly
              value={saved.slides[slide - 1] || ""}
            />
          </label>
          <button
            className="button"
            type="button"
            onClick={() => {
              const el = textArea.current;
              if (!el) return;
              const start = el.selectionStart,
                end = el.selectionEnd,
                quote = saved.slides[slide - 1].slice(start, end);
              if (!quote.trim() || quote.length > 1000) {
                setError("Select 1–1,000 characters from the prepared slide.");
                return;
              }
              if (passages.length >= 10) {
                setError("Save at most 10 passages per PPTX.");
                return;
              }
              if (
                passages.some(
                  (p) =>
                    p.slide === slide && p.start === start && p.end === end,
                )
              ) {
                setError("That passage is already selected.");
                return;
              }
              setPassages([...passages, { slide, start, end, quote }]);
              setAttested(false);
              setError("");
              setMessage("");
            }}
          >
            Add selected PPTX passage
          </button>
          <h5>PPTX passages to verify ({passages.length}/10)</h5>
          {passages.map((p, n) => (
            <article key={`${p.slide}:${p.start}:${p.end}`}>
              <blockquote>{p.quote}</blockquote>
              <p>{citation(p)}</p>
              <button className="button" type="button" onClick={() => view(p)}>
                View cited slide {p.slide}
              </button>
              <button
                className="button"
                type="button"
                onClick={() => {
                  setPassages(passages.filter((_, i) => i !== n));
                  setAttested(false);
                  setMessage("");
                }}
              >
                Remove PPTX passage {n + 1}
              </button>
            </article>
          ))}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includeInReports}
              onChange={(e) => {
                setIncludeInReports(e.target.checked);
                setAttested(false);
              }}
            />
            Include this verified PPTX selection in new analysis and report
            appendices, including shared reports and exports.
          </label>
          <p className="muted">
            Saving an included selection or withdrawing its inclusion removes
            existing analyses, report editions and share links. Create and
            review new reports after saving.
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
            />
            I checked these passages against the cited prepared PPTX slides and
            approve this selection, including any removals.
          </label>
          <button
            className="button primary"
            type="button"
            disabled={!attested}
            onClick={() =>
              act(async () => {
                adopt(
                  await api(path, "PUT", {
                    source: saved.source,
                    digest: saved.digest,
                    version: saved.verification?.history.at(-1)?.version || 0,
                    attested: true,
                    includeInReports,
                    passages,
                  }),
                );
                setMessage(
                  includeInReports
                    ? "PPTX passages verified and included. Create a new analysis and report."
                    : "PPTX passages verified and saved privately.",
                );
              })
            }
          >
            Save verified PPTX passages
          </button>
          <p>
            {saved.verification?.history.length
              ? `Saved PPTX verification · revision ${saved.verification.history.at(-1)!.version}`
              : "No PPTX passage verification saved"}
          </p>
          <details>
            <summary>
              PPTX verification history (
              {saved.verification?.history.length || 0})
            </summary>
            {[...(saved.verification?.history || [])].reverse().map((h) => (
              <article key={h.version}>
                <p>
                  {h.includeInReports ? "Included in reports" : "Internal only"}{" "}
                  · Revision {h.version} · {h.reviewer.name} ·{" "}
                  {new Date(h.at).toLocaleString()}
                </p>
                {!h.passages.length && (
                  <p>No passages selected in this revision.</p>
                )}
                {h.passages.map((p, n) => (
                  <div key={n}>
                    <blockquote>{p.quote}</blockquote>
                    <p>
                      {citation(p)} · verification revision {h.version}
                    </p>
                    <button
                      className="button"
                      type="button"
                      onClick={() => view(p)}
                    >
                      View cited slide {p.slide}
                    </button>
                  </div>
                ))}
              </article>
            ))}
          </details>
        </fieldset>
      )}
    </section>
  );
}
