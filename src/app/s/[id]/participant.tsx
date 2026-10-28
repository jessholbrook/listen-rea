"use client";
import ParticipantPPTXUpload from "../../participant-pptx-upload";
import DOCXPromptCitation from "../../docx-prompt-citation";
import PPTXPromptCitation from "../../pptx-prompt-citation";
import { docxAILabels } from "@/lib/participant-docx-ai";
import { pptxAILabels } from "@/lib/participant-pptx-ai";
import PDFPromptCitation from "../../pdf-prompt-citation";
import ParticipantDOCXUpload from "../../participant-docx-upload";
import ParticipantPDFUpload from "../../participant-pdf-upload";
import { copy, participantError } from "@/lib/participant-copy";
import { languageNames, type Language } from "@/lib/localization";
import { useEffect, useState, useRef, type CSSProperties } from "react";
import { brandingStyle, type ParticipantBranding } from "@/lib/branding";
import ParticipantBrand from "../../participant-brand";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ShieldCheck,
  MessageSquare,
} from "lucide-react";
import { api } from "@/lib/client";
import ParticipantImageUpload from "../../participant-image-upload";
import VoiceInput from "../../voice-input";
import ScreenCapture from "../../screen-capture";
import { pricingCopy } from "@/lib/pricing";
import CardsortInput from "../../cardsort-input";
import { cardsortFormAssignments, cardsortCopy } from "@/lib/cardsort";
import MaxdiffInput from "../../maxdiff-input";
import MixedInput from "../../mixed-input";
import TimedConcept from "../../timed-concept";
import AnswerOptionImage from "@/app/answer-option-image";
import { optionsFor, structuredAnswer } from "@/lib/mixed";
import type { Turn } from "@/lib/domain";
import { deleteVoiceDraft } from "@/lib/voice-drafts";
import { invitationSessionKey } from "@/lib/invitation-session";
import { responseIdInput, type HandoffProvider } from "@/lib/survey-handoff";
import type { Interview } from "@/lib/domain";
import { Brand, Spinner, Notice } from "../../components";
export default function Participant({ id }: { id: string }) {
  const [info, setInfo] = useState<any>(null),
    [i, setI] = useState<Interview | null>(null),
    [token, setToken] = useState(""),
    [consent, setConsent] = useState(false),
    [confidentialityAccepted, setConfidentialityAccepted] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [answer, setAnswer] = useState(""),
    [option, setOption] = useState(""),
    [ai, setAi] = useState(false);
  const [audio, setAudio] = useState<{
      audioId: string;
      durationMs: number;
    } | null>(null),
    [audioBusy, setAudioBusy] = useState(false),
    [source, setSource] = useState<"typed" | "transcribed">("typed");
  const [screenBusy, setScreenBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [value, setValue] = useState<Turn["value"]>(undefined);
  const language: Language = i?.language || info?.language || "en";
  const t = (text: string) => copy(language, text);
  const invitation = useRef<string | null>(null),
    responseId = useRef<string | null>(null),
    handoffProvider = useRef<HandoffProvider>("qualtrics"),
    externalStudyId = useRef<string | null>(null),
    sessionKey = useRef("study-session:" + id);
  const [destination, setDestination] = useState<{
    url: string;
    origin: string;
    provider?: HandoffProvider;
  } | null>(null);
  useEffect(() => {
    setDestination(null);
    if (!i || i.preview || i.status === "active" || !token) return;
    let active = true;
    api("interviews/" + i.id + "/survey-handoff", "GET", undefined, {
      "x-interview-token": token,
    })
      .then((r) => {
        if (active) setDestination(r.destination);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [i?.id, i?.status, token]);
  useEffect(() => {
    // A different fragment is a different invitation, even on the same study page.
    const reloadInvitation = () => location.reload();
    window.addEventListener("hashchange", reloadInvitation);
    return () => window.removeEventListener("hashchange", reloadInvitation);
  }, []);
  const retry = useRef<{
    value?: Turn["value"];
    imageId?: string;
    pdfId?: string;
    pptxId?: string;
    docxId?: string;
    answer: string;
    option: string;
    version: number;
    id: string;
  } | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const preview = new URL(location.href).searchParams.get("preview");
        const query = new URL(location.href).searchParams;
        const ids = query.getAll("ResponseID"),
          pids = query.getAll("pid"),
          rallyStudies = query.getAll("studyID"),
          rids = query.getAll("rid"),
          markers = query.getAll("handoff");
        const forsta = rids.length > 0 || markers[0] === "forsta";
        if (!preview && forsta) {
          if (
            ids.length ||
            pids.length ||
            rallyStudies.length ||
            rids.length !== 1 ||
            markers.length > 1 ||
            (markers.length === 1 && markers[0] !== "forsta") ||
            !responseIdInput.safeParse(rids[0]).success
          )
            throw new Error(
              "This Decipher link has an invalid or mixed rid. Contact the research team.",
            );
          handoffProvider.current = "forsta";
          responseId.current = rids[0];
        } else {
          if (
            !preview &&
            (markers.length > 1 ||
              (markers.length === 1 && markers[0] !== "rally"))
          )
            throw new Error(
              "This Rally link has invalid or mixed participant identifiers. Contact the research team.",
            );
          if (
            !preview &&
            (pids.length || rallyStudies.length || markers.length)
          ) {
            if (
              ids.length ||
              pids.length !== 1 ||
              rallyStudies.length !== 1 ||
              !responseIdInput.safeParse(pids[0]).success ||
              !responseIdInput.safeParse(rallyStudies[0]).success
            )
              throw new Error(
                "This Rally link has invalid or mixed participant identifiers. Contact the research team.",
              );
            handoffProvider.current = "rally";
            responseId.current = pids[0];
            externalStudyId.current = rallyStudies[0];
          }
          if (!preview && ids.length) {
            if (ids.length !== 1 || !responseIdInput.safeParse(ids[0]).success)
              throw new Error(
                "This survey link has an invalid ResponseID. Contact the research team.",
              );
            responseId.current = ids[0];
          }
        }
        invitation.current = preview
          ? null
          : new URLSearchParams(location.hash.slice(1)).get("invite");
        sessionKey.current = await invitationSessionKey(id, invitation.current);
        if (responseId.current)
          sessionKey.current +=
            handoffProvider.current === "rally"
              ? ":rally:" + externalStudyId.current + ":" + responseId.current
              : ":" + handoffProvider.current + ":" + responseId.current;
        const saved = preview
          ? { id: preview, token: localStorage.getItem("interview:" + preview) }
          : JSON.parse(localStorage.getItem(sessionKey.current) || "null");
        if (saved?.token) {
          setToken(saved.token);
          try {
            const r = await api("interviews/" + saved.id, "GET", undefined, {
              "x-interview-token": saved.token,
            });
            setI(r.interview);
            setAi(r.ai);
            return;
          } catch {
            if (preview)
              throw new Error(
                t(
                  "This preview has expired. Open a new one from the study editor.",
                ),
              );
            localStorage.removeItem(sessionKey.current);
          }
        }
        // Recover a consented admission whose response was lost, before a used
        // invitation or changed public guide prevents loading the consent page.
        const pending =
          !preview && responseId.current
            ? JSON.parse(
                localStorage.getItem(
                  sessionKey.current + ":admission-request",
                ) || "null",
              )
            : null;
        if (
          pending?.surveyHandoff?.responseId === responseId.current &&
          (pending.surveyHandoff.provider || "qualtrics") ===
            handoffProvider.current &&
          (pending.surveyHandoff.externalStudyId || null) ===
            externalStudyId.current &&
          pending
        ) {
          const r = await api("public/" + id, "POST", pending);
          localStorage.setItem(
            sessionKey.current,
            JSON.stringify({ id: r.interview.id, token: r.token }),
          );
          localStorage.removeItem(sessionKey.current + ":admission-request");
          setI(r.interview);
          setToken(r.token);
          try {
            const details = await api(
              "interviews/" + r.interview.id,
              "GET",
              undefined,
              { "x-interview-token": r.token },
            );
            setAi(details.ai);
          } catch {
            setAi(false);
          }
          return;
        }
        const requested =
          new URL(location.href).searchParams.get("language") ||
          (invitation.current ? "" : navigator.language.split("-")[0]);
        const details = await api(
          "public/" + id + "?language=" + encodeURIComponent(requested),
          "GET",
          undefined,
          invitation.current
            ? { "x-participant-invite": invitation.current }
            : undefined,
        );
        if (
          responseId.current &&
          !(handoffProvider.current === "rally"
            ? details.rallyHandoff
            : handoffProvider.current === "forsta"
              ? details.forstaHandoff
              : details.surveyHandoff)
        )
          throw new Error(
            "This survey connection is unavailable. Contact the research team.",
          );
        setInfo(details);
      } catch (e) {
        if (
          (e as Error).message.includes(
            "Review the current confidentiality text",
          )
        )
          localStorage.removeItem(sessionKey.current + ":admission-request");
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);
  async function start() {
    setBusy(true);
    setError("");
    try {
      const attrs: Record<string, string> = {};
      new URL(location.href).searchParams.forEach((v, k) => {
        if (
          k !== "preview" &&
          k !== "language" &&
          !["responseid", "pid", "studyid", "rid", "handoff"].includes(
            k.toLowerCase(),
          ) &&
          !["invite", "invitationtoken", "token"].includes(k.toLowerCase()) &&
          k.length <= 100 &&
          v.length <= 500
        )
          attrs[k] = v;
      });
      let surveyHandoff:
        | {
            responseId: string;
            secret: string;
            provider?: HandoffProvider;
            externalStudyId?: string;
          }
        | undefined;
      if (responseId.current) {
        const storageKey = sessionKey.current + ":admission-secret";
        let secret = localStorage.getItem(storageKey);
        if (!secret) {
          secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join("");
          localStorage.setItem(storageKey, secret);
        }
        surveyHandoff = {
          responseId: responseId.current,
          secret,
          ...(handoffProvider.current === "rally"
            ? { provider: "rally", externalStudyId: externalStudyId.current! }
            : handoffProvider.current === "forsta"
              ? { provider: "forsta" }
              : {}),
        };
      }
      const request = {
        consent: true,
        confidentiality: info.confidentiality
          ? {
              accepted: confidentialityAccepted,
              version: info.confidentiality.version,
            }
          : undefined,
        surveyHandoff,
        invitationToken: invitation.current || undefined,
        language: info.language,
        attributes: attrs,
      };
      if (surveyHandoff)
        localStorage.setItem(
          sessionKey.current + ":admission-request",
          JSON.stringify(request),
        );
      const r = await api("public/" + id, "POST", request);
      setI(r.interview);
      setToken(r.token);
      setAi(info.ai);
      localStorage.setItem(
        sessionKey.current,
        JSON.stringify({ id: r.interview.id, token: r.token }),
      );
      if (surveyHandoff)
        localStorage.removeItem(sessionKey.current + ":admission-request");
    } catch (e) {
      if (
        (e as Error).message.includes("Review the current confidentiality text")
      ) {
        localStorage.removeItem(sessionKey.current + ":admission-request");
        setConfidentialityAccepted(false);
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const [sortDraftSaved, setSortDraftSaved] = useState(false);
  const draftRetry = useRef<{
    id: string;
    version: number;
    serialized: string;
  } | null>(null);
  async function saveCardsortDraft() {
    if (!i) return;
    setBusy(true);
    setError("");
    try {
      const assignments = cardsortFormAssignments(i.cardsortPrompt, value),
        serialized = JSON.stringify(assignments);
      if (
        !draftRetry.current ||
        draftRetry.current.version !== i.version ||
        draftRetry.current.serialized !== serialized
      )
        draftRetry.current = {
          id: crypto.randomUUID(),
          version: i.version,
          serialized,
        };
      const r = await api(
        "interviews/" + i.id + "/cardsort-draft",
        "POST",
        { requestId: draftRetry.current.id, version: i.version, assignments },
        { "x-interview-token": token },
      );
      setI(r.interview);
      draftRetry.current = null;
      setSortDraftSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(voice?: {
    text: string;
    audio: { audioId: string; durationMs: number };
  }): Promise<boolean> {
    if (!i || screenBusy || imageBusy) return false;
    const text = voice?.text ?? answer;
    const recording = voice?.audio ?? audio;
    setBusy(true);
    setError("");
    try {
      const prev = retry.current;
      if (
        !prev ||
        prev.imageId !== i.participantImageDraft?.image.id ||
        prev.pdfId !== i.participantPDFDraft?.pdf.id ||
        prev.pptxId !== i.participantPPTXDraft?.pptx.id ||
        prev.docxId !== i.participantDOCXDraft?.docx.id ||
        prev.answer !== text ||
        prev.option !== option ||
        JSON.stringify(prev.value) !== JSON.stringify(value) ||
        prev.version !== i.version
      )
        retry.current = {
          imageId: i.participantImageDraft?.image.id,
          pdfId: i.participantPDFDraft?.pdf.id,
          pptxId: i.participantPPTXDraft?.pptx.id,
          docxId: i.participantDOCXDraft?.docx.id,
          answer: text,
          value,
          option,
          version: i.version,
          id: crypto.randomUUID(),
        };
      const r = await api(
        "interviews/" + i.id + "/answer",
        "POST",
        {
          participantImageId: i.participantImageDraft?.image.id,
          participantPDFId: i.participantPDFDraft?.pdf.id,
          participantPPTXId: i.participantPPTXDraft?.pptx.id,
          participantDOCXId: i.participantDOCXDraft?.docx.id,
          requestId: retry.current!.id,
          version: i.version,
          answer: text,
          optionId: option || undefined,
          value:
            i.guide.questions[i.current]?.type === "cardsort"
              ? cardsortFormAssignments(i.cardsortPrompt, value)
              : i.guide.questions[i.current]?.type === "maxdiff"
                ? {
                    best: Array.isArray(value) ? value[0] : "",
                    worst: Array.isArray(value) ? value[1] : "",
                  }
                : value,
          source: voice ? "transcribed" : source,
          ...(recording || {}),
        },
        { "x-interview-token": token },
      );
      setI(r.interview);
      setAnswer("");
      setOption("");
      setValue(undefined);
      setSortDraftSaved(false);
      setAudio(null);
      setSource("typed");
      retry.current = null;
      await deleteVoiceDraft("recording:" + i.id + ":" + i.version).catch(
        () => {},
      );
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <div className="full-loader">
        <Brand />
        <Spinner />
      </div>
    );
  const q = i?.guide.questions[i.current],
    done = i && i.status !== "active";
  const timedAnswerBlocked =
    !!i?.conceptPresentation &&
    !["expired", "untimed"].includes(i.conceptPresentation.state);
  const branding: ParticipantBranding | undefined = i
    ? i.participantBranding
    : info?.participantBranding;
  return (
    <div
      className={
        "participant-shell" + (branding?.enabled ? " participant-themed" : "")
      }
      style={brandingStyle(branding) as CSSProperties}
      lang={language}
    >
      <header>
        <ParticipantBrand branding={branding} />
        <span className="private-label">
          <ShieldCheck size={14} />
          {t("A private conversation")}{" "}
        </span>
      </header>
      <main className="participant-main">
        {i?.preview && (
          <div className="preview-banner">
            {t(
              "DRAFT PREVIEW · This interview is excluded from study results.",
            )}{" "}
          </div>
        )}
        {error && <Notice>{participantError(language, error)}</Notice>}
        {i?.turns.at(-1)?.imageProbe &&
          ["unavailable", "rejected"].includes(
            i.turns.at(-1)!.imageProbe!.status,
          ) && (
            <Notice>
              {t(
                "No AI image follow-up was available. Your answer and image were saved.",
              )}
            </Notice>
          )}
        {i?.turns.at(-1)?.docxProbe &&
          ["unavailable", "rejected", "none"].includes(
            i.turns.at(-1)!.docxProbe!.status,
          ) && <Notice>{docxAILabels[language].unavailable}</Notice>}
        {i?.turns.at(-1)?.pptxProbe &&
          ["unavailable", "rejected", "none"].includes(
            i.turns.at(-1)!.pptxProbe!.status,
          ) && <Notice>{pptxAILabels[language].unavailable}</Notice>}
        {i?.turns.at(-1)?.pdfProbe &&
          ["unavailable", "rejected", "none"].includes(
            i.turns.at(-1)!.pdfProbe!.status,
          ) && (
            <Notice>
              {t(
                "No AI PDF follow-up was available. Your answer and PDF were saved.",
              )}
            </Notice>
          )}
        {!i && info && (
          <section className="consent-card">
            <span className="eyebrow">
              {t("A FEW QUESTIONS. YOUR PERSPECTIVE.")}{" "}
            </span>
            {info.languages?.length > 1 && (
              <label>
                {language === "es"
                  ? "Idioma de la entrevista"
                  : language === "fr"
                    ? "Langue de l’entretien"
                    : "Interview language"}
                <select
                  value={info.language}
                  disabled={busy}
                  onChange={async (e) => {
                    setBusy(true);
                    setConsent(false);
                    setConfidentialityAccepted(false);
                    try {
                      setInfo(
                        await api(
                          "public/" + id + "?language=" + e.target.value,
                          "GET",
                          undefined,
                          invitation.current
                            ? { "x-participant-invite": invitation.current }
                            : undefined,
                        ),
                      );
                    } catch (error) {
                      setError((error as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {info.languages.map((l: Language) => (
                    <option key={l} value={l}>
                      {languageNames[l]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <h1>{info.title}</h1>
            <p className="intro-text">{info.intro}</p>
            <div className="interview-facts">
              <span>
                <MessageSquare size={18} />
                {`${info.questionCount} ${t("core questions")}`}
              </span>
              <span>
                <ShieldCheck size={18} />
                {t("You can stop at any time")}{" "}
              </span>
            </div>
            <div className="consent-info">
              <h3>{t("Before we begin")} </h3>
              <p>
                {t(
                  "Your answers will be saved for the study team to review and analyze. Recording is optional and starts only when you choose it. When connected, AI processes answers to ask follow-ups and help the team analyze the study. Please don’t share confidential or identifying details.",
                )}{" "}
              </p>
              <p>
                {info.ai
                  ? t("An AI interviewer may ask follow-up questions.")
                  : t(
                      "This study uses researcher-written questions and scripted clarification. AI is not connected.",
                    )}
              </p>
            </div>
            {info.confidentiality && (
              <section
                className="panel"
                aria-label={info.confidentiality.title}
              >
                <h2>{info.confidentiality.title}</h2>
                <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {info.confidentiality.text}
                </p>
                <label className="consent-check">
                  <input
                    type="checkbox"
                    checked={confidentialityAccepted}
                    onChange={(e) =>
                      setConfidentialityAccepted(e.target.checked)
                    }
                  />
                  {t(
                    "I acknowledge and agree to the confidentiality text above.",
                  )}
                </label>
                <p className="muted">
                  {t(
                    "If you do not agree, leave this page without starting the interview.",
                  )}
                </p>
              </section>
            )}
            <label className="consent-check">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />{" "}
              {t(
                "I agree to take part and have my responses stored and analyzed for this study.",
              )}{" "}
            </label>
            <button
              className="button primary"
              disabled={
                !consent ||
                (info.confidentiality && !confidentialityAccepted) ||
                busy ||
                info.fielding !== "active"
              }
              onClick={start}
            >
              {busy ? (
                <Spinner />
              ) : (
                <>
                  {info.fielding === "active"
                    ? t("Let’s begin")
                    : t("This study is not accepting interviews")}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </section>
        )}
        {i && !done && (
          <>
            <div className="interview-progress">
              <span>{q?.section}</span>
              <span>
                {`${t("Question")} ${i.current + 1} ${t("of")} ${i.guide.questions.length}`}
              </span>
            </div>
            <div className="progress-track">
              <i
                style={{
                  width: `${(i.current / i.guide.questions.length) * 100}%`,
                }}
              />
            </div>
            <section className="interview-card">
              <div className="moderator-avatar">
                <MessageSquare size={23} />
              </div>
              <div className="eyebrow">
                {i.strategy === "ai"
                  ? t("A FOLLOW-UP FOR YOU")
                  : i.strategy === "scripted"
                    ? t("A SCRIPTED CLARIFICATION")
                    : t("YOUR PERSPECTIVE MATTERS")}
              </div>
              <TimedConcept
                key={q?.conceptId || "shared"}
                interview={i}
                token={token}
                onInterview={(next) =>
                  setI((current) => {
                    if (current && current.id === next.id) {
                      if (current.version > next.version) return current;
                      if (
                        current.version === next.version &&
                        current.videoPresentation &&
                        next.videoPresentation &&
                        current.videoPresentation.conceptId ===
                          next.videoPresentation.conceptId &&
                        (current.videoPresentation.revision >
                          next.videoPresentation.revision ||
                          (current.videoPresentation.revision ===
                            next.videoPresentation.revision &&
                            current.videoPresentation.serverNow >
                              next.videoPresentation.serverNow))
                      )
                        return current;
                      if (
                        current.version === next.version &&
                        current.conceptPresentation?.conceptId ===
                          next.conceptPresentation?.conceptId &&
                        current.conceptPresentation &&
                        next.conceptPresentation &&
                        (current.conceptPresentation.revision >
                          next.conceptPresentation.revision ||
                          (current.conceptPresentation.revision ===
                            next.conceptPresentation.revision &&
                            current.conceptPresentation.serverNow >
                              next.conceptPresentation.serverNow))
                      )
                        return current;
                    }
                    return next;
                  })
                }
              />
              {!timedAnswerBlocked &&
                !["ready", "playing"].includes(
                  i.videoPresentation?.state || "",
                ) && (
                  <>
                    <h1>{i.prompt}</h1>
                    <DOCXPromptCitation
                      key={i.promptDOCXId}
                      interview={i}
                      token={token}
                    />
                    <PPTXPromptCitation
                      key={i.promptPPTXId}
                      interview={i}
                      token={token}
                    />
                    <PDFPromptCitation interview={i} token={token} />
                    {q?.task && (
                      <ScreenCapture
                        key={i.version}
                        language={language}
                        interviewId={i.id}
                        version={i.version}
                        token={token}
                        task={q.task}
                        onBlocking={setScreenBusy}
                      />
                    )}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void submit();
                      }}
                    >
                      {q?.type === "cardsort" ? (
                        i.cardsortPrompt?.phase === "reason" ? (
                          <>
                            <details>
                              <summary>
                                {cardsortCopy(language).savedSort}
                              </summary>
                              {i.cardsortPrompt.cards.map((card) => (
                                <p key={card.id}>
                                  {card.text} →{" "}
                                  {i.cardsortPrompt!.draft.find(
                                    (x) => x.cardId === card.id,
                                  )?.groupId === null
                                    ? cardsortCopy(language).uncertain
                                    : i.cardsortPrompt!.groups.find(
                                        (g) =>
                                          g.id ===
                                          i.cardsortPrompt!.draft.find(
                                            (x) => x.cardId === card.id,
                                          )?.groupId,
                                      )?.text}
                                </p>
                              ))}
                            </details>
                            <label htmlFor="cardsort-reason">
                              {t("Your answer")}
                            </label>
                            <textarea
                              id="cardsort-reason"
                              rows={5}
                              maxLength={12000}
                              value={answer}
                              disabled={busy}
                              onChange={(e) => setAnswer(e.target.value)}
                            />
                          </>
                        ) : (
                          <>
                            {" "}
                            {(sortDraftSaved ||
                              (value === undefined &&
                                !!i.cardsortPrompt?.draft.length)) && (
                              <p role="status">
                                {cardsortCopy(language).saved}
                              </p>
                            )}
                            <CardsortInput
                              interview={i}
                              value={value}
                              onChange={(v) => {
                                setValue(v);
                                setSortDraftSaved(false);
                              }}
                              disabled={busy}
                              saveDraft={() => void saveCardsortDraft()}
                            />
                          </>
                        )
                      ) : q?.type === "maxdiff" ? (
                        <MaxdiffInput
                          token={token}
                          key={i.version}
                          interview={i}
                          value={value}
                          onChange={setValue}
                          disabled={busy}
                        />
                      ) : q?.type === "pricing" ? (
                        i.pricingPrompt?.phase === "reason" ? (
                          <>
                            <label htmlFor="pricing-reason">
                              {t("Your answer")}
                            </label>
                            <textarea
                              id="pricing-reason"
                              rows={5}
                              maxLength={12000}
                              disabled={busy}
                              value={answer}
                              onChange={(e) => setAnswer(e.target.value)}
                            />
                          </>
                        ) : (
                          <fieldset
                            disabled={busy}
                            className="participant-options"
                          >
                            <legend>{pricingCopy(language).notMeasured}</legend>
                            {(["yes", "no"] as const).map((id) => (
                              <label
                                key={id}
                                className={option === id ? "chosen" : ""}
                              >
                                <input
                                  type="radio"
                                  name="pricing-decision"
                                  checked={option === id}
                                  onChange={() => setOption(id)}
                                />
                                {pricingCopy(language)[id]}
                              </label>
                            ))}
                          </fieldset>
                        )
                      ) : q?.type === "choice" ? (
                        <div className="participant-options">
                          {optionsFor(i, q).map((o) => (
                            <div className="answer-option" key={o.id}>
                              <label
                                className={option === o.id ? "chosen" : ""}
                              >
                                <input
                                  type="radio"
                                  name="option"
                                  checked={option === o.id}
                                  onChange={() => setOption(o.id)}
                                />
                                {o.text}
                                {option === o.id && <Check size={18} />}
                              </label>
                              <AnswerOptionImage
                                option={o}
                                interview={i}
                                token={token}
                              />
                            </div>
                          ))}
                        </div>
                      ) : q && !["open", "statement"].includes(q.type) ? (
                        <MixedInput
                          token={token}
                          interview={i}
                          question={q}
                          value={value}
                          onChange={setValue}
                          disabled={busy}
                        />
                      ) : q?.type === "open" ? (
                        <>
                          <label className="sr-only" htmlFor="answer">
                            {t("Your answer")}{" "}
                          </label>
                          <textarea
                            id="answer"
                            disabled={busy || audioBusy}
                            rows={6}
                            placeholder={t("Take your time. We’re listening…")}
                            value={answer}
                            onChange={(e) => {
                              setAnswer(e.target.value);
                              setSource("typed");
                            }}
                            maxLength={12000}
                          />
                          <span className="input-note">
                            {t(
                              "Share as much or as little as you’d like. You can type “skip” to move on.",
                            )}{" "}
                          </span>
                          {q.participantImages && (
                            <ParticipantImageUpload
                              key={i.id + ":" + i.version}
                              interview={i}
                              token={token}
                              disabled={
                                busy || audioBusy || screenBusy || imageBusy
                              }
                              onBusy={setImageBusy}
                              onInterview={setI}
                            />
                          )}
                          {q.participantPPTX && (
                            <ParticipantPPTXUpload
                              key={i.id + ":pptx:" + i.version}
                              interview={i}
                              token={token}
                              disabled={
                                busy || audioBusy || screenBusy || imageBusy
                              }
                              onBusy={setImageBusy}
                              onInterview={setI}
                            />
                          )}
                          {q.participantDOCX && (
                            <ParticipantDOCXUpload
                              key={i.id + ":docx:" + i.version}
                              interview={i}
                              token={token}
                              disabled={
                                busy || audioBusy || screenBusy || imageBusy
                              }
                              onBusy={setImageBusy}
                              onInterview={setI}
                            />
                          )}
                          {q.participantPDFs && (
                            <ParticipantPDFUpload
                              key={i.id + ":pdf:" + i.version}
                              interview={i}
                              token={token}
                              disabled={
                                busy || audioBusy || screenBusy || imageBusy
                              }
                              onBusy={setImageBusy}
                              onInterview={setI}
                            />
                          )}
                          {!q.task && (
                            <fieldset
                              disabled={imageBusy}
                              style={{ border: 0, padding: 0, margin: 0 }}
                            >
                              <VoiceInput
                                key={i.version}
                                language={language}
                                interviewId={i.id}
                                token={token}
                                version={i.version}
                                prompt={i.prompt}
                                provider={ai}
                                onAudio={setAudio}
                                onTranscript={(text) => {
                                  setAnswer(text);
                                  setSource("transcribed");
                                }}
                                onBusy={setAudioBusy}
                                onVoiceAnswer={(text, audio) =>
                                  submit({ text, audio })
                                }
                              />
                            </fieldset>
                          )}
                        </>
                      ) : (
                        <p className="muted">
                          {t("Continue when you’re ready.")}{" "}
                        </p>
                      )}
                      <div className="participant-actions">
                        <small>
                          {busy
                            ? t("Saving your answer…")
                            : ai
                              ? t("Adaptive interview")
                              : t("Researcher guide · scripted clarification")}
                        </small>
                        <button
                          className="button primary"
                          disabled={
                            busy ||
                            audioBusy ||
                            screenBusy ||
                            imageBusy ||
                            (q?.type === "open" && !answer.trim()) ||
                            (q?.type === "choice" && !option) ||
                            (q?.type === "cardsort" &&
                              (i.cardsortPrompt?.phase === "reason"
                                ? !answer.trim()
                                : cardsortFormAssignments(
                                    i.cardsortPrompt,
                                    value,
                                  ).length !==
                                  i.cardsortPrompt?.cards.length)) ||
                            (q?.type === "maxdiff" &&
                              (!Array.isArray(value) ||
                                !value[0] ||
                                !value[1] ||
                                value[0] === value[1])) ||
                            (q?.type === "pricing" &&
                              (i.pricingPrompt?.phase === "reason"
                                ? !answer.trim()
                                : !option)) ||
                            (!!q &&
                              ![
                                "choice",
                                "open",
                                "statement",
                                "pricing",
                                "maxdiff",
                                "cardsort",
                              ].includes(q.type) &&
                              (() => {
                                try {
                                  structuredAnswer(i, q, { value });
                                  return false;
                                } catch {
                                  return true;
                                }
                              })())
                          }
                        >
                          {busy ? (
                            <Spinner />
                          ) : (
                            <>
                              {t("Continue")} <ArrowRight size={17} />
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  </>
                )}
            </section>
            <div style={{ textAlign: "center", marginTop: 28 }}>
              <button
                className="text-button"
                disabled={busy || audioBusy || screenBusy || imageBusy}
                onClick={async () => {
                  if (
                    !confirm(
                      t(
                        "Stop this interview? Your completed answers will be retained for the study team, but excluded from analysis.",
                      ),
                    )
                  )
                    return;
                  try {
                    const r = await api(
                      "interviews/" + i.id + "/stop",
                      "POST",
                      {},
                      { "x-interview-token": token },
                    );
                    setI(r.interview);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {t("Stop interview")}{" "}
              </button>
            </div>
            <p className="participant-footnote">
              <ShieldCheck size={14} />
              {t(
                "Your progress is saved after each answer. Return in this browser to continue.",
              )}{" "}
            </p>
          </>
        )}
        {done && (
          <section className="completion-card">
            <div className="completion-icon">
              <CheckCircle2 size={38} />
            </div>
            <div className="eyebrow">
              {i.status === "screened_out"
                ? t("THANK YOU FOR YOUR INTEREST")
                : t("THAT’S A WRAP")}
            </div>
            <h1>
              {i.status === "withdrawn"
                ? t("Your interview has stopped.")
                : i.status === "screened_out"
                  ? t("Thanks for checking in.")
                  : t("Your perspective makes a difference.")}
            </h1>
            <p>
              {i.status === "withdrawn"
                ? t(
                    "Your saved answers are excluded from analysis. Contact the study team if you would like them deleted.",
                  )
                : i.status === "screened_out"
                  ? t(
                      "This study needs a different participant profile. No further questions are needed.",
                    )
                  : t(
                      "Your answers have been saved. Thanks for taking the time to share your experience.",
                    )}
            </p>
            {i.preview && (
              <a href="/" className="button">
                {t("Back to workspace")} <ArrowRight size={16} />
              </a>
            )}
            {destination && !i.preview && (
              <div className="survey-return">
                <p>
                  {t(
                    destination.provider === "rally"
                      ? "Continue to the study team’s Rally page at"
                      : destination.provider === "forsta"
                        ? "Continue to the study team’s Decipher survey at"
                        : "Continue to the study team’s survey at",
                  )}{" "}
                  <strong>{destination.origin}</strong>.
                </p>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const r = await api(
                        "interviews/" + i.id + "/survey-handoff",
                        "GET",
                        undefined,
                        { "x-interview-token": token },
                      );
                      if (!r.destination) {
                        setDestination(null);
                        throw new Error(
                          "This survey connection is unavailable. Contact the research team.",
                        );
                      }
                      location.assign(r.destination.url);
                    } catch (e) {
                      setError((e as Error).message);
                      setBusy(false);
                    }
                  }}
                >
                  {t(
                    destination.provider === "rally"
                      ? "Continue to Rally"
                      : destination.provider === "forsta"
                        ? "Continue to Decipher"
                        : "Continue to survey",
                  )}{" "}
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </section>
        )}
      </main>
      <footer>
        <Brand />
        <span>{t("Thoughtful research. Grounded in people.")} </span>
      </footer>
    </div>
  );
}
