"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { RecruitmentSettings, InvitationView } from "@/lib/recruitment";
import { csv } from "@/lib/evidence";
import { Modal, Spinner } from "./components";
type Data = {
  settings: RecruitmentSettings;
  invitations: InvitationView[];
  canManage: boolean;
  languages: string[];
  capacity: {
    limit: number | null;
    reserved: number;
    remaining: number | null;
  };
  counts: {
    issued: number;
    ready: number;
    markedShared: number;
    inProgress: number;
    complete: number;
    screenedOut: number;
    withdrawn: number;
    responseDeleted: number;
  };
};
type Link = { invitation: InvitationView; path: string };
const labels: Record<string, string> = {
  ready: "Ready to share",
  marked_shared: "Marked shared",
  in_progress: "In progress",
  complete: "Complete",
  screened_out: "Screened out",
  withdrawn: "Withdrawn",
  revoked: "Revoked",
  expired: "Expired",
  replaced: "Replaced",
  response_deleted: "Response deleted",
};
function download(text: string, name: string) {
  const url = URL.createObjectURL(
      new Blob([text], { type: "text/csv;charset=utf-8" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export default function RecruitmentPanel({
  studyId,
  dataVersion,
  studyVersion,
  onMode,
}: {
  studyId: string;
  dataVersion: number;
  studyVersion: number;
  onMode: (mode: "open" | "invitation_only") => void;
}) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [refs, setRefs] = useState(""),
    [days, setDays] = useState(14),
    [language, setLanguage] = useState(""),
    [tag, setTag] = useState(""),
    [tagValue, setTagValue] = useState(""),
    [issued, setIssued] = useState<Link[] | null>(null),
    [confirm, setConfirm] = useState<{
      row: InvitationView;
      action: "revoke" | "erase" | "replace";
    } | null>(null),
    [status, setStatus] = useState("all"),
    [notice, setNotice] = useState("");
  const pending = useRef<{
      semantic: string;
      requestId: string;
      secret: string;
      expiresAt: string;
    } | null>(null),
    root = `studies/${studyId}`,
    modeCallback = useRef(onMode);
  modeCallback.current = onMode;
  async function load() {
    const d = await api<Data>(root + "/recruitment");
    setData(d);
    modeCallback.current(d.settings.mode);
  }
  useEffect(() => {
    let active = true;
    setData(null);
    api<Data>(root + "/recruitment")
      .then((d) => {
        if (active) {
          setData(d);
          modeCallback.current(d.settings.mode);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [studyId, dataVersion, studyVersion]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function issue(replace?: InvitationView) {
    const recipients = replace
      ? [{ reference: replace.reference, attributes: replace.attributes }]
      : refs
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((reference) => ({
            reference,
            attributes: tag ? { [tag]: tagValue } : {},
          }));
    const preferred = replace
      ? replace.language || undefined
      : language || undefined;
    const semantic = JSON.stringify({
      recipients,
      language: preferred,
      days,
      replace: replace
        ? { id: replace.id, version: replace.version }
        : undefined,
    });
    if (!pending.current || pending.current.semantic !== semantic)
      pending.current = {
        semantic,
        requestId: crypto.randomUUID(),
        secret: Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join(""),
        expiresAt: new Date(Date.now() + days * 86400000).toISOString(),
      };
    const p = pending.current;
    const r = await api<{ links: Link[] }>(root + "/invitations", "POST", {
      requestId: p.requestId,
      secret: p.secret,
      expiresAt: p.expiresAt,
      recipients,
      language: preferred,
      ...(replace
        ? { replace: { id: replace.id, version: replace.version } }
        : {}),
    });
    // Keep the retry secret only while this request is pending. Raw links are not in the roster.
    // Close the confirmation before showing links so only one focus trap exists.
    setConfirm(null);
    setIssued(r.links);
    pending.current = null;
    setRefs("");
    await load();
  }
  async function action(
    row: InvitationView,
    name: "shared" | "revoke" | "erase",
  ) {
    await api(root + `/invitations/${row.id}/${name}`, "POST", {
      version: row.version,
    });
    await load();
    setConfirm(null);
  }
  const shown =
    data?.invitations.filter((v) => status === "all" || v.status === status) ||
    [];
  return (
    <section className="panel visual-stack recruitment-panel">
      <div className="panel-heading">
        <h2>Participant invitations</h2>
        <button className="button" disabled={busy} onClick={() => run(load)}>
          Refresh invitations
        </button>
      </div>
      <p>
        Create individual links to share through your usual channel. Each link
        admits one interview; possessing a link does not verify a person’s
        identity. Links are tracked separately from team-member invitations.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!data ? (
        !error && <Spinner />
      ) : (
        <>
          {!data.canManage && (
            <p>
              A researcher or admin can issue/revoke participant invitations and
              change admission settings.
            </p>
          )}
          <label>
            Who can start an interview?
            <select
              aria-label="Participant admission"
              disabled={busy || !data.canManage}
              value={data.settings.mode}
              onChange={(e) => {
                const mode = e.target.value;
                void run(async () => {
                  await api(root + "/recruitment", "PUT", {
                    version: data.settings.version,
                    mode,
                  });
                  await load();
                });
              }}
            >
              <option value="open">Anyone with the general study link</option>
              <option value="invitation_only">
                Only people with individual invitations
              </option>
            </select>
          </label>
          <p>
            Changing admission or revoking a link stops new starts. Already
            admitted participants can finish or resume their original interview.
            Invitations reserve a place only when an interview starts.
          </p>
          <dl className="snapshot">
            <div>
              <dt>Links issued</dt>
              <dd>{data.counts.issued}</dd>
            </div>
            <div>
              <dt>In progress</dt>
              <dd>{data.counts.inProgress}</dd>
            </div>
            <div>
              <dt>Complete</dt>
              <dd>{data.counts.complete}</dd>
            </div>
            <div>
              <dt>Screened out</dt>
              <dd>{data.counts.screenedOut}</dd>
            </div>
          </dl>
          <p>
            {data.capacity.limit === null
              ? "Publish a guide to set the admission limit."
              : `${data.capacity.reserved} places reserved / ${data.capacity.limit} admission limit · ${data.capacity.remaining} remaining`}
            . General-link and invited interviews share this limit. Excluding a
            response does not release its place.
          </p>
          <details>
            <summary>Create invitation links</summary>
            <form
              className="visual-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => issue());
              }}
            >
              <label>
                Participant references, one per line
                <textarea
                  required
                  disabled={busy || !data.canManage}
                  maxLength={5050}
                  rows={5}
                  value={refs}
                  onChange={(e) => setRefs(e.target.value)}
                  placeholder="P001&#10;P002"
                />
              </label>
              <p>
                Use participant codes when possible. Up to 50 per batch;
                references are unique within the study. Keep contact details in
                your own contact list.
              </p>
              <div className="mixed-grid">
                <label>
                  Link valid for days
                  <input
                    type="number"
                    min={1}
                    max={90}
                    required
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                    disabled={busy || !data.canManage}
                  />
                </label>
                <label>
                  Preferred interview language
                  <select
                    aria-label="Preferred interview language"
                    disabled={busy || !data.canManage}
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  >
                    <option value="">Published guide default</option>
                    {data.languages.map((l) => (
                      <option value={l} key={l}>
                        {{ en: "English", es: "Spanish", fr: "French" }[l] || l}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mixed-grid">
                <label>
                  Participant tag (optional)
                  <input
                    maxLength={100}
                    value={tag}
                    disabled={busy || !data.canManage}
                    onChange={(e) => setTag(e.target.value)}
                    placeholder="segment"
                  />
                </label>
                <label>
                  Tag value
                  <input
                    maxLength={500}
                    value={tagValue}
                    disabled={busy || !data.canManage}
                    onChange={(e) => setTagValue(e.target.value)}
                    placeholder="Customer"
                  />
                </label>
              </div>
              <p>
                Preset tags override matching link parameters and stay private
                to the study team. Other link parameters are
                participant-supplied and do not establish eligibility.
              </p>
              <button
                className="button primary"
                disabled={busy || !data.canManage || !data.languages.length}
              >
                Generate invitation links
              </button>
            </form>
          </details>
          <div className="button-row">
            <label>
              Invitation status
              <select
                aria-label="Invitation status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">All invitations</option>
                {Object.entries(labels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <a className="button" href={`/api/${root}/invitations/export`}>
              Export invitation roster
            </a>
          </div>
          <p>
            “Marked shared” records your manual confirmation, not email delivery
            or a verified open. The roster contains no reusable invitation
            links. If you lose an unused link, replace it to revoke the old one.
          </p>
          {!shown.length ? (
            <p>No invitations in this selection.</p>
          ) : (
            <div className="pricing-table">
              <table>
                <thead>
                  <tr>
                    <th>Participant reference</th>
                    <th>Status</th>
                    <th>Expiry</th>
                    <th>Response</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((v) => (
                    <tr key={v.id}>
                      <td>
                        {v.reference || "Details removed"}
                        <small className="mono">{v.id.slice(0, 8)}</small>
                        {Object.entries(v.attributes).map(([k, x]) => (
                          <small key={k}>
                            {k}: {x}
                          </small>
                        ))}
                      </td>
                      <td>
                        {labels[v.status] || v.status}
                        {v.response?.excluded && (
                          <small>Excluded from analysis</small>
                        )}
                        {v.revokedAt && v.claimedAt && (
                          <small>Admission link revoked</small>
                        )}
                      </td>
                      <td>{new Date(v.expiresAt).toLocaleDateString()}</td>
                      <td>
                        {v.response ? (
                          <a href={`/?study=${studyId}&tab=responses`}>
                            {v.response.id.slice(0, 8)}
                          </a>
                        ) : v.responseDeletedAt ? (
                          "Response deleted"
                        ) : (
                          "Not started"
                        )}
                      </td>
                      <td>
                        <div className="recruitment-actions">
                          <button
                            className="button"
                            disabled={
                              busy ||
                              !data.canManage ||
                              v.linkStatus !== "valid" ||
                              !!v.sharedAt
                            }
                            onClick={() => run(() => action(v, "shared"))}
                          >
                            Mark shared
                          </button>
                          <button
                            className="button"
                            disabled={
                              busy ||
                              !data.canManage ||
                              !!v.claimedAt ||
                              !!v.redactedAt ||
                              !!v.replacedBy
                            }
                            onClick={() =>
                              setConfirm({ row: v, action: "replace" })
                            }
                          >
                            Replace link
                          </button>
                          <button
                            className="button"
                            disabled={busy || !data.canManage || !!v.revokedAt}
                            onClick={() =>
                              setConfirm({ row: v, action: "revoke" })
                            }
                          >
                            Revoke link
                          </button>
                          <button
                            className="button"
                            disabled={busy || !data.canManage || !!v.redactedAt}
                            onClick={() =>
                              setConfirm({ row: v, action: "erase" })
                            }
                          >
                            Erase invitation details
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {issued && (
        <Modal
          title="Save your invitation links"
          onClose={() => setIssued(null)}
        >
          <p>
            These links are shown for this batch only. Save them now and share
            each link only with its intended participant. No messages have been
            sent.
          </p>
          <div className="visual-stack">
            {issued.map((l) => (
              <label key={l.invitation.id}>
                {l.invitation.reference || "Details removed"}
                <input
                  aria-label={`Invitation link for ${l.invitation.reference}`}
                  readOnly
                  value={location.origin + l.path}
                />
                <button
                  className="button"
                  onClick={() =>
                    run(async () => {
                      await navigator.clipboard.writeText(
                        location.origin + l.path,
                      );
                      setNotice("Invitation link copied.");
                    })
                  }
                >
                  Copy invitation link
                </button>
              </label>
            ))}
          </div>
          <button
            className="button primary"
            onClick={() =>
              download(
                csv([
                  ["participant_reference", "invitation_link", "expires_at"],
                  ...issued.map((l) => [
                    l.invitation.reference,
                    location.origin + l.path,
                    l.invitation.expiresAt,
                  ]),
                ]),
                "private-invitation-links.csv",
              )
            }
          >
            Download private invitation links
          </button>
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
      {confirm && (
        <Modal
          title={
            confirm.action === "replace"
              ? "Replace unused invitation"
              : confirm.action === "erase"
                ? "Erase invitation details"
                : "Revoke invitation link"
          }
          onClose={() => setConfirm(null)}
        >
          <p>
            {confirm.action === "replace"
              ? "This creates a new link with the same reference and tags. The old link will no longer admit anyone. Save the new link before closing it."
              : confirm.action === "erase"
                ? "This removes the invitation reference and preset tags and revokes unused admission. It does not delete an existing interview or its collected attributes. Delete the response in Responses for full source deletion."
                : "This prevents new admission with the link. An already admitted participant keeps access to their existing interview."}
          </p>
          {confirm.action === "replace" && (
            <label>
              Replacement link valid for days
              <input
                type="number"
                min={1}
                max={90}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </label>
          )}
          <button
            className="button primary"
            disabled={busy || !Number.isInteger(days) || days < 1 || days > 90}
            onClick={() =>
              run(() =>
                confirm.action === "replace"
                  ? issue(confirm.row)
                  : action(confirm.row, confirm.action),
              )
            }
          >
            {confirm.action === "replace"
              ? "Replace and show new link"
              : confirm.action === "erase"
                ? "Erase reference and tags"
                : "Revoke invitation"}
          </button>
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
    </section>
  );
}
