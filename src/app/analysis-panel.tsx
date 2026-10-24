"use client";
import PPTXEvidencePanel from "./pptx-evidence-panel";
import { pptxEvidenceText } from "@/lib/pptx-evidence";
import DOCXObservationsPanel from "./docx-observations-panel";
import PPTXObservationsPanel from "./pptx-observations-panel";
import { docxObservationsText } from "@/lib/docx-observations";
import { pptxObservationsText } from "@/lib/pptx-observations";
import DOCXAnswersPanel from "./docx-answers-panel";
import PPTXAnswersPanel from "./pptx-answers-panel";
import { includedDOCXAnswers, docxAnswersText } from "@/lib/docx-answers";
import { includedPPTXAnswers, pptxAnswersText } from "@/lib/pptx-answers";
import DOCXQAPanel from "./docx-qa-panel";
import PPTXQAPanel from "./pptx-qa-panel";
import DOCXSynthesisPanel from "./docx-synthesis-panel";
import PPTXSynthesisPanel from "./pptx-synthesis-panel";
import { docxSynthesisText } from "@/lib/docx-synthesis";
import { pptxSynthesisText } from "@/lib/pptx-synthesis";
import DOCXEvidencePanel from "./docx-evidence-panel";
import PDFAnswersPanel from "./pdf-answers-panel";
import { includedPDFAnswers, pdfAnswersText } from "@/lib/pdf-answers";
import DOCXObservationAnswersPanel from "./docx-observation-answers-panel";
import PPTXObservationAnswersPanel from "./pptx-observation-answers-panel";
import PDFObservationAnswersPanel from "./pdf-observation-answers-panel";
import {
  includedDOCXObservationAnswers,
  docxObservationAnswersText,
} from "@/lib/docx-observation-answers";
import {
  includedPPTXObservationAnswers,
  pptxObservationAnswersText,
} from "@/lib/pptx-observation-answers";
import {
  includedPDFObservationAnswers,
  pdfObservationAnswersText,
} from "@/lib/pdf-observation-answers";
import PDFQAPanel from "./pdf-qa-panel";
import DOCXObservationQAPanel from "./docx-observation-qa-panel";
import PPTXObservationQAPanel from "./pptx-observation-qa-panel";
import PDFObservationQAPanel from "./pdf-observation-qa-panel";
import DOCXObservationSynthesisPanel from "./docx-observation-synthesis-panel";
import PPTXObservationSynthesisPanel from "./pptx-observation-synthesis-panel";
import PDFObservationSynthesisPanel from "./pdf-observation-synthesis-panel";
import { docxObservationSynthesisText } from "@/lib/docx-observation-synthesis";
import { pptxObservationSynthesisText } from "@/lib/pptx-observation-synthesis";
import { pdfObservationSynthesisText } from "@/lib/pdf-observation-synthesis";
import PDFObservationsPanel from "./pdf-observations-panel";
import { pdfObservationsText } from "@/lib/pdf-observations";
import PDFSynthesisPanel from "./pdf-synthesis-panel";
import { pdfSynthesisText } from "@/lib/pdf-synthesis";
import { docxEvidenceText } from "@/lib/docx-evidence";
import { pdfEvidenceText } from "@/lib/pdf-evidence";
import PDFEvidencePanel from "./pdf-evidence-panel";
import AttachmentSynthesisPanel from "./attachment-synthesis-panel";
import { attachmentSynthesisText } from "@/lib/attachment-synthesis";
import AttachmentEvidencePanel from "./attachment-evidence-panel";
import { attachmentEvidenceText } from "@/lib/attachment-evidence";
import { useState, useEffect } from "react";
import {
  Sparkles,
  Plus,
  Download,
  ArrowUpRight,
  CheckCircle2,
  Share2,
  Link,
  RefreshCw,
  Trash2,
  FileText,
  MessageSquare,
  Save,
} from "lucide-react";
import {
  summarizeThemes,
  type Study,
  type Interview,
  type Analysis,
  type Theme,
  type Citation,
} from "@/lib/domain";
import { api } from "@/lib/client";
import MeasuresPanel from "./measures-panel";
import ScreenPlayback from "./screen-playback";
import {
  scopeInterviews,
  conceptScopes,
  scopeQuery,
  conceptFor,
} from "@/lib/concepts";
import type { AnalysisScope } from "@/lib/domain";
import { Spinner, Notice, Modal } from "./components";
export default function AnalysisPanel({
  study,
  interviews,
  ai,
  onError,
}: {
  study: Study;
  interviews: Interview[];
  ai: boolean;
  onError: (s: string) => void;
}) {
  const [a, setA] = useState<Analysis | null>(null),
    [stale, setStale] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("findings"),
    [source, setSource] = useState<Citation | null>(null),
    [coding, setCoding] = useState<Theme | null>(null),
    [memo, setMemo] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [share, setShare] = useState(""),
    [question, setQuestion] = useState(""),
    [qa, setQa] = useState<{ answer: string; citations: Citation[] } | null>(
      null,
    ),
    [segment, setSegment] = useState(""),
    [scopeValue, setScopeValue] = useState("");
  const scope: AnalysisScope | undefined = scopeValue
    ? JSON.parse(scopeValue)
    : undefined;
  const query = scopeQuery(scope),
    scopes = conceptScopes(interviews);
  const eligible = scopeInterviews(interviews, scope);
  const segmentQuestions = [
    ...new Map(
      eligible
        .flatMap((i) =>
          i.guide.questions.filter((q) =>
            i.turns.some((t) => t.questionId === q.id),
          ),
        )
        .map((q) => [q.id, q]),
    ).values(),
  ];
  const stats = a
    ? summarizeThemes(
        a.themes,
        eligible,
        segment ? JSON.parse(segment) : undefined,
      )
    : null;
  function accept(r: any) {
    setA(r.analysis);
    setStale(r.stale);
    setMemo(r.analysis?.memo || "");
    setReviewed(Boolean(r.analysis?.reviewed));
    setShare("");
  }
  useEffect(() => {
    setScopeValue("");
  }, [study.id]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setSource(null);
    setQa(null);
    setCoding(null);
    setSegment("");
    api("studies/" + study.id + "/analysis" + query)
      .then((r) => {
        if (active) accept(r);
      })
      .catch((e) => {
        if (active) onError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [study.id, study.dataVersion, query]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function generate(mode: string) {
    await run(async () => {
      const r = await api("studies/" + study.id + "/analysis" + query, "POST", {
        mode,
      });
      accept(r);
      setQa(null);
    });
  }
  async function saveCoding(themes: Theme[]) {
    if (!a) return;
    await run(async () => {
      const r = await api("studies/" + study.id + "/analysis" + query, "PUT", {
        id: a.id,
        version: a.version || 1,
        summary: a.summary,
        limitations: a.limitations,
        themes,
        reviewed: false,
      });
      accept(r);
      setCoding(null);
      setQa(null);
    });
  }
  const sourceI = source
    ? interviews.find((i) => i.id === source.interviewId)
    : null;
  const sourceTurn = sourceI?.turns.find((t) => t.id === source?.turnId);
  if (loading)
    return (
      <section className="panel">
        <Spinner /> Loading the evidence…
      </section>
    );
  return (
    <>
      {(study.draft.conceptTest || scopes.length > 0) && (
        <section className="panel concept-analysis">
          <h2>Concept results</h2>
          <p className="muted">
            Analyze one concept and revision at a time. Shared questions have
            their own evidence memo.
          </p>
          <label>
            Analysis scope
            <select
              disabled={busy}
              value={scopeValue}
              onChange={(e) => {
                setLoading(true);
                setA(null);
                setMemo("");
                setShare("");
                setScopeValue(e.target.value);
              }}
            >
              <option value="">Shared questions</option>
              {scopes.map((c) => (
                <option
                  key={c.revisionId + c.conceptId}
                  value={JSON.stringify({
                    conceptId: c.conceptId,
                    revisionId: c.revisionId,
                  })}
                >
                  {c.name} · revision {c.revisionId.slice(0, 8)} · {c.completed}{" "}
                  complete / {c.assigned} assigned
                </option>
              ))}
            </select>
          </label>
        </section>
      )}
      <div className="analysis-heading">
        <div>
          <div className="eyebrow">MAKE SENSE OF WHAT YOU HEARD</div>
          <h2>Find the patterns. Keep the people.</h2>
          <p>Source-linked themes and a memo you can stand behind.</p>
        </div>
        <div className="inline">
          <a className="button" href={"/api/studies/" + study.id + "/export"}>
            <Download size={15} /> Export CSV
          </a>
          <button
            className="button primary"
            disabled={!ai || busy || !eligible.length}
            onClick={() => generate("ai")}
          >
            {busy ? <Spinner /> : <Sparkles size={15} />}{" "}
            {a ? "Regenerate with AI" : "Analyze with AI"}
          </button>
        </div>
      </div>
      {!ai && (
        <Notice>
          AI synthesis isn’t connected. You can code exact quotes and write your
          memo manually. No automated findings are being generated.
        </Notice>
      )}
      {stale && (
        <Notice>
          The response set changed. This analysis is out of date. Regenerate
          before editing or sharing. Old report links are unavailable.
        </Notice>
      )}
      <div className="analysis-stats">
        <span>
          <strong>{eligible.length}</strong> completed, included participants
        </span>
        <span>
          <strong>{interviews.filter((i) => i.excluded).length}</strong>{" "}
          excluded
        </span>
        <span>
          <strong>
            {interviews.filter((i) => i.status === "active").length}
          </strong>{" "}
          in progress
        </span>
        <span>Counts describe this sample.</span>
      </div>
      <MeasuresPanel studyId={study.id} dataVersion={study.dataVersion} />
      {!a ? (
        <section className="panel empty-state">
          <FileText size={30} />
          <h2>Start with the stories.</h2>
          <p>
            {eligible.length
              ? "Analyze with AI, or create a blank evidence memo and code the responses yourself."
              : "Complete an interview first. Preview responses and excluded interviews stay out of the analysis."}
          </p>
          <button
            className="button"
            disabled={!eligible.length || busy}
            onClick={() => generate("manual")}
          >
            {busy ? <Spinner /> : <Plus size={16} />} Create evidence memo
          </button>
        </section>
      ) : (
        <>
          <AttachmentSynthesisPanel
            analysis={a}
            studyId={study.id}
            query={query}
            ai={ai}
            stale={stale}
            accept={accept}
            onError={onError}
          />
          <DOCXSynthesisPanel
            analysis={a}
            studyId={study.id}
            query={query}
            ai={ai}
            stale={stale}
            accept={accept}
            onError={onError}
          />
          <PPTXSynthesisPanel
            key={`pptx-synthesis:${study.id}:${query}:${a.id}:${a.version}:${stale}:${a.reportLanguage}`}
            analysis={a}
            studyId={study.id}
            query={query}
            ai={ai}
            stale={stale}
            accept={accept}
            onError={onError}
          />
          <PDFSynthesisPanel
            analysis={a}
            studyId={study.id}
            query={query}
            ai={ai}
            stale={stale}
            accept={accept}
            onError={onError}
          />
          <PDFQAPanel
            key={`pdf-qa:${study.id}:${query}:${a.id}:${a.version}:${stale}:${a.reportLanguage}`}
            analysis={a}
            studyId={study.id}
            query={query}
            ai={ai}
            stale={stale}
            accept={accept}
          />
          <DOCXQAPanel
            key={`docx-qa:${study.id}:${query}:${a.id}:${a.version}:${stale}:${a.reportLanguage}`}
            analysis={a}
            studyId={study.id}
            query={query}
            ai={ai}
            stale={stale}
            accept={accept}
          />
          <PPTXQAPanel
            key={`pptx-qa:${study.id}:${query}:${a.id}:${a.version}:${stale}:${a.reportLanguage}`}
            analysis={a}
            studyId={study.id}
            query={query}
            ai={ai}
            stale={stale}
            accept={accept}
          />
          <DOCXAnswersPanel
            analysis={a}
            studyId={study.id}
            query={query}
            stale={stale}
            accept={accept}
          />
          <PPTXAnswersPanel
            key={`pptx-answers:${study.id}:${query}:${a.id}:${a.version}:${stale}:${a.reportLanguage}`}
            analysis={a}
            studyId={study.id}
            query={query}
            stale={stale}
            accept={accept}
          />
          <PDFAnswersPanel
            analysis={a}
            studyId={study.id}
            query={query}
            stale={stale}
            accept={accept}
          />
          <DOCXObservationQAPanel
            key={`docx-observation-qa:${study.id}:${query}:${a.id}:${a.version}:${stale}:${a.reportLanguage}`}
            analysis={a}
            studyId={study.id}
            query={query}
            ai={ai}
            stale={stale}
            accept={accept}
          />
          <PPTXObservationQAPanel
            key={`pptx-observation-qa:${study.id}:${query}:${a.id}:${a.version}:${stale}:${a.reportLanguage}`}
            analysis={a}
            studyId={study.id}
            query={query}
            ai={ai}
            stale={stale}
            accept={accept}
          />
          <PDFObservationQAPanel
            key={`pdf-observation-qa:${study.id}:${query}:${a.id}:${a.version}:${stale}:${a.reportLanguage}`}
            analysis={a}
            studyId={study.id}
            query={query}
            ai={ai}
            stale={stale}
            accept={accept}
          />
          <DOCXObservationAnswersPanel
            analysis={a}
            studyId={study.id}
            query={query}
            stale={stale}
            accept={accept}
          />
          <PPTXObservationAnswersPanel
            analysis={a}
            studyId={study.id}
            query={query}
            stale={stale}
            accept={accept}
          />
          <PDFObservationAnswersPanel
            analysis={a}
            studyId={study.id}
            query={query}
            stale={stale}
            accept={accept}
          />
          <DOCXObservationSynthesisPanel
            key={`docx-observation-synthesis:${study.id}:${query}:${a.id}:${a.version}:${stale}:${a.reportLanguage}`}
            analysis={a}
            studyId={study.id}
            query={query}
            ai={ai}
            stale={stale}
            accept={accept}
            onError={onError}
          />
          <PPTXObservationSynthesisPanel
            key={`pptx-observation-synthesis:${study.id}:${query}:${a.id}:${a.version}:${stale}:${a.reportLanguage}`}
            analysis={a}
            studyId={study.id}
            query={query}
            ai={ai}
            stale={stale}
            accept={accept}
            onError={onError}
          />
          <PDFObservationSynthesisPanel
            analysis={a}
            studyId={study.id}
            query={query}
            ai={ai}
            stale={stale}
            accept={accept}
            onError={onError}
          />
          <DOCXObservationsPanel
            entries={a.docxObservations}
            studyId={study.id}
            language={a.reportLanguage}
          />
          <PPTXObservationsPanel
            entries={a.pptxObservations}
            studyId={study.id}
            language={a.reportLanguage}
          />
          <PDFObservationsPanel
            entries={a.pdfObservations}
            studyId={study.id}
            language={a.reportLanguage}
          />
          <PPTXEvidencePanel
            entries={a.pptxEvidence}
            studyId={study.id}
            language={a.reportLanguage}
          />
          <DOCXEvidencePanel
            entries={a.docxEvidence}
            studyId={study.id}
            language={a.reportLanguage}
          />
          <PDFEvidencePanel
            entries={a.pdfEvidence}
            studyId={study.id}
            language={a.reportLanguage}
          />
          <AttachmentEvidencePanel
            entries={a.attachmentEvidence}
            studyId={study.id}
            language={a.reportLanguage}
          />
          <div className="filter-tabs">
            <button
              className={tab === "findings" ? "active" : ""}
              onClick={() => setTab("findings")}
            >
              Themes & evidence
            </button>
            <button
              className={tab === "memo" ? "active" : ""}
              onClick={() => setTab("memo")}
            >
              Research memo
            </button>
          </div>
          {tab === "findings" ? (
            <div className="analysis-grid">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h3>What people told us</h3>
                    <p className="muted small">
                      {a.model === "researcher"
                        ? "Researcher-coded"
                        : "AI-proposed · review before sharing"}{" "}
                      · {new Date(a.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    className="button"
                    disabled={busy || stale}
                    onClick={() =>
                      setCoding({
                        id: crypto.randomUUID(),
                        title: "",
                        description: "",
                        citations: [],
                      })
                    }
                  >
                    <Plus size={14} /> Add theme
                  </button>
                </div>
                <label>
                  Compare a segment
                  <select
                    className="segment-select"
                    value={segment}
                    onChange={(e) => setSegment(e.target.value)}
                  >
                    <option value="">All included participants</option>
                    {segmentQuestions
                      .filter((q) => ["choice", "multiple"].includes(q.type))
                      .flatMap((q) =>
                        q.options
                          .filter((o) => !o.rejects)
                          .map((o) => (
                            <option
                              key={q.id + o.id}
                              value={JSON.stringify({
                                questionId: q.id,
                                optionId: o.id,
                              })}
                            >
                              {q.text.slice(0, 35)} → {o.text}
                            </option>
                          )),
                      )}
                  </select>
                </label>
                <p className="muted small">
                  N = {stats?.denominator}. Theme counts include distinct
                  participants with coded supporting quotes. Participants may
                  appear in multiple themes.
                </p>
                {stats?.themes.length ? (
                  stats.themes.map((t) => (
                    <article className="theme-card" key={t.id}>
                      <div className="theme-top">
                        <h3>{t.title}</h3>
                        <span className="theme-count">
                          {t.count}/{stats.denominator} · {t.percent}%
                        </span>
                      </div>
                      <p>{t.description}</p>
                      <div className="theme-bar">
                        <i style={{ width: t.percent + "%" }} />
                      </div>
                      {t.citations.slice(0, 4).map((c, n) => (
                        <CitationView
                          key={c.turnId + ":" + n}
                          c={c}
                          open={setSource}
                        />
                      ))}
                      {t.citations.length > 4 && (
                        <p className="muted small">
                          + {t.citations.length - 4} more coded quotes. Open
                          theme editing to review all.
                        </p>
                      )}
                      <button
                        className="text-button"
                        disabled={stale}
                        onClick={() =>
                          setCoding(a.themes.find((x) => x.id === t.id)!)
                        }
                      >
                        Review / edit coding <ArrowUpRight size={13} />
                      </button>
                    </article>
                  ))
                ) : (
                  <div className="empty-state compact">
                    <MessageSquare size={25} />
                    <h3>No themes coded yet.</h3>
                    <p>
                      Choose exact quotes, group them into themes, and keep room
                      for contrary views.
                    </p>
                  </div>
                )}
              </section>
              <aside>
                <section className="panel">
                  <h3>Ask the evidence</h3>
                  <p className="muted small">
                    Answers use the coded quotes in this study. Uncoded
                    interviews aren’t searched yet.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () =>
                        setQa(
                          await api(
                            "studies/" + study.id + "/qa" + query,
                            "POST",
                            {
                              question,
                            },
                          ),
                        ),
                      );
                    }}
                  >
                    <label>
                      Your research question
                      <textarea
                        rows={3}
                        minLength={5}
                        maxLength={2000}
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        placeholder="What made it difficult to act on feedback?"
                      />
                    </label>
                    <button
                      className="button full"
                      disabled={
                        !ai ||
                        busy ||
                        stale ||
                        question.trim().length < 5 ||
                        !a.themes.length
                      }
                    >
                      {busy ? <Spinner /> : <Sparkles size={14} />} Ask a
                      question
                    </button>
                  </form>
                  {qa && (
                    <div className="qa-answer">
                      <p>{qa.answer}</p>
                      {qa.citations.map((c, n) => (
                        <CitationView c={c} key={n} open={setSource} />
                      ))}
                    </div>
                  )}
                </section>
                <div className="side-note" style={{ marginTop: 20 }}>
                  <CheckCircle2 size={17} />
                  <p>
                    A citation proves where a quote came from. It doesn’t prove
                    an interpretation is right. Review counterexamples and the
                    complete response.
                  </p>
                </div>
                {stale && (
                  <button
                    className="button full"
                    disabled={busy || !eligible.length}
                    style={{ marginTop: 20 }}
                    onClick={() => {
                      if (
                        confirm(
                          "Start a new manual analysis? Existing coding and memo remain in history, but the current view will start blank.",
                        )
                      )
                        void generate("manual");
                    }}
                  >
                    <RefreshCw size={15} /> Start fresh manually
                  </button>
                )}
              </aside>
            </div>
          ) : (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Your research memo</h2>
                  <p className="muted small">
                    Review the evidence, add context, and make it your own.
                  </p>
                </div>
                <span className={"badge " + (a.reviewed ? "active" : "draft")}>
                  {a.reviewed ? "Reviewed" : "Needs review"}
                </span>
              </div>
              <label>
                Editable memo
                <textarea
                  className="memo-editor"
                  value={memo}
                  onChange={(e) => {
                    setMemo(e.target.value);
                    setReviewed(false);
                  }}
                  maxLength={40000}
                />
              </label>
              <label className="checkbox-label" style={{ marginTop: 20 }}>
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />{" "}
                I’ve checked the source evidence, counts and limitations.
              </label>
              <div className="panel-actions">
                <button
                  className="button primary"
                  disabled={busy || stale}
                  onClick={() =>
                    run(async () =>
                      accept(
                        await api(
                          "studies/" + study.id + "/analysis" + query,
                          "PUT",
                          {
                            id: a.id,
                            version: a.version || 1,
                            summary: a.summary,
                            limitations: a.limitations,
                            themes: a.themes,
                            memo,
                            reviewed,
                          },
                        ),
                      ),
                    )
                  }
                >
                  <Save size={15} /> Save memo
                </button>
                <button
                  className="button"
                  onClick={() => {
                    const u = URL.createObjectURL(
                      new Blob(
                        [
                          memo +
                            attachmentSynthesisText(
                              a.attachmentSynthesis,
                              a.reportLanguage,
                            ) +
                            attachmentEvidenceText(
                              a.attachmentEvidence,
                              a.reportLanguage,
                            ) +
                            pdfEvidenceText(a.pdfEvidence, a.reportLanguage) +
                            pptxEvidenceText(a.pptxEvidence, a.reportLanguage) +
                            docxEvidenceText(a.docxEvidence, a.reportLanguage) +
                            docxObservationsText(
                              a.docxObservations,
                              a.reportLanguage,
                            ) +
                            pptxObservationsText(
                              a.pptxObservations,
                              a.reportLanguage,
                            ) +
                            pdfObservationsText(
                              a.pdfObservations,
                              a.reportLanguage,
                            ) +
                            docxAnswersText(
                              includedDOCXAnswers(
                                a.docxAnswers,
                                a.docxEvidence || [],
                              ),
                              a.reportLanguage,
                            ) +
                            pptxAnswersText(
                              includedPPTXAnswers(
                                a.pptxAnswers,
                                a.pptxEvidence || [],
                              ),
                              a.reportLanguage,
                            ) +
                            pdfAnswersText(
                              includedPDFAnswers(
                                a.pdfAnswers,
                                a.pdfEvidence || [],
                              ),
                              a.reportLanguage,
                            ) +
                            docxObservationAnswersText(
                              includedDOCXObservationAnswers(
                                a.docxObservationAnswers,
                                a.docxObservations || [],
                              ),
                              a.reportLanguage,
                            ) +
                            pptxObservationAnswersText(
                              includedPPTXObservationAnswers(
                                a.pptxObservationAnswers,
                                a.pptxObservations || [],
                              ),
                              a.reportLanguage,
                            ) +
                            pdfObservationAnswersText(
                              includedPDFObservationAnswers(
                                a.pdfObservationAnswers,
                                a.pdfObservations || [],
                              ),
                              a.reportLanguage,
                            ) +
                            pdfSynthesisText(a.pdfSynthesis, a.reportLanguage) +
                            docxSynthesisText(
                              a.docxSynthesis,
                              a.reportLanguage,
                            ) +
                            pptxSynthesisText(
                              a.pptxSynthesis,
                              a.reportLanguage,
                            ) +
                            docxObservationSynthesisText(
                              a.docxObservationSynthesis,
                              a.reportLanguage,
                            ) +
                            pptxObservationSynthesisText(
                              a.pptxObservationSynthesis,
                              a.reportLanguage,
                            ) +
                            pdfObservationSynthesisText(
                              a.pdfObservationSynthesis,
                              a.reportLanguage,
                            ),
                        ],
                        { type: "text/plain" },
                      ),
                    );
                    const el = document.createElement("a");
                    el.href = u;
                    el.download = "research-memo.txt";
                    el.click();
                    setTimeout(() => URL.revokeObjectURL(u), 1000);
                  }}
                >
                  <Download size={15} /> Download memo
                </button>
                <button
                  className="button"
                  disabled={
                    busy || stale || !a.reviewed || memo !== a.memo || !reviewed
                  }
                  onClick={() =>
                    run(async () => {
                      const r = await api(
                        "studies/" + study.id + "/share" + query,
                        "POST",
                      );
                      setShare(location.origin + "/share/" + r.token);
                    })
                  }
                >
                  <Share2 size={15} /> Create view-only link
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api(
                        "studies/" + study.id + "/share" + query,
                        "DELETE",
                      );
                      setShare("");
                    })
                  }
                >
                  Revoke report links
                </button>
              </div>
              {share && (
                <label>
                  View-only report · expires in 7 days
                  <div className="copy-field">
                    <input
                      readOnly
                      value={share}
                      onClick={(e) => e.currentTarget.select()}
                    />
                    <button
                      className="button"
                      onClick={() =>
                        run(async () => {
                          await navigator.clipboard.writeText(share);
                        })
                      }
                    >
                      <Link size={14} /> Copy
                    </button>
                  </div>
                </label>
              )}
              <p className="muted small" style={{ marginTop: 20 }}>
                Saving edits revokes existing report links. Changes to the
                included response set make shared reports unavailable until
                regenerated and reviewed.
              </p>
            </section>
          )}
        </>
      )}
      {coding && (
        <ThemeEditor
          theme={coding}
          interviews={eligible}
          busy={busy}
          close={() => setCoding(null)}
          save={(t) =>
            saveCoding([...a!.themes.filter((x) => x.id !== t.id), t])
          }
          remove={() => {
            if (confirm("Remove this theme and rebuild the memo?"))
              void saveCoding(a!.themes.filter((x) => x.id !== coding.id));
          }}
        />
      )}
      {source && (
        <Modal title="Back to the source" onClose={() => setSource(null)}>
          {sourceI?.origin && (
            <Notice>
              External transcript: {sourceI.origin.title} ·{" "}
              {sourceI.origin.externalId}. Review speaker labels before
              attributing this quote. Imported video is available in Research
              Library.
            </Notice>
          )}
          <div className="transcript-meta">
            <span>Participant {source.interviewId.slice(0, 8)}</span>
            {sourceI && sourceTurn?.conceptId && (
              <span>
                Concept: {conceptFor(sourceI, sourceTurn.conceptId)?.name}
              </span>
            )}
            <span>
              Question{" "}
              {sourceTurn?.templateQuestionId || sourceTurn?.questionId}
            </span>
          </div>
          <h3>
            {sourceTurn?.prompt ||
              "Source is no longer available in this response set."}
          </h3>
          <div className="citation">“{source.quote}”</div>
          {sourceTurn && (
            <div className="source-context">
              <strong>Complete answer</strong>
              <p>{sourceTurn.answer}</p>
              {sourceTurn.audioId && (
                <audio
                  controls
                  preload="none"
                  style={{ width: "100%", marginTop: 15 }}
                  src={"/api/recordings/" + sourceTurn.audioId}
                />
              )}
              {sourceI?.guide.questions.find(
                (q) => q.id === sourceTurn.questionId,
              )?.task && (
                <ScreenPlayback
                  studyId={study.id}
                  interviewId={source.interviewId}
                  questionId={sourceTurn.questionId}
                />
              )}
              <p className="mono">Turn {source.turnId}</p>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
function CitationView({
  c,
  open,
}: {
  c: Citation;
  open: (c: Citation) => void;
}) {
  return (
    <blockquote className="citation" style={{ marginLeft: 0, marginRight: 0 }}>
      “{c.quote}”
      <button onClick={() => open(c)}>
        Participant {c.interviewId.slice(0, 8)} · View source{" "}
        <ArrowUpRight size={12} />
      </button>
    </blockquote>
  );
}
function ThemeEditor({
  theme,
  interviews,
  busy,
  close,
  save,
  remove,
}: {
  theme: Theme;
  interviews: Interview[];
  busy: boolean;
  close: () => void;
  save: (t: Theme) => void;
  remove: () => void;
}) {
  const [t, setT] = useState<Theme>(structuredClone(theme)),
    [turnKey, setTurnKey] = useState(""),
    [quote, setQuote] = useState("");
  const turns = interviews.flatMap((i) =>
    i.turns
      .filter(
        (x) =>
          i.guide.questions.find((q) => q.id === x.questionId)?.type === "open",
      )
      .map((x) => ({ i, t: x })),
  );
  const selected = turns.find((x) => x.t.id === turnKey);
  const valid =
    selected &&
    quote.trim().length >= 3 &&
    selected.t.answer.includes(quote.trim());
  return (
    <Modal
      title={theme.title ? "Review theme coding" : "Add a theme"}
      onClose={close}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(t);
        }}
      >
        <label>
          Theme name
          <input
            value={t.title}
            required
            minLength={3}
            maxLength={150}
            onChange={(e) => setT({ ...t, title: e.target.value })}
          />
        </label>
        <label>
          What does the evidence suggest?
          <textarea
            value={t.description}
            maxLength={1500}
            onChange={(e) => setT({ ...t, description: e.target.value })}
          />
        </label>
        <h3 style={{ marginTop: 25 }}>Supporting evidence</h3>
        {t.citations.map((c, n) => (
          <div className="citation" key={c.turnId + ":" + n}>
            <p>“{c.quote}”</p>
            <button
              type="button"
              onClick={() =>
                setT({
                  ...t,
                  citations: t.citations.filter((_, idx) => idx !== n),
                })
              }
            >
              Remove quote
            </button>
          </div>
        ))}
        <label>
          Choose a source answer
          <select
            value={turnKey}
            onChange={(e) => {
              setTurnKey(e.target.value);
              setQuote(
                turns.find((x) => x.t.id === e.target.value)?.t.answer || "",
              );
            }}
          >
            <option value="">Select a response…</option>
            {turns.map((x) => (
              <option key={x.t.id} value={x.t.id}>
                {x.i.id.slice(0, 8)} · {x.t.answer.slice(0, 80)}
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <>
            <label>
              Exact quote
              <textarea
                value={quote}
                onChange={(e) => setQuote(e.target.value)}
                rows={3}
              />
            </label>
            <p className="muted small">
              Use the full answer or an exact, continuous excerpt. The server
              verifies every quote against the source.
            </p>
            <button
              type="button"
              className="text-button"
              disabled={!valid}
              onClick={() => {
                setT({
                  ...t,
                  citations: [
                    ...t.citations,
                    {
                      interviewId: selected.i.id,
                      turnId: selected.t.id,
                      quote: quote.trim(),
                    },
                  ],
                });
                setTurnKey("");
                setQuote("");
              }}
            >
              <Plus size={13} /> Add this quote
            </button>
          </>
        )}
        <Notice>
          Updating coding rebuilds the memo and clears its review status and
          share links. Include contrary views rather than forcing agreement.
        </Notice>
        <div className="modal-actions">
          {theme.title && (
            <button
              type="button"
              className="button danger"
              onClick={remove}
              disabled={busy}
            >
              <Trash2 size={15} /> Remove theme
            </button>
          )}
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !t.citations.length || t.title.trim().length < 3}
          >
            {busy ? <Spinner /> : <Save size={15} />} Save theme
          </button>
        </div>
      </form>
    </Modal>
  );
}
