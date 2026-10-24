"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import {
  pdfOCRPermissionText,
  pdfOCRPermissionVersion,
  verifiedOCRRevision,
} from "@/lib/pdf-ocr";
import type { PDFTextView } from "@/lib/pdf-text";
export default function PDFOCRPanel({
  studyId,
  pdfId,
  page,
  saved,
  onSaved,
  onCompare,
}: {
  studyId: string;
  pdfId: string;
  page: number;
  saved: PDFTextView;
  onSaved: (r: PDFTextView) => void;
  onCompare: () => void;
}) {
  const draft = saved.text?.ocr?.find((d) => d.page === page);
  const latest = verifiedOCRRevision(draft),
    correctionVersion = draft?.corrections?.at(-1)?.version || 0;
  const [editing, setEditing] = useState(false),
    [reason, setReason] = useState("");
  const [permission, setPermission] = useState(false),
    [attested, setAttested] = useState(false),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setText(latest?.text || draft?.draft || "");
    setEditing(false);
    setReason("");
    setPermission(false);
    setAttested(false);
    setError("");
  }, [page, draft?.id, Boolean(draft?.accepted), correctionVersion]);
  async function act(method: string, data: object) {
    setBusy(true);
    setError("");
    try {
      onSaved(
        await api(`studies/${studyId}/participant-pdfs/${pdfId}/ocr`, method, {
          source: saved.source,
          digest: saved.text!.digest,
          page,
          ...data,
        }),
      );
      setPermission(false);
      setAttested(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel attachment-synthesis"
      aria-label={`OCR for PDF page ${page}`}
    >
      <h5>OCR · PDF page {page}</h5>
      <p>
        Transcribe one scanned page using OpenAI. AI can omit or invent text.
        Each page supports one draft, up to 12,000 characters. Other pages and
        interview answers are not sent.
      </p>
      {error && <p role="alert">{error}</p>}
      {draft?.accepted ? (
        <>
          <p role="status">
            OCR verified by {latest!.reviewer.name} · {latest!.at}.{" "}
            {correctionVersion
              ? `Correction revision ${correctionVersion}.`
              : "Initial verification."}{" "}
            Select and verify passages separately to include them in reports.
          </p>
          {!editing ? (
            <button
              className="button"
              type="button"
              onClick={() => {
                setText(latest!.text);
                setAttested(false);
                setReason("");
                setEditing(true);
              }}
            >
              Correct verified OCR text
            </button>
          ) : (
            <fieldset disabled={busy}>
              <p>
                This manual correction stays within Echo Lab. It makes no AI
                request. Saving removes this page’s selected passages, resets
                PDF passage inclusion and removes existing analyses (including
                saved PDF answers), report editions and share links. Other page
                selections remain available for a new verification.
              </p>
              <button className="button" type="button" onClick={onCompare}>
                Compare OCR correction with PDF page {page}
              </button>
              <label>
                Verified OCR correction
                <textarea
                  aria-label="Verified OCR correction"
                  rows={8}
                  maxLength={12000}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setAttested(false);
                  }}
                />
              </label>
              <label>
                Reason for OCR correction
                <textarea
                  aria-label="Reason for OCR correction"
                  minLength={3}
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setAttested(false);
                  }}
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={attested}
                  onChange={(e) => setAttested(e.target.checked)}
                />
                I compared this corrected text with PDF page {page} and approve
                replacing the verified transcription.
              </label>
              <button
                className="button primary"
                type="button"
                disabled={
                  !attested ||
                  !text.trim() ||
                  text.trim() === latest!.text ||
                  reason.trim().length < 3
                }
                onClick={() =>
                  act("PUT", {
                    draftId: draft.id,
                    text,
                    reason,
                    correctionVersion,
                    attested: true,
                    version: saved.text!.history.at(-1)?.version || 0,
                  })
                }
              >
                Save verified OCR correction
              </button>
              <button
                className="button"
                type="button"
                onClick={() => {
                  setEditing(false);
                  setText(latest!.text);
                  setAttested(false);
                  setReason("");
                }}
              >
                Cancel OCR correction
              </button>
            </fieldset>
          )}
          <details>
            <summary>
              Verified OCR text history ({1 + (draft.corrections?.length || 0)})
            </summary>
            {[...(draft.corrections || [])].reverse().map((r) => (
              <article key={r.version}>
                <p>
                  Correction {r.version} · {r.reviewer.name} · {r.at}
                </p>
                <p>{r.reason}</p>
                <pre style={{ whiteSpace: "pre-wrap" }}>{r.text}</pre>
              </article>
            ))}
            <p>
              Initial verification · {draft.accepted.reviewer.name} ·{" "}
              {draft.accepted.at}
            </p>
            <pre style={{ whiteSpace: "pre-wrap" }}>{draft.accepted.text}</pre>
          </details>
        </>
      ) : (
        <fieldset disabled={busy}>
          {!draft ? (
            <>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={permission}
                  onChange={(e) => setPermission(e.target.checked)}
                />
                {pdfOCRPermissionText}
              </label>
              <button
                className="button"
                type="button"
                disabled={!permission}
                onClick={() =>
                  act("POST", {
                    permission: true,
                    permissionVersion: pdfOCRPermissionVersion,
                  })
                }
              >
                {busy ? "Transcribing page…" : "Transcribe this page with AI"}
              </button>
            </>
          ) : (
            <>
              <p>
                Private AI draft · {draft.model} · {draft.generatedAt}. This
                draft cannot be used as passage evidence until verified.
              </p>
              <button className="button" type="button" onClick={onCompare}>
                Compare OCR with PDF page {page}
              </button>
              <label>
                Corrected OCR text
                <textarea
                  aria-label="Corrected OCR text"
                  rows={8}
                  maxLength={12000}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setAttested(false);
                  }}
                />
              </label>
              <p>
                Saving verified OCR updates this PDF’s text, removes existing
                analysis, report editions and share links, and resets passage
                inclusion. Previous verification history stays private. Verify
                and explicitly include passages again before creating a new
                analysis.
              </p>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={attested}
                  onChange={(e) => setAttested(e.target.checked)}
                />
                I compared this transcription with PDF page {page}, corrected
                errors and approve using this text for passage selection.
              </label>
              <button
                className="button primary"
                type="button"
                disabled={!attested || !text.trim()}
                onClick={() =>
                  act("PUT", {
                    draftId: draft.id,
                    text,
                    attested: true,
                    version: saved.text!.history.at(-1)?.version || 0,
                  })
                }
              >
                Save verified OCR text
              </button>
            </>
          )}
        </fieldset>
      )}
      {draft && (
        <details>
          <summary>Original OCR draft and permission</summary>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {draft.draft || "No legible text returned."}
          </pre>
          <p>
            {draft.permission.actor.name} · {draft.permission.grantedAt} ·{" "}
            {draft.permission.text}
          </p>
        </details>
      )}
    </section>
  );
}
