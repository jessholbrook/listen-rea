"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import {
  qualtricsTemplate,
  rallyTestUrl,
  forstaTestUrl,
  type HandoffProvider,
  type HandoffSettings,
  type HandoffRoutes,
} from "@/lib/survey-handoff";
type Row = {
  responseId: string;
  interviewId: string | null;
  status: string;
  excluded: boolean;
  configVersion: number;
  externalStudyId?: string;
};
type Data = {
  settings: HandoffSettings;
  canManage: boolean;
  rows: Row[];
  recruitmentMode: string;
};
const labels: Record<keyof HandoffRoutes, string> = {
  complete: "Completed interview destination",
  screened_out: "Screened-out destination",
  withdrawn: "Stopped interview destination",
};
export default function SurveyHandoffPanel({
  studyId,
  provider = "qualtrics",
}: {
  studyId: string;
  provider?: HandoffProvider;
}) {
  const rally = provider === "rally",
    forsta = provider === "forsta",
    title = rally
      ? "Rally study handoff"
      : forsta
        ? "Decipher (Forsta) handoff"
        : "Qualtrics survey handoff";
  const [data, setData] = useState<Data | null>(null),
    [settings, setSettings] = useState<HandoffSettings | null>(null),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const path =
    "studies/" +
    studyId +
    (rally ? "/rally-handoff" : forsta ? "/forsta-handoff" : "/survey-handoff");
  async function load(isCurrent = () => true) {
    const d = await api<Data>(path);
    if (!isCurrent()) return;
    setData(d);
    setSettings(d.settings);
    setReviewed(false);
  }
  useEffect(() => {
    let current = true;
    void load(() => current).catch((e) => {
      if (current) setError(e.message);
    });
    return () => {
      current = false;
    };
  }, [studyId, provider]);
  return (
    <section
      className={
        "panel survey-handoff-panel " +
        (rally
          ? "rally-handoff-panel"
          : forsta
            ? "forsta-handoff-panel"
            : "handoff-panel")
      }
    >
      <h3>{title}</h3>
      <p>
        {rally
          ? "Match Rally participants and studies using pid and studyID. Use Rally’s custom test link workflow; no Rally API key, domain or email provider is needed."
          : forsta
            ? "Match Decipher participants using rid and return them to the approved survey address. No Decipher API key, domain or email provider is needed."
            : "Match a Qualtrics response to its Echo Lab interview using ResponseID. No Qualtrics API key, domain or email provider is needed."}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {data && settings && (
        <>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              setNotice("");
              try {
                await api(path, "PUT", {
                  version: settings.version,
                  enabled: settings.enabled,
                  routes: settings.routes,
                  reviewed,
                  ...(rally
                    ? { externalStudyId: settings.externalStudyId || "" }
                    : {}),
                });
                await load();
                setNotice(
                  rally
                    ? "Rally handoff saved."
                    : forsta
                      ? "Decipher handoff saved."
                      : "Survey handoff saved.",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="handoff-check">
              <input
                type="checkbox"
                checked={settings.enabled}
                disabled={!data.canManage || busy}
                onChange={(e) => {
                  setSettings({ ...settings, enabled: e.target.checked });
                  setReviewed(false);
                }}
              />
              {rally
                ? "Enable Rally handoff"
                : forsta
                  ? "Enable Decipher handoff"
                  : "Enable Qualtrics handoff"}
            </label>
            <p>
              Existing fielding limits, consent and individual invitation rules
              still apply. Normal participant links remain available.
            </p>
            {rally && (
              <label>
                Expected Rally studyID
                <input
                  aria-label="Expected Rally studyID"
                  value={settings.externalStudyId || ""}
                  maxLength={128}
                  disabled={!data.canManage || busy}
                  onChange={(e) => {
                    setSettings({
                      ...settings,
                      externalStudyId: e.target.value,
                    });
                    setReviewed(false);
                  }}
                />
                <small>
                  New arrivals must match this Rally study. Use its opaque ID,
                  not its display name.
                </small>
              </label>
            )}
            {(Object.keys(labels) as (keyof HandoffRoutes)[]).map((status) => (
              <label key={status}>
                {labels[status]}
                <input
                  type="url"
                  aria-label={labels[status]}
                  placeholder={
                    rally
                      ? "https://app.rallyuxr.com/…"
                      : forsta
                        ? "https://your-survey.decipherinc.com/…"
                        : "https://your-survey.qualtrics.com/jfe/form/SV_…"
                  }
                  maxLength={2048}
                  value={settings.routes[status]}
                  disabled={!data.canManage || busy}
                  onChange={(e) => {
                    setSettings({
                      ...settings,
                      routes: { ...settings.routes, [status]: e.target.value },
                    });
                    setReviewed(false);
                  }}
                />
                <small>
                  Optional HTTPS address. Leave blank to finish in Echo Lab.
                </small>
              </label>
            ))}
            {rally ? (
              <p>
                Paste the return links supplied for your Rally test. If needed,
                use {"{pid}"} and {"{studyID}"} in the path or query values.
                Echo Lab only fills those placeholders; it adds no invented
                Rally status parameters. Use a completion link only for
                completed interviews, and leave other endings blank unless Rally
                supplies the appropriate link.
              </p>
            ) : forsta ? (
              <p>
                Paste your Decipher survey address without rid. Echo Lab appends
                the admitted rid; other saved query values stay unchanged.
                Incoming extra parameters are not forwarded. Use the completion
                destination to resume the survey; leave other endings blank
                unless your survey has an appropriate route. Participants choose
                Continue to Decipher.
              </p>
            ) : (
              <p>
                A return destination can be a second Qualtrics survey or another
                approved page. It does not reopen an already completed Qualtrics
                response. Participants choose Continue to survey; Echo Lab
                appends ResponseID and echo_status.
              </p>
            )}
            <p>
              Active interviews keep their approved destination snapshot.
              Disabling handoffs blocks new admissions and destination requests.
              Previously downloaded links and exports cannot be recalled.
            </p>
            {settings.enabled && (
              <label className="handoff-check">
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={!data.canManage || busy}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                {rally
                  ? "I reviewed the Rally return links and identifier sharing."
                  : forsta
                    ? "I reviewed the Decipher return addresses and rid sharing."
                    : "I reviewed the survey destinations and the ResponseID sharing."}
              </label>
            )}
            {data.canManage ? (
              <button
                className="button primary"
                disabled={
                  busy ||
                  (settings.enabled &&
                    (!reviewed || (rally && !settings.externalStudyId)))
                }
              >
                {rally
                  ? "Save Rally handoff"
                  : forsta
                    ? "Save Decipher handoff"
                    : "Save survey handoff"}
              </button>
            ) : (
              <p className="muted">
                Only workspace admins can change this connection.
              </p>
            )}
          </form>
          {data.settings.enabled && !rally && !forsta && (
            <details open>
              <summary>Set up the Qualtrics redirect</summary>
              <ol>
                <li>
                  In Qualtrics Survey Builder, select End of Survey → Redirect
                  to URL.
                </li>
                <li>
                  Paste this participant URL. Keep the piped ResponseID
                  expression unchanged.
                </li>
              </ol>
              <label>
                Qualtrics redirect template
                <input
                  aria-label="Qualtrics redirect template"
                  readOnly
                  value={
                    typeof location === "undefined"
                      ? ""
                      : qualtricsTemplate(location.origin, studyId)
                  }
                  onClick={(e) => e.currentTarget.select()}
                />
              </label>
              <p>
                <code>{"ResponseID=${e://Field/ResponseID}"}</code> is replaced
                by Qualtrics when a participant finishes its survey. Use opaque
                IDs; do not put names, email addresses or secrets in the URL.
              </p>
              {data.recruitmentMode === "invitation_only" && (
                <p>
                  An individual invitation is required: append its private
                  invitation fragment to the template for that participant. This
                  shared template alone does not admit anyone.
                </p>
              )}
              <p>
                Vercel sign-in protection still applies to the hosted interview.
                Run a real Qualtrics survey test before recruiting; the current
                checks use synthetic redirects.
              </p>
            </details>
          )}
          {data.settings.enabled && rally && (
            <details open>
              <summary>Set up the Rally custom test</summary>
              <ol>
                <li>
                  Create an Unmoderated Test in Rally and use a custom test link
                  for Echo Lab.
                </li>
                <li>
                  Paste the test URL below and verify that launched links
                  include the actual pid and studyID.
                </li>
                <li>
                  Copy Rally’s return URL into the appropriate destination
                  above, then test the full journey with a Rally test
                  participant.
                </li>
              </ol>
              <label>
                Rally test URL
                <input
                  aria-label="Rally test URL"
                  readOnly
                  value={
                    typeof location === "undefined"
                      ? ""
                      : rallyTestUrl(location.origin, studyId)
                  }
                  onClick={(e) => e.currentTarget.select()}
                />
              </label>
              <p>
                Echo Lab is a custom tool, so do not select Listen Labs as its
                integration. The native Listen partnership does not apply here.
                Verify Rally’s participant status in your account; this build
                makes no server-to-server status updates.
              </p>
              {data.recruitmentMode === "invitation_only" && (
                <p>
                  Individual Echo Lab invitation fragments are still required
                  for each participant; the shared test link alone grants no
                  admission.
                </p>
              )}
              <p>
                Vercel access is still required. The pid and studyID values are
                self-reported IDs, not verified identities.
              </p>
            </details>
          )}
          {data.settings.enabled && forsta && (
            <details open>
              <summary>Set up the Decipher redirect</summary>
              <ol>
                <li>
                  Add a Redirect Logic Node in your Decipher Survey Editor at
                  the interview handoff point.
                </li>
                <li>
                  Use this participant URL, set Participant ID Query Parameter
                  to rid, and Participant ID Value to $uuid. Confirm the live
                  URL contains the expanded opaque ID.
                </li>
                <li>
                  Save your survey return address above and test the journey
                  back to the survey.
                </li>
              </ol>
              <label>
                Decipher participant URL
                <input
                  aria-label="Decipher participant URL"
                  readOnly
                  value={
                    typeof location === "undefined"
                      ? ""
                      : forstaTestUrl(location.origin, studyId)
                  }
                  onClick={(e) => e.currentTarget.select()}
                />
              </label>
              <p>
                This initial connection supports the standard rid key. Custom ID
                keys and forwarding arbitrary incoming query parameters are not
                supported. No automatic survey status updates or payments are
                made. Verify survey resumption in your Decipher account before
                recruiting.
              </p>
              {data.recruitmentMode === "invitation_only" && (
                <p>
                  Append each participant’s private Echo Lab invitation
                  fragment. This shared URL alone grants no admission.
                </p>
              )}
              <p>
                Vercel access is still required. Use opaque IDs; keep contact
                details and secrets out of URLs.
              </p>
            </details>
          )}
          <div className="inline">
            <button
              className="button"
              disabled={busy}
              onClick={async () => {
                setError("");
                try {
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {rally
                ? "Refresh Rally handoff status"
                : forsta
                  ? "Refresh Decipher handoff status"
                  : "Refresh handoff status"}
            </button>
            <a className="button" href={"/api/" + path + "/export"} download>
              {rally
                ? "Export Rally handoff CSV"
                : forsta
                  ? "Export Decipher handoff CSV"
                  : "Export handoff CSV"}
            </a>
          </div>
          <p>
            {data.rows.length} linked survey responses. IDs are self-reported
            URL values, not verified identities. Completion URLs are not signed
            proof of eligibility or payment.
          </p>
          {!data.rows.length ? (
            <p className="muted">No survey handoffs yet.</p>
          ) : (
            <div className="handoff-table">
              <table>
                <thead>
                  <tr>
                    <th>{rally ? "pid" : forsta ? "rid" : "ResponseID"}</th>
                    {rally && <th>studyID</th>}
                    <th>Interview</th>
                    <th>Status</th>
                    <th>Destination version</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, n) => (
                    <tr key={r.interviewId || "deleted-" + n}>
                      <td>{r.responseId || "Removed"}</td>
                      {rally && <td>{r.externalStudyId || "Removed"}</td>}
                      <td>{r.interviewId?.slice(0, 8) || "Deleted"}</td>
                      <td>
                        {r.status}
                        {r.excluded ? " · excluded" : ""}
                      </td>
                      <td>{r.configVersion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
