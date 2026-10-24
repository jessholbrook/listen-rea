"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { PDFPassage, PDFTextView } from "@/lib/pdf-text";
import PrivatePDF from "./private-pdf";
import PDFOCRPanel from "./pdf-ocr-panel";
export default function PDFTextPanel({
  studyId,
  pdfId,
}: {
  studyId: string;
  pdfId: string;
}) {
  const path = `studies/${studyId}/participant-pdfs/${pdfId}/text`;
  const [saved, setSaved] = useState<PDFTextView | null>(null),
    [passages, setPassages] = useState<PDFPassage[]>([]),
    [page, setPage] = useState(1),
    [view, setView] = useState<number | null>(null),
    [includeInReports, setIncludeInReports] = useState(false),
    [attested, setAttested] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const textArea = useRef<HTMLTextAreaElement>(null);
  function adopt(r: PDFTextView) {
    setSaved(r);
    setPassages(r.text?.history.at(-1)?.passages || []);
    setAttested(false);
    setIncludeInReports(r.text?.history.at(-1)?.includeInReports || false);
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
  const extracted = saved?.text,
    content = extracted?.pages[page - 1] || "";
  return (
    <section
      className="panel pdf-text"
      aria-label="PDF text and verified passages"
    >
      <h4>PDF text and verified passages</h4>
      <p className="muted">
        Extraction can miss text or change reading order. Compare each selected
        passage with its PDF page before verifying. Only explicitly included
        verified passages appear in new analysis and report appendices,
        including shared reports and exports. Raw extraction and history stay
        internal. PDF excerpts reach AI only when a researcher explicitly
        requests PDF synthesis. Scanned pages support explicitly authorized AI
        OCR, followed by researcher verification.
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!extracted && (
        <button
          type="button"
          className="button"
          disabled={busy || !saved}
          onClick={() =>
            act(async () => {
              adopt(await api(path, "POST", {}));
              setMessage(
                "PDF text extracted. Review the pages before verifying passages.",
              );
            })
          }
        >
          Extract PDF text
        </button>
      )}
      {extracted && (
        <fieldset disabled={busy}>
          <label>
            Extracted page
            <select
              aria-label="Extracted page"
              value={page}
              onChange={(e) => setPage(Number(e.target.value))}
            >
              {extracted.pages.map((_, n) => (
                <option key={n} value={n + 1}>
                  Page {n + 1}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button"
            type="button"
            onClick={() => setView(page)}
          >
            Compare PDF page {page}
          </button>
          {view !== null && (
            <PrivatePDF
              key={view}
              assetId={pdfId}
              studyId={studyId}
              initialPage={view}
              autoOpen
            />
          )}
          {content ? (
            <>
              <label>
                Extracted text · page {page}
                <textarea
                  ref={textArea}
                  aria-label="Extracted PDF text"
                  rows={8}
                  readOnly
                  value={content}
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
                    quote = content.slice(start, end);
                  if (!quote.trim() || quote.length > 1000) {
                    setError(
                      "Select 1–1,000 characters from the extracted text.",
                    );
                    return;
                  }
                  if (passages.length >= 10) {
                    setError("Save at most 10 passages per PDF.");
                    return;
                  }
                  if (
                    passages.some(
                      (p) =>
                        p.page === page && p.start === start && p.end === end,
                    )
                  ) {
                    setError("That passage is already selected.");
                    return;
                  }
                  setPassages([...passages, { page, start, end, quote }]);
                  setAttested(false);
                  setError("");
                }}
              >
                Add selected passage
              </button>
            </>
          ) : (
            <p>
              No extractable text on page {page}. Review the PDF visually or
              request OCR below.
            </p>
          )}
          {(!content || extracted.ocr?.some((d) => d.page === page)) && (
            <PDFOCRPanel
              key={page}
              studyId={studyId}
              pdfId={pdfId}
              page={page}
              saved={saved!}
              onCompare={() => setView(page)}
              onSaved={adopt}
            />
          )}
          <h5>Passages to verify ({passages.length}/10)</h5>
          {passages.map((p, n) => (
            <article key={`${p.page}:${p.start}:${p.end}`}>
              <blockquote>{p.quote}</blockquote>
              <p>
                PDF page {p.page} · characters {p.start + 1}–{p.end}
              </p>
              <button
                className="button"
                type="button"
                onClick={() => {
                  setPage(p.page);
                  setView(p.page);
                }}
              >
                View cited page {p.page}
              </button>
              <button
                className="button"
                type="button"
                onClick={() => {
                  setPassages(passages.filter((_, i) => i !== n));
                  setAttested(false);
                }}
              >
                Remove passage {n + 1}
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
            Include this verified passage selection in new analysis and report
            appendices, including shared reports and exports.
          </label>
          <p className="muted">
            Saving an included selection or withdrawing its inclusion removes
            existing analysis, report editions and share links. Create a new
            analysis and report after saving.
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
            />
            I checked these passages against the cited PDF pages and approve
            this selection, including any removals.
          </label>
          <button
            className="button primary"
            type="button"
            disabled={!attested}
            onClick={() =>
              act(async () => {
                adopt(
                  await api(path, "PUT", {
                    source: saved!.source,
                    digest: extracted.digest,
                    version: extracted.history.at(-1)?.version || 0,
                    attested: true,
                    includeInReports,
                    passages,
                  }),
                );
                setMessage("PDF passages verified and saved.");
              })
            }
          >
            Save verified passages
          </button>
          <p>
            {extracted.history.length
              ? `Saved verification · revision ${extracted.history.at(-1)!.version}`
              : "No researcher verification saved"}
          </p>
          <details>
            <summary>
              PDF verification history ({extracted.history.length})
            </summary>
            {[...extracted.history].reverse().map((h) => (
              <article key={h.version}>
                <p>
                  {h.includeInReports ? "Included in reports" : "Internal only"}{" "}
                  · Revision {h.version} · {h.reviewer.name} ·{" "}
                  {new Date(h.at).toLocaleString()}
                </p>
                {h.ocrPage && (
                  <p>
                    {h.ocrCorrectionVersion
                      ? `OCR correction ${h.ocrCorrectionVersion} saved`
                      : "Verified OCR added"}{" "}
                    for PDF page {h.ocrPage}; passage inclusion reset.
                  </p>
                )}
                {h.passages.map((p, n) => (
                  <p key={n}>
                    PDF page {p.page}: {p.quote}
                  </p>
                ))}
                {!h.passages.length && <p>All passages removed.</p>}
              </article>
            ))}
          </details>
        </fieldset>
      )}
      <button
        className="button"
        type="button"
        disabled={busy}
        onClick={() => {
          if (
            !confirm(
              "Reload saved PDF verification and discard unsaved passage selections?",
            )
          )
            return;
          void act(async () => {
            adopt(await api(path));
          });
        }}
      >
        Reload saved verification
      </button>
    </section>
  );
}
