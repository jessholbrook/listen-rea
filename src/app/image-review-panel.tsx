"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { ImageReviewFields, ImageReviewResult } from "@/lib/image-review";
export default function ImageReviewPanel({
  studyId,
  imageId,
}: {
  studyId: string;
  imageId: string;
}) {
  const [saved, setSaved] = useState<ImageReviewResult | null>(null);
  const [fields, setFields] = useState<ImageReviewFields>({
    quality: "uncertain",
    grounding: "uncertain",
    notes: "",
    correction: "",
    includeInReports: false,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const path = `studies/${studyId}/participant-images/${imageId}/review`;
  const adopt = (r: ImageReviewResult) => {
    setSaved(r);
    const latest = r.history.at(-1);
    setFields(
      latest
        ? {
            quality: latest.quality,
            grounding: latest.grounding,
            notes: latest.notes,
            correction: latest.correction,
            includeInReports: Boolean(latest.includeInReports),
          }
        : {
            quality: "uncertain",
            grounding: r.asked ? "uncertain" : "not_applicable",
            notes: "",
            correction: "",
          },
    );
  };
  useEffect(() => {
    let active = true;
    setSaved(null);
    setError("");
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
  return (
    <section className="panel" aria-label="Researcher image review">
      <h4>Researcher image review</h4>
      <p className="muted">
        Reviews stay internal unless you explicitly include their notes in
        analysis and reports. Corrections are review notes; the original
        question and participant answer stay in the transcript. Flags do not
        exclude a participant or verify authenticity.
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {saved && (
        <>
          <p>
            {saved.version
              ? `Saved review · revision ${saved.version}`
              : "Not reviewed"}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              setMessage("");
              try {
                adopt(
                  await api(path, "PUT", {
                    ...fields,
                    version: saved.version,
                    source: saved.source,
                  }),
                );
                setMessage("Image review saved.");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Image quality
                <select
                  aria-label="Image quality"
                  value={fields.quality}
                  onChange={(e) =>
                    setFields({
                      ...fields,
                      quality: e.target.value as ImageReviewFields["quality"],
                    })
                  }
                >
                  <option value="usable">Usable</option>
                  <option value="unclear">Unclear or unreadable</option>
                  <option value="irrelevant">Irrelevant to the answer</option>
                  <option value="privacy_concern">Privacy concern</option>
                  <option value="uncertain">Uncertain</option>
                </select>
              </label>
              {saved.asked && (
                <label>
                  AI question grounding
                  <select
                    aria-label="AI question grounding"
                    value={fields.grounding}
                    onChange={(e) =>
                      setFields({
                        ...fields,
                        grounding: e.target
                          .value as ImageReviewFields["grounding"],
                      })
                    }
                  >
                    <option value="supported">Supported by the image</option>
                    <option value="unsupported">
                      Unsupported by the image
                    </option>
                    <option value="uncertain">Uncertain</option>
                  </select>
                </label>
              )}
              {!saved.asked && <p>No generated image question to assess.</p>}
              <label>
                Review notes
                <textarea
                  aria-label="Review notes"
                  maxLength={2000}
                  value={fields.notes}
                  onChange={(e) =>
                    setFields({ ...fields, notes: e.target.value })
                  }
                />
              </label>
              {saved.asked && (
                <label>
                  Suggested question correction
                  <textarea
                    aria-label="Suggested question correction"
                    maxLength={1000}
                    value={fields.correction}
                    onChange={(e) =>
                      setFields({ ...fields, correction: e.target.value })
                    }
                  />
                </label>
              )}
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={Boolean(fields.includeInReports)}
                  onChange={(e) =>
                    setFields({ ...fields, includeInReports: e.target.checked })
                  }
                />
                Include these researcher notes in analysis and reports
              </label>
              <p className="muted">
                Requires a usable image and notes. Included notes and reviewer
                attribution appear in shared reports and exports. Private
                correction history stays internal. Changing an included review
                clears saved analyses, report editions and share links; create a
                new analysis afterward.
              </p>
              <button className="button primary" type="submit">
                {busy ? "Saving review…" : "Save image review"}
              </button>
            </fieldset>
          </form>
          <details>
            <summary>Correction history ({saved.history.length})</summary>
            {[...saved.history].reverse().map((r) => (
              <article key={r.version} className="panel">
                <p>
                  Revision {r.version} · {r.reviewer.name} ·{" "}
                  {new Date(r.at).toLocaleString()}
                </p>
                <p>
                  Image quality: {r.quality.replaceAll("_", " ")} · Question
                  grounding: {r.grounding.replaceAll("_", " ")}
                </p>
                <p>
                  {r.includeInReports
                    ? "Included in analysis and reports"
                    : "Internal review only"}
                </p>
                {r.notes && <p>Notes: {r.notes}</p>}
                {r.correction && <p>Suggested correction: {r.correction}</p>}
              </article>
            ))}
          </details>
        </>
      )}
      <button
        className="button"
        type="button"
        disabled={busy}
        onClick={async () => {
          if (
            saved &&
            !confirm("Reload the saved review and discard unsaved edits?")
          )
            return;
          setBusy(true);
          setError("");
          setMessage("");
          try {
            adopt(await api(path));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Reload saved review
      </button>
    </section>
  );
}
