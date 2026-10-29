"use client";
import AutomationPanel from "./automation-panel";
import PrivatePPTX from "./private-pptx";
import PPTXTextPanel from "./pptx-text-panel";
import PrivateDOCX from "./private-docx";
import DOCXReviewPanel from "./docx-review-panel";
import PPTXReviewPanel from "./pptx-review-panel";
import DOCXTextPanel from "./docx-text-panel";
import PrivatePDF from "./private-pdf";
import PDFTextPanel from "./pdf-text-panel";
import PDFReviewPanel from "./pdf-review-panel";
import ImageReviewPanel from "./image-review-panel";
import ConceptImageUpload from "./concept-image-upload";
import ConceptImageLibrary from "./concept-image-library";
import QuotaPanel from "./quota-panel";
import BrandingPanel from "./branding-panel";
import ApiKeyPanel from "./api-key-panel";
import OAuthConnectionsPanel from "./oauth-connections-panel";
import InvitationEmailPanel from "./invitation-email-panel";
import IncentivesPanel from "./incentives-panel";
import RecruitmentPanel from "./recruitment-panel";
import SurveyHandoffPanel from "./survey-handoff-panel";
import EmotionPanel from "./emotion-panel";
import PulsePanel from "./pulse-panel";
import CardsortSettings from "./cardsort-settings";
import CardsortPanel from "./cardsort-panel";
import MaxdiffSettings from "./maxdiff-settings";
import MaxdiffPanel from "./maxdiff-panel";
import PricingPanel from "./pricing-panel";
import PricingSettings from "./pricing-settings";
import { useEffect, useState, useCallback } from "react";
import {
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  Plus,
  Search,
  AudioLines,
  LayoutGrid,
  Settings,
  LogOut,
  Check,
  ChevronRight,
  MessageSquare,
  Play,
  Pause,
  Copy,
  FileText,
  Users,
  Globe,
  Clock,
  Trash2,
  Save,
  Eye,
  Upload,
  X,
  Sparkles,
  BarChart3,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import { api } from "@/lib/client";
import {
  type Guide,
  type Study,
  type Actor,
  type Interview,
  type Question,
  type Revision,
} from "@/lib/domain";
import AnalysisPanel from "./analysis-panel";
import ReportingPanel from "./reporting-panel";
import LibraryPanel from "./library-panel";
import LocalizationPanel from "./localization-panel";
import VisualPanel from "./visual-panel";
import ScreenPlayback from "./screen-playback";
import {
  WorkflowLibraryModal,
  StudyWorkflow,
  GuideAdvisor,
} from "./workflow-panels";
import type { Folder } from "@/lib/workflow";
import MixedSettings from "./mixed-settings";
import PrivateConceptImage from "./private-concept-image";
import ConceptEditor from "./concept-editor";
import { hasOptions } from "@/lib/mixed";
type StudyRow = Study & {
  counts: {
    complete: number;
    active: number;
    screenedOut: number;
    included: number;
  };
};
type Detail = {
  study: Study;
  counts: StudyRow["counts"];
  revisions: Revision[];
  interviews: Interview[];
};
import { Spinner, Notice, Modal, Brand } from "./components";
export default function Workspace() {
  const [user, setUser] = useState<Actor | null>(null),
    [loading, setLoading] = useState(true),
    [ai, setAi] = useState(false),
    [rows, setRows] = useState<StudyRow[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [tab, setTab] = useState("guide"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [create, setCreate] = useState(false),
    [settings, setSettings] = useState(false),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [libraryOpen, setLibraryOpen] = useState(false),
    [researchOpen, setResearchOpen] = useState(false),
    [folders, setFolders] = useState<Folder[]>([]),
    [folderFilter, setFolderFilter] = useState("all");
  const loadRows = useCallback(async () => {
    const [r, library] = await Promise.all([api("studies"), api("workflow")]);
    setRows(r.studies);
    setFolders(library.folders);
  }, []);
  async function open(id: string, t = "guide") {
    setError("");
    try {
      const r = await api<Detail>("studies/" + id);
      setDetail(r);
      setResearchOpen(false);
      setTab(t);
      const nextParams = new URLSearchParams({ study: id, tab: t });
      const currentParams = new URLSearchParams(window.location.search);
      if (t === "responses" && currentParams.get("study") === id)
        for (const key of ["interview", "turn"]) {
          const value = currentParams.get(key);
          if (value) nextParams.set(key, value);
        }
      history.replaceState(null, "", "/?" + nextParams.toString());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function refresh() {
    await loadRows();
    if (detail) await open(detail.study.id, tab);
  }
  async function init() {
    setLoading(true);
    try {
      const m = await api("me");
      setUser(m.user);
      setAi(m.ai);
      await loadRows();
      const url = new URL(location.href);
      setResearchOpen(url.searchParams.has("library"));
      if (url.searchParams.get("study"))
        await open(
          url.searchParams.get("study")!,
          url.searchParams.get("tab") || "guide",
        );
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void init();
  }, []);
  function home() {
    setResearchOpen(false);
    setDetail(null);
    history.replaceState(null, "", "/");
    void loadRows();
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function preview() {
    if (!detail) return;
    await run(async () => {
      const r = await api("studies/" + detail.study.id + "/preview", "POST");
      localStorage.setItem("interview:" + r.interview.id, r.token);
      window.open(
        "/s/" + detail.study.id + "?preview=" + r.interview.id,
        "_blank",
      );
    });
  }
  if (loading)
    return (
      <div className="full-loader">
        <Brand />
        <Spinner />
      </div>
    );
  if (!user) return <Auth onSuccess={init} />;
  const shown = rows.filter(
    (s) =>
      s.title.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" || s.fielding === filter) &&
      (folderFilter === "all" ||
        (folderFilter === "unfiled"
          ? !s.folderId
          : s.folderId === folderFilter)),
  );
  const completed = rows.reduce((n, s) => n + s.counts.complete, 0),
    active = rows.filter((s) => s.fielding === "active").length;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          href="/"
          className="brand-link"
          onClick={(e) => {
            e.preventDefault();
            home();
          }}
        >
          <Brand />
        </a>
        <div className="workspace-switch">
          <span className="workspace-avatar">{user.name[0].toUpperCase()}</span>
          <div>
            <strong>{user.name.split(" ")[0]}’s workspace</strong>
            <small>Internal research</small>
          </div>
          <ChevronRight size={15} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <button
          className={
            "nav-item " + (!settings && !researchOpen ? "selected" : "")
          }
          onClick={home}
        >
          <LayoutGrid size={18} /> Studies <span>{rows.length}</span>
        </button>
        <button className="nav-item" onClick={() => setSettings(true)}>
          <Settings size={18} /> Team & settings
        </button>
        <button
          className={"nav-item " + (researchOpen ? "selected" : "")}
          onClick={() => {
            setResearchOpen(true);
            setDetail(null);
            history.replaceState(null, "", "/?library=1");
          }}
        >
          <Search size={18} /> Research library
        </button>
        <button className="nav-item" onClick={() => setLibraryOpen(true)}>
          <FileText size={18} /> Study resources
        </button>
        <div className="sidebar-bottom">
          <div className="research-note">
            <span className="tiny-label">A LITTLE REMINDER</span>
            <p>
              Good questions.
              <br />
              Real people.
              <br />
              Better decisions.
            </p>
            <AudioLines size={26} />
          </div>
          <button className="profile" onClick={() => setSettings(true)}>
            <span className="avatar">{user.name[0].toUpperCase()}</span>
            <div>
              <strong>{user.name}</strong>
              <small>{user.role}</small>
            </div>
            <Settings size={16} />
          </button>
          <button
            className="logout"
            onClick={() =>
              run(async () => {
                await api("auth/logout", "POST");
                setUser(null);
                setDetail(null);
              })
            }
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button onClick={home}>Workspace</button>
            <ChevronRight size={14} />
            <span>
              {researchOpen
                ? "Research Library"
                : detail
                  ? detail.study.title
                  : "Studies"}
            </span>
          </div>
          <span className="private-label">
            <ShieldCheck size={14} /> Private workspace
          </span>
        </header>
        <main>
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          )}
          {researchOpen ? (
            <LibraryPanel
              changed={loadRows}
              openStudy={(id) => void open(id, "responses")}
            />
          ) : !detail ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR RESEARCH, IN ONE PLACE</div>
                  <h1>A little curiosity goes a long way.</h1>
                  <p>
                    Ask better questions. Hear the whole story. Find your next
                    move.
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => setCreate(true)}
                >
                  <Plus size={17} /> New study
                </button>
              </div>
              <div className="overview">
                <Metric
                  label="Studies in your workspace"
                  value={rows.length}
                  icon={<FileText size={19} />}
                  foot="Every question starts somewhere"
                />
                <Metric
                  label="Interviews completed"
                  value={completed}
                  icon={<MessageSquare size={19} />}
                  foot="Real conversations, ready to explore"
                />
                <Metric
                  label="Currently in the field"
                  value={active}
                  icon={<Globe size={19} />}
                  foot={
                    active ? "Listening for what matters" : "Ready when you are"
                  }
                />
              </div>
              <section className="studies-section">
                <div className="section-heading">
                  <div>
                    <h2>
                      Your studies <span className="count">{rows.length}</span>
                    </h2>
                    <p>A space for every question worth asking.</p>
                  </div>
                  <label className="search">
                    <Search size={17} />
                    <input
                      aria-label="Search studies"
                      placeholder="Find a study…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                </div>
                <label className="folder-filter">
                  Folder
                  <select
                    aria-label="Filter by folder"
                    value={folderFilter}
                    onChange={(e) => setFolderFilter(e.target.value)}
                  >
                    <option value="all">All folders</option>
                    <option value="unfiled">Unfiled</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="filter-tabs">
                  {[
                    ["all", "All studies"],
                    ["active", "In the field"],
                    ["draft", "Drafts"],
                    ["closed", "Closed"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={filter === id ? "active" : ""}
                      onClick={() => setFilter(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {shown.length ? (
                  <div className="study-grid">
                    {shown.map((s) => (
                      <button
                        key={s.id}
                        className="study-card"
                        onClick={() => open(s.id)}
                      >
                        <div className="study-card-top">
                          <span className={"badge " + s.fielding}>
                            <i />
                            {s.fielding === "active"
                              ? "In the field"
                              : s.fielding === "paused"
                                ? "Ready / paused"
                                : s.fielding === "draft"
                                  ? "Draft"
                                  : "Closed"}
                          </span>
                          <ArrowUpRight size={19} />
                        </div>
                        <h3>{s.title}</h3>
                        <p>{s.draft.goal}</p>
                        <div className="study-card-meta">
                          <span>
                            <MessageSquare size={15} />
                            {s.counts.complete} interviews
                          </span>
                          <span>
                            <Clock size={14} />
                            {new Date(s.updatedAt).toLocaleDateString(
                              undefined,
                              { month: "short", day: "numeric" },
                            )}
                          </span>
                        </div>
                        <div className="study-card-bottom">
                          <div className="mini-avatar">{user.name[0]}</div>
                          <span>Created by your team</span>
                          <ChevronRight size={16} />
                        </div>
                      </button>
                    ))}
                    <button
                      className="new-study-card"
                      onClick={() => setCreate(true)}
                    >
                      <span>
                        <Plus size={24} />
                      </span>
                      <h3>Follow your curiosity</h3>
                      <p>
                        Start with a question.
                        <br />
                        See where it takes you.
                      </p>
                    </button>
                  </div>
                ) : (
                  <div className="empty-state">
                    <div className="empty-illustration">
                      <MessageSquare size={34} />
                      <AudioLines size={25} />
                    </div>
                    <h2>
                      {search
                        ? "No studies found"
                        : "Your next insight starts here."}
                    </h2>
                    <p>
                      {search
                        ? "Try another title or filter."
                        : "Build an interview guide, invite a few people, and hear what matters."}
                    </p>
                    <button
                      className="button primary"
                      onClick={() => setCreate(true)}
                    >
                      <Plus size={16} /> Create your first study
                    </button>
                  </div>
                )}
              </section>
              <div className="bottom-note">
                <AudioLines size={17} />
                <span>
                  Keep the evidence close. Every good finding starts with
                  someone’s story.
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="study-heading">
                <button className="back-link" onClick={home}>
                  <ArrowLeft size={15} /> All studies
                </button>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">
                      {detail.study.fielding === "active"
                        ? "LISTENING NOW"
                        : "STUDY WORKSPACE"}
                    </div>
                    <h1>{detail.study.title}</h1>
                    <p>{detail.study.draft.audience}</p>
                  </div>
                  <button className="button" onClick={preview} disabled={busy}>
                    <Eye size={16} /> Preview draft
                  </button>
                </div>
              </div>
              <div className="study-nav">
                {[
                  ["guide", "Study design", FileText],
                  ["workflow", "Workflow", Clock],
                  ["languages", "Languages", Globe],
                  ["fielding", "Fielding", Globe],
                  ["responses", "Responses", Users],
                  ["analysis", "Analysis & report", BarChart3],
                  ["reporting", "Reports & media", FileText],
                  ["visual", "Visual Insights", Eye],
                  ["pricing", "Pricing", LayoutGrid],
                  ["maxdiff", "MaxDiff", LayoutGrid],
                  ["cardsort", "Card sort", LayoutGrid],
                  ["pulse", "Pulse", Clock],
                  ["emotions", "Feelings", BarChart3],
                ].map(([id, label, Icon]) => (
                  <button
                    key={id as string}
                    className={tab === id ? "active" : ""}
                    onClick={() => {
                      setTab(id as string);
                      history.replaceState(
                        null,
                        "",
                        "/?study=" + detail.study.id + "&tab=" + id,
                      );
                    }}
                  >
                    {typeof Icon !== "string" && <Icon size={16} />}{" "}
                    {label as string}
                    {id === "responses" && (
                      <span>{detail.counts.complete}</span>
                    )}
                  </button>
                ))}
              </div>
              {tab === "guide" && (
                <GuideEditor
                  key={detail.study.id + ":" + detail.study.version}
                  study={detail.study}
                  ai={ai}
                  busy={busy}
                  save={(g) =>
                    run(async () => {
                      await api("studies/" + detail.study.id, "PUT", {
                        guide: g,
                        version: detail.study.version,
                      });
                      await refresh();
                    })
                  }
                  generate={() =>
                    api("studies/" + detail.study.id + "/draft", "POST")
                  }
                  publish={() =>
                    run(async () => {
                      await api(
                        "studies/" + detail.study.id + "/publish",
                        "POST",
                        { version: detail.study.version },
                      );
                      await refresh();
                    })
                  }
                />
              )}
              {tab === "languages" && (
                <LocalizationPanel
                  key={detail.study.id}
                  study={detail.study}
                  ai={ai}
                  refresh={refresh}
                />
              )}
              {tab === "workflow" && (
                <StudyWorkflow
                  key={detail.study.id}
                  study={detail.study}
                  refresh={refresh}
                />
              )}
              {tab === "emotions" && (
                <EmotionPanel
                  key={detail.study.id}
                  studyId={detail.study.id}
                  dataVersion={detail.study.dataVersion}
                />
              )}
              {tab === "pulse" && (
                <PulsePanel
                  key={detail.study.id}
                  study={detail.study}
                  open={open}
                />
              )}
              {tab === "cardsort" && (
                <CardsortPanel
                  key={detail.study.id}
                  studyId={detail.study.id}
                  dataVersion={detail.study.dataVersion}
                />
              )}
              {tab === "maxdiff" && (
                <MaxdiffPanel
                  key={detail.study.id}
                  studyId={detail.study.id}
                  dataVersion={detail.study.dataVersion}
                />
              )}
              {tab === "pricing" && (
                <PricingPanel
                  key={detail.study.id}
                  studyId={detail.study.id}
                  dataVersion={detail.study.dataVersion}
                />
              )}
              {tab === "visual" && (
                <VisualPanel key={detail.study.id} studyId={detail.study.id} />
              )}
              {tab === "reporting" && (
                <ReportingPanel
                  key={detail.study.id}
                  study={detail.study}
                  user={user}
                />
              )}
              {tab === "fielding" && (
                <Fielding
                  detail={detail}
                  busy={busy}
                  change={(state) =>
                    run(async () => {
                      await api(
                        "studies/" + detail.study.id + "/fielding",
                        "POST",
                        { state },
                      );
                      await refresh();
                    })
                  }
                />
              )}
              {tab === "responses" && (
                <Responses
                  detail={detail}
                  refresh={refresh}
                  onError={setError}
                />
              )}
              {tab === "analysis" && (
                <AnalysisPanel
                  study={detail.study}
                  interviews={detail.interviews}
                  ai={ai}
                  onError={setError}
                />
              )}
            </>
          )}
        </main>
        <footer>
          ECHO LAB <span>Thoughtful research. Grounded in people.</span>
        </footer>
      </div>
      {create && (
        <CreateStudy
          close={() => setCreate(false)}
          submit={(title, goal) =>
            run(async () => {
              const r = await api("studies", "POST", { title, goal });
              setCreate(false);
              await loadRows();
              await open(r.study.id);
            })
          }
          busy={busy}
        />
      )}
      {libraryOpen && (
        <WorkflowLibraryModal
          user={user}
          close={() => setLibraryOpen(false)}
          changed={async () => {
            setFolderFilter("all");
            await refresh();
          }}
        />
      )}
      {settings && (
        <SettingsPanel user={user} close={() => setSettings(false)} />
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  icon,
  foot,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  foot: string;
}) {
  return (
    <div className="metric">
      <div>
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value.toString().padStart(2, "0")}</strong>
      <small>{foot}</small>
    </div>
  );
}
function Auth({ onSuccess }: { onSuccess: () => void }) {
  const [signup, setSignup] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [invite, setInvite] = useState("");
  useEffect(() => {
    const i = new URL(location.href).searchParams.get("invite");
    if (i) {
      setInvite(i);
      setSignup(true);
    }
  }, []);
  return (
    <div className="auth-shell">
      <section className="auth-story">
        <Brand />
        <div>
          <div className="eyebrow">A SPACE FOR YOUR CURIOSITY</div>
          <h1>
            Less guesswork.
            <br />
            More understanding.
          </h1>
          <p>
            Listen closely. Find the patterns.
            <br />
            Keep the people behind every insight in view.
          </p>
          <div className="auth-quote">
            <span>“</span>
            <p>
              The best research starts
              <br />
              with a better question.
            </p>
            <AudioLines size={38} />
          </div>
        </div>
        <small>YOUR TEAM’S PRIVATE RESEARCH WORKSPACE</small>
      </section>
      <section className="auth-form">
        <div>
          <span className="badge paused">INTERNAL RESEARCH</span>
          <h2>{signup ? "Make room for discovery." : "Welcome back."}</h2>
          <p>
            {signup
              ? "Create your account to start listening."
              : "Your next insight is waiting for you."}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              try {
                await api("auth/" + (signup ? "signup" : "login"), "POST", {
                  name: f.get("name"),
                  setupCode: f.get("setupCode") || undefined,
                  email: f.get("email"),
                  password: f.get("password"),
                  ...(invite ? { invite } : {}),
                });
                onSuccess();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {signup && (
              <label>
                Your name
                <input
                  name="name"
                  autoComplete="name"
                  minLength={2}
                  maxLength={80}
                  required
                  placeholder="Jess Holbrook"
                />
              </label>
            )}
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@yourteam.com"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={signup ? "new-password" : "current-password"}
                minLength={signup ? 12 : 1}
                maxLength={128}
                required
                placeholder={
                  signup ? "At least 12 characters" : "Your password"
                }
              />
            </label>
            {error && <Notice>{error}</Notice>}
            {signup && !invite && (
              <label>
                Hosted workspace setup code{" "}
                <span className="muted small">(optional locally)</span>
                <input
                  name="setupCode"
                  type="password"
                  autoComplete="off"
                  maxLength={256}
                  placeholder="Only needed for a new Vercel workspace"
                />
              </label>
            )}
            <button className="button primary full" disabled={busy}>
              {busy ? (
                <Spinner />
              ) : (
                <>
                  {signup ? "Create workspace" : "Sign in"}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>
          <p className="auth-toggle">
            {signup ? "Already have an account?" : "New here?"}{" "}
            <button
              onClick={() => {
                setSignup(!signup);
                setError("");
              }}
            >
              {signup ? "Sign in" : "Create your workspace"}
            </button>
          </p>
          <div className="auth-security">
            <ShieldCheck size={17} /> Your studies belong to your workspace.
          </div>
        </div>
      </section>
    </div>
  );
}
function CreateStudy({
  close,
  submit,
  busy,
}: {
  close: () => void;
  submit: (title: string, goal: string) => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState(""),
    [goal, setGoal] = useState("");
  return (
    <Modal title="What are you curious about?" onClose={close}>
      <p className="muted">
        Start with the decision you need to make. You can shape the guide next.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(title, goal);
        }}
      >
        <label>
          Study name
          <input
            autoFocus
            required
            minLength={3}
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. How teams turn feedback into decisions"
          />
        </label>
        <label>
          What do you want to learn?
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            minLength={10}
            maxLength={4000}
            placeholder="Understand the process, the friction, and what would help."
            rows={4}
          />
        </label>
        <div className="template-note">
          <FileText size={19} />
          <div>
            <strong>A useful starting point</strong>
            <p>
              You’ll get an editable exploratory interview template. AI drafting
              is available when a provider is connected.
            </p>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="button" onClick={close}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <Spinner /> : <Plus size={16} />} Create study
          </button>
        </div>
      </form>
    </Modal>
  );
}
function GuideEditor({
  study,
  ai,
  busy,
  save,
  generate,
  publish,
}: {
  study: Study;
  ai: boolean;
  busy: boolean;
  save: (g: Guide) => void;
  generate: () => Promise<{ guide: Guide }>;
  publish: () => void;
}) {
  const [g, setG] = useState<Guide>(structuredClone(study.draft)),
    [selected, setSelected] = useState(0),
    [changed, setChanged] = useState(false),
    [generating, setGenerating] = useState(false),
    [candidate, setCandidate] = useState<Guide | null>(null),
    [optionUploads, setOptionUploads] = useState<Record<string, boolean>>({}),
    [error, setError] = useState("");
  const optionUploading = Object.values(optionUploads).some(Boolean);
  const q = g.questions[selected];
  const update = (patch: Partial<Guide>) => {
    setG({ ...g, ...patch });
    setChanged(true);
  };
  const updateQ = (patch: Partial<Question>) => {
    const questions = g.questions.map((x, i) =>
      i === selected ? { ...x, ...patch } : x,
    );
    update({
      questions,
      sections: g.sections?.filter((s) =>
        questions.some((q) => q.section === s.name),
      ),
    });
  };
  return (
    <div className="guide-layout">
      <section className="panel guide-editor">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">THE STARTING POINT</span>
            <h2>Shape your conversation</h2>
          </div>
          <span className="badge draft">
            {changed ? "Unsaved changes" : "Draft saved"}
          </span>
        </div>
        <label>
          Study name
          <input
            value={g.title}
            onChange={(e) => update({ title: e.target.value })}
          />
        </label>
        <label>
          Research objective
          <textarea
            rows={3}
            value={g.goal}
            onChange={(e) => update({ goal: e.target.value })}
          />
        </label>
        <label>
          Who do you want to hear from?
          <input
            value={g.audience}
            onChange={(e) => update({ audience: e.target.value })}
          />
        </label>
        <label>
          Admission limit
          <input
            type="number"
            min={1}
            max={500}
            value={g.limit}
            onChange={(e) => update({ limit: Number(e.target.value) })}
          />
        </label>
        <label>
          Participant introduction
          <textarea
            rows={3}
            value={g.intro}
            onChange={(e) => update({ intro: e.target.value })}
          />
        </label>
        <section className="panel">
          <h3>Confidentiality acknowledgement</h3>
          <p>
            Require participants to acknowledge your team’s approved text before
            starting. This records an acknowledgement, without an electronic
            signature service. Researcher previews bypass this step and record
            no acknowledgement.
          </p>
          <label className="consent-check">
            <input
              type="checkbox"
              checked={!!g.confidentiality}
              onChange={(e) =>
                update({
                  confidentiality: e.target.checked
                    ? { title: "Confidentiality acknowledgement", text: "" }
                    : null,
                })
              }
            />
            Require acknowledgement
          </label>
          {g.confidentiality && (
            <>
              <label>
                Confidentiality title
                <input
                  maxLength={160}
                  value={g.confidentiality.title}
                  onChange={(e) =>
                    update({
                      confidentiality: {
                        ...g.confidentiality!,
                        title: e.target.value,
                      },
                    })
                  }
                />
              </label>
              <label>
                Confidentiality text
                <textarea
                  rows={8}
                  maxLength={6000}
                  value={g.confidentiality.text}
                  onChange={(e) =>
                    update({
                      confidentiality: {
                        ...g.confidentiality!,
                        text: e.target.value,
                      },
                    })
                  }
                />
              </label>
              <p className="muted">
                20–6,000 characters. Publish to apply changes to new
                participants. Review translations before publishing.
              </p>
            </>
          )}
        </section>
        <ConceptEditor
          studyId={study.id}
          guide={g}
          onChange={update}
          onBusy={(busy) =>
            setOptionUploads((current) => ({
              ...current,
              "concept-media": busy,
            }))
          }
        />
        {!g.conceptTest && (
          <ConceptImageLibrary
            studyId={study.id}
            usedIds={[
              ...g.questions.flatMap((q) =>
                [...q.options, ...(q.maxdiff?.items || [])].map(
                  (o) => o.imageAssetId,
                ),
              ),
            ].filter((id): id is string => !!id)}
            refreshKey={JSON.stringify(
              g.questions.map((q) =>
                [...q.options, ...(q.maxdiff?.items || [])].map(
                  (o) => o.imageAssetId,
                ),
              ),
            )}
          />
        )}
        <div className="guide-section-title">
          <h3>
            Discussion guide <span className="count">{g.questions.length}</span>
          </h3>
          <button
            className="text-button"
            onClick={() => {
              const questions = [
                ...g.questions,
                {
                  id: crypto.randomUUID(),
                  type: "open" as const,
                  text: "What would you like to ask?",
                  section: "Discussion",
                  options: [],
                  followUps: 1,
                  instructions: "",
                  condition: null,
                },
              ];
              update({ questions });
              setSelected(questions.length - 1);
            }}
          >
            <Plus size={15} /> Add question
          </button>
        </div>
        <div className="question-list">
          {g.questions.map((x, i) => (
            <button
              className={
                selected === i
                  ? "question-summary selected"
                  : "question-summary"
              }
              key={x.id}
              onClick={() => setSelected(i)}
            >
              <span className="question-number">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>
                <small>
                  {x.section} ·{" "}
                  {x.type === "open"
                    ? "Open-ended"
                    : x.type === "choice"
                      ? "Single select"
                      : {
                          multiple: "Multiple select",
                          rating: "Rating",
                          ranking: "Ranking",
                          matrix: "Matrix",
                          pricing: "Gabor–Granger pricing",
                          maxdiff: "MaxDiff",
                          cardsort: "Card sort",
                          emotion: "Feeling check-in",
                          statement: "Statement",
                        }[x.type]}
                </small>
                {x.text}
              </span>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
        <div className="sticky-actions">
          <button
            className="button primary"
            disabled={busy || optionUploading || !changed}
            onClick={() => save(g)}
          >
            <Save size={16} /> Save changes
          </button>
          <button
            className="button"
            disabled={busy || optionUploading || changed}
            onClick={publish}
          >
            <Upload size={16} /> Publish revision
          </button>
          <small>
            {changed
              ? "Save before publishing."
              : "Publishing does not open fielding."}
          </small>
        </div>
      </section>
      <aside className="guide-side">
        <section className="panel question-detail">
          <div className="panel-heading">
            <h3>Question {selected + 1}</h3>
            <div className="inline">
              <button
                className="icon-button"
                title="Move question up"
                aria-label="Move question up"
                disabled={selected === 0}
                onClick={() => {
                  const qs = [...g.questions];
                  [qs[selected - 1], qs[selected]] = [
                    qs[selected],
                    qs[selected - 1],
                  ];
                  update({ questions: qs });
                  setSelected(selected - 1);
                }}
              >
                <ArrowLeft size={15} />
              </button>
              <button
                className="icon-button danger"
                aria-label="Delete question"
                disabled={g.questions.length === 1}
                onClick={() => {
                  update({
                    questions: g.questions.filter((_, i) => i !== selected),
                  });
                  setSelected(Math.max(0, selected - 1));
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          <label>
            Question type
            <select
              aria-label="Question type"
              value={q.type}
              onChange={(e) =>
                updateQ({
                  type: e.target.value as Question["type"],
                  cardsort:
                    e.target.value === "cardsort"
                      ? {
                          cards: [
                            "Invite a teammate",
                            "Review evidence",
                            "Export a report",
                          ].map((text) => ({ id: crypto.randomUUID(), text })),
                          groups: ["Team management", "Research work"].map(
                            (text) => ({ id: crypto.randomUUID(), text }),
                          ),
                          randomizeCards: true,
                          randomizeGroups: false,
                          allowUncertain: true,
                          askReason: true,
                        }
                      : null,
                  maxdiff:
                    e.target.value === "maxdiff"
                      ? {
                          items: [
                            "Fast setup",
                            "Clear evidence",
                            "Team collaboration",
                            "Flexible exports",
                          ].map((text) => ({ id: crypto.randomUUID(), text })),
                          setSize: 3,
                          cycles: 1,
                        }
                      : null,
                  participantPPTX:
                    e.target.value === "open" ? q.participantPPTX : false,
                  participantDOCX:
                    e.target.value === "open" ? q.participantDOCX : false,
                  participantPDFs:
                    e.target.value === "open" ? q.participantPDFs : false,
                  participantDOCXAI:
                    e.target.value === "open" ? q.participantDOCXAI : false,
                  participantPPTXAI:
                    e.target.value === "open" ? q.participantPPTXAI : false,
                  participantPDFAI:
                    e.target.value === "open" ? q.participantPDFAI : false,
                  participantImages:
                    e.target.value === "open" ? q.participantImages : false,
                  participantImageAI:
                    e.target.value === "open" ? q.participantImageAI : false,
                  pricing:
                    e.target.value === "pricing"
                      ? {
                          prices: [1000, 2000, 3000, 4000, 5000],
                          currency: "USD",
                          unit: "per month",
                          askReason: true,
                        }
                      : null,
                  followUps: [
                    "pricing",
                    "maxdiff",
                    "cardsort",
                    "emotion",
                  ].includes(e.target.value)
                    ? 0
                    : q.followUps,
                  options:
                    ["choice", "multiple", "ranking", "matrix"].includes(
                      e.target.value,
                    ) && q.options.length < 2
                      ? [
                          {
                            id: crypto.randomUUID(),
                            text: "Yes",
                            rejects: false,
                          },
                          {
                            id: crypto.randomUUID(),
                            text: "No",
                            rejects: false,
                          },
                        ]
                      : ["pricing", "maxdiff", "cardsort", "emotion"].includes(
                            e.target.value,
                          )
                        ? []
                        : q.options.map((o) => ({
                            ...o,
                            imageAssetId: [
                              "choice",
                              "multiple",
                              "ranking",
                            ].includes(e.target.value)
                              ? o.imageAssetId
                              : null,
                            imageAlt: [
                              "choice",
                              "multiple",
                              "ranking",
                            ].includes(e.target.value)
                              ? o.imageAlt
                              : "",
                            rejects:
                              e.target.value === "choice" ? o.rejects : false,
                          })),
                  task: null,
                  carryForward: null,
                  selection: null,
                  scale: e.target.value === "emotion" ? null : q.scale,
                  randomizeOptions:
                    e.target.value === "emotion" ? false : q.randomizeOptions,
                })
              }
            >
              <option value="open">Open-ended</option>
              <option value="choice">Single select</option>
              <option value="multiple">Multiple select</option>
              <option value="rating">Rating scale</option>
              <option value="emotion">
                Feeling check-in (optional self-report)
              </option>
              <option value="cardsort">Closed card sort</option>
              <option value="maxdiff">MaxDiff best / worst</option>
              <option value="pricing">Gabor–Granger pricing</option>
              <option value="ranking">Ranking</option>
              <option value="matrix">Rating matrix</option>
              <option value="statement">Statement / instructions</option>
            </select>
          </label>
          <label>
            Section
            <input
              value={q.section}
              onChange={(e) => updateQ({ section: e.target.value })}
            />
          </label>
          <label>
            Question wording
            <textarea
              rows={4}
              value={q.text}
              onChange={(e) => updateQ({ text: e.target.value })}
            />
          </label>
          {q.type === "open" && (
            <section className="panel">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={!!q.participantImages}
                  onChange={(e) =>
                    updateQ({
                      participantImages: e.target.checked,
                      participantImageAI: e.target.checked
                        ? q.participantImageAI
                        : false,
                    })
                  }
                />
                Allow optional participant image attachment
              </label>
              <p className="muted">
                One private PNG, JPEG or WebP image per answer, up to 2 MB, with
                a participant description. Metadata is removed. Participants can
                answer without uploading. AI image review requires the setting
                below and separate participant permission.
              </p>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={Boolean(q.participantPDFs)}
                  onChange={(e) =>
                    updateQ({
                      participantPDFs: e.target.checked,
                      participantPDFAI: e.target.checked
                        ? q.participantPDFAI
                        : false,
                    })
                  }
                />
                Allow optional participant PDF attachment
              </label>
              <p className="muted">
                Private PDF uploads up to 3 MB and 20 pages, with prepared
                static pages and researcher review. AI interview follow-ups
                require the setting below and separate participant permission.
              </p>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={!!q.participantPPTX}
                  onChange={(e) =>
                    updateQ({
                      participantPPTX: e.target.checked,
                      participantPPTXAI: e.target.checked
                        ? q.participantPPTXAI
                        : false,
                    })
                  }
                />
                Allow optional participant PPTX attachment
              </label>
              <p className="muted">
                PPTX uploads up to 3 MB become private prepared slide text.
                Original files, notes, images, master text and hidden content
                are omitted. Researchers can verify exact slide passages and
                explicitly include them in reports. Uploading invokes no AI.
                Optional interview follow-ups require the setting below and
                separate participant permission.
              </p>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={!!q.participantDOCX}
                  onChange={(e) =>
                    updateQ({
                      participantDOCX: e.target.checked,
                      participantDOCXAI: e.target.checked
                        ? q.participantDOCXAI
                        : false,
                    })
                  }
                />
                Allow optional participant DOCX attachment
              </label>
              <p className="muted">
                DOCX uploads up to 3 MB become private text snapshots. Images,
                links, comments, hidden/deleted text and original files are not
                retained. Participants give explicit sharing permission. This
                upload step sends no text to AI. Researchers can separately
                verify excerpts, include them in reports and explicitly request
                AI synthesis.
              </p>
              {q.participantDOCX && (
                <>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={!!q.participantDOCXAI}
                      onChange={(e) =>
                        updateQ({
                          participantDOCXAI: e.target.checked,
                          followUps: e.target.checked
                            ? Math.max(1, q.followUps)
                            : q.followUps,
                        })
                      }
                    />
                    Allow optional AI DOCX follow-up (OpenAI)
                  </label>
                  <p className="muted">
                    With separate participant permission, up to 1,000 prepared
                    characters from each of the first 20 paragraphs are sent
                    with the answer and description. Questions must quote an
                    exact supplied paragraph excerpt. DOCX takes priority over
                    PDF and image follow-ups when several uploads are permitted.
                    Erasure removes derived questions and reports.
                  </p>
                </>
              )}
              {q.participantPPTX && (
                <>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={!!q.participantPPTXAI}
                      onChange={(e) =>
                        updateQ({
                          participantPPTXAI: e.target.checked,
                          followUps: e.target.checked
                            ? Math.max(1, q.followUps)
                            : q.followUps,
                        })
                      }
                    />
                    Allow optional AI PPTX follow-up (OpenAI)
                  </label>
                  <p className="muted">
                    With separate participant permission, up to 1,000 prepared
                    characters from each of the first 20 slides are sent with
                    the answer and description. Questions must quote an exact
                    supplied slide excerpt. PPTX takes priority over DOCX, PDF
                    and image follow-ups when several uploads are permitted.
                    Erasure removes derived questions and reports.
                  </p>
                </>
              )}
              {q.participantPDFs && (
                <>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={!!q.participantPDFAI}
                      onChange={(e) =>
                        updateQ({
                          participantPDFAI: e.target.checked,
                          followUps: e.target.checked
                            ? Math.max(1, q.followUps)
                            : q.followUps,
                        })
                      }
                    />
                    Allow optional AI PDF follow-up (OpenAI)
                  </label>
                  <p className="muted">
                    Only separately permitted uploads are extracted for AI
                    interview questions. Up to 1,000 characters per page are
                    sent, with page-cited questions checked against the
                    extracted text. PDFs take priority when both image and PDF
                    AI review are permitted. Deleting an analyzed PDF clears its
                    derived questions and study reports.
                  </p>
                </>
              )}
              {q.participantImages && (
                <>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={!!q.participantImageAI}
                      onChange={(e) =>
                        updateQ({
                          participantImageAI: e.target.checked,
                          followUps: e.target.checked
                            ? Math.max(1, q.followUps)
                            : q.followUps,
                        })
                      }
                    />
                    Allow optional AI image follow-up (OpenAI)
                  </label>
                  <p className="muted">
                    Only separately permitted uploads are sent to OpenAI. One
                    image-grounded question may be asked within the follow-up
                    limit. Treat visual anchors as model proposals to review.
                    Deleting an analyzed image clears derived questions and
                    saved study analyses/reports.
                  </p>
                </>
              )}
            </section>
          )}
          {q.type === "emotion" && (
            <p className="notice">
              Optional self-report: fixed feeling labels in English, Spanish and
              French, optional intensity and a written note. Participants can
              always decline. No emotion is inferred from recordings or text,
              and no AI follow-up is asked.
            </p>
          )}
          {q.type === "open" && (
            <section className="task-settings">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={!!q.task}
                  onChange={(e) =>
                    updateQ({
                      task: e.target.checked ? { maxSeconds: 300 } : null,
                      followUps: 0,
                    })
                  }
                />
                Usability task with optional screen recording
              </label>
              {q.task && (
                <>
                  <label>
                    Task website (optional HTTPS link)
                    <input
                      type="url"
                      value={q.task.url || ""}
                      onChange={(e) =>
                        updateQ({
                          task: {
                            ...q.task!,
                            url: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    Recording limit (seconds)
                    <input
                      type="number"
                      min={30}
                      max={600}
                      value={q.task.maxSeconds}
                      onChange={(e) =>
                        updateQ({
                          task: {
                            ...q.task!,
                            maxSeconds: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <p className="small muted">
                    Use the question wording as the task prompt. Participants
                    share a screen or tab and microphone, then add a written
                    reflection. Follow-ups must be zero.
                  </p>
                </>
              )}
            </section>
          )}
          {q.type === "open" && (
            <>
              <label>
                Follow-up depth
                <select
                  disabled={!!q.task}
                  value={q.followUps}
                  onChange={(e) =>
                    updateQ({ followUps: Number(e.target.value) })
                  }
                >
                  <option value={0}>None — keep moving</option>
                  <option value={1}>One follow-up</option>
                  <option value={2}>Up to two follow-ups</option>
                </select>
              </label>
              <label>
                Probing instructions
                <textarea
                  rows={2}
                  value={q.instructions}
                  onChange={(e) => updateQ({ instructions: e.target.value })}
                  placeholder="What should the interviewer explore?"
                />
              </label>
            </>
          )}
          {hasOptions(q) && !q.carryForward && (
            <div className="options-editor">
              <label>
                {q.type === "matrix"
                  ? "Matrix rows"
                  : q.type === "ranking"
                    ? "Items to rank"
                    : "Answer options"}
              </label>
              {q.options.map((o, i) => (
                <div className="option-item" key={q.id + ":" + o.id}>
                  <div className="option-edit">
                    <input
                      aria-label={"Option " + (i + 1)}
                      value={o.text}
                      onChange={(e) =>
                        updateQ({
                          options: q.options.map((v) =>
                            v.id === o.id ? { ...v, text: e.target.value } : v,
                          ),
                        })
                      }
                    />
                    {q.type === "choice" && (
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={o.rejects}
                          onChange={(e) =>
                            updateQ({
                              options: q.options.map((v) =>
                                v.id === o.id
                                  ? { ...v, rejects: e.target.checked }
                                  : v,
                              ),
                            })
                          }
                        />{" "}
                        Screen out
                      </label>
                    )}
                    <button
                      className="icon-button"
                      aria-label={"Remove option " + (i + 1)}
                      onClick={() =>
                        updateQ({
                          options: q.options.filter((v) => v.id !== o.id),
                        })
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                  {["choice", "multiple", "ranking"].includes(q.type) && (
                    <details className="answer-image-editor">
                      <summary>
                        Answer image for option {i + 1}
                        {o.imageAssetId ? " · Uploaded" : ""}
                      </summary>
                      <p className="small muted">
                        Optional private PNG, JPEG or WebP, up to 2 MB. Keep a
                        visible text label and describe any information needed
                        to choose this answer.
                      </p>
                      <ConceptImageUpload
                        studyId={study.id}
                        assetId={o.imageAssetId}
                        alt={o.imageAlt || o.text}
                        purpose="answer"
                        onBusy={(busy) =>
                          setOptionUploads((current) => ({
                            ...current,
                            [q.id + ":" + o.id]: busy,
                          }))
                        }
                        onImage={(id) => {
                          setG((current) => ({
                            ...current,
                            questions: current.questions.map((question) =>
                              question.id === q.id
                                ? {
                                    ...question,
                                    options: question.options.map((option) =>
                                      option.id === o.id
                                        ? { ...option, imageAssetId: id }
                                        : option,
                                    ),
                                  }
                                : question,
                            ),
                          }));
                          setChanged(true);
                        }}
                      />
                      {o.imageAssetId && (
                        <label>
                          Answer image description
                          <textarea
                            aria-label="Answer image description"
                            maxLength={500}
                            value={o.imageAlt || ""}
                            onChange={(e) =>
                              updateQ({
                                options: q.options.map((v) =>
                                  v.id === o.id
                                    ? { ...v, imageAlt: e.target.value }
                                    : v,
                                ),
                              })
                            }
                          />
                        </label>
                      )}
                    </details>
                  )}
                </div>
              ))}
              <button
                className="text-button"
                onClick={() =>
                  updateQ({
                    options: [
                      ...q.options,
                      {
                        id: crypto.randomUUID(),
                        text: "New option",
                        rejects: false,
                      },
                    ],
                  })
                }
              >
                <Plus size={14} /> Add option
              </button>
            </div>
          )}
          {g.conceptTest && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={!!q.conceptQuestion}
                onChange={(e) => updateQ({ conceptQuestion: e.target.checked })}
              />
              Repeat for each assigned concept
            </label>
          )}
          {q.type === "cardsort" && q.cardsort && (
            <CardsortSettings question={q} onChange={updateQ} />
          )}
          {q.type === "maxdiff" && q.maxdiff && (
            <MaxdiffSettings
              question={q}
              onChange={updateQ}
              studyId={study.id}
              onBusy={(id, busy) =>
                setOptionUploads((current) => ({
                  ...current,
                  [q.id + ":" + id]: busy,
                }))
              }
              onImage={(id, assetId) => {
                setG((current) => ({
                  ...current,
                  questions: current.questions.map((question) =>
                    question.id === q.id && question.maxdiff
                      ? {
                          ...question,
                          maxdiff: {
                            ...question.maxdiff,
                            items: question.maxdiff.items.map((item) =>
                              item.id === id
                                ? { ...item, imageAssetId: assetId }
                                : item,
                            ),
                          },
                        }
                      : question,
                  ),
                }));
                setChanged(true);
              }}
            />
          )}
          {q.type === "pricing" && q.pricing && (
            <PricingSettings key={q.id} question={q} onChange={updateQ} />
          )}
          <MixedSettings
            guide={g}
            question={q}
            index={selected}
            onQuestion={updateQ}
            onGuide={update}
          />
          <label>
            Show this question
            <select
              value={
                q.condition
                  ? q.condition.questionId + ":" + q.condition.optionId
                  : ""
              }
              onChange={(e) => {
                const v = e.target.value;
                const earlier = g.questions
                  .slice(0, selected)
                  .find((x) => x.options.some((o) => x.id + ":" + o.id === v));
                updateQ({
                  condition: earlier
                    ? {
                        questionId: earlier.id,
                        optionId: earlier.options.find(
                          (o) => earlier.id + ":" + o.id === v,
                        )!.id,
                      }
                    : null,
                });
              }}
            >
              <option value="">To everyone</option>
              {g.questions
                .slice(0, selected)
                .filter(
                  (x) =>
                    ["choice", "multiple"].includes(x.type) && !x.carryForward,
                )
                .flatMap((x) =>
                  x.options.map((o) => (
                    <option key={x.id + o.id} value={x.id + ":" + o.id}>
                      If {x.text.slice(0, 30)} → {o.text}
                    </option>
                  )),
                )}
            </select>
          </label>
        </section>
        <GuideAdvisor
          guide={g}
          select={(id) =>
            setSelected(g.questions.findIndex((q) => q.id === id))
          }
        />
        <section className="ai-card">
          <Sparkles size={22} />
          <h3>A thoughtful first draft.</h3>
          <p>
            Generate a guide from your saved objective, then review every
            question before applying it.
          </p>
          {!ai && (
            <span className="small-status">AI provider not connected</span>
          )}
          {error && <Notice>{error}</Notice>}
          <button
            className="button full"
            disabled={!ai || generating || changed}
            onClick={async () => {
              setGenerating(true);
              setError("");
              try {
                setCandidate((await generate()).guide);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setGenerating(false);
              }
            }}
          >
            {generating ? <Spinner /> : <Sparkles size={15} />} Draft with AI
          </button>
        </section>
        <div className="side-note">
          <ShieldCheck size={17} />
          <p>
            Published revisions stay fixed for interviews already underway.
            Preview responses never count toward your study.
          </p>
        </div>
      </aside>
      {candidate && (
        <Modal title="Review your AI draft" onClose={() => setCandidate(null)}>
          <p>{candidate.goal}</p>
          {g.questions.some((q) => q.task) && (
            <p>
              Applying this conversation guide replaces the current usability
              task settings. Configure tasks again before saving.
            </p>
          )}
          {g.conceptTest && (
            <p>
              Applying this conversation guide replaces the current concept
              setup. You can configure concepts again before saving.
            </p>
          )}
          <ol className="draft-preview">
            {candidate.questions.map((x) => (
              <li key={x.id}>{x.text}</li>
            ))}
          </ol>
          <div className="modal-actions">
            <button className="button" onClick={() => setCandidate(null)}>
              Discard
            </button>
            <button
              className="button primary"
              onClick={() => {
                setG(candidate);
                setChanged(true);
                setSelected(0);
                setCandidate(null);
              }}
            >
              Apply to draft
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Fielding({
  detail,
  busy,
  change,
}: {
  detail: Detail;
  busy: boolean;
  change: (state: string) => void;
}) {
  const [copied, setCopied] = useState(false),
    [mode, setMode] = useState<"open" | "invitation_only">("open"),
    [url, setUrl] = useState("");
  useEffect(
    () => setUrl(location.origin + "/s/" + detail.study.id),
    [detail.study.id],
  );
  const s = detail.study;
  return (
    <div className="two-columns">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">INVITE THE RIGHT PEOPLE</div>
            <h2>Take your study into the field.</h2>
          </div>
          <span className={"badge " + s.fielding}>
            {s.fielding === "active" ? "In the field" : s.fielding}
          </span>
        </div>
        <p className="muted">
          Share the participant link with your own audience. You control who you
          invite.
        </p>
        {!s.revisionId ? (
          <Notice>
            Publish a guide in Study design before opening fielding.
          </Notice>
        ) : (
          <>
            {mode === "invitation_only" ? (
              <Notice>
                Use the individual invitation links below. The general study
                link cannot start a new interview.
              </Notice>
            ) : (
              <label>
                Participant link
                <div className="copy-field">
                  <input value={url} readOnly aria-label="Participant link" />
                  <button
                    className="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(url);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </label>
            )}
            <div className="fielding-actions">
              <button
                disabled={busy || s.fielding === "active"}
                className="button primary"
                onClick={() => change("active")}
              >
                <Play size={16} /> Open fielding
              </button>
              <button
                disabled={busy || s.fielding !== "active"}
                className="button"
                onClick={() => change("paused")}
              >
                <Pause size={16} /> Pause
              </button>
              <button
                disabled={busy || s.fielding === "closed"}
                className="button"
                onClick={() => change("closed")}
              >
                Close study
              </button>
            </div>
          </>
        )}
        <div className="template-note">
          <ShieldCheck size={20} />
          <p>
            Pausing or closing stops new interviews. People already admitted can
            finish. Each participant stays on the revision they started.
          </p>
        </div>
      </section>
      <section className="panel">
        <h3>Fielding snapshot</h3>
        <dl className="snapshot">
          <div>
            <dt>Completed</dt>
            <dd>{detail.counts.complete}</dd>
          </div>
          <div>
            <dt>In progress</dt>
            <dd>{detail.counts.active}</dd>
          </div>
          <div>
            <dt>Screened out</dt>
            <dd>{detail.counts.screenedOut}</dd>
          </div>
          <div>
            <dt>Included in analysis</dt>
            <dd>{detail.counts.included}</dd>
          </div>
        </dl>
        <label>
          Admission limit
          <input
            type="number"
            value={
              detail.revisions.find((r) => r.id === s.revisionId)?.guide
                .limit ?? s.draft.limit
            }
            readOnly
          />
        </label>
        <p className="muted small">
          The published guide’s limit reserves a place for each active or
          completed interview. Screen-outs release their place.
        </p>
      </section>
      <InvitationEmailPanel
        key={"email:" + s.id}
        studyId={s.id}
        dataVersion={s.dataVersion}
      />
      <IncentivesPanel key={s.id} studyId={s.id} dataVersion={s.dataVersion} />
      <RecruitmentPanel
        studyId={s.id}
        dataVersion={s.dataVersion}
        studyVersion={s.version}
        onMode={setMode}
      />
      <BrandingPanel key={s.id + ":branding"} studyId={s.id} />
      <QuotaPanel key={s.id + ":quotas"} studyId={s.id} />
      <SurveyHandoffPanel key={s.id} studyId={s.id} />
      <SurveyHandoffPanel
        key={s.id + ":rally"}
        studyId={s.id}
        provider="rally"
      />
      <SurveyHandoffPanel
        key={s.id + ":forsta"}
        studyId={s.id}
        provider="forsta"
      />
    </div>
  );
}
function Responses({
  detail,
  refresh,
  onError,
}: {
  detail: Detail;
  refresh: () => Promise<void>;
  onError: (s: string) => void;
}) {
  const [selected, setSelected] = useState<Interview | null>(null),
    [filter, setFilter] = useState("all"),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("interview"),
      turn = params.get("turn");
    if (id) {
      const i = detail.interviews.find((i) => i.id === id);
      if (i) {
        setSelected(i);
        setReason(i.exclusionReason);
        if (turn)
          setTimeout(
            () =>
              document
                .getElementById("turn-" + turn)
                ?.scrollIntoView({ block: "start" }),
            100,
          );
      }
    }
  }, [detail]);
  const rows = detail.interviews.filter(
    (i) =>
      filter === "all" ||
      (filter === "excluded" ? i.excluded : i.status === filter),
  );
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Every voice, in context.</h2>
          <p className="muted">
            Review the conversation before drawing conclusions.
          </p>
        </div>
        <button className="button" onClick={refresh}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>
      <div className="filter-tabs">
        {[
          "all",
          "complete",
          "active",
          "screened_out",
          "withdrawn",
          "excluded",
        ].map((f) => (
          <button
            key={f}
            className={filter === f ? "active" : ""}
            onClick={() => setFilter(f)}
          >
            {f.replaceAll("_", " ")}
          </button>
        ))}
      </div>
      {!rows.length ? (
        <div className="empty-state compact">
          <MessageSquare size={28} />
          <h3>No responses here yet.</h3>
          <p>
            Open fielding and invite participants to start the conversation.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Participant</th>
                <th>Status</th>
                <th>Answers</th>
                <th>Started</th>
                <th>Analysis</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => {
                        setSelected(i);
                        setReason(i.exclusionReason);
                      }}
                    >
                      Participant{" "}
                      {detail.interviews.length - detail.interviews.indexOf(i)}
                    </button>
                    <small className="mono">{i.id.slice(0, 8)}</small>
                    {i.origin && (
                      <span className="badge">External transcript</span>
                    )}
                  </td>
                  <td>
                    <span
                      className={
                        "badge " +
                        (i.status === "complete" ? "active" : "draft")
                      }
                    >
                      {i.status.replaceAll("_", " ")}
                    </span>
                    {i.screenOutReason && (
                      <small>
                        {i.screenOutReason === "quota_full"
                          ? "Quota group full"
                          : i.screenOutReason === "quota_minimum"
                            ? "Places protected for quota targets"
                            : "No quota group matched"}
                      </small>
                    )}
                  </td>
                  <td>{i.turns.length}</td>
                  <td>{new Date(i.createdAt).toLocaleDateString()}</td>
                  <td>{i.excluded ? "Excluded" : "Included"}</td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label="View transcript"
                      onClick={() => {
                        setSelected(i);
                        setReason(i.exclusionReason);
                      }}
                    >
                      <ArrowUpRight size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && (
        <Modal title="Response transcript" onClose={() => setSelected(null)}>
          <div className="transcript-meta">
            <span className="mono">{selected.id.slice(0, 8)}</span>
            <span>{selected.status.replaceAll("_", " ")}</span>
            <span>
              {selected.origin
                ? "Import permission attested"
                : "Consent recorded"}{" "}
              {new Date(selected.consentAt).toLocaleDateString()}
            </span>
          </div>
          {selected.screenOutReason && (
            <Notice>
              {selected.screenOutReason === "quota_full"
                ? "Screened out: a matching quota group was full."
                : selected.screenOutReason === "quota_minimum"
                  ? "Screened out: remaining places are protected for quota targets."
                  : "Screened out: no required quota group matched."}
            </Notice>
          )}
          {selected.confidentialityAcknowledgement && (
            <section className="panel">
              <h3>Confidentiality acknowledgement</h3>
              <h4>{selected.confidentialityAcknowledgement.title}</h4>
              <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {selected.confidentialityAcknowledgement.text}
              </p>
              <p>
                Accepted{" "}
                {new Date(
                  selected.confidentialityAcknowledgement.acceptedAt,
                ).toLocaleString()}{" "}
                · {selected.confidentialityAcknowledgement.language}
              </p>
              <p className="muted" style={{ overflowWrap: "anywhere" }}>
                Revision: {selected.confidentialityAcknowledgement.revisionId}
                <br />
                Version: {selected.confidentialityAcknowledgement.version}
              </p>
            </section>
          )}
          {selected.videoViews && (
            <section className="panel">
              <h3>Video viewing</h3>
              {Object.entries(selected.videoViews).map(([id, v]) => (
                <p key={id}>
                  {selected.guide.conceptTest?.concepts.find((c) => c.id === id)
                    ?.name || id}
                  :{" "}
                  {v.alternativeAt !== undefined
                    ? "Participant chose replayable viewing"
                    : v.skippedAt !== undefined
                      ? "Participant continued without video"
                      : v.endedAt !== undefined
                        ? "Browser reported video ended"
                        : v.endsAt !== undefined && Date.now() >= v.endsAt
                          ? "Viewing window expired"
                          : "Viewing window started"}
                  {v.startedAt
                    ? " · " + new Date(v.startedAt).toLocaleString()
                    : ""}
                </p>
              ))}
            </section>
          )}
          {selected.conceptExposures && (
            <section className="panel">
              <h3>Concept presentation</h3>
              {Object.entries(selected.conceptExposures).map(
                ([id, exposure]) => (
                  <p key={id}>
                    {selected.guide.conceptTest?.concepts.find(
                      (c) => c.id === id,
                    )?.name || id}
                    :{" "}
                    {exposure.untimedAt !== undefined
                      ? "Participant chose untimed view"
                      : "Timed window started"}
                    {exposure.startedAt
                      ? " · " + new Date(exposure.startedAt).toLocaleString()
                      : ""}
                  </p>
                ),
              )}
            </section>
          )}
          {selected.origin && (
            <Notice>
              External transcript: {selected.origin.title} ·{" "}
              {selected.origin.externalId}. Permission and transcript review
              attested by {selected.origin.importedBy}. Review speaker labels
              before quoting. Open Research Library for imported video playback.
            </Notice>
          )}
          <ScreenPlayback
            key={selected.id}
            studyId={detail.study.id}
            interviewId={selected.id}
          />
          <div className="transcript">
            {selected.turns.map((t) => (
              <article key={t.id} id={"turn-" + t.id}>
                <div className="turn-label">
                  {t.followUp ? "FOLLOW-UP" : "INTERVIEWER"} · {t.strategy}
                </div>
                {t.conceptId && (
                  <span className="badge">
                    {selected.guide.conceptTest?.concepts.find(
                      (c) => c.id === t.conceptId,
                    )?.name || t.conceptId}
                  </span>
                )}
                <h4>{t.prompt}</h4>
                <p>{t.answer}</p>
                {t.docxProbe && (
                  <section className="panel">
                    <h4>DOCX-aware AI follow-up</h4>
                    <p>
                      Status: {t.docxProbe.status} · Model: {t.docxProbe.model}
                    </p>
                    {t.docxProbe.rejectionReason && (
                      <p>
                        Question rejected:{" "}
                        {t.docxProbe.rejectionReason.replaceAll("_", " ")}
                      </p>
                    )}
                    {t.docxProbe.quote && (
                      <blockquote>
                        DOCX paragraph {t.docxProbe.paragraph}:{" "}
                        {t.docxProbe.quote}
                      </blockquote>
                    )}
                    {t.docxProbe.probe && <p>{t.docxProbe.probe}</p>}
                    <p className="muted">
                      DOCX {t.docxProbe.docxId} · Prompt{" "}
                      {t.docxProbe.promptVersion} · Permission{" "}
                      {t.docxProbe.permissionVersion} ·{" "}
                      {t.docxProbe.generatedAt}
                    </p>
                    <details>
                      <summary>DOCX question source provenance</summary>
                      <p style={{ overflowWrap: "anywhere" }}>
                        Prepared snapshot SHA-256:{" "}
                        {t.docxProbe.snapshotSha256 || "Unavailable"}
                      </p>
                      <p>
                        Paragraphs considered:{" "}
                        {t.docxProbe.paragraphsConsidered?.join(", ") || "None"}
                      </p>
                      <p>
                        References identify prepared text, not Word pages or
                        verified facts. Compare the cited paragraph before
                        relying on the question.
                      </p>
                    </details>
                    {t.docxProbe.contextTruncated && (
                      <p className="muted">
                        Paragraph excerpts were shortened to the interview
                        context limit.
                      </p>
                    )}
                  </section>
                )}
                {t.pptxProbe && (
                  <section className="panel">
                    <h4>PPTX-aware AI follow-up</h4>
                    <p>
                      Status: {t.pptxProbe.status} · Model: {t.pptxProbe.model}
                    </p>
                    {t.pptxProbe.rejectionReason && (
                      <p>
                        Question rejected:{" "}
                        {t.pptxProbe.rejectionReason.replaceAll("_", " ")}
                      </p>
                    )}
                    {t.pptxProbe.quote && (
                      <blockquote>
                        PPTX slide {t.pptxProbe.slide}: {t.pptxProbe.quote}
                      </blockquote>
                    )}
                    {t.pptxProbe.probe && <p>{t.pptxProbe.probe}</p>}
                    <p className="muted">
                      PPTX {t.pptxProbe.pptxId} · Prompt{" "}
                      {t.pptxProbe.promptVersion} · Permission{" "}
                      {t.pptxProbe.permissionVersion} ·{" "}
                      {t.pptxProbe.generatedAt}
                    </p>
                    <details>
                      <summary>PPTX question source provenance</summary>
                      <p style={{ overflowWrap: "anywhere" }}>
                        Prepared snapshot SHA-256:{" "}
                        {t.pptxProbe.snapshotSha256 || "Unavailable"}
                      </p>
                      <p>
                        Slides considered:{" "}
                        {t.pptxProbe.slidesConsidered?.join(", ") || "None"}
                      </p>
                      <p>
                        References identify prepared text, not rendered slides
                        or verified facts. Compare the cited slide before
                        relying on the question.
                      </p>
                    </details>
                    {t.pptxProbe.contextTruncated && (
                      <p className="muted">
                        Slide excerpts were shortened to the interview context
                        limit.
                      </p>
                    )}
                  </section>
                )}
                {t.pdfProbe && (
                  <section className="panel">
                    <h4>PDF-aware AI follow-up</h4>
                    <p>
                      Status: {t.pdfProbe.status} · Model: {t.pdfProbe.model}
                    </p>
                    {t.pdfProbe.quote && (
                      <blockquote>
                        PDF page {t.pdfProbe.page}: {t.pdfProbe.quote}
                      </blockquote>
                    )}
                    {t.pdfProbe.probe && <p>{t.pdfProbe.probe}</p>}
                    <p className="muted">
                      PDF {t.pdfProbe.pdfId} · Prompt {t.pdfProbe.promptVersion}{" "}
                      · Permission {t.pdfProbe.permissionVersion} ·{" "}
                      {t.pdfProbe.generatedAt}
                    </p>
                    {t.pdfProbe.contextTruncated && (
                      <p className="muted">
                        Page excerpts were shortened to the interview context
                        limit.
                      </p>
                    )}
                  </section>
                )}
                {t.imageProbe && (
                  <section className="panel">
                    <h4>AI image follow-up provenance</h4>
                    <p>
                      Status: {t.imageProbe.status} · Configured model:{" "}
                      {t.imageProbe.model}
                    </p>
                    {t.imageProbe.visualAnchor && (
                      <p>
                        Model-reported visual anchor (review against image):{" "}
                        {t.imageProbe.visualAnchor}
                      </p>
                    )}
                    {t.imageProbe.probe && (
                      <p>Generated question: {t.imageProbe.probe}</p>
                    )}
                    <p className="muted" style={{ overflowWrap: "anywhere" }}>
                      Source image: {t.imageProbe.imageId}
                      <br />
                      Prompt: {t.imageProbe.promptVersion} · Observation:{" "}
                      {t.imageProbe.observationPromptVersion || "—"} ·
                      Permission: {t.imageProbe.permissionVersion}
                      <br />
                      Attempted{" "}
                      {new Date(t.imageProbe.generatedAt).toLocaleString()}
                      {t.imageProbe.imageSha256 && (
                        <>
                          <br />
                          PNG SHA-256: {t.imageProbe.imageSha256}
                        </>
                      )}
                    </p>
                  </section>
                )}
                {t.participantImage && (
                  <section className="panel">
                    <h4>Participant image attachment</h4>
                    <PrivateConceptImage
                      assetId={t.participantImage.id}
                      studyId={detail.study.id}
                      resource="participant-images"
                      alt={t.participantImage.description}
                      enlarge
                    />
                    <p>{t.participantImage.description}</p>
                    {t.participantImage.aiPermission && (
                      <p className="muted">
                        AI permission: {t.participantImage.aiPermission.text} ·{" "}
                        {new Date(
                          t.participantImage.aiPermission.grantedAt,
                        ).toLocaleString()}{" "}
                        · {t.participantImage.aiPermission.version}
                      </p>
                    )}
                    <p className="muted">
                      Uploaded{" "}
                      {new Date(t.participantImage.uploadedAt).toLocaleString()}{" "}
                      · {t.participantImage.width} × {t.participantImage.height}
                    </p>
                    <ImageReviewPanel
                      studyId={detail.study.id}
                      imageId={t.participantImage.id}
                    />
                    <button
                      className="button danger"
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          !confirm(
                            t.imageProbe
                              ? "Permanently delete this image, description, reviews and derived questions? Saved study analyses and reports will also be cleared."
                              : "Permanently delete this attached image, its description, extracted text, verified passages, AI-derived questions and saved study analyses/reports? Written answers are preserved.",
                          )
                        )
                          return;
                        setBusy(true);
                        try {
                          await api(
                            "studies/" +
                              detail.study.id +
                              "/participant-images/" +
                              t.participantImage!.id,
                            "DELETE",
                          );
                          setSelected(null);
                          await refresh();
                        } catch (e) {
                          onError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Delete attached image
                    </button>
                  </section>
                )}
                {t.participantPPTX && (
                  <section className="panel">
                    <h4>Participant PPTX attachment</h4>
                    <PrivatePPTX
                      assetId={t.participantPPTX.id}
                      studyId={detail.study.id}
                    />
                    <p>{t.participantPPTX.description}</p>
                    <p>
                      {t.participantPPTX.slides} slides ·{" "}
                      {t.participantPPTX.characters} characters
                    </p>
                    {t.participantPPTX.aiPermission && (
                      <p className="muted">
                        AI permission: {t.participantPPTX.aiPermission.text} ·{" "}
                        {t.participantPPTX.aiPermission.grantedAt} ·{" "}
                        {t.participantPPTX.aiPermission.language} ·{" "}
                        {t.participantPPTX.aiPermission.version}
                      </p>
                    )}
                    <PPTXReviewPanel
                      key={t.participantPPTX.id}
                      studyId={detail.study.id}
                      pptxId={t.participantPPTX.id}
                    />
                    <PPTXTextPanel
                      key={`${detail.study.id}:${t.participantPPTX.id}`}
                      studyId={detail.study.id}
                      pptxId={t.participantPPTX.id}
                    />
                    <button
                      className="button danger"
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          !confirm(
                            "Permanently delete this PPTX text, description, permission, derived questions, review and passage verification history, and saved study analyses/reports? Written answers are preserved.",
                          )
                        )
                          return;
                        setBusy(true);
                        try {
                          await api(
                            `studies/${detail.study.id}/participant-pptx/${t.participantPPTX!.id}`,
                            "DELETE",
                          );
                          setSelected(null);
                          await refresh();
                        } catch (e) {
                          onError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Delete attached PPTX
                    </button>
                  </section>
                )}
                {t.participantDOCX && (
                  <section className="panel">
                    <h4>Participant DOCX attachment</h4>
                    <PrivateDOCX
                      assetId={t.participantDOCX.id}
                      studyId={detail.study.id}
                    />
                    <p>{t.participantDOCX.description}</p>
                    <p>
                      {t.participantDOCX.paragraphs} paragraphs ·{" "}
                      {t.participantDOCX.characters} characters
                    </p>
                    {t.participantDOCX.aiPermission && (
                      <p className="muted">
                        AI permission: {t.participantDOCX.aiPermission.text} ·{" "}
                        {t.participantDOCX.aiPermission.grantedAt} ·{" "}
                        {t.participantDOCX.aiPermission.language} ·{" "}
                        {t.participantDOCX.aiPermission.version}
                      </p>
                    )}

                    <DOCXReviewPanel
                      key={t.participantDOCX.id}
                      studyId={detail.study.id}
                      docxId={t.participantDOCX.id}
                    />

                    <DOCXTextPanel
                      key={`${detail.study.id}:${t.participantDOCX.id}`}
                      studyId={detail.study.id}
                      docxId={t.participantDOCX.id}
                    />
                    <button
                      className="button danger"
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          !confirm(
                            "Permanently delete this DOCX text, description, permission, derived questions, review and passage verification history, and saved study analyses/reports? Written answers are preserved.",
                          )
                        )
                          return;
                        setBusy(true);
                        try {
                          await api(
                            `studies/${detail.study.id}/participant-docx/${t.participantDOCX!.id}`,
                            "DELETE",
                          );
                          setSelected(null);
                          await refresh();
                        } catch (e) {
                          onError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Delete attached DOCX
                    </button>
                  </section>
                )}
                {t.participantPPTXRemovedAt && (
                  <p className="muted">
                    PPTX attachment deleted{" "}
                    {new Date(t.participantPPTXRemovedAt).toLocaleString()}.
                  </p>
                )}
                {t.participantDOCXRemovedAt && (
                  <p className="muted">
                    DOCX attachment deleted{" "}
                    {new Date(t.participantDOCXRemovedAt).toLocaleString()}.
                  </p>
                )}
                {t.participantPDF && (
                  <section className="panel">
                    <h4>Participant PDF attachment</h4>
                    <PrivatePDF
                      assetId={t.participantPDF.id}
                      studyId={detail.study.id}
                    />
                    <p>{t.participantPDF.description}</p>
                    <p>
                      {t.participantPDF.pages} pages · Uploaded{" "}
                      {new Date(t.participantPDF.uploadedAt).toLocaleString()}
                    </p>
                    <PDFTextPanel
                      studyId={detail.study.id}
                      pdfId={t.participantPDF.id}
                    />
                    <PDFReviewPanel
                      key={t.participantPDF.id}
                      studyId={detail.study.id}
                      pdfId={t.participantPDF.id}
                    />
                    <button
                      className="button danger"
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          !confirm(
                            "Permanently delete this PDF, its description, extracted text, verified passages, AI-derived questions and saved study analyses/reports? Written answers are preserved.",
                          )
                        )
                          return;
                        setBusy(true);
                        try {
                          await api(
                            `studies/${detail.study.id}/participant-pdfs/${t.participantPDF!.id}`,
                            "DELETE",
                          );
                          setSelected(null);
                          await refresh();
                        } catch (e) {
                          onError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Delete attached PDF
                    </button>
                  </section>
                )}
                {t.participantPDFRemovedAt && (
                  <p className="muted">
                    PDF attachment deleted{" "}
                    {new Date(t.participantPDFRemovedAt).toLocaleString()}.
                  </p>
                )}
                {t.participantImageRemovedAt && (
                  <p className="muted">
                    Image attachment deleted{" "}
                    {new Date(t.participantImageRemovedAt).toLocaleString()}.
                  </p>
                )}
                {t.audioId && (
                  <audio
                    controls
                    preload="none"
                    src={"/api/recordings/" + t.audioId}
                  />
                )}
                <span className="mono small">{t.id.slice(0, 8)}</span>
              </article>
            ))}
            {!selected.turns.length && <p>No answers recorded yet.</p>}
          </div>
          <label>
            Review note / exclusion reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain the decision so your team can review it."
            />
          </label>
          <div className="modal-actions">
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                if (
                  !confirm(
                    "Permanently delete this response and its recordings? Reports and sharing will be invalidated.",
                  )
                )
                  return;
                setBusy(true);
                try {
                  await api(
                    "studies/" + detail.study.id + "/responses/" + selected.id,
                    "DELETE",
                  );
                  setSelected(null);
                  await refresh();
                } catch (e) {
                  onError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Trash2 size={15} /> Delete permanently
            </button>
            <button
              className="button"
              disabled={busy || (!selected.excluded && !reason.trim())}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(
                    "studies/" + detail.study.id + "/responses/" + selected.id,
                    "PATCH",
                    { excluded: !selected.excluded, reason },
                  );
                  setSelected(null);
                  await refresh();
                } catch (e) {
                  onError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {selected.excluded
                ? "Restore to analysis"
                : "Exclude from analysis"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
function SettingsPanel({ user, close }: { user: Actor; close: () => void }) {
  const [data, setData] = useState<any>(null),
    [invite, setInvite] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    api("me")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <Modal title="Team & workspace" onClose={close}>
      <div className="settings-identity">
        <span className="avatar">{user.name[0]}</span>
        <div>
          <h3>{user.name}</h3>
          <p>
            {user.email} · {user.role}
          </p>
        </div>
      </div>
      <h3>Connected capabilities</h3>
      <div className="connection-row">
        <Sparkles size={19} />
        <div>
          <strong>AI & speech provider</strong>
          <p>
            {data?.ai
              ? "Connected · server credentials configured"
              : "Not connected · manual research remains available"}
          </p>
        </div>
        <span className={"status-dot " + (data?.ai ? "online" : "")} />
      </div>
      {!data?.ai && (
        <p className="muted small">
          An admin can configure the server’s RESEARCH_AI_KEY securely.
          Credentials stay off the browser.
        </p>
      )}
      <h3>Team members</h3>
      {data?.members.map((m: any) => (
        <div className="member-row" key={m.id}>
          <span>
            {m.name}
            <small>{m.email}</small>
          </span>
          <span className="badge draft">{m.role}</span>
        </div>
      ))}
      {user.role === "admin" && (
        <div className="inline">
          <button
            className="button"
            onClick={async () => {
              try {
                const r = await api("invites", "POST", { role: "researcher" });
                setInvite(location.origin + "/?invite=" + r.invite);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Plus size={15} /> Invite researcher
          </button>
          <button
            className="button"
            onClick={async () => {
              try {
                const r = await api("invites", "POST", {
                  role: "collaborator",
                });
                setInvite(location.origin + "/?invite=" + r.invite);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Invite collaborator
          </button>
        </div>
      )}
      {invite && (
        <label>
          One-use invite · expires in 7 days
          <input
            readOnly
            value={invite}
            onClick={(e) => e.currentTarget.select()}
          />
        </label>
      )}
      {user.role === "admin" && <ApiKeyPanel />}
      {user.role === "admin" && <AutomationPanel />}
      {user.role === "admin" && <OAuthConnectionsPanel />}
      <h3>Provider usage</h3>
      {data?.usage.length ? (
        <table>
          <thead>
            <tr>
              <th>Operation</th>
              <th>Calls</th>
              <th>Tokens in / out</th>
            </tr>
          </thead>
          <tbody>
            {data.usage.map((u: any) => (
              <tr key={u.operation + u.model}>
                <td>
                  {u.operation}
                  <small>{u.model}</small>
                </td>
                <td>{u.requests}</td>
                <td>
                  {u.inputTokens} / {u.outputTokens}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">
          No provider calls yet. Billing totals depend on your provider’s
          current rates.
        </p>
      )}
      {error && <Notice>{error}</Notice>}
    </Modal>
  );
}
