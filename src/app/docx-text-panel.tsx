"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { DOCXPassage, DOCXTextView } from "@/lib/docx-text";

export default function DOCXTextPanel({
  studyId,
  docxId,
}: {
  studyId: string;
  docxId: string;
}) {
  const path = `studies/${studyId}/participant-docx/${docxId}/text`;
  const [saved, setSaved] = useState<DOCXTextView | null>(null),
    [passages, setPassages] = useState<DOCXPassage[]>([]),
    [paragraph, setParagraph] = useState(1),
    [cited, setCited] = useState<DOCXPassage | null>(null),
    [attested, setAttested] = useState(false),
    [includeInReports, setIncludeInReports] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const textArea = useRef<HTMLTextAreaElement>(null);
  function adopt(r: DOCXTextView) {
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
    if (cited && cited.paragraph === paragraph) {
      textArea.current?.focus();
      textArea.current?.setSelectionRange(cited.start, cited.end);
    }
  }, [paragraph, cited]);
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
  function view(p: DOCXPassage) {
    setParagraph(p.paragraph);
    setCited({ ...p });
  }
  function citation(p: DOCXPassage) {
    return `DOCX paragraph ${p.paragraph} · characters ${p.start + 1}–${p.end}`;
  }
  return (
    <section
      className="panel pdf-text"
      aria-label="DOCX text and verified passages"
    >
      <h4>DOCX text and verified passages</h4>
      <p className="muted">
        Select exact text from the prepared snapshot and check each passage in
        its paragraph before verifying. Paragraph numbers refer to this prepared
        text, not Word pages. Verification records your review, not whether a
        document claim is true. Only explicitly included selections and reviewer
        attribution appear in new analysis and report appendices, including
        shared reports and exports. Raw text and history stay private. This step
        sends no text to AI.
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
            setMessage("Saved DOCX verification reloaded.");
          })
        }
      >
        Reload DOCX verification
      </button>
      {saved && (
        <fieldset disabled={busy}>
          <label>
            Prepared paragraph
            <select
              aria-label="Prepared DOCX paragraph"
              value={paragraph}
              onChange={(e) => {
                setParagraph(Number(e.target.value));
                setCited(null);
              }}
            >
              {saved.paragraphs.map((_, n) => (
                <option key={n} value={n + 1}>
                  Paragraph {n + 1}
                </option>
              ))}
            </select>
          </label>
          <label>
            Prepared text · paragraph {paragraph}
            <textarea
              ref={textArea}
              aria-label="Prepared DOCX paragraph text"
              rows={7}
              readOnly
              value={saved.paragraphs[paragraph - 1] || ""}
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
                quote = saved.paragraphs[paragraph - 1].slice(start, end);
              if (!quote.trim() || quote.length > 1000) {
                setError(
                  "Select 1–1,000 characters from the prepared paragraph.",
                );
                return;
              }
              if (passages.length >= 10) {
                setError("Save at most 10 passages per DOCX.");
                return;
              }
              if (
                passages.some(
                  (p) =>
                    p.paragraph === paragraph &&
                    p.start === start &&
                    p.end === end,
                )
              ) {
                setError("That passage is already selected.");
                return;
              }
              setPassages([...passages, { paragraph, start, end, quote }]);
              setAttested(false);
              setError("");
              setMessage("");
            }}
          >
            Add selected DOCX passage
          </button>
          <h5>DOCX passages to verify ({passages.length}/10)</h5>
          {passages.map((p, n) => (
            <article key={`${p.paragraph}:${p.start}:${p.end}`}>
              <blockquote>{p.quote}</blockquote>
              <p>{citation(p)}</p>
              <button className="button" type="button" onClick={() => view(p)}>
                View cited paragraph {p.paragraph}
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
                Remove DOCX passage {n + 1}
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
            Include this verified DOCX selection in new analysis and report
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
            I checked these passages against the cited prepared DOCX paragraphs
            and approve this selection, including any removals.
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
                    ? "DOCX passages verified and included. Create a new analysis and report."
                    : "DOCX passages verified and saved privately.",
                );
              })
            }
          >
            Save verified DOCX passages
          </button>
          <p>
            {saved.verification?.history.length
              ? `Saved DOCX verification · revision ${saved.verification.history.at(-1)!.version}`
              : "No DOCX passage verification saved"}
          </p>
          <details>
            <summary>
              DOCX verification history (
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
                      View cited paragraph {p.paragraph}
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
