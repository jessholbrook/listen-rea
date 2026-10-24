import { clearInvitationEmails } from "./invitation-email-cleanup";
import { z } from "zod";
import { actor, canLaunch, body, respond, fail, limit } from "./http";
import {
  get,
  put,
  list,
  hash,
  now,
  requireStudy,
  interviews,
  transaction,
} from "./db";
import type { Study, Interview, Revision, Actor } from "./domain";
import { retention } from "./features";
import { availableLanguages } from "./localization-server";
import { invitationToken } from "./recruitment-tokens";
import {
  invitationBatchInput,
  invitationView,
  referenceKey,
  redactInvitation,
  type ParticipantInvitation,
  type RecruitmentSettings,
  type InvitationBatch,
} from "./recruitment";
import { csv } from "./evidence";
export async function recruitmentSettings(
  s: Study,
): Promise<RecruitmentSettings> {
  return (
    (await get<RecruitmentSettings>(
      "recruitmentSettings",
      s.id,
      s.workspaceId,
    )) || {
      id: s.id,
      workspaceId: s.workspaceId,
      studyId: s.id,
      version: 0,
      mode: "open",
    }
  );
}
export async function admissionInvitation(s: Study, raw?: string | null) {
  if (raw !== undefined && raw !== null) {
    if (!/^[a-zA-Z0-9_-]{43}$/.test(raw))
      fail(404, "This invitation link is invalid. Contact the research team.");
    const v = await get<ParticipantInvitation>(
      "participantInvitation",
      hash(raw),
      s.workspaceId,
    );
    if (!v || v.studyId !== s.id)
      fail(404, "This invitation link is invalid. Contact the research team.");
    if (v.claimedAt || v.responseDeletedAt)
      fail(
        409,
        "This invitation has already been used. Return to the browser where you started, or contact the research team.",
      );
    if (
      v.revokedAt ||
      v.redactedAt ||
      v.replacedBy ||
      Date.parse(v.expiresAt) <= Date.now()
    )
      fail(
        410,
        "This invitation has expired or been revoked. Contact the research team.",
      );
    return v;
  }
  if ((await recruitmentSettings(s)).mode === "invitation_only")
    fail(403, "An individual invitation link is required for this study.");
}
export async function claimInvitation(v: ParticipantInvitation, i: Interview) {
  const at = now();
  i.invitationId = v.id;
  await put("participantInvitation", {
    ...v,
    interviewId: i.id,
    claimedAt: at,
    updatedAt: at,
    version: v.version + 1,
  });
}
async function roster(s: Study) {
  const [rows, sources] = await Promise.all([
    list<ParticipantInvitation>("participantInvitation", s.workspaceId, s.id),
    interviews(s),
  ]);
  return {
    rows,
    sources,
    views: rows.map((v) =>
      invitationView(
        v,
        sources.find((i) => i.id === v.interviewId),
      ),
    ),
  };
}
async function issue(
  s: Study,
  a: Actor,
  input: z.infer<typeof invitationBatchInput>,
) {
  const batchId = s.id + ":" + input.requestId,
    fingerprint = hash(JSON.stringify(input));
  let invitations: ParticipantInvitation[] = [];
  const tokens = input.recipients.map((_, index) =>
    invitationToken(input.secret, a.workspaceId, s.id, input.requestId, index),
  );
  await transaction(async () => {
    const existing = await get<InvitationBatch>(
      "invitationBatch",
      batchId,
      a.workspaceId,
    );
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        fail(
          409,
          "This request was already used for different invitations. Start a new batch.",
        );
      for (const id of existing.ids) {
        const v = await get<ParticipantInvitation>(
          "participantInvitation",
          id,
          a.workspaceId,
        );
        if (!v)
          fail(
            409,
            "This batch is no longer available. Refresh the invitations list.",
          );
        invitations.push(v);
      }
      return;
    }
    const current = await requireStudy(s.id, a),
      rev = current.revisionId
        ? await get<Revision>("revision", current.revisionId, a.workspaceId)
        : undefined;
    if (!rev)
      fail(400, "Publish a guide before creating participant invitations.");
    if (
      Date.parse(input.expiresAt) <= Date.now() ||
      Date.parse(input.expiresAt) > Date.now() + 90 * 86400000
    )
      fail(400, "Invitation expiry must be in the future and within 90 days.");
    if (
      input.language &&
      !availableLanguages(rev.guide).includes(input.language)
    )
      fail(400, "Choose a reviewed language available in the published guide.");
    const all = await list<ParticipantInvitation>(
      "participantInvitation",
      a.workspaceId,
      s.id,
    );
    if (all.length + input.recipients.length > 1000)
      fail(
        400,
        "This study supports up to 1,000 invitation records. Use a new study or allow retention cleanup before adding more.",
      );
    let old: ParticipantInvitation | undefined;
    if (input.replace) {
      old = await get<ParticipantInvitation>(
        "participantInvitation",
        input.replace.id,
        a.workspaceId,
      );
      if (!old || old.studyId !== s.id) fail(404, "Invitation not found.");
      if (old.version !== input.replace.version)
        fail(409, "This invitation changed. Refresh before replacing it.");
      if (
        old.claimedAt ||
        old.responseDeletedAt ||
        old.redactedAt ||
        old.replacedBy
      )
        fail(
          409,
          "Only an unused invitation with retained details can be replaced.",
        );
      if (
        input.recipients[0].reference !== old.reference ||
        JSON.stringify(
          Object.entries(input.recipients[0].attributes).sort(),
        ) !== JSON.stringify(Object.entries(old.attributes).sort())
      )
        fail(
          400,
          "Replacement must preserve the participant reference and tags.",
        );
    }
    for (const r of input.recipients)
      if (
        all.some(
          (v) =>
            v.id !== old?.id &&
            !v.redactedAt &&
            !v.replacedBy &&
            referenceKey(v.reference) === referenceKey(r.reference),
        )
      )
        fail(
          409,
          "A participant reference already exists in this study. Replace its unused link instead.",
        );
    const at = now();
    invitations = input.recipients.map((r, index) => ({
      id: hash(tokens[index]),
      workspaceId: a.workspaceId,
      studyId: s.id,
      batchId,
      version: 1,
      reference: r.reference,
      attributes: r.attributes,
      language: input.language,
      createdAt: at,
      updatedAt: at,
      createdBy: a.name,
      expiresAt: input.expiresAt,
    }));
    for (const v of invitations) {
      if (await get("participantInvitation", v.id))
        fail(409, "Invitation already exists.");
      await put("participantInvitation", v);
    }
    if (old)
      await put("participantInvitation", {
        ...old,
        revokedAt: old.revokedAt || at,
        replacedBy: invitations[0].id,
        updatedAt: at,
        version: old.version + 1,
      });
    await put("invitationBatch", {
      id: batchId,
      workspaceId: a.workspaceId,
      studyId: s.id,
      fingerprint,
      ids: invitations.map((v) => v.id),
      createdAt: at,
    });
  });
  const sources = await interviews(s);
  return invitations.map((v, index) => ({
    invitation: invitationView(
      v,
      sources.find((i) => i.id === v.interviewId),
    ),
    path: `/s/${s.id}#invite=${tokens[index]}`,
  }));
}
export async function dispatchRecruitment(req: Request, p: string[]) {
  if (
    p[0] !== "studies" ||
    !p[1] ||
    !["recruitment", "invitations"].includes(p[2])
  )
    return null;
  await retention();
  const a = await actor(),
    s = await requireStudy(p[1], a);
  if (p[2] === "recruitment" && p.length === 3) {
    if (req.method === "GET") {
      const data = await roster(s),
        rev = s.revisionId
          ? await get<Revision>("revision", s.revisionId, a.workspaceId)
          : undefined;
      const reserved = data.sources.filter(
        (i) =>
          !i.preview && !i.origin && ["active", "complete"].includes(i.status),
      ).length;
      return respond({
        settings: await recruitmentSettings(s),
        invitations: data.views,
        canManage: a.role !== "collaborator",
        languages: rev ? availableLanguages(rev.guide) : [],
        capacity: {
          limit: rev?.guide.limit || null,
          reserved,
          remaining: rev ? Math.max(0, rev.guide.limit - reserved) : null,
        },
        counts: {
          issued: data.views.length,
          ready: data.views.filter((v) => v.status === "ready").length,
          markedShared: data.views.filter((v) => v.sharedAt).length,
          inProgress: data.views.filter((v) => v.status === "in_progress")
            .length,
          complete: data.views.filter((v) => v.status === "complete").length,
          screenedOut: data.views.filter((v) => v.status === "screened_out")
            .length,
          withdrawn: data.views.filter((v) => v.status === "withdrawn").length,
          responseDeleted: data.views.filter(
            (v) => v.status === "response_deleted",
          ).length,
        },
      });
    }
    if (req.method === "PUT") {
      canLaunch(a);
      const input = z
        .object({
          version: z.number().int().min(0),
          mode: z.enum(["open", "invitation_only"]),
        })
        .parse(await body(req));
      await transaction(async () => {
        const current = await recruitmentSettings(s);
        if (current.version !== input.version)
          fail(409, "Admission settings changed. Refresh before saving.");
        await put("recruitmentSettings", {
          ...current,
          ...input,
          version: current.version + 1,
          updatedAt: now(),
          updatedBy: a.name,
        });
      });
      return respond({ settings: await recruitmentSettings(s) });
    }
    fail(405, "Use GET or PUT for admission settings.");
  }
  if (p[2] === "invitations" && p[3] === "export" && req.method === "GET") {
    const { views } = await roster(s);
    return new Response(
      csv([
        [
          "invitation_id",
          "participant_reference",
          "status",
          "link_status",
          "created_at",
          "expires_at",
          "marked_shared_at",
          "claimed_at",
          "response_id",
          "response_status",
          "excluded",
          "revoked_at",
          "details_erased_at",
          "response_deleted_at",
          "replaced_by",
          "preferred_language",
          "tags",
        ],
        ...views.map((v) => [
          v.id,
          v.reference,
          v.status,
          v.linkStatus,
          v.createdAt,
          v.expiresAt,
          v.sharedAt || "",
          v.claimedAt || "",
          v.response?.id || "",
          v.response?.status || "",
          v.response ? String(v.response.excluded) : "",
          v.revokedAt || "",
          v.redactedAt || "",
          v.responseDeletedAt || "",
          v.replacedBy || "",
          v.language || "",
          JSON.stringify(v.attributes),
        ]),
      ]),
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="participant-invitations.csv"',
          "Cache-Control": "private, no-store",
        },
      },
    );
  }
  canLaunch(a);
  if (p[2] === "invitations" && p.length === 3 && req.method === "POST") {
    limit("participant-invitations:" + a.workspaceId, 30);
    return respond(
      { links: await issue(s, a, invitationBatchInput.parse(await body(req))) },
      201,
    );
  }
  if (
    p[2] === "invitations" &&
    p.length === 5 &&
    req.method === "POST" &&
    ["shared", "revoke", "erase"].includes(p[4])
  ) {
    const input = z
      .object({ version: z.number().int().min(1) })
      .parse(await body(req));
    await transaction(async () => {
      const v = await get<ParticipantInvitation>(
        "participantInvitation",
        p[3],
        a.workspaceId,
      );
      if (!v || v.studyId !== s.id) fail(404, "Invitation not found.");
      if (v.version !== input.version)
        fail(409, "Invitation changed. Refresh before updating it.");
      const at = now();
      if (p[4] === "erase") {
        await clearInvitationEmails(v);
        await put("participantInvitation", redactInvitation(v, at));
      } else if (p[4] === "revoke")
        await put("participantInvitation", {
          ...v,
          revokedAt: v.revokedAt || at,
          version: v.version + 1,
          updatedAt: at,
        });
      else {
        if (
          v.redactedAt ||
          v.revokedAt ||
          v.claimedAt ||
          Date.parse(v.expiresAt) <= Date.now()
        )
          fail(
            409,
            "Only an available, unused invitation can be marked shared.",
          );
        await put("participantInvitation", {
          ...v,
          sharedAt: v.sharedAt || at,
          version: v.version + 1,
          updatedAt: at,
        });
      }
    });
    return respond({ ok: true });
  }
  fail(404, "Invitation route not found.");
}
