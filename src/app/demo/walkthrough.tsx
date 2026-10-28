"use client";
import { useState } from "react";
import {
  FileText,
  MessageSquare,
  BarChart3,
  ArrowRight,
  ArrowLeft,
  AudioLines,
  ShieldCheck,
  LayoutGrid,
} from "lucide-react";
import { Brand } from "../components";
import { templateGuide } from "@/lib/domain";
const examples = [
  {
    question:
      "Tell me about the last product decision you made using customer feedback.",
    answer:
      "We were deciding what to fix in onboarding. The feedback was spread across interview notes, support tickets, and a spreadsheet.",
  },
  {
    question: "What made that difficult?",
    answer:
      "We spent more time finding the source than discussing the decision. It was hard to tell whether one loud request was a real pattern.",
  },
  {
    question: "What would have made the process work better?",
    answer:
      "A clear summary with the original quotes one click away. I want to check the evidence, not just trust the headline.",
  },
];
export default function Walkthrough() {
  const [tab, setTab] = useState("guide"),
    [step, setStep] = useState(0),
    [showSource, setShowSource] = useState(false);
  const g = templateGuide();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-switch">
          <span className="workspace-avatar">F</span>
          <div>
            <strong>Echo Lab preview</strong>
            <small>Product walkthrough</small>
          </div>
        </div>
        <div className="nav-label">EXPLORE THE WORKFLOW</div>
        {[
          ["guide", "Study design", FileText],
          ["interview", "The interview", MessageSquare],
          ["analysis", "Analysis & report", BarChart3],
        ].map(([id, label, Icon]) => (
          <button
            key={id as string}
            className={"nav-item " + (tab === id ? "selected" : "")}
            onClick={() => setTab(id as string)}
          >
            {typeof Icon !== "string" && <Icon size={18} />} {label as string}
          </button>
        ))}
        <div className="sidebar-bottom">
          <div className="research-note">
            <span className="tiny-label">GROUNDED IN PEOPLE</span>
            <p>
              Good questions.
              <br />
              Real evidence.
              <br />
              Better decisions.
            </p>
            <AudioLines size={25} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            Echo Lab <span>Product walkthrough</span>
          </div>
          <span className="private-label">
            <ShieldCheck size={14} /> Illustrative data only
          </span>
        </header>
        <main>
          <div className="preview-banner">
            INTERACTIVE WALKTHROUGH · All responses below are fictional
            examples. Nothing is recorded or sent to AI.
          </div>
          <div className="page-heading">
            <div>
              <div className="eyebrow">FROM CURIOSITY TO CLARITY</div>
              <h1>From feedback to decisions.</h1>
              <p>
                A closer look at study design, interviewing, and findings you
                can trace.
              </p>
            </div>
            <span className="badge paused">PREVIEW</span>
          </div>
          <div className="study-nav">
            {[
              ["guide", "1. Design a study"],
              ["interview", "2. Hear the story"],
              ["analysis", "3. Check the evidence"],
            ].map(([id, label]) => (
              <button
                className={tab === id ? "active" : ""}
                key={id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "guide" && (
            <div className="guide-layout">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <div className="eyebrow">THE STARTING POINT</div>
                    <h2>Shape your conversation</h2>
                  </div>
                  <span className="badge draft">Example guide</span>
                </div>
                <label>Research objective</label>
                <p>{g.goal}</p>
                <label>Audience</label>
                <p className="muted">{g.audience}</p>
                <div className="guide-section-title">
                  <h3>
                    Discussion guide{" "}
                    <span className="count">{g.questions.length}</span>
                  </h3>
                </div>
                <div className="question-list">
                  {g.questions.map((q, n) => (
                    <div className="question-summary" key={q.id}>
                      <span className="question-number">
                        {String(n + 1).padStart(2, "0")}
                      </span>
                      <span>
                        <small>
                          {q.section} ·{" "}
                          {q.type === "choice" ? "Screener" : "Open-ended"}
                        </small>
                        {q.text}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="panel-actions">
                  <button
                    className="button primary"
                    onClick={() => setTab("interview")}
                  >
                    Try the interview walkthrough <ArrowRight size={15} />
                  </button>
                </div>
              </section>
              <aside>
                <div className="ai-card">
                  <FileText size={22} />
                  <h3>Researcher control, throughout.</h3>
                  <p>
                    The full workspace supports editable guides, bounded probes,
                    screeners, branch rules and separate publishing and fielding
                    controls.
                  </p>
                </div>
                <div className="side-note" style={{ marginTop: 20 }}>
                  <ShieldCheck size={17} />
                  <p>
                    This preview is a visual walkthrough. Running real studies
                    requires a configured database, private media storage, and
                    your own workspace account.
                  </p>
                </div>
              </aside>
            </div>
          )}
          {tab === "interview" && (
            <section
              className="panel"
              style={{ maxWidth: 760, margin: "0 auto" }}
            >
              <div className="interview-progress">
                <span>Illustrative conversation</span>
                <span>
                  Question {step + 1} of {examples.length}
                </span>
              </div>
              <div className="progress-track">
                <i
                  style={{ width: ((step + 1) / examples.length) * 100 + "%" }}
                />
              </div>
              <div className="interview-card">
                <div className="moderator-avatar">
                  <MessageSquare size={23} />
                </div>
                <div className="eyebrow">
                  A FICTIONAL PARTICIPANT’S PERSPECTIVE
                </div>
                <h1>{examples[step].question}</h1>
                <div className="source-context">
                  <span className="tiny-label">EXAMPLE RESPONSE</span>
                  <p>{examples[step].answer}</p>
                </div>
                <p className="muted" style={{ marginTop: 22 }}>
                  In a configured study, participants can type or consent to
                  voice recording. The voice workflow supports a hands-free mode
                  with silence detection and manual interruption.
                </p>
                <div className="participant-actions">
                  <button
                    className="button"
                    disabled={step === 0}
                    onClick={() => setStep(step - 1)}
                  >
                    <ArrowLeft size={15} /> Previous
                  </button>
                  <button
                    className="button primary"
                    onClick={() =>
                      step < examples.length - 1
                        ? setStep(step + 1)
                        : setTab("analysis")
                    }
                  >
                    {step < examples.length - 1
                      ? "Next example"
                      : "Explore the findings"}
                    <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            </section>
          )}
          {tab === "analysis" && (
            <div className="analysis-grid">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>The evidence behind the headline.</h2>
                    <p className="muted">
                      One fictional conversation, shown for interface review.
                    </p>
                  </div>
                  <span className="badge draft">Illustrative finding</span>
                </div>
                <article className="theme-card">
                  <div className="theme-top">
                    <h3>Scattered feedback slows decisions</h3>
                  </div>
                  <p>
                    The example participant describes time lost locating and
                    comparing evidence across tools.
                  </p>
                  <blockquote
                    className="citation"
                    style={{ marginLeft: 0, marginRight: 0 }}
                  >
                    “{examples[0].answer}”
                    <button onClick={() => setShowSource(!showSource)}>
                      Example participant ·{" "}
                      {showSource ? "Hide source" : "View source"}{" "}
                      <ArrowRight size={12} />
                    </button>
                  </blockquote>
                  {showSource && (
                    <div className="source-context">
                      <strong>{examples[0].question}</strong>
                      <p>{examples[0].answer}</p>
                      <small>Fictional example · first answer</small>
                    </div>
                  )}
                </article>
                <h3 style={{ marginTop: 20 }}>Keep the claim proportional</h3>
                <p className="muted" style={{ marginTop: 10 }}>
                  A single account illustrates a problem. It does not establish
                  how common the problem is. The research workspace computes
                  counts from coded, included responses and keeps every quote
                  connected to its source.
                </p>
              </section>
              <aside className="panel">
                <div className="eyebrow">WHAT COMES NEXT</div>
                <h3>Try it with your own research.</h3>
                <p className="muted" style={{ marginTop: 12 }}>
                  The live workspace needs a hosted libSQL database and a
                  private Vercel Blob store. The preview can be linked to a
                  Vercel project, then configured for real studies.
                </p>
                <div className="template-note">
                  <ShieldCheck size={20} />
                  <p>
                    No participant data or API keys are included in this
                    walkthrough.
                  </p>
                </div>
                <a className="button" href="/" style={{ marginTop: 20 }}>
                  <LayoutGrid size={15} /> Workspace home
                </a>
              </aside>
            </div>
          )}
        </main>
        <footer>
          ECHO LAB<span>Thoughtful research. Grounded in people.</span>
        </footer>
      </div>
    </div>
  );
}
