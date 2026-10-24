"use client";
import PPTXEvidencePanel from "./pptx-evidence-panel";

import DOCXObservationsPanel from "./docx-observations-panel";
import PPTXObservationsPanel from "./pptx-observations-panel";
import { DOCXAnswersView } from "./docx-answers-panel";
import { PPTXAnswersView } from "./pptx-answers-panel";
import { DOCXSynthesisView } from "./docx-synthesis-panel";
import { PPTXSynthesisView } from "./pptx-synthesis-panel";
import DOCXEvidencePanel from "./docx-evidence-panel";
import { PDFAnswersView } from "./pdf-answers-panel";
import { DOCXObservationAnswersView } from "./docx-observation-answers-panel";
import { PPTXObservationAnswersView } from "./pptx-observation-answers-panel";
import { PDFObservationAnswersView } from "./pdf-observation-answers-panel";
import { DOCXObservationSynthesisView } from "./docx-observation-synthesis-panel";
import { PPTXObservationSynthesisView } from "./pptx-observation-synthesis-panel";
import { PDFObservationSynthesisView } from "./pdf-observation-synthesis-panel";
import PDFObservationsPanel from "./pdf-observations-panel";

import { PDFSynthesisView } from "./pdf-synthesis-panel";
import PDFEvidencePanel from "./pdf-evidence-panel";
import { SynthesisView } from "./attachment-synthesis-panel";
import AttachmentEvidencePanel from "./attachment-evidence-panel";
import { useEffect, useState, useRef } from "react";
import { api } from "@/lib/client";
import type { Study, Actor, Citation } from "@/lib/domain";
import {
  defaultStyle,
  editionText,
  type ReportingData,
  type ReportEdition,
  type ReportSnapshot,
  type ReportTemplate,
  type MediaClip,
  type MediaReel,
  type PresentationStyle,
} from "@/lib/reporting";
import { Modal, Notice, Spinner } from "./components";

type Act = (fn: () => Promise<void>, message?: string) => Promise<void>;
export default function ReportingPanel({
  study,
  user,
}: {
  study: Study;
  user: Actor;
}) {
  const [data, setData] = useState<ReportingData | null>(null),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("reports"),
    [editionId, setEditionId] = useState(""),
    [clipId, setClipId] = useState(""),
    [reelId, setReelId] = useState(""),
    [templateId, setTemplateId] = useState(""),
    [link, setLink] = useState(""),
    [history, setHistory] = useState<ReportSnapshot[] | null>(null),
    [title, setTitle] = useState(study.title),
    [analysisId, setAnalysisId] = useState(""),
    [styleId, setStyleId] = useState("");
  const base = `studies/${study.id}/reporting`;
  async function reload() {
    const d = await api<ReportingData>(base);
    setData(d);
    return d;
  }
  useEffect(() => {
    let active = true;
    api<ReportingData>(base)
      .then((d) => {
        if (active) {
          setData(d);
          setEditionId(d.editions[0]?.id || "");
          setAnalysisId(d.analyses.find((a) => !a.stale)?.id || "");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [base]);
  async function act(fn: () => Promise<void>, message = "Saved.") {
    setBusy(true);
    setError("");
    setStatus("");
    setLink("");
    try {
      await fn();
      await reload();
      setStatus(message);
    } catch (e) {
      setError((e as Error).message);
      try {
        await reload();
      } catch {}
    } finally {
      setBusy(false);
    }
  }
  async function share(path: string) {
    await act(async () => {
      const r = await api(base + path, "POST");
      setLink(location.origin + "/share/" + r.token);
    }, "View-only link created. It expires in seven days.");
  }
  const edition = data?.editions.find((e) => e.id === editionId),
    clip = data?.clips.find((c) => c.id === clipId),
    reel = data?.reels.find((r) => r.id === reelId),
    template = data?.templates.find((t) => t.id === templateId);
  return (
    <div className="reporting-stack">
      <section className="panel">
        <div className="eyebrow">BRING THE EVIDENCE WITH YOU</div>
        <h2>Reports & media</h2>
        <p className="muted">
          Create report editions, export editable slides and build reviewed
          highlight reels. The original analysis memo stays intact.
        </p>
        <div className="filter-tabs">
          {[
            ["reports", "Report editions"],
            ["media", "Clips & reels"],
            ["styles", "Presentation styles"],
          ].map(([id, name]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {name}
            </button>
          ))}
        </div>
        {error && <Notice>{error}</Notice>}
        {status && <p role="status">{status}</p>}
        {busy && (
          <p role="status">
            <Spinner /> Working…
          </p>
        )}
        {link && (
          <label>
            View-only share link
            <input
              readOnly
              value={link}
              onClick={(e) => e.currentTarget.select()}
            />
          </label>
        )}
        <div className="inline">
          <button
            className="button"
            disabled={busy}
            onClick={() => void act(async () => {}, "Refreshed.")}
          >
            Refresh reports & jobs
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              if (
                confirm(
                  "Revoke all share links for this study, including the original memo?",
                )
              )
                void act(async () => {
                  await api(base + "/shares", "DELETE");
                  setLink("");
                }, "All study share links revoked.");
            }}
          >
            Revoke all study share links
          </button>
        </div>
      </section>
      {!data ? (
        <Spinner />
      ) : (
        <>
          {tab === "reports" && (
            <>
              <section className="panel">
                <h3>Create an edition</h3>
                {data.analyses.some((a) => !a.stale) ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(async () => {
                        const r = await api(base + "/editions", "POST", {
                          analysisId,
                          title,
                          templateId: styleId || undefined,
                        });
                        setEditionId(r.edition.id);
                      }, "Edition created; original memo retained.");
                    }}
                  >
                    <label>
                      Edition title
                      <input
                        required
                        minLength={3}
                        maxLength={160}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                      />
                    </label>
                    <label>
                      Source analysis
                      <select
                        aria-label="Source analysis"
                        value={analysisId}
                        onChange={(e) => setAnalysisId(e.target.value)}
                      >
                        {data.analyses
                          .filter((a) => !a.stale)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.label}
                            </option>
                          ))}
                      </select>
                    </label>
                    <StyleSelect
                      templates={data.templates}
                      value={styleId}
                      change={setStyleId}
                    />
                    <button
                      className="button primary"
                      disabled={busy || !analysisId}
                    >
                      Create report edition
                    </button>
                  </form>
                ) : (
                  <p>
                    Create or refresh an evidence memo in Analysis & report
                    before making an edition.
                  </p>
                )}
              </section>
              {data.editions.length > 0 && (
                <section className="panel">
                  <label>
                    Report edition
                    <select
                      aria-label="Report edition"
                      value={editionId}
                      onChange={(e) => setEditionId(e.target.value)}
                    >
                      <option value="">Choose an edition</option>
                      {data.editions.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.title} · v{e.version}
                          {e.dataVersion !== data.dataVersion
                            ? " · response set changed"
                            : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>
              )}
              {edition && (
                <EditionEditor
                  key={edition.id + ":" + edition.version}
                  edition={edition}
                  data={data}
                  base={base}
                  busy={busy}
                  act={act}
                  share={() => share(`/editions/${edition.id}/share`)}
                  history={async () => {
                    try {
                      setHistory(
                        (await api(base + `/editions/${edition.id}/history`))
                          .history,
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                />
              )}
            </>
          )}
          {tab === "media" && (
            <>
              <section className="panel">
                <h3>Clips</h3>
                <p className="muted">
                  Select an exact evidence quote and review the media range
                  yourself. A quote in the answer does not establish its spoken
                  timestamp.
                </p>
                <label>
                  Saved clip
                  <select
                    aria-label="Saved clip"
                    value={clipId}
                    onChange={(e) => setClipId(e.target.value)}
                  >
                    <option value="">New clip</option>
                    {data.clips.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.reviewed ? "reviewed" : "needs review"}
                      </option>
                    ))}
                  </select>
                </label>
                <ClipEditor
                  key={(clip?.id || "new") + ":" + (clip?.version || 0)}
                  clip={clip}
                  data={data}
                  base={base}
                  busy={busy}
                  act={act}
                  saved={setClipId}
                />
              </section>
              <section className="panel">
                <h3>Reels</h3>
                <p className="muted">
                  Choose up to six clips, totaling at most 60 seconds. The
                  rendered MP4 includes reviewed captions. Short voice
                  recordings use a caption card.
                </p>
                <label>
                  Saved reel
                  <select
                    aria-label="Saved reel"
                    value={reelId}
                    onChange={(e) => setReelId(e.target.value)}
                  >
                    <option value="">New reel</option>
                    {data.reels.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} · v{r.version}
                      </option>
                    ))}
                  </select>
                </label>
                <ReelEditor
                  key={(reel?.id || "new") + ":" + (reel?.version || 0)}
                  reel={reel}
                  data={data}
                  base={base}
                  busy={busy}
                  act={act}
                  saved={setReelId}
                />
              </section>
              <section className="panel">
                <h3>Render jobs</h3>
                <p className="muted">
                  Start a queued job or retry a failed one. You can return here
                  to check an interrupted render. Downloads remain private until
                  you create a share link.
                </p>
                {data.jobs.length ? (
                  data.jobs.map((j) => (
                    <article className="report-job" key={j.id}>
                      <strong>{j.name}</strong>
                      <p>
                        {j.state === "running" &&
                        (j.leaseUntil || 0) < Date.now()
                          ? "Interrupted · retry available"
                          : j.state}{" "}
                        · Attempts {j.attempts}
                        {j.durationMs
                          ? ` · ${(j.durationMs / 1000).toFixed(1)} seconds`
                          : ""}
                      </p>
                      {j.error && <Notice>{j.error}</Notice>}
                      {j.dataVersion !== data.dataVersion ? (
                        <p>
                          Response set changed. Review the clips and create a
                          new job.
                        </p>
                      ) : (
                        <div className="inline">
                          {j.state !== "complete" ? (
                            <button
                              className="button"
                              disabled={
                                busy ||
                                (j.state === "running" &&
                                  (j.leaseUntil || 0) > Date.now())
                              }
                              onClick={() =>
                                void act(async () => {
                                  const r = await api(
                                    base + `/jobs/${j.id}/run`,
                                    "POST",
                                  );
                                  if (r.job.state !== "complete")
                                    throw new Error(
                                      r.job.error ||
                                        "Render did not complete. Retry the job.",
                                    );
                                }, "Render completed.")
                              }
                            >
                              {j.state === "queued"
                                ? "Render now"
                                : "Retry render"}
                            </button>
                          ) : (
                            <>
                              <video
                                controls
                                preload="none"
                                src={"/api/" + base + `/jobs/${j.id}/download`}
                              />
                              <a
                                className="button"
                                href={"/api/" + base + `/jobs/${j.id}/download`}
                                download="research-reel.mp4"
                              >
                                Download MP4
                              </a>
                              <a
                                className="button"
                                href={"/api/" + base + `/jobs/${j.id}/captions`}
                              >
                                Download captions
                              </a>
                              <button
                                className="button"
                                disabled={busy}
                                onClick={() =>
                                  void share(`/jobs/${j.id}/share`)
                                }
                              >
                                Share reviewed reel
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </article>
                  ))
                ) : (
                  <p>
                    No render jobs yet. Save a reviewed reel, then create a job.
                  </p>
                )}
              </section>
            </>
          )}
          {tab === "styles" && (
            <section className="panel">
              <h3>Workspace presentation styles</h3>
              <p className="muted">
                Reuse brand text, color, footer and font. Editions copy their
                chosen style, so later template changes do not alter saved
                editions. PowerPoint slides stay editable. Importing arbitrary
                PowerPoint layouts is later work.
              </p>
              <label>
                Saved presentation style
                <select
                  aria-label="Saved presentation style"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                >
                  <option value="">New style</option>
                  {data.templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              {user.role === "admin" ? (
                <TemplateEditor
                  key={(template?.id || "new") + ":" + (template?.version || 0)}
                  template={template}
                  base={base}
                  busy={busy}
                  act={act}
                  saved={setTemplateId}
                />
              ) : (
                <p>An admin can manage workspace presentation styles.</p>
              )}
            </section>
          )}
        </>
      )}
      {history && edition && (
        <Modal title="Edition history" onClose={() => setHistory(null)}>
          <p>
            Restoring creates a new edition version and clears review. The
            original memo is retained.
          </p>
          {history.map((h) => (
            <div className="report-job" key={h.id}>
              <strong>
                Version {h.edition.version} · {h.action}
              </strong>
              <p>
                {h.actorName} · {new Date(h.createdAt).toLocaleString()}
              </p>
              <details>
                <summary>Review snapshot</summary>
                <pre className="preserve">{editionText(h.edition)}</pre>
              </details>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await api(
                      base + `/editions/${edition.id}/restore`,
                      "POST",
                      { version: edition.version, snapshotId: h.id },
                    );
                    setHistory(null);
                  }, "Edition restored as a new version; review required.")
                }
              >
                Restore this version
              </button>
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
}
function StyleSelect({
  templates,
  value,
  change,
}: {
  templates: ReportTemplate[];
  value: string;
  change: (v: string) => void;
}) {
  return (
    <label>
      Presentation style
      <select
        aria-label="Presentation style"
        value={value}
        onChange={(e) => change(e.target.value)}
      >
        <option value="">Echo Lab default</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}
function StyleFields({
  style,
  update,
}: {
  style: PresentationStyle;
  update: (p: Partial<PresentationStyle>) => void;
}) {
  return (
    <div className="report-style-fields">
      <label>
        Style name
        <input
          required
          maxLength={100}
          value={style.name}
          onChange={(e) => update({ name: e.target.value })}
        />
      </label>
      <label>
        Brand name
        <input
          required
          maxLength={100}
          value={style.brand}
          onChange={(e) => update({ brand: e.target.value })}
        />
      </label>
      <label>
        Accent color
        <input
          type="color"
          value={style.accent}
          onChange={(e) => update({ accent: e.target.value })}
        />
      </label>
      <label>
        Slide footer
        <input
          maxLength={160}
          value={style.footer}
          onChange={(e) => update({ footer: e.target.value })}
        />
      </label>
      <label>
        Slide font
        <select
          aria-label="Slide font"
          value={style.font}
          onChange={(e) =>
            update({ font: e.target.value as "Arial" | "Georgia" })
          }
        >
          <option>Arial</option>
          <option>Georgia</option>
        </select>
      </label>
    </div>
  );
}
function TemplateEditor({
  template,
  base,
  busy,
  act,
  saved,
}: {
  template?: ReportTemplate;
  base: string;
  busy: boolean;
  act: Act;
  saved: (id: string) => void;
}) {
  const [style, setStyle] = useState<PresentationStyle>(
    template || { ...defaultStyle, name: "Team presentation" },
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void act(async () => {
          const r = await api(
            base + "/templates" + (template ? "/" + template.id : ""),
            template ? "PUT" : "POST",
            { ...style, version: template?.version },
          );
          if (!template) saved(r.template.id);
        }, "Presentation style saved.");
      }}
    >
      <StyleFields style={style} update={(p) => setStyle({ ...style, ...p })} />
      <div className="inline">
        <button className="button primary" disabled={busy}>
          Save presentation style
        </button>
        {template && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => {
              if (
                confirm(
                  "Remove this style? Existing editions keep their copies.",
                )
              )
                void act(async () => {
                  await api(base + "/templates/" + template.id, "DELETE");
                  saved("");
                }, "Style removed; saved editions retained.");
            }}
          >
            Delete style
          </button>
        )}
      </div>
    </form>
  );
}
function EditionEditor({
  edition,
  data,
  base,
  busy,
  act,
  share,
  history,
}: {
  edition: ReportEdition;
  data: ReportingData;
  base: string;
  busy: boolean;
  act: Act;
  share: () => Promise<void>;
  history: () => Promise<void>;
}) {
  const [e, setE] = useState(structuredClone(edition)),
    [changed, setChanged] = useState(false),
    [block, setBlock] = useState(0),
    [source, setSource] = useState(""),
    [quote, setQuote] = useState(""),
    [sourceAnswer, setSourceAnswer] = useState(""),
    [sourceError, setSourceError] = useState("");
  const stale = edition.dataVersion !== data.dataVersion;
  function change(p: Partial<ReportEdition>) {
    setE({ ...e, ...p, reviewed: false });
    setChanged(true);
  }
  function updateBlock(n: number, p: Partial<ReportEdition["blocks"][number]>) {
    change({ blocks: e.blocks.map((b, i) => (i === n ? { ...b, ...p } : b)) });
  }
  async function loadSource(value: string) {
    setSource(value);
    setSourceError("");
    setSourceAnswer("");
    setQuote("");
    if (!value) return;
    const [interview, turn] = JSON.parse(value);
    try {
      const r = await api(base + `/evidence/${interview}/${turn}`);
      setSourceAnswer(r.answer);
      setQuote(r.answer);
    } catch (error) {
      setSourceError((error as Error).message);
    }
  }
  return (
    <section className="panel edition-editor">
      <h3>Edit report edition</h3>
      <p className="small muted">
        Saved version {edition.version} · {edition.sampleSize} included
        participants · {changed ? "Unsaved changes" : "Saved"}
      </p>
      {stale && (
        <Notice>
          The response set changed. Correct any invalid citations, save edits,
          then rebase and review this edition before export.
        </Notice>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void act(async () => {
            await api(base + `/editions/${e.id}`, "PUT", e);
          }, "Edition saved as a new version.");
        }}
      >
        <label>
          Report title
          <input
            required
            minLength={3}
            maxLength={160}
            value={e.title}
            onChange={(event) => change({ title: event.target.value })}
          />
        </label>
        <SynthesisView
          synthesis={e.attachmentSynthesis}
          studyId={e.studyId}
          evidence={e.attachmentEvidence}
          language={e.language}
        />
        <DOCXSynthesisView
          synthesis={e.docxSynthesis}
          evidence={e.docxEvidence}
          studyId={e.studyId}
          language={e.language}
        />
        <PPTXSynthesisView
          synthesis={e.pptxSynthesis}
          evidence={e.pptxEvidence}
          studyId={e.studyId}
          language={e.language}
        />
        <PDFSynthesisView
          synthesis={e.pdfSynthesis}
          evidence={e.pdfEvidence}
          studyId={e.studyId}
          language={e.language}
        />
        <DOCXAnswersView
          entries={e.docxAnswers}
          studyId={e.studyId}
          language={e.language}
        />
        <PPTXAnswersView
          entries={e.pptxAnswers}
          studyId={e.studyId}
          language={e.language}
        />
        <PDFAnswersView
          entries={e.pdfAnswers}
          studyId={e.studyId}
          language={e.language}
        />
        <DOCXObservationAnswersView
          entries={e.docxObservationAnswers}
          studyId={e.studyId}
          language={e.language}
        />
        <PPTXObservationAnswersView
          entries={e.pptxObservationAnswers}
          studyId={e.studyId}
          language={e.language}
        />
        <PDFObservationAnswersView
          entries={e.pdfObservationAnswers}
          studyId={e.studyId}
          language={e.language}
        />
        <DOCXObservationSynthesisView
          synthesis={e.docxObservationSynthesis}
          evidence={e.docxObservations}
          studyId={e.studyId}
          language={e.language}
        />
        <PPTXObservationSynthesisView
          synthesis={e.pptxObservationSynthesis}
          evidence={e.pptxObservations}
          studyId={e.studyId}
          language={e.language}
        />
        <PDFObservationSynthesisView
          synthesis={e.pdfObservationSynthesis}
          evidence={e.pdfObservations}
          studyId={e.studyId}
          language={e.language}
        />
        <DOCXObservationsPanel
          entries={e.docxObservations}
          studyId={e.studyId}
          language={e.language}
        />
        <PPTXObservationsPanel
          entries={e.pptxObservations}
          studyId={e.studyId}
          language={e.language}
        />
        <PDFObservationsPanel
          entries={e.pdfObservations}
          studyId={e.studyId}
          language={e.language}
        />
        <PPTXEvidencePanel
          entries={e.pptxEvidence}
          studyId={e.studyId}
          language={e.language}
        />
        <DOCXEvidencePanel
          entries={e.docxEvidence}
          studyId={e.studyId}
          language={e.language}
        />
        <PDFEvidencePanel
          entries={e.pdfEvidence}
          studyId={e.studyId}
          language={e.language}
        />
        <AttachmentEvidencePanel
          entries={e.attachmentEvidence}
          studyId={e.studyId}
          language={e.language}
        />
        {e.blocks.map((b, n) => (
          <article className="report-block" key={b.id}>
            <div className="report-block-heading">
              <strong>Block {n + 1}</strong>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={b.hidden}
                  onChange={(event) =>
                    updateBlock(n, { hidden: event.target.checked })
                  }
                />
                Hide from export
              </label>
            </div>
            <label>
              Block heading
              <input
                required
                maxLength={160}
                value={b.title}
                onChange={(event) =>
                  updateBlock(n, { title: event.target.value })
                }
              />
            </label>
            <label>
              Block text
              <textarea
                aria-label={`Block ${n + 1} text`}
                maxLength={6000}
                rows={4}
                value={b.body}
                onChange={(event) =>
                  updateBlock(n, { body: event.target.value })
                }
              />
            </label>
            {b.citations.map((c, i) => (
              <div className="report-citation" key={c.turnId + ":" + i}>
                <blockquote>{c.quote}</blockquote>
                <small>
                  Participant {c.interviewId.slice(0, 8)} · Turn{" "}
                  {c.turnId.slice(0, 8)}
                </small>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    updateBlock(n, {
                      citations: b.citations.filter((_, at) => at !== i),
                    })
                  }
                >
                  Remove citation
                </button>
              </div>
            ))}
            <div className="inline">
              <button
                type="button"
                className="text-button"
                disabled={n === 0}
                onClick={() => {
                  const blocks = [...e.blocks];
                  [blocks[n - 1], blocks[n]] = [blocks[n], blocks[n - 1]];
                  change({ blocks });
                }}
              >
                Move block up
              </button>
              <button
                type="button"
                className="text-button"
                disabled={e.blocks.length === 1}
                onClick={() =>
                  change({ blocks: e.blocks.filter((_, i) => i !== n) })
                }
              >
                Remove block
              </button>
            </div>
          </article>
        ))}
        <button
          type="button"
          className="button"
          disabled={e.blocks.length >= 20}
          onClick={() =>
            change({
              blocks: [
                ...e.blocks,
                {
                  id: crypto.randomUUID(),
                  title: "Research note",
                  body: "",
                  hidden: false,
                  citations: [],
                },
              ],
            })
          }
        >
          Add report block
        </button>
        <details>
          <summary>Add a source citation</summary>
          <label>
            Citation block
            <select
              aria-label="Citation block"
              value={Math.min(block, e.blocks.length - 1)}
              onChange={(event) => setBlock(Number(event.target.value))}
            >
              {e.blocks.map((b, n) => (
                <option key={b.id} value={n}>
                  {b.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Evidence source
            <select
              aria-label="Evidence source"
              value={source}
              onChange={(event) => void loadSource(event.target.value)}
            >
              <option value="">Choose a participant answer</option>
              {data.evidence.map((t) => (
                <option
                  key={t.turnId}
                  value={JSON.stringify([t.interviewId, t.turnId])}
                >
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {sourceError && <Notice>{sourceError}</Notice>}
          {sourceAnswer && (
            <>
              <p className="preserve source-answer">{sourceAnswer}</p>
              <label>
                Exact evidence quote
                <textarea
                  aria-label="Exact evidence quote"
                  value={quote}
                  onChange={(event) => setQuote(event.target.value)}
                  maxLength={12000}
                />
              </label>
              <button
                type="button"
                className="button"
                disabled={!quote || !sourceAnswer.includes(quote)}
                onClick={() => {
                  const [interviewId, turnId] = JSON.parse(source);
                  const at = Math.min(block, e.blocks.length - 1);
                  updateBlock(at, {
                    citations: [
                      ...e.blocks[at].citations,
                      { interviewId, turnId, quote } as Citation,
                    ],
                  });
                  setSource("");
                  setSourceAnswer("");
                  setQuote("");
                }}
              >
                Add exact citation
              </button>
            </>
          )}
        </details>
        <details>
          <summary>Presentation style for this edition</summary>
          <StyleSelect
            templates={data.templates}
            value=""
            change={(id) =>
              change({
                style: structuredClone(
                  data.templates.find((t) => t.id === id) || defaultStyle,
                ),
              })
            }
          />
          <StyleFields
            style={e.style}
            update={(p) => change({ style: { ...e.style, ...p } })}
          />
        </details>
        <label className="checkbox-label report-review">
          <input
            type="checkbox"
            checked={e.reviewed}
            disabled={stale}
            onChange={(event) => {
              setE({ ...e, reviewed: event.target.checked });
              setChanged(true);
            }}
          />
          I reviewed this edition’s interpretation, visible blocks and source
          citations.
        </label>
        <div className="inline">
          <button className="button primary" disabled={busy || !changed}>
            Save edition
          </button>
          <button
            type="button"
            className="button"
            disabled={busy || changed}
            onClick={() => void history()}
          >
            Edition history
          </button>
          <button
            type="button"
            className="button"
            disabled={busy || changed || !e.reviewed || stale}
            onClick={() => void share()}
          >
            Share reviewed edition
          </button>
          {!changed && e.reviewed && !stale && (
            <a
              className="button"
              href={"/api/" + base + `/editions/${e.id}/deck`}
            >
              Export editable PowerPoint
            </a>
          )}
          {stale && (
            <button
              type="button"
              className="button"
              disabled={busy || changed}
              onClick={() =>
                void act(async () => {
                  await api(base + `/editions/${e.id}/rebase`, "POST", {
                    version: e.version,
                  });
                }, "Edition rebased; review required.")
              }
            >
              Rebase to current responses
            </button>
          )}
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              if (
                confirm(
                  "Delete this edition and its version history? The original memo remains.",
                )
              )
                void act(async () => {
                  await api(base + `/editions/${e.id}`, "DELETE");
                }, "Edition deleted.");
            }}
          >
            Delete edition
          </button>
        </div>
      </form>
    </section>
  );
}
function ClipEditor({
  clip,
  data,
  base,
  busy,
  act,
  saved,
}: {
  clip?: MediaClip;
  data: ReportingData;
  base: string;
  busy: boolean;
  act: Act;
  saved: (id: string) => void;
}) {
  const [c, setC] = useState({
      name: clip?.name || "",
      mediaId: clip?.mediaId || data.sources[0]?.mediaId || "",
      quote: clip?.quote || "",
      startMs: clip?.startMs || 0,
      endMs: clip?.endMs || Math.min(data.sources[0]?.durationMs || 5000, 5000),
      caption: clip?.caption || "",
      reviewed: clip?.reviewed || false,
    }),
    [answer, setAnswer] = useState(""),
    [error, setError] = useState("");
  const media = useRef<HTMLMediaElement | null>(null);
  const source = data.sources.find((s) => s.mediaId === c.mediaId);
  useEffect(() => {
    let active = true;
    setError("");
    if (source)
      api(base + `/evidence/${source.interviewId}/${source.turnId}`)
        .then((r) => {
          if (active) {
            setAnswer(r.answer);
            setC((current) => ({
              ...current,
              quote: current.quote || r.answer,
            }));
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [c.mediaId, base]);
  function change(p: Partial<typeof c>) {
    setC({ ...c, ...p, reviewed: false });
  }
  if (!data.sources.length)
    return (
      <p>
        Complete an included response with a voice or screen recording to create
        a clip.
      </p>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void act(async () => {
          const r = await api(
            base + "/clips" + (clip ? "/" + clip.id : ""),
            clip ? "PUT" : "POST",
            { ...c, version: clip?.version },
          );
          saved(r.clip.id);
        }, "Clip saved.");
      }}
    >
      <label>
        Clip name
        <input
          required
          maxLength={100}
          value={c.name}
          onChange={(e) => change({ name: e.target.value })}
        />
      </label>
      <label>
        Source recording
        <select
          aria-label="Source recording"
          value={c.mediaId}
          onChange={(e) => {
            const s = data.sources.find((s) => s.mediaId === e.target.value)!;
            change({
              mediaId: s.mediaId,
              quote: "",
              startMs: 0,
              endMs: Math.min(s.durationMs, 5000),
            });
          }}
        >
          {data.sources.map((s) => (
            <option key={s.mediaId} value={s.mediaId}>
              {s.external
                ? "Imported " + (s.kind === "screen" ? "video" : "audio")
                : s.kind}{" "}
              · {s.prompt.slice(0, 70)} · {s.interviewId.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      {source && (
        <div className="clip-preview">
          {source.kind === "screen" ? (
            <video
              ref={(node) => {
                media.current = node;
              }}
              controls
              preload="metadata"
              src={"/api/recordings/" + source.mediaId}
              onTimeUpdate={() => {
                if (
                  media.current &&
                  media.current.currentTime >= c.endMs / 1000
                )
                  media.current.pause();
              }}
            />
          ) : (
            <audio
              ref={(node) => {
                media.current = node;
              }}
              controls
              preload="metadata"
              src={"/api/recordings/" + source.mediaId}
              onTimeUpdate={() => {
                if (
                  media.current &&
                  media.current.currentTime >= c.endMs / 1000
                )
                  media.current.pause();
              }}
            />
          )}
          <p className="small muted">
            {(source.durationMs / 1000).toFixed(1)} seconds.{" "}
            {source.external
              ? "External transcript: check speaker labels and manually verify the quote’s timing against this recording."
              : source.kind === "screen"
                ? "Evidence quotes come from the written task reflection, not an automatic narration transcript."
                : "Listen to the recording and check the quote’s spoken timing manually."}
          </p>
        </div>
      )}
      <div className="report-range">
        <label>
          Start (seconds)
          <input
            required
            type="number"
            min={0}
            step={0.1}
            value={c.startMs / 1000}
            onChange={(e) =>
              change({ startMs: Math.round(Number(e.target.value) * 1000) })
            }
          />
        </label>
        <label>
          End (seconds)
          <input
            required
            type="number"
            min={0.1}
            max={(source?.durationMs || 30000) / 1000}
            step={0.1}
            value={c.endMs / 1000}
            onChange={(e) =>
              change({ endMs: Math.round(Number(e.target.value) * 1000) })
            }
          />
        </label>
        <button
          type="button"
          className="button"
          onClick={async () => {
            if (media.current) {
              try {
                media.current.currentTime = c.startMs / 1000;
                await media.current.play();
              } catch {
                setError(
                  "The selected source could not be played. Check the recording and try again.",
                );
              }
            }
          }}
        >
          Preview selected range
        </button>
      </div>
      {error && <Notice>{error}</Notice>}
      <details>
        <summary>Linked participant answer</summary>
        <p className="preserve source-answer">{answer}</p>
      </details>
      <label>
        Evidence quote from the linked answer
        <textarea
          aria-label="Evidence quote from the linked answer"
          required
          maxLength={12000}
          rows={3}
          value={c.quote}
          onChange={(e) => change({ quote: e.target.value })}
        />
      </label>
      <label>
        Researcher caption
        <textarea
          aria-label="Researcher caption"
          maxLength={180}
          rows={2}
          value={c.caption}
          onChange={(e) => change({ caption: e.target.value })}
        />
      </label>
      <p className="small muted">
        The caption is shown throughout the selected clip. It is editable
        context, not automatic word-level subtitles.
      </p>
      <label className="checkbox-label report-review">
        <input
          type="checkbox"
          checked={c.reviewed}
          onChange={(e) => setC({ ...c, reviewed: e.target.checked })}
        />
        I checked the selected media range, evidence quote and caption.
      </label>
      <div className="inline">
        <button className="button primary" disabled={busy}>
          Save clip
        </button>
        {clip && (
          <>
            <a
              className="button"
              href={"/api/" + base + `/clips/${clip.id}/captions`}
            >
              Download clip captions
            </a>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    "Delete this clip and its derived render jobs? It will also be removed from reels.",
                  )
                )
                  void act(async () => {
                    await api(base + `/clips/${clip.id}`, "DELETE");
                    saved("");
                  }, "Clip and derived renders deleted.");
              }}
            >
              Delete clip
            </button>
          </>
        )}
      </div>
    </form>
  );
}
function ReelEditor({
  reel,
  data,
  base,
  busy,
  act,
  saved,
}: {
  reel?: MediaReel;
  data: ReportingData;
  base: string;
  busy: boolean;
  act: Act;
  saved: (id: string) => void;
}) {
  const [r, setR] = useState({
      name: reel?.name || "",
      clipIds: reel?.clipIds || ([] as string[]),
      reviewed: reel?.reviewed || false,
    }),
    [changed, setChanged] = useState(false);
  function change(p: Partial<typeof r>) {
    setR({ ...r, ...p, reviewed: false });
    setChanged(true);
  }
  const duration = r.clipIds.reduce((n, id) => {
    const c = data.clips.find((c) => c.id === id);
    return n + (c ? c.endMs - c.startMs : 0);
  }, 0);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void act(async () => {
          const res = await api(
            base + "/reels" + (reel ? "/" + reel.id : ""),
            reel ? "PUT" : "POST",
            { ...r, version: reel?.version },
          );
          saved(res.reel.id);
        }, "Reel saved.");
      }}
    >
      <label>
        Reel name
        <input
          required
          maxLength={100}
          value={r.name}
          onChange={(e) => change({ name: e.target.value })}
        />
      </label>
      <label>
        Add reviewed clip
        <select
          aria-label="Add reviewed clip"
          value=""
          disabled={r.clipIds.length >= 6}
          onChange={(e) => {
            if (e.target.value)
              change({ clipIds: [...r.clipIds, e.target.value] });
          }}
        >
          <option value="">Choose a clip</option>
          {data.clips
            .filter((c) => c.reviewed && !r.clipIds.includes(c.id))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </label>
      <ol className="reel-order">
        {r.clipIds.map((id, n) => {
          const c = data.clips.find((c) => c.id === id);
          return (
            <li key={id}>
              <span>
                {c?.name || "Missing clip"}
                {!c?.reviewed ? " · needs review" : ""}
              </span>
              <div className="inline">
                <button
                  type="button"
                  className="button"
                  aria-label={`Move clip ${n + 1} up`}
                  disabled={n === 0}
                  onClick={() => {
                    const ids = [...r.clipIds];
                    [ids[n - 1], ids[n]] = [ids[n], ids[n - 1]];
                    change({ clipIds: ids });
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="button"
                  aria-label={`Move clip ${n + 1} down`}
                  disabled={n === r.clipIds.length - 1}
                  onClick={() => {
                    const ids = [...r.clipIds];
                    [ids[n + 1], ids[n]] = [ids[n], ids[n + 1]];
                    change({ clipIds: ids });
                  }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="text-button"
                  aria-label={`Remove clip ${n + 1}`}
                  onClick={() =>
                    change({ clipIds: r.clipIds.filter((x) => x !== id) })
                  }
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <p>{(duration / 1000).toFixed(1)} / 60 seconds</p>
      <label className="checkbox-label report-review">
        <input
          type="checkbox"
          checked={r.reviewed}
          disabled={
            !r.clipIds.length ||
            r.clipIds.some(
              (id) => !data.clips.find((c) => c.id === id)?.reviewed,
            )
          }
          onChange={(e) => {
            setR({ ...r, reviewed: e.target.checked });
            setChanged(true);
          }}
        />
        I reviewed this reel’s clip selection, order and context.
      </label>
      <div className="inline">
        <button
          className="button primary"
          disabled={busy || !r.clipIds.length || duration > 60000}
        >
          Save reel
        </button>
        {reel && (
          <>
            <button
              type="button"
              className="button"
              disabled={busy || changed || !r.reviewed}
              onClick={() =>
                void act(async () => {
                  await api(base + "/jobs", "POST", {
                    reelId: reel.id,
                    version: reel.version,
                  });
                }, "Render job queued. Start it in Render jobs below.")
              }
            >
              Create render job
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    "Delete this reel and its render jobs? Saved clips remain.",
                  )
                )
                  void act(async () => {
                    await api(base + `/reels/${reel.id}`, "DELETE");
                    saved("");
                  }, "Reel and derived renders deleted.");
              }}
            >
              Delete reel
            </button>
          </>
        )}
      </div>
    </form>
  );
}
