"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { Study } from "@/lib/domain";
import {
  languages,
  languageNames,
  settings,
  type Language,
  type TextField,
  type ResponseTranslation,
} from "@/lib/localization";
import { Notice, Spinner } from "./components";
type Data = {
  settings: ReturnType<typeof settings>;
  sourceFingerprint: string;
  fields: TextField[];
  availableLanguages: Language[];
  version: number;
  evidence: {
    interviewId: string;
    turnId: string;
    prompt: string;
    language: Language;
  }[];
};
type ResponseData = {
  original: string;
  sourceLanguage: Language;
  language: Language;
  sourceFingerprint: string;
  translation: ResponseTranslation | null;
  version: number;
};
export default function LocalizationPanel({
  study,
  ai,
  refresh,
}: {
  study: Study;
  ai: boolean;
  refresh: () => Promise<void>;
}) {
  const [data, setData] = useState<Data | null>(null),
    [cfg, setCfg] = useState(() => structuredClone(settings(study.draft))),
    [language, setLanguage] = useState<Language>("es"),
    [fields, setFields] = useState<{ key: string; text: string }[]>([]),
    [reviewed, setReviewed] = useState(false),
    [edited, setEdited] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const [evidence, setEvidence] = useState(""),
    [target, setTarget] = useState<Language>("en"),
    [response, setResponse] = useState<ResponseData | null>(null),
    [translated, setTranslated] = useState(""),
    [responseReviewed, setResponseReviewed] = useState(false);
  const root = `studies/${study.id}/localization`;
  async function load() {
    const d = await api<Data>(root);
    setData(d);
    setCfg(structuredClone(d.settings));
    setLanguage((l) =>
      l === d.settings.sourceLanguage ? languages.find((x) => x !== l)! : l,
    );
    if (!evidence && d.evidence[0]) {
      const e = d.evidence[0];
      setEvidence(JSON.stringify([e.interviewId, e.turnId]));
      setTarget(
        d.settings.reportingLanguage !== e.language
          ? d.settings.reportingLanguage
          : languages.find((x) => x !== e.language)!,
      );
    }
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [study.id, study.version]);
  useEffect(() => {
    if (!data) return;
    const saved = data.settings.translations.find(
      (t) => t.language === language,
    );
    setFields(
      data.fields.map((f) => ({
        key: f.key,
        text: saved?.fields.find((x) => x.key === f.key)?.text ?? f.text,
      })),
    );
    setReviewed(
      !!saved?.reviewed && saved.sourceFingerprint === data.sourceFingerprint,
    );
    setEdited(false);
  }, [data, language]);
  async function responseLoad() {
    if (!evidence) return;
    const [id, turn] = JSON.parse(evidence);
    const r = await api<ResponseData>(
      `${root}/responses/${id}/${turn}/${target}`,
    );
    setResponse(r);
    setTranslated(r.translation?.translated || "");
    setResponseReviewed(!!r.translation?.reviewed);
  }
  useEffect(() => {
    let active = true;
    setResponse(null);
    setTranslated("");
    setResponseReviewed(false);
    if (evidence) {
      const [id, turn] = JSON.parse(evidence);
      api<ResponseData>(`${root}/responses/${id}/${turn}/${target}`)
        .then((r) => {
          if (active) {
            setResponse(r);
            setTranslated(r.translation?.translated || "");
            setResponseReviewed(!!r.translation?.reviewed);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }
    return () => {
      active = false;
    };
  }, [evidence, target, study.version]);
  async function run(fn: () => Promise<void>, message?: string) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await fn();
      if (message) setStatus(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data && !error) return <Spinner />;
  const saved = data?.settings.translations.find(
      (t) => t.language === language,
    ),
    source = evidence
      ? data?.evidence.find(
          (e) => JSON.stringify([e.interviewId, e.turnId]) === evidence,
        )
      : undefined;
  const responsePath = source
    ? `${root}/responses/${source.interviewId}/${source.turnId}/${target}`
    : "";
  return (
    <div className="localization-stack">
      {error && (
        <div role="alert">
          <Notice>{error}</Notice>
        </div>
      )}
      {status && <p role="status">{status}</p>}
      <section className="panel localization-stack">
        <h2>Interview and reporting languages</h2>
        <p>
          The source language describes the text in Study design. Reporting
          language controls new analysis drafts and memo labels. Existing
          interviews and reports retain their saved language.
        </p>
        <div className="library-two">
          <label>
            Source guide language
            <select
              aria-label="Source guide language"
              value={cfg.sourceLanguage}
              disabled={busy}
              onChange={(e) =>
                setCfg((c) => ({
                  ...c,
                  sourceLanguage: e.target.value as Language,
                  translations: [],
                }))
              }
            >
              {languages.map((l) => (
                <option key={l} value={l}>
                  {languageNames[l]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reporting language
            <select
              aria-label="Reporting language"
              value={cfg.reportingLanguage}
              disabled={busy}
              onChange={(e) =>
                setCfg((c) => ({
                  ...c,
                  reportingLanguage: e.target.value as Language,
                }))
              }
            >
              {languages.map((l) => (
                <option key={l} value={l}>
                  {languageNames[l]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Translation guidance
          <textarea
            aria-label="Translation guidance"
            value={cfg.guidance}
            maxLength={3000}
            disabled={busy}
            onChange={(e) =>
              setCfg((c) => ({ ...c, guidance: e.target.value }))
            }
            placeholder="Preferred terminology, product names to preserve, formality, regional conventions…"
          />
        </label>
        <Notice>
          Changing source text or guidance makes existing guide translations
          stale. Changing the source language removes draft translations. Save
          settings, review translations, then publish from Study design.
          Fluent-speaker acceptance and voice-quality review remain pending.
        </Notice>
        <button
          className="button primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api(`studies/${study.id}`, "PUT", {
                guide: { ...study.draft, localization: cfg },
                version: study.version,
              });
              await refresh();
              await load();
            }, "Language settings saved. Publish the reviewed draft to update participant links.")
          }
        >
          Save language settings
        </button>
      </section>
      {data && (
        <section className="panel localization-stack">
          <h2>Reviewed guide translations</h2>
          <p>
            Translate only the text fields below. Question/option IDs, routing,
            assignments, scales and task URLs remain intact. Drafts proposed by
            AI are never saved or enabled automatically.
          </p>
          <label>
            Guide translation language
            <select
              aria-label="Guide translation language"
              value={language}
              disabled={busy}
              onChange={(e) => setLanguage(e.target.value as Language)}
            >
              {languages
                .filter((l) => l !== data.settings.sourceLanguage)
                .map((l) => (
                  <option key={l} value={l}>
                    {languageNames[l]}
                  </option>
                ))}
            </select>
          </label>
          <p>
            {saved
              ? saved.sourceFingerprint !== data.sourceFingerprint
                ? "Saved translation is stale. Review every current field before saving again."
                : saved.reviewed
                  ? `Reviewed by ${saved.reviewedBy}. Publish to make this version available.`
                  : "Saved draft is not reviewed; participants cannot use it."
              : "No translation saved. Source text is prefilled for manual translation."}
          </p>
          <div className="panel-actions">
            <button
              className="button"
              disabled={busy || !ai}
              onClick={() =>
                run(async () => {
                  const r = await api(`${root}/guide/${language}`, "POST", {
                    version: data.version,
                    sourceFingerprint: data.sourceFingerprint,
                  });
                  setFields(r.fields);
                  setReviewed(false);
                  setEdited(true);
                }, "AI translation proposed. Review every field before saving.")
              }
            >
              Propose guide translation
            </button>
            <button
              className="button"
              disabled={
                busy || edited || !data.availableLanguages.includes(language)
              }
              onClick={() =>
                run(async () => {
                  const r = await api(`studies/${study.id}/preview`, "POST", {
                    language,
                  });
                  localStorage.setItem("interview:" + r.interview.id, r.token);
                  window.open(
                    `/s/${study.id}?preview=${r.interview.id}`,
                    "_blank",
                  );
                })
              }
            >
              Preview saved language
            </button>
          </div>
          <div className="localization-fields">
            {data.fields.map((f, n) => (
              <div className="localization-field" key={f.key}>
                <div>
                  <strong>{f.label}</strong>
                  <p
                    lang={data.settings.sourceLanguage}
                    className="preserve-lines"
                  >
                    {f.text || "(empty)"}
                  </p>
                </div>
                <label>
                  {`Translation ${n + 1}: ${f.label}`}
                  <textarea
                    aria-label={`Translation ${n + 1}: ${f.label}`}
                    lang={language}
                    value={fields.find((x) => x.key === f.key)?.text || ""}
                    minLength={f.min}
                    maxLength={f.max}
                    disabled={busy}
                    onChange={(e) => {
                      setFields((fs) =>
                        fs.map((x) =>
                          x.key === f.key ? { ...x, text: e.target.value } : x,
                        ),
                      );
                      setReviewed(false);
                      setEdited(true);
                    }}
                  />
                </label>
              </div>
            ))}
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed the meaning, neutral wording, terminology and all
            translated fields.
          </label>
          <div className="panel-actions">
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api(`${root}/guide/${language}`, "PUT", {
                    version: data.version,
                    sourceFingerprint: data.sourceFingerprint,
                    fields,
                    reviewed,
                  });
                  await refresh();
                  await load();
                }, "Guide translation saved. Publish the draft to update available participant languages.")
              }
            >
              Save guide translation
            </button>
            {saved && (
              <button
                className="button danger"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api(`${root}/guide/${language}`, "DELETE", {
                      version: data.version,
                      sourceFingerprint: data.sourceFingerprint,
                    });
                    await refresh();
                    await load();
                  }, "Draft translation removed. Published interviews retain their version.")
                }
              >
                Remove draft translation
              </button>
            )}
          </div>
          <p className="small muted">
            Participants can select a reviewed published language before
            consent. A link ending in ?language=es or ?language=fr requests that
            language; otherwise a supported browser language is used, with the
            source language as fallback.
          </p>
        </section>
      )}
      {data && (
        <section className="panel localization-stack">
          <h2>Original responses and translations</h2>
          <Notice>
            Original responses remain canonical evidence. Translations are
            labeled interpretations and never replace exact citation text. Save
            a reviewed translation to include it in the bilingual CSV export.
          </Notice>
          <a className="button" href={`/api/${root}/export`} download>
            Export reviewed translations CSV
          </a>
          {!data.evidence.length ? (
            <p>Complete an included response to translate it.</p>
          ) : (
            <>
              <label>
                Source response
                <select
                  aria-label="Source response"
                  value={evidence}
                  disabled={busy}
                  onChange={(e) => {
                    setEvidence(e.target.value);
                    const s = data.evidence.find(
                      (x) =>
                        JSON.stringify([x.interviewId, x.turnId]) ===
                        e.target.value,
                    )!;
                    if (target === s.language)
                      setTarget(languages.find((l) => l !== s.language)!);
                  }}
                >
                  {data.evidence.map((e) => (
                    <option
                      key={e.interviewId + e.turnId}
                      value={JSON.stringify([e.interviewId, e.turnId])}
                    >
                      {languageNames[e.language]} · {e.prompt.slice(0, 65)} ·{" "}
                      {e.interviewId.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Response translation language
                <select
                  aria-label="Response translation language"
                  disabled={busy}
                  value={target}
                  onChange={(e) => setTarget(e.target.value as Language)}
                >
                  {languages
                    .filter((l) => l !== source?.language)
                    .map((l) => (
                      <option key={l} value={l}>
                        {languageNames[l]}
                      </option>
                    ))}
                </select>
              </label>
              {response && (
                <>
                  <div className="library-two">
                    <div>
                      <h3>
                        Original · {languageNames[response.sourceLanguage]}
                      </h3>
                      <p
                        className="preserve-lines"
                        lang={response.sourceLanguage}
                      >
                        {response.original}
                      </p>
                      <p className="mono small">
                        {source?.interviewId} / {source?.turnId}
                      </p>
                    </div>
                    <label>
                      Translated response
                      <textarea
                        aria-label="Translated response"
                        lang={target}
                        value={translated}
                        maxLength={18000}
                        disabled={busy}
                        onChange={(e) => {
                          setTranslated(e.target.value);
                          setResponseReviewed(false);
                        }}
                      />
                    </label>
                  </div>
                  <button
                    className="button"
                    disabled={busy || !ai}
                    onClick={() =>
                      run(async () => {
                        const r = await api(responsePath, "POST");
                        setTranslated(r.translated);
                        setResponseReviewed(false);
                      }, "Translation proposed. Compare it with the original before saving.")
                    }
                  >
                    Propose response translation
                  </button>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={responseReviewed}
                      disabled={busy}
                      onChange={(e) => setResponseReviewed(e.target.checked)}
                    />
                    I reviewed this translation against the original, including
                    speaker labels and uncertainty.
                  </label>
                  <div className="panel-actions">
                    <button
                      className="button primary"
                      disabled={busy || !translated.trim()}
                      onClick={() =>
                        run(async () => {
                          await api(responsePath, "PUT", {
                            translated,
                            reviewed: responseReviewed,
                            sourceFingerprint: response.sourceFingerprint,
                            version: response.version,
                          });
                          await responseLoad();
                        }, "Response translation saved separately from the original.")
                      }
                    >
                      Save response translation
                    </button>
                    {response.translation && (
                      <button
                        className="button danger"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await api(responsePath, "DELETE", {
                              sourceFingerprint: response.sourceFingerprint,
                              version: response.version,
                            });
                            await responseLoad();
                          }, "Saved translation deleted; the original response is retained.")
                        }
                      >
                        Delete translation
                      </button>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
