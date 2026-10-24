"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { Modal, Spinner } from "./components";
import type { EmailPayload } from "@/lib/invitation-email";
type Message = {
  id: string;
  invitationId: string;
  version: number;
  kind: string;
  state: string;
  to: string;
  subject: string;
  createdAt: string;
  acceptedAt: string | null;
  delivery: string | null;
  checkedAt: string | null;
  attempts: number;
  error: string | null;
  retryExpired: boolean;
  suppressed: boolean;
};
type Data = {
  configured: boolean;
  encryptionReady: boolean;
  sender: string;
  replyTo: string;
  origin: string;
  canManage: boolean;
  messages: Message[];
};
type Invitation = {
  id: string;
  reference: string;
  linkStatus: string;
  language: string | null;
};
export default function InvitationEmailPanel({
  studyId,
  dataVersion,
}: {
  studyId: string;
  dataVersion: number;
}) {
  const [data, setData] = useState<Data | null>(null),
    [invitations, setInvitations] = useState<Invitation[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(""),
    [kind, setKind] = useState("invitation"),
    [to, setTo] = useState(""),
    [subject, setSubject] = useState("Invitation to share your perspective"),
    [message, setMessage] = useState(
      "We would like to hear about your experience. If you would like to participate, please use your individual interview link below.",
    ),
    [link, setLink] = useState(""),
    [preview, setPreview] = useState<{
      row: Message;
      payload: EmailPayload;
    } | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [confirmAction, setConfirmAction] = useState<{
      row: Message;
      action: "cancel" | "suppress";
    } | null>(null);
  const pending = useRef<{ semantic: string; id: string } | null>(null),
    root = `studies/${studyId}/emails`;
  async function load() {
    const [d, r] = await Promise.all([
      api<Data>(root),
      api<{ invitations: Invitation[] }>(`studies/${studyId}/recruitment`),
    ]);
    setData(d);
    setInvitations(r.invitations);
  }
  useEffect(() => {
    let active = true;
    setData(null);
    void Promise.all([
      api<Data>(root),
      api<{ invitations: Invitation[] }>(`studies/${studyId}/recruitment`),
    ])
      .then(([d, r]) => {
        if (active) {
          setData(d);
          setInvitations(r.invitations);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [studyId, dataVersion]);
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
  async function inspect(id: string) {
    const r = await api<{ message: Message & { payload: EmailPayload } }>(
      root + "/" + id,
    );
    setConfirmed(false);
    setPreview({ row: r.message, payload: r.message.payload });
  }
  async function save() {
    const payload = {
        invitationId: selected,
        kind,
        to,
        subject,
        message,
        link,
      },
      semantic = JSON.stringify(payload);
    if (!pending.current || pending.current.semantic !== semantic)
      pending.current = { semantic, id: crypto.randomUUID() };
    const r = await api<{ message: Message }>(root, "POST", {
      ...payload,
      requestId: pending.current.id,
    });
    pending.current = null;
    await load();
    setTo("");
    setLink("");
    await inspect(r.message.id);
  }
  async function send() {
    if (!preview) return;
    const id = preview.row.id;
    try {
      await api(root + "/" + id + "/send", "POST", {
        version: preview.row.version,
        confirmed: true,
      });
      setPreview(null);
      setNotice(
        "Provider accepted this email. Acceptance does not establish delivery or participation.",
      );
      await load();
    } catch (e) {
      await load();
      try {
        await inspect(id);
      } catch {}
      throw e;
    }
  }
  async function act(row: Message, action: "cancel" | "suppress" | "check") {
    await api(root + "/" + row.id + "/" + action, "POST", {
      version: row.version,
    });
    await load();
    setConfirmAction(null);
    setNotice(
      action === "suppress"
        ? "Further email to this address is stopped in this workspace."
        : action === "check"
          ? "Latest provider delivery status retrieved."
          : "Email draft cancelled.",
    );
  }
  return (
    <section className="panel visual-stack recruitment-panel">
      <div className="panel-heading">
        <h2>Email invitations and reminders</h2>
        <button className="button" disabled={busy} onClick={() => run(load)}>
          Refresh email records
        </button>
      </div>
      <p>
        Review each recipient and exact message before sending. Reminders are
        manual, only for valid unused links, at least 24 hours apart and limited
        to three per invitation. No automatic campaign is running.
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
          {!data.configured && (
            <p className="notice">
              Email sending is not connected. An admin needs to configure a
              verified Resend sender, reply address and provider key. Manual
              invitation links remain available.
            </p>
          )}
          <p>
            From: {data.sender || "Not configured"} · Reply to:{" "}
            {data.replyTo || "Not configured"}
          </p>
          <p>
            Echo Lab currently requires Vercel sign-in. Email invitations do not
            bypass deployment access. Only contact people authorized for this
            internal study.
          </p>
          {!data.canManage && (
            <p>
              A researcher or admin must create, inspect or send messages.
              Recipient addresses are masked for collaborators.
            </p>
          )}
          <details>
            <summary>Draft participant email</summary>
            <form
              className="visual-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void run(save);
              }}
            >
              <label>
                Participant invitation
                <select
                  aria-label="Email participant invitation"
                  value={selected}
                  required
                  disabled={busy || !data.canManage}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setLink("");
                  }}
                >
                  <option value="">Choose an unused invitation</option>
                  {invitations
                    .filter((v) => v.linkStatus === "valid")
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.reference || v.id.slice(0, 8)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Email purpose
                <select
                  aria-label="Email purpose"
                  value={kind}
                  disabled={busy || !data.canManage}
                  onChange={(e) => setKind(e.target.value)}
                >
                  <option value="invitation">Initial invitation</option>
                  <option value="reminder">Reminder</option>
                </select>
              </label>
              <label>
                Recipient email
                <input
                  aria-label="Recipient email"
                  type="email"
                  required
                  maxLength={254}
                  value={to}
                  disabled={busy || !data.canManage}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
              <label>
                Individual invitation link
                <input
                  aria-label="Individual invitation link"
                  type="url"
                  required
                  maxLength={2000}
                  value={link}
                  disabled={busy || !data.canManage}
                  onChange={(e) => setLink(e.target.value)}
                />
              </label>
              <p>
                Paste the private link saved when you created the invitation. If
                it is lost, replace the unused invitation in Participant
                invitations. The app validates that this link belongs to the
                selected invitation.
              </p>
              <label>
                Email subject
                <input
                  aria-label="Email subject"
                  required
                  maxLength={160}
                  value={subject}
                  disabled={busy || !data.canManage}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </label>
              <label>
                Message before the link
                <textarea
                  aria-label="Email message"
                  required
                  rows={5}
                  maxLength={5000}
                  value={message}
                  disabled={busy || !data.canManage}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </label>
              <p>
                Your link and a reply-to instruction for declining reminders
                will be appended to the plain-text message. You can write the
                invitation in the participant’s language. Addresses and full
                message content are encrypted in storage.
              </p>
              <button
                className="button primary"
                disabled={
                  busy ||
                  !data.canManage ||
                  !data.encryptionReady ||
                  !data.sender ||
                  !data.replyTo ||
                  !data.origin
                }
              >
                Save and review email
              </button>
            </form>
          </details>
          <a className="button" href={"/api/" + root + "/export"}>
            Export email delivery records
          </a>
          <p>
            “Accepted” means the provider accepted the request. Use Check
            delivery to retrieve its latest status. Delivery does not establish
            an open, consent or completion. Bounces, complaints and manual stops
            block further email to that address across the workspace.
          </p>
          {!data.messages.length ? (
            <p>No email drafts or deliveries yet.</p>
          ) : (
            <div className="pricing-table">
              <table>
                <thead>
                  <tr>
                    <th>Recipient / subject</th>
                    <th>Purpose</th>
                    <th>Send state</th>
                    <th>Delivery</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.messages.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.to}
                        <small>{row.subject}</small>
                        <small>
                          {new Date(row.createdAt).toLocaleString()}
                        </small>
                      </td>
                      <td>{row.kind}</td>
                      <td>
                        {row.state}
                        <small>{row.attempts} attempts</small>
                        {row.suppressed && <small>Email stopped</small>}
                        {row.error && <small>{row.error}</small>}
                        {row.retryExpired && row.state !== "accepted" && (
                          <small>
                            Safe retry window ended. Reconcile in Resend; do not
                            recreate this message blindly.
                          </small>
                        )}
                      </td>
                      <td>
                        {row.delivery || "Not sent"}
                        {row.checkedAt && (
                          <small>
                            {new Date(row.checkedAt).toLocaleString()}
                          </small>
                        )}
                      </td>
                      <td>
                        <div className="recruitment-actions">
                          <button
                            className="button"
                            disabled={busy || !data.canManage}
                            onClick={() => run(() => inspect(row.id))}
                          >
                            Review email
                          </button>
                          <button
                            className="button"
                            disabled={
                              busy ||
                              !data.canManage ||
                              row.state !== "accepted"
                            }
                            onClick={() => run(() => act(row, "check"))}
                          >
                            Check delivery
                          </button>
                          <button
                            className="button"
                            disabled={
                              busy ||
                              !data.canManage ||
                              !["draft", "failed"].includes(row.state)
                            }
                            onClick={() =>
                              setConfirmAction({ row, action: "cancel" })
                            }
                          >
                            Cancel email draft
                          </button>
                          <button
                            className="button"
                            disabled={busy || !data.canManage || row.suppressed}
                            onClick={() =>
                              setConfirmAction({ row, action: "suppress" })
                            }
                          >
                            Stop email to address
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p>
            Drafts are immutable: cancel an unsent draft and create a new one to
            edit it. Retries use the same provider key and exact message for up
            to 23 hours after the first attempt. An uncertain send may already
            have reached the provider; check Resend before replacing its
            invitation. In-flight emails cannot be recalled. Erasing invitation
            details or deleting its response removes linked email content and
            address records here; provider copies and CSV downloads need
            separate handling.
          </p>
        </>
      )}
      {preview && (
        <Modal
          title="Review participant email"
          onClose={() => {
            if (!busy) setPreview(null);
          }}
        >
          <div className="visual-stack">
            <p>To: {preview.payload.to[0]}</p>
            <p>
              From: {preview.payload.from} · Reply to:{" "}
              {preview.payload.reply_to}
            </p>
            <strong>{preview.payload.subject}</strong>
            <pre className="email-message-preview">{preview.payload.text}</pre>
            <p>State: {preview.row.state}</p>
            {preview.row.error && <p role="alert">{preview.row.error}</p>}
            {["draft", "failed", "uncertain", "sending"].includes(
              preview.row.state,
            ) && (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />{" "}
                  I reviewed this recipient and exact message, have permission
                  to contact them and understand the Vercel sign-in requirement.
                </label>
                <button
                  className="button primary"
                  disabled={
                    busy ||
                    !data?.configured ||
                    !confirmed ||
                    preview.row.suppressed ||
                    preview.row.retryExpired
                  }
                  onClick={() => run(send)}
                >
                  {preview.row.attempts
                    ? "Retry this exact email"
                    : "Send this email now"}
                </button>
              </>
            )}
            {error && <p role="alert">{error}</p>}
          </div>
        </Modal>
      )}
      {confirmAction && (
        <Modal
          title={
            confirmAction.action === "cancel"
              ? "Cancel email draft"
              : "Stop email to address"
          }
          onClose={() => {
            if (!busy) setConfirmAction(null);
          }}
        >
          <p>
            {confirmAction.action === "cancel"
              ? "This cancels this unsent draft. It does not revoke the participant’s invitation link."
              : "This blocks future email to this address throughout the workspace. It does not recall an email already in flight, revoke an invitation or delete a response."}
          </p>
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              run(() => act(confirmAction.row, confirmAction.action))
            }
          >
            Confirm{" "}
            {confirmAction.action === "cancel" ? "cancellation" : "email stop"}
          </button>
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
    </section>
  );
}
