import { z } from "zod";
import { actor, body, respond, fail, canLaunch, limit } from "./http";
import { get, put, list, hash, now, transaction, requireStudy } from "./db";
import type { Study } from "./domain";
import type { ParticipantInvitation } from "./recruitment";
import { retention } from "./features";
import {
  emailDraftInput,
  emailLinkToken,
  maskedEmail,
  recipientKey,
  reminderIssue,
  retryExpired,
  deliveryStates,
  stopDelivery,
  type InvitationEmail,
  type EmailPayload,
} from "./invitation-email";
import {
  emailEncryptionReady,
  openEmail,
  sealEmail,
} from "./invitation-email-crypto";
import {
  emailConfiguration,
  sendInvitationEmail,
  invitationDelivery,
} from "./invitation-email-provider";
import { csv } from "./evidence";
function ready() {
  if (!emailEncryptionReady())
    fail(
      503,
      "Email encryption is not configured. Ask the admin to connect email settings.",
    );
}
async function invite(s: Study, id: string) {
  const v = await get<ParticipantInvitation>(
    "participantInvitation",
    id,
    s.workspaceId,
  );
  if (!v || v.studyId !== s.id) fail(404, "Participant invitation not found.");
  if (
    v.claimedAt ||
    v.revokedAt ||
    v.redactedAt ||
    v.replacedBy ||
    v.responseDeletedAt ||
    Date.parse(v.expiresAt) <= Date.now()
  )
    fail(409, "Only valid, unused invitation links can be emailed.");
  return v;
}
async function suppressed(j: { recipientHash: string; workspaceId: string }) {
  return !!(await get("emailSuppression", j.recipientHash, j.workspaceId));
}
function view(j: InvitationEmail, manage: boolean) {
  let payload: EmailPayload | undefined;
  try {
    payload = openEmail<EmailPayload>(j.sealed, j.id);
  } catch {}
  return {
    id: j.id,
    invitationId: j.invitationId,
    kind: j.kind,
    version: j.version,
    state: j.state,
    to: payload
      ? manage
        ? payload.to[0]
        : maskedEmail(payload.to[0])
      : "Encrypted address unavailable",
    subject: payload?.subject || "",
    createdAt: j.createdAt,
    acceptedAt: j.acceptedAt || null,
    delivery: j.delivery || null,
    checkedAt: j.checkedAt || null,
    attempts: j.attempts,
    error: j.error || null,
    retryExpired: retryExpired(j),
  };
}
export async function dispatchInvitationEmail(req: Request, p: string[]) {
  if (p[0] !== "studies" || !p[1] || p[2] !== "emails") return null;
  await retention();
  const a = await actor(),
    s = await requireStudy(p[1], a),
    c = emailConfiguration();
  if (req.method === "GET" && p.length === 3) {
    const jobs = await list<InvitationEmail>(
      "invitationEmail",
      a.workspaceId,
      s.id,
    );
    return respond({
      configured: c.ready && emailEncryptionReady(),
      encryptionReady: emailEncryptionReady(),
      sender: c.from,
      replyTo: c.replyTo,
      origin: c.origin,
      canManage: a.role !== "collaborator",
      messages: await Promise.all(
        jobs.map(async (j) => ({
          ...view(j, a.role !== "collaborator"),
          suppressed: await suppressed(j),
        })),
      ),
    });
  }
  if (req.method === "GET" && p[3] === "export" && p.length === 4) {
    const jobs = await list<InvitationEmail>(
      "invitationEmail",
      a.workspaceId,
      s.id,
    );
    return new Response(
      csv([
        [
          "message_id",
          "invitation_id",
          "kind",
          "recipient",
          "subject",
          "state",
          "accepted_at",
          "delivery",
          "checked_at",
          "attempts",
          "error",
        ],
        ...jobs.map((j) => {
          const v = view(j, a.role !== "collaborator");
          return [
            v.id,
            v.invitationId,
            v.kind,
            v.to,
            v.subject,
            v.state,
            v.acceptedAt || "",
            v.delivery || "",
            v.checkedAt || "",
            String(v.attempts),
            v.error || "",
          ];
        }),
      ]),
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="invitation-email-delivery.csv"',
          "Cache-Control": "private, no-store",
        },
      },
    );
  }
  canLaunch(a);
  ready();
  if (req.method === "POST" && p.length === 3) {
    const input = emailDraftInput.parse(await body(req));
    const id = hash(JSON.stringify([s.id, input.requestId])),
      fingerprint = hash(JSON.stringify(input));
    if (!c.metadataReady)
      fail(
        503,
        "Configure the public URL, sender and reply address before creating email drafts.",
      );
    let token: string;
    try {
      token = emailLinkToken(input.link, c.origin, s.id);
    } catch {
      fail(
        400,
        "Paste the original individual invitation link for this study.",
      );
    }
    if (hash(token) !== input.invitationId)
      fail(400, "The pasted link does not match the selected invitation.");
    await transaction(async () => {
      await invite(s, input.invitationId);
      const existing = await get<InvitationEmail>(
        "invitationEmail",
        id,
        a.workspaceId,
      );
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          fail(
            409,
            "This draft request was already used for different content.",
          );
        return;
      }
      const recipientHash = hash(recipientKey(a.workspaceId, input.to));
      if (await suppressed({ recipientHash, workspaceId: a.workspaceId }))
        fail(409, "Email to this address has been stopped in this workspace.");
      const all = await list<InvitationEmail>(
        "invitationEmail",
        a.workspaceId,
        s.id,
      );
      if (all.length >= 1000)
        fail(409, "This study has reached its email-record limit.");
      const issue = reminderIssue(
        input.kind,
        all.filter((j) => j.invitationId === input.invitationId),
      );
      if (issue) fail(409, issue);
      const previous = all.find(
        (j) => j.invitationId === input.invitationId && j.state === "accepted",
      );
      if (previous && previous.recipientHash !== recipientHash)
        fail(
          409,
          "A reminder must use the initial invitation’s email address.",
        );
      const payload: EmailPayload = {
        from: c.from,
        reply_to: c.replyTo,
        to: [input.to],
        subject: input.subject,
        text:
          input.message +
          "\n\n" +
          input.link +
          "\n\nIf you do not wish to receive reminders, reply to " +
          c.replyTo +
          ".",
      };
      await put("invitationEmail", {
        id,
        workspaceId: a.workspaceId,
        studyId: s.id,
        invitationId: input.invitationId,
        kind: input.kind,
        version: 1,
        createdAt: now(),
        createdBy: a.name,
        state: "draft",
        sealed: sealEmail(payload, id),
        fingerprint,
        recipientHash,
        attempts: 0,
      } satisfies InvitationEmail);
    });
    return respond(
      {
        message: view(
          (await get<InvitationEmail>("invitationEmail", id, a.workspaceId))!,
          true,
        ),
      },
      201,
    );
  }
  const j = p[3]
    ? await get<InvitationEmail>("invitationEmail", p[3], a.workspaceId)
    : undefined;
  if (!j || j.studyId !== s.id) fail(404, "Email message not found.");
  if (req.method === "GET" && p.length === 4) {
    return respond({
      message: {
        ...view(j, true),
        payload: openEmail<EmailPayload>(j.sealed, j.id),
        suppressed: await suppressed(j),
      },
    });
  }
  if (req.method === "POST" && p.length === 5) {
    const input = z
      .object({
        version: z.number().int().min(1),
        confirmed: z.literal(true).optional(),
      })
      .parse(await body(req));
    if (p[4] === "send") {
      if (!input.confirmed)
        fail(
          400,
          "Confirm the recipient, message and permission to contact this participant.",
        );
      limit("email-send:" + a.workspaceId, 30);
      let current!: InvitationEmail,
        payload!: EmailPayload,
        already = false;
      await transaction(async () => {
        current = (await get<InvitationEmail>(
          "invitationEmail",
          j.id,
          a.workspaceId,
        ))!;
        if (!current) fail(404, "Email message not found.");
        if (current.state === "accepted") {
          already = true;
          return;
        }
        if (current.version !== input.version)
          fail(409, "This email changed. Refresh before sending.");
        if (current.state === "cancelled")
          fail(409, "This email was cancelled.");
        if ((current.leaseUntil || 0) > Date.now())
          fail(409, "A send attempt is still in progress. Refresh shortly.");
        if (retryExpired(current))
          fail(
            409,
            "The safe retry window has ended. Reconcile delivery in Resend; this message cannot be resent.",
          );
        const source = await requireStudy(s.id, a);
        if (source.fielding !== "active")
          fail(409, "Open fielding before sending participant email.");
        await invite(source, current.invitationId);
        if (await suppressed(current))
          fail(
            409,
            "Email to this address has been stopped in this workspace.",
          );
        if (!c.ready)
          fail(
            503,
            "Connect the verified email sender and provider key before sending.",
          );
        if (current.providerKeyHash && current.providerKeyHash !== hash(c.key))
          fail(
            409,
            "The provider key changed. Reconcile the earlier attempt before proceeding.",
          );
        // Recheck reminder limits at dispatch, not only when the draft was created.
        const siblings = (
          await list<InvitationEmail>("invitationEmail", a.workspaceId, s.id)
        ).filter(
          (v) => v.invitationId === current.invitationId && v.id !== current.id,
        );
        const issue = reminderIssue(current.kind, siblings);
        if (issue) fail(409, issue);
        payload = openEmail<EmailPayload>(current.sealed, current.id);
        current = {
          ...current,
          state: "sending",
          firstAttemptAt: current.firstAttemptAt || now(),
          leaseUntil: Date.now() + 60000,
          providerKeyHash: hash(c.key),
          attempts: current.attempts + 1,
          version: current.version + 1,
          error: undefined,
        };
        await put("invitationEmail", current);
      });
      if (already) return respond({ message: view(current, true) });
      const outcome = await sendInvitationEmail(payload, current.id);
      await transaction(async () => {
        const fresh = await get<InvitationEmail>(
          "invitationEmail",
          current.id,
          a.workspaceId,
        );
        if (
          !fresh ||
          fresh.state === "accepted" ||
          fresh.attempts !== current.attempts
        )
          return;
        fresh.leaseUntil = undefined;
        fresh.version++;
        if (outcome.ok) {
          fresh.state = "accepted";
          fresh.providerId = outcome.id;
          fresh.acceptedAt = now();
          fresh.delivery = "accepted";
          fresh.error = undefined;
        } else {
          fresh.state = outcome.uncertain ? "uncertain" : "failed";
          fresh.error = outcome.error;
        }
        await put("invitationEmail", fresh);
      });
      const saved = await get<InvitationEmail>(
        "invitationEmail",
        current.id,
        a.workspaceId,
      );
      return respond(
        { message: saved ? view(saved, true) : null },
        outcome.ok ? 200 : 502,
      );
    }
    if (p[4] === "check") {
      if (!c.ready)
        fail(503, "Connect the email provider before checking delivery.");
      if (!j.providerId)
        fail(409, "There is no confirmed provider message to check.");
      limit("email-status:" + a.workspaceId, 60);
      const delivery = await invitationDelivery(j.providerId);
      if (!delivery || !deliveryStates.has(delivery))
        fail(
          502,
          "Delivery status could not be retrieved. Check the provider dashboard and API read permissions.",
        );
      await transaction(async () => {
        const fresh = await get<InvitationEmail>(
          "invitationEmail",
          j.id,
          a.workspaceId,
        );
        if (!fresh) return;
        fresh.delivery = delivery;
        fresh.checkedAt = now();
        fresh.version++;
        await put("invitationEmail", fresh);
        if (stopDelivery.has(delivery))
          await put("emailSuppression", {
            id: fresh.recipientHash,
            workspaceId: a.workspaceId,
            createdAt: now(),
            reason: delivery,
          });
      });
      return respond({ ok: true });
    }
    if (["cancel", "suppress"].includes(p[4])) {
      await transaction(async () => {
        const fresh = await get<InvitationEmail>(
          "invitationEmail",
          j.id,
          a.workspaceId,
        );
        if (!fresh) fail(404, "Email message not found.");
        if (fresh.version !== input.version)
          fail(409, "This email changed. Refresh first.");
        if (p[4] === "suppress") {
          await put("emailSuppression", {
            id: fresh.recipientHash,
            workspaceId: a.workspaceId,
            createdAt: now(),
            reason: "researcher_stop",
          });
          return;
        }
        if (fresh.state !== "draft" && fresh.state !== "failed")
          fail(
            409,
            "Only an unsent draft or a definitively failed email can be cancelled. Reconcile uncertain delivery first.",
          );
        await put("invitationEmail", {
          ...fresh,
          state: "cancelled",
          version: fresh.version + 1,
        });
      });
      return respond({ ok: true });
    }
  }
  fail(405, "Unsupported participant email action.");
}
