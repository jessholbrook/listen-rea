"use client";
import { useEffect, useState, useRef } from "react";
import { api } from "@/lib/client";
import type { PPTXReviewResult } from "@/lib/participant-pptx";
type Saved = PPTXReviewResult;
export default function PPTXReviewPanel({
  studyId,
  pptxId,
}: {
  studyId: string;
  pptxId: string;
}) {
  const [saved, setSaved] = useState<Saved | null>(null),
    [quality, setQuality] = useState("uncertain"),
    [included, setIncluded] = useState(false),
    [notes, setNotes] = useState(""),
    [grounding, setGrounding] = useState("uncertain"),
    [correction, setCorrection] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const path = `studies/${studyId}/participant-pptx/${pptxId}/review`;
  const active = useRef(false);
  function adopt(r: Saved) {
    setSaved(r);
    setQuality(r.history.at(-1)?.quality || "uncertain");
    setNotes(r.history.at(-1)?.notes || "");
    const latest = r.history.at(-1);
    const current = latest?.probeSource === r.probeSource;
    setGrounding(
      current && latest?.grounding
        ? latest.grounding
        : r.asked
          ? "uncertain"
          : "not_applicable",
    );
    setCorrection(current ? latest?.correction || "" : "");
    setIncluded(current && latest?.includeInReports === true);
  }
  useEffect(() => {
    active.current = true;
    api(path)
      .then((r) => {
        if (active.current) adopt(r);
      })
      .catch((e) => {
        if (active.current) setError(e.message);
      });
    return () => {
      active.current = false;
    };
  }, [path]);
  return (
    <section
      style={{ overflowWrap: "anywhere" }}
      className="panel pptx-review"
      aria-label="Researcher PPTX review"
    >
      <h4>Researcher PPTX review</h4>
      <p className="muted">
        Reviews stay internal unless you explicitly include the latest notes and
        corrections in report appendices. They remain separate from automated
        analysis and do not rewrite the participant’s interview.
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {saved && (
        <>
          <p>
            {saved.version
              ? `Saved PPTX review · revision ${saved.version}`
              : "PPTX not reviewed"}
          </p>
          {saved.asked && saved.probe ? (
            <section aria-label="Original PPTX follow-up">
              <h5>Original PPTX follow-up</h5>
              <p>{saved.probe.probe}</p>
              <p>
                Prepared slide {saved.probe.slide}: <q>{saved.probe.quote}</q>
              </p>
              <p className="muted">
                Review this question against the prepared PPTX text above. A
                matching citation alone does not establish that its
                interpretation is supported.
              </p>
            </section>
          ) : (
            <p>
              No PPTX follow-up was asked. Grounding review is not applicable.
            </p>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              setMessage("");
              try {
                const result = await api(path, "PUT", {
                  source: saved.source,
                  version: saved.version,
                  quality,
                  notes,
                  probeSource: saved.probeSource,
                  grounding,
                  correction,
                  includeInReports: included,
                });
                if (active.current) {
                  adopt(result);
                  setMessage("PPTX review saved.");
                }
              } catch (e) {
                if (active.current) setError((e as Error).message);
              } finally {
                if (active.current) setBusy(false);
              }
            }}
          >
            <fieldset disabled={busy}>
              <label>
                PPTX quality
                <select
                  aria-label="PPTX quality"
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                >
                  <option value="usable">Usable</option>
                  <option value="unclear">Unclear or unreadable</option>
                  <option value="irrelevant">Irrelevant to the answer</option>
                  <option value="privacy_concern">Privacy concern</option>
                  <option value="uncertain">Uncertain</option>
                </select>
              </label>
              <label>
                PPTX review notes
                <textarea
                  aria-label="PPTX review notes"
                  value={notes}
                  maxLength={2000}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              {saved.asked && (
                <>
                  <label>
                    PPTX question grounding
                    <select
                      aria-label="PPTX question grounding"
                      value={grounding}
                      onChange={(e) => setGrounding(e.target.value)}
                    >
                      <option value="uncertain">Uncertain</option>
                      <option value="supported">Supported by the PPTX</option>
                      <option value="unsupported">
                        Unsupported by the PPTX
                      </option>
                    </select>
                  </label>
                  <label>
                    Researcher correction
                    <textarea
                      aria-label="Researcher correction"
                      value={correction}
                      maxLength={1000}
                      onChange={(e) => setCorrection(e.target.value)}
                    />
                  </label>
                  <p className="muted">
                    Explain any misleading interpretation or suggest better
                    wording. This is your annotation, not a participant quote.
                  </p>
                </>
              )}
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  aria-label="Include PPTX notes and corrections in analysis and report appendices"
                  checked={included}
                  onChange={(e) => setIncluded(e.target.checked)}
                />
                Include PPTX notes and corrections in analysis and report
                appendices
              </label>
              <p className="muted">
                Requires a usable PPTX and a note or correction. Only the latest
                included revision is shared, with attribution and original
                question context. Saving inclusion, editing included annotations
                or withdrawing them clears saved analyses, reports and share
                links. Private files stay private; downloaded copies cannot be
                recalled.
              </p>
              <button
                className="button primary"
                style={{ whiteSpace: "normal", maxWidth: "100%" }}
                type="submit"
              >
                Save PPTX review
              </button>
            </fieldset>
          </form>
          <details>
            <summary>PPTX review history ({saved.history.length})</summary>
            {[...saved.history].reverse().map((r) => (
              <article key={r.version}>
                <p>
                  Revision {r.version} · {r.reviewer.name} ·{" "}
                  {new Date(r.at).toLocaleString()} ·{" "}
                  {r.quality.replaceAll("_", " ")}
                </p>
                <p>
                  {r.includeInReports
                    ? "Included in report appendices"
                    : "Internal only"}
                </p>
                <p>{r.notes}</p>
                <p>
                  Grounding:{" "}
                  {r.grounding?.replaceAll("_", " ") ||
                    "Not assessed in this revision"}
                </p>
                {r.correction && <p>Researcher correction: {r.correction}</p>}
                {r.originalProbe && (
                  <blockquote>
                    <p>{r.originalProbe.probe}</p>
                    <p>
                      Slide {r.originalProbe.slide}:{" "}
                      <q>{r.originalProbe.quote}</q>
                    </p>
                  </blockquote>
                )}
              </article>
            ))}
          </details>
        </>
      )}
      <button
        className="button"
        style={{ whiteSpace: "normal", maxWidth: "100%" }}
        type="button"
        disabled={busy}
        onClick={async () => {
          if (
            saved &&
            !confirm("Reload the saved PPTX review and discard unsaved edits?")
          )
            return;
          setError("");
          setMessage("");
          setBusy(true);
          try {
            const result = await api(path);
            if (active.current) adopt(result);
          } catch (e) {
            if (active.current) setError((e as Error).message);
          } finally {
            if (active.current) setBusy(false);
          }
        }}
      >
        Reload saved PPTX review
      </button>
    </section>
  );
}
