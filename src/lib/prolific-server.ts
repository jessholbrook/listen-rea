import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  db,
  get,
  list,
  put,
  hash,
  now,
  uid,
  transaction,
  requireStudy,
} from "./db";
import { actor, body, fail, respond } from "./http";
import type { Actor, Study, Revision, Interview } from "./domain";
import type { SurveyHandoff } from "./survey-handoff";
import {
  prolificConfigInput,
  prolificId,
  prolificPayload,
  prolificUrl,
  projectedCost,
  submissionInput,
  reviewDeadline,
  type ProlificConfig,
  type ProlificOperation,
  type ProlificSubmission,
} from "./prolific";
import { prolificTransport, type ProlificTransport } from "./prolific-provider";
import { prolificClaimId, prolificSettings } from "./prolific-admission";
import { csv } from "./evidence";
async function member(a: Actor) {
  const row = await db
    .prepare("SELECT role,workspace_id FROM users WHERE id=?")
    .get(a.id);
  if (row?.role !== "admin" || row.workspace_id !== a.workspaceId)
    fail(
      403,
      "Current workspace admin access is required for provider actions.",
    );
}
async function binding(a: Actor, provider: ProlificTransport) {
  await member(a);
  const b = provider.binding(a.workspaceId);
  if (!b)
    fail(
      503,
      "Prolific is not configured for this workspace. Save the plan first; provider credentials can be connected later.",
    );
  const me = z
    .object({ id: prolificId })
    .parse(await provider.request(a.workspaceId, "users/me/"));
  if (me.id !== b.researcherId)
    fail(
      409,
      "The Prolific researcher account does not match the configured identity.",
    );
  const project = z
    .object({ id: prolificId })
    .parse(
      await provider.request(a.workspaceId, "projects/" + b.projectId + "/"),
    );
  if (project.id !== b.projectId)
    fail(409, "The Prolific project does not match this connection.");
  return b;
}
async function currentConfig(s: Study) {
  return get<ProlificConfig>("prolificConfig", s.id, s.workspaceId);
}
async function fresh(s: Study, c: ProlificConfig) {
  const rev =
    c.revisionId === s.revisionId
      ? await get<Revision>("revision", c.revisionId, s.workspaceId)
      : undefined;
  if (!rev || rev.studyId !== s.id)
    fail(
      409,
      "The published Echo Lab revision changed. Save and review a current recruitment plan.",
    );
  return rev;
}
function view(c: ProlificConfig) {
  const { connectionHash, quote, ...rest } = c;
  return {
    ...rest,
    quote: quote
      ? {
          id: quote.id,
          totalMinor: quote.totalMinor,
          currency: quote.currency,
          expiresAt: quote.expiresAt,
        }
      : null,
  };
}
function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, value]) => JSON.stringify(k) + ":" + canonical(value))
        .join(",") +
      "}"
    );
  return JSON.stringify(v) ?? "null";
}
function remoteProjection(value: unknown) {
  const r = z
      .object({ id: prolificId, status: z.string().max(60) })
      .passthrough()
      .parse(value),
    p = r as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of [
    "name",
    "description",
    "estimated_completion_time",
    "reward",
    "total_available_places",
    "external_study_url",
    "prolific_id_option",
    "metadata",
    "completion_codes",
  ])
    out[key] = p[key];
  out.completion_codes = Array.isArray(p.completion_codes)
    ? p.completion_codes.map((v: any) => ({
        code: v.code,
        code_type: v.code_type,
        actions: Array.isArray(v.actions)
          ? v.actions.map((a: any) => ({ action: a.action }))
          : null,
      }))
    : null;
  out.project =
    typeof p.project === "object" && p.project
      ? (p.project as { id?: unknown }).id
      : p.project;
  for (const key of ["device_compatibility", "peripheral_requirements"])
    out[key] = Array.isArray(p[key]) ? [...(p[key] as string[])].sort() : [];
  out.filters = p.filters || [];
  const submissions = p.submissions_config as
    | {
        max_submissions_per_participant?: number;
        auto_rejection_categories?: unknown[];
      }
    | undefined;
  out.submissions_config = {
    max_submissions_per_participant:
      submissions?.max_submissions_per_participant ?? 1,
    auto_rejection_categories: submissions?.auto_rejection_categories || [],
  };
  return {
    id: r.id,
    status: r.status,
    payload: out,
    digest: hash(canonical(out)),
  };
}
function verifiedRemote(value: unknown, c: ProlificConfig) {
  const r = remoteProjection(value),
    expected = remoteProjection({ ...c.payload, id: r.id, status: r.status });
  if (r.digest !== expected.digest)
    fail(
      409,
      "The provider study differs from the reviewed plan. Pause admissions and reconcile in Prolific before proceeding.",
    );
  return r;
}
async function noPending(c: ProlificConfig) {
  const op = c.operationId
    ? await get<ProlificOperation>(
        "prolificOperation",
        c.operationId,
        c.workspaceId,
      )
    : undefined;
  if (op && op.state !== "complete")
    fail(
      409,
      "A provider outcome is unresolved. Reconcile that request before another write.",
    );
}
function publicOrigin(req: Request) {
  const u = new URL(process.env.RESEARCH_PUBLIC_URL || req.url);
  if (
    u.protocol !== "https:" &&
    (process.env.VERCEL || !["127.0.0.1", "localhost"].includes(u.hostname))
  )
    fail(503, "Configure Echo Lab’s public HTTPS URL before recruitment.");
  return u.origin;
}
export async function syncProlific(
  studyId: string,
  workspaceId: string,
  provider = prolificTransport,
) {
  const s = await get<Study>("study", studyId, workspaceId),
    c = s && (await currentConfig(s)),
    b = provider.binding(workspaceId);
  if (
    !s ||
    !c ||
    !b ||
    c.connectionHash !== b.hash ||
    !(c.activeId || c.draftId)
  )
    fail(409, "No verified provider binding is available for reconciliation.");
  const remoteId = c.activeId || c.draftId!,
    remote = remoteProjection(
      await provider.request(workspaceId, "studies/" + remoteId + "/"),
    );
  let matches = true;
  try {
    verifiedRemote(
      { ...remote.payload, id: remote.id, status: remote.status },
      c,
    );
  } catch {
    matches = false;
  }
  const records: ReturnType<typeof submissionInput.parse>[] = [];
  for (let page = 1; page <= 10; page++) {
    const result = z
      .object({
        results: z.array(submissionInput).max(100),
        next: z.unknown().optional(),
      })
      .parse(
        await provider.request(
          workspaceId,
          `submissions/?study=${remoteId}&page_size=100&page=${page}`,
        ),
      );
    records.push(...result.results);
    if (result.next === null || (result.results.length < 100 && !result.next))
      break;
    if (page === 10)
      fail(
        413,
        "Provider submissions exceed the initial 1,000-row reconciliation limit. Review the provider dashboard.",
      );
  }
  await transaction(async () => {
    const current = await get<Study>("study", s.id, workspaceId),
      cfg = current && (await currentConfig(current));
    if (
      !current ||
      !cfg ||
      current.dataVersion !== s.dataVersion ||
      cfg.version !== c.version ||
      provider.binding(workspaceId)?.hash !== b.hash
    )
      fail(
        409,
        "Study sources or connection changed during reconciliation. Refresh again.",
      );
    await db
      .prepare(
        "DELETE FROM documents WHERE kind='prolificSubmission' AND workspace_id=? AND study_id=?",
      )
      .run(workspaceId, s.id);
    for (const row of records) {
      const claimId = prolificClaimId(
          workspaceId,
          s.id,
          remoteId,
          row.participant_id,
        ),
        claim = await get<SurveyHandoff>("surveyHandoff", claimId, workspaceId);
      if (claim?.responseDeletedAt) continue;
      const id = hash(s.id + ":" + row.id);
      await put("prolificSubmission", {
        id,
        workspaceId,
        studyId: s.id,
        providerId: row.id,
        participantId: row.participant_id,
        claimId,
        status: row.status,
        payment: row.payment_info?.status || "not_reported",
        completedAt: row.completed_at || null,
        reviewDeadline: reviewDeadline(row.status, row.completed_at),
        checkedAt: now(),
      } satisfies ProlificSubmission);
    }
    await put("prolificConfig", {
      ...cfg,
      providerStatus: remote.status,
      checkedAt: now(),
      admissionsEnabled:
        cfg.admissionsEnabled &&
        matches &&
        current.revisionId === cfg.revisionId &&
        remote.status === "ACTIVE",
      quote: undefined,
      version: cfg.version + 1,
    });
  });
}
export async function dispatchProlific(
  req: Request,
  p: string[],
  provider = prolificTransport,
  internalActor?: Actor,
): Promise<Response | null> {
  if (p[0] !== "studies" || !p[1] || p[2] !== "prolific") return null;
  const a = internalActor || (await actor()),
    s = await requireStudy(p[1], a),
    path = p[3],
    c = await currentConfig(s);
  if (
    req.method === "GET" &&
    (p.length === 3 || (p.length === 4 && path === "export"))
  ) {
    const rows = await list<ProlificSubmission>(
        "prolificSubmission",
        a.workspaceId,
        s.id,
      ),
      claims = await list<SurveyHandoff>("surveyHandoff", a.workspaceId, s.id),
      sources = await list<Interview>("interview", a.workspaceId, s.id),
      b = provider.binding(a.workspaceId);
    if (path === "export")
      return new Response(
        csv([
          [
            "provider_submission_id",
            "participant_id",
            "provider_status",
            "payment_status",
            "app_status",
            "excluded_from_research",
            "identity_match",
            "review_deadline",
            "checked_at",
          ],
          ...rows.map((r) => {
            const claim = claims.find((v) => v.id === r.claimId),
              i = sources.find((v) => v.id === claim?.interviewId);
            return [
              r.providerId,
              r.participantId,
              r.status,
              r.payment,
              i?.status || "unmatched",
              String(i?.excluded || false),
              String(
                !!(
                  claim?.sessionId === r.providerId &&
                  claim.responseId === r.participantId
                ),
              ),
              r.reviewDeadline || "",
              r.checkedAt,
            ];
          }),
        ]),
        {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition":
              'attachment; filename="prolific-reconciliation.csv"',
            "Cache-Control": "private, no-store",
          },
        },
      );
    return respond({
      acceptingParticipants:
        s.fielding === "active" && (await prolificSettings(s)).enabled,
      boundGuide:
        c?.revisionId || s.revisionId
          ? (
              await get<Revision>(
                "revision",
                (c?.revisionId || s.revisionId)!,
                s.workspaceId,
              )
            )?.guide || null
          : null,
      config: c ? view(c) : null,
      canManage: a.role === "admin",
      connected: !!b,
      testEnabled: b?.testEnabled || false,
      paidEnabled: b?.paidEnabled || false,
      revisionId: s.revisionId,
      studyVersion: s.version,
      fielding: s.fielding,
      operation: c?.operationId
        ? await get("prolificOperation", c.operationId, a.workspaceId)
        : null,
      participantUrl: prolificUrl(publicOrigin(req), s.id),
      rows: rows.map((r) => {
        const claim = claims.find((v) => v.id === r.claimId),
          i = sources.find((v) => v.id === claim?.interviewId);
        return {
          ...r,
          interviewId: i?.id || null,
          appStatus: i?.status || "unmatched",
          excluded: i?.excluded || false,
          identityMatched: !!(
            claim?.sessionId === r.providerId &&
            claim.responseId === r.participantId
          ),
          deadlineSoon: !!(
            r.reviewDeadline &&
            Date.parse(r.reviewDeadline) < Date.now() + 3 * 86400000
          ),
        };
      }),
    });
  }
  await member(a);
  if (req.method === "PUT" && p.length === 3) {
    const input = z
      .object({
        version: z.number().int().min(0),
        studyVersion: z.number().int().positive(),
        config: prolificConfigInput,
        reviewed: z.literal(true),
      })
      .strict()
      .parse(await body(req));
    await transaction(async () => {
      await member(a);
      const current = await requireStudy(s.id, a),
        old = await currentConfig(current);
      if (
        (old?.version || 0) !== input.version ||
        current.version !== input.studyVersion
      )
        fail(
          409,
          "The recruitment plan or guide changed. Refresh before saving.",
        );
      if (old) {
        await noPending(old);
        if (old.activeId)
          fail(
            409,
            "A launched study is immutable here. Pause it and manage changes in Prolific.",
          );
      }
      const rev =
        current.revisionId &&
        (await get<Revision>("revision", current.revisionId, a.workspaceId));
      if (!rev || rev.studyId !== s.id)
        fail(400, "Publish an Echo Lab guide before reviewing recruitment.");
      if (rev.guide.questions.some((q) => q.options.some((o) => o.rejects)))
        fail(
          400,
          "This initial Prolific connector does not support in-interview screen-outs. Use a guide without rejecting options; screening compensation needs provider-specific setup.",
        );
      if (input.config.places > rev.guide.limit)
        fail(
          400,
          "Provider places must fit within the published Echo Lab admission limit.",
        );
      const count = await db
        .prepare(
          "SELECT COUNT(*) AS n FROM documents WHERE kind='prolificConfig' AND workspace_id=?",
        )
        .get(a.workspaceId);
      if (!old && Number(count?.n) >= 20)
        fail(409, "This workspace supports up to 20 Prolific study bindings.");
      const marker = "echo:" + s.id + ":" + uid(),
        code = randomBytes(6).toString("hex").toUpperCase(),
        projectId =
          provider.binding(a.workspaceId)?.projectId || "CONNECT_PROJECT_FIRST",
        payload = prolificPayload(
          input.config,
          prolificUrl(publicOrigin(req), s.id),
          projectId,
          marker,
          code,
        );
      await put("prolificConfig", {
        id: s.id,
        studyId: s.id,
        workspaceId: a.workspaceId,
        input: input.config,
        version: (old?.version || 0) + 1,
        revisionId: current.revisionId!,
        marker,
        code,
        payload,
        fingerprint: hash(
          canonical([
            payload,
            current.revisionId,
            input.config.currency,
            input.config.maxCostMinor,
          ]),
        ),
        reviewedBy: a.id,
        reviewedAt: now(),
        admissionsEnabled: false,
        ...(old?.draftId
          ? {
              draftId: old.draftId,
              remoteMarker: old.remoteMarker,
              providerStatus: old.providerStatus,
              connectionHash: old.connectionHash,
            }
          : {}),
      } satisfies ProlificConfig);
    });
    return respond({ config: view((await currentConfig(s))!) });
  }
  if (!c) fail(400, "Save a reviewed recruitment plan first.");
  if (path === "verify" && req.method === "POST" && p.length === 4) {
    const input = z
      .object({
        version: z.number().int().positive(),
        reviewed: z.literal(true),
      })
      .strict()
      .parse(await body(req));
    const b = await binding(a, provider);
    if (c.version !== input.version || c.payload.project !== b.projectId)
      fail(409, "Save a plan for the configured provider project first.");
    if (c.activeId || c.draftId)
      verifiedRemote(
        await provider.request(
          a.workspaceId,
          "studies/" + (c.activeId || c.draftId) + "/",
        ),
        c,
      );
    await transaction(async () => {
      await member(a);
      const cfg = (await currentConfig(s))!;
      if (cfg.version !== c.version) fail(409, "Plan changed. Refresh first.");
      await put("prolificConfig", {
        ...cfg,
        connectionHash: b.hash,
        admissionsEnabled: false,
        quote: undefined,
        version: cfg.version + 1,
      });
    });
    return respond({ verified: true });
  }
  if (path === "sync" && req.method === "POST" && p.length === 4) {
    await binding(a, provider);
    await syncProlific(s.id, a.workspaceId, provider);
    return respond({ refreshed: true });
  }
  if (path === "hold" && req.method === "POST" && p.length === 4) {
    const input = z
      .object({ version: z.number().int().positive() })
      .strict()
      .parse(await body(req));
    await transaction(async () => {
      await member(a);
      const cfg = (await currentConfig(s))!;
      if (cfg.version !== input.version)
        fail(409, "Plan changed. Refresh first.");
      await put("prolificConfig", {
        ...cfg,
        admissionsEnabled: false,
        quote: undefined,
        version: cfg.version + 1,
      });
    });
    return respond({ held: true });
  }
  if (path === "quote" && req.method === "POST" && p.length === 4) {
    const input = z
      .object({ version: z.number().int().positive() })
      .strict()
      .parse(await body(req));
    const b = await binding(a, provider);
    await fresh(s, c);
    await noPending(c);
    if (
      !c.draftId ||
      c.activeId ||
      c.connectionHash !== b.hash ||
      c.version !== input.version
    )
      fail(
        409,
        "Create or update the current unpublished provider draft first.",
      );
    const remote = verifiedRemote(
      await provider.request(a.workspaceId, "studies/" + c.draftId + "/"),
      c,
    );
    if (remote.status !== "UNPUBLISHED")
      fail(409, "The provider study is no longer an unpublished draft.");
    const total = projectedCost(
      await provider.request(
        a.workspaceId,
        "studies/" + c.draftId + "/cost/?is_projected=true",
      ),
      c.input.currency,
    );
    await transaction(async () => {
      await member(a);
      const cfg = (await currentConfig(s))!;
      await fresh(await requireStudy(s.id, a), cfg);
      if (
        cfg.version !== c.version ||
        provider.binding(a.workspaceId)?.hash !== b.hash
      )
        fail(409, "Plan or credentials changed during quotation.");
      await put("prolificConfig", {
        ...cfg,
        quote: {
          id: uid(),
          totalMinor: total,
          currency: cfg.input.currency,
          expiresAt: Date.now() + 300000,
          remoteHash: remote.digest,
          connectionHash: b.hash,
        },
        version: cfg.version + 1,
      });
    });
    return respond({ config: view((await currentConfig(s))!) });
  }
  if (path === "resolve" && req.method === "POST" && p.length === 4) {
    const input = z
      .object({
        version: z.number().int().positive(),
        remoteId: prolificId,
        reviewed: z.literal(true),
        testCloneConfirmed: z.boolean().optional(),
      })
      .strict()
      .parse(await body(req));
    const b = await binding(a, provider),
      op =
        c.operationId &&
        (await get<ProlificOperation>(
          "prolificOperation",
          c.operationId,
          a.workspaceId,
        ));
    if (!op || op.state === "complete" || input.version !== c.version)
      fail(409, "There is no current unresolved request.");
    const remote = verifiedRemote(
      await provider.request(a.workspaceId, "studies/" + input.remoteId + "/"),
      c,
    );
    if (
      (op.kind === "create" || op.kind === "update") &&
      remote.status !== "UNPUBLISHED"
    )
      fail(
        409,
        "Resolve draft writes only against an unpublished matching study.",
      );
    if (
      op.kind === "test" &&
      (!input.testCloneConfirmed || input.remoteId === c.draftId)
    )
      fail(
        400,
        "Confirm in Prolific that this is the generated no-credit test clone, not the original draft.",
      );
    if (
      (op.kind === "pause" || op.kind === "paid") &&
      input.remoteId !== (c.activeId || c.draftId)
    )
      fail(409, "Resolve only the originally bound provider study.");
    if (op.kind === "pause" && remote.status !== "PAUSED")
      fail(
        409,
        "The provider study is not paused. Resolve its status in the provider dashboard.",
      );
    if (op.kind === "paid" && remote.status !== "ACTIVE")
      fail(
        409,
        "The provider study is not active. Keep this request held until its outcome is resolved.",
      );
    await transaction(async () => {
      await member(a);
      const cfg = (await currentConfig(s))!;
      if (cfg.version !== c.version)
        fail(409, "Plan changed during reconciliation.");
      await put("prolificConfig", {
        ...cfg,
        ...(op.kind === "create" || op.kind === "update"
          ? { draftId: remote.id, remoteMarker: cfg.marker }
          : {
              activeId: remote.id,
              mode: op.kind === "test" ? "test" : cfg.mode || "paid",
            }),
        connectionHash: b.hash,
        providerStatus: remote.status,
        checkedAt: now(),
        admissionsEnabled: false,
        version: cfg.version + 1,
        quote: undefined,
      });
      await put("prolificOperation", {
        ...op,
        state: "complete",
        remoteId: remote.id,
        resultVersion: cfg.version + 1,
      });
    });
    return respond({ resolved: true, admissionHeld: true });
  }
  if (path === "admissions" && req.method === "POST" && p.length === 4) {
    const input = z
      .object({
        version: z.number().int().positive(),
        reviewed: z.literal(true),
      })
      .strict()
      .parse(await body(req));
    const b = await binding(a, provider);
    await fresh(s, c);
    await noPending(c);
    if (
      input.version !== c.version ||
      !c.activeId ||
      c.connectionHash !== b.hash ||
      s.fielding !== "active"
    )
      fail(
        409,
        "Open Echo Lab fielding and reconcile the active provider study before enabling admissions.",
      );
    const remote = verifiedRemote(
      await provider.request(a.workspaceId, "studies/" + c.activeId + "/"),
      c,
    );
    if (remote.status !== "ACTIVE")
      fail(409, "The provider study is not active.");
    await transaction(async () => {
      await member(a);
      const current = await requireStudy(s.id, a),
        cfg = (await currentConfig(current))!;
      if (cfg.version !== c.version || current.fielding !== "active")
        fail(409, "Study changed. Refresh first.");
      await fresh(current, cfg);
      await put("prolificConfig", {
        ...cfg,
        admissionsEnabled: true,
        providerStatus: remote.status,
        checkedAt: now(),
        version: cfg.version + 1,
      });
    });
    return respond({ enabled: true });
  }
  if (path !== "operations" || req.method !== "POST" || p.length !== 4)
    fail(405, "Unsupported Prolific action.");
  const input = z
      .object({
        requestId: z.uuid(),
        version: z.number().int().positive(),
        kind: z.enum(["create", "update", "test", "paid", "pause"]),
        reviewed: z.literal(true),
        quoteId: z.uuid().optional(),
        fundedAndBudgetReviewed: z.boolean().optional(),
      })
      .strict()
      .parse(await body(req)),
    opId = hash(a.workspaceId + ":" + input.requestId),
    requestHash = hash(canonical(input));
  const previous = await get<ProlificOperation>(
    "prolificOperation",
    opId,
    a.workspaceId,
  );
  if (previous) {
    if (previous.studyId !== s.id || previous.requestHash !== requestHash)
      fail(409, "This provider request ID has different content.");
    if (previous.state !== "complete")
      fail(
        409,
        "This provider request is unresolved; do not retry it with a new ID.",
      );
    return respond({
      operation: previous,
      config: view((await currentConfig(s))!),
    });
  }
  const b = await binding(a, provider);
  if (input.kind !== "pause") await fresh(s, c);
  await noPending(c);
  if (c.version !== input.version)
    fail(409, "The recruitment plan changed. Refresh first.");
  if (input.kind === "test" && !b.testEnabled)
    fail(
      409,
      "No-credit test access is not enabled for this account. No paid fallback will be attempted.",
    );
  if (
    input.kind === "paid" &&
    (!b.paidEnabled || !input.fundedAndBudgetReviewed)
  )
    fail(
      403,
      "Paid launch is disabled or its funding/budget has not been reviewed.",
    );
  if (c.payload.project !== b.projectId)
    fail(
      409,
      "The saved provider project differs from this connection. Save and review the plan again.",
    );
  if (
    (input.kind === "test" || input.kind === "paid") &&
    s.fielding !== "active"
  )
    fail(409, "Open Echo Lab fielding before launching the provider study.");
  if (input.kind === "test" || input.kind === "paid") {
    const rev = await fresh(s, c),
      interviews = await list<Interview>("interview", a.workspaceId, s.id);
    if (
      interviews.filter(
        (i) =>
          !i.preview && !i.origin && ["active", "complete"].includes(i.status),
      ).length +
        c.input.places >
      rev.guide.limit
    )
      fail(
        409,
        "There is insufficient remaining Echo Lab capacity for these provider places.",
      );
  }
  if (input.kind === "create" && c.draftId)
    fail(409, "This binding already has a provider draft.");
  if (input.kind !== "create" && (!c.draftId || c.connectionHash !== b.hash))
    fail(409, "Create a verified provider draft first.");
  let remote: ReturnType<typeof remoteProjection> | undefined;
  if (input.kind !== "create") {
    const data = await provider.request(
      a.workspaceId,
      "studies/" + (c.activeId || c.draftId) + "/",
    );
    if (input.kind === "update") {
      remote = remoteProjection(data);
      if (
        remote.payload.metadata !== c.remoteMarker ||
        remote.payload.project !== b.projectId
      )
        fail(409, "The original provider draft identity changed.");
    } else if (input.kind === "pause") {
      remote = remoteProjection(data);
      if (
        remote.id !== (c.activeId || c.draftId) ||
        remote.payload.project !== b.projectId
      )
        fail(409, "The provider study identity changed.");
    } else remote = verifiedRemote(data, c);
    if (
      input.kind === "pause"
        ? remote.status !== "ACTIVE"
        : remote.status !== "UNPUBLISHED" || !!c.activeId
    )
      fail(409, "The provider state does not permit this operation.");
  }
  if (input.kind === "paid") {
    const q = c.quote;
    if (
      !q ||
      q.id !== input.quoteId ||
      q.expiresAt <= Date.now() ||
      q.remoteHash !== remote!.digest ||
      q.connectionHash !== b.hash
    )
      fail(
        409,
        "Refresh the provider quote and review the current budget first.",
      );
    const cost = projectedCost(
      await provider.request(
        a.workspaceId,
        "studies/" + c.draftId + "/cost/?is_projected=true",
      ),
      c.input.currency,
    );
    if (cost !== q.totalMinor || cost > c.input.maxCostMinor)
      fail(
        409,
        "The provider quote changed or exceeds the approved cap. No paid launch was sent.",
      );
  }
  let op: ProlificOperation = {
    id: opId,
    studyId: s.id,
    workspaceId: a.workspaceId,
    kind: input.kind,
    requestHash,
    configVersion: c.version,
    state: "sending",
    createdAt: now(),
    actorId: a.id,
  };
  await transaction(async () => {
    await member(a);
    const current = await requireStudy(s.id, a),
      cfg = (await currentConfig(current))!;
    if (input.kind !== "pause") await fresh(current, cfg);
    if (
      cfg.version !== c.version ||
      provider.binding(a.workspaceId)?.hash !== b.hash
    )
      fail(409, "The plan or connection changed before dispatch.");
    await noPending(cfg);
    await put("prolificOperation", op);
    await put("prolificConfig", {
      ...cfg,
      operationId: op.id,
      admissionsEnabled: false,
    });
  });
  try {
    // Exactly one provider write; unknown outcomes are held, never automatically retried.
    let result: unknown;
    if (input.kind === "create")
      result = await provider.request(
        a.workspaceId,
        "studies/",
        "POST",
        c.payload,
      );
    else if (input.kind === "update")
      result = await provider.request(
        a.workspaceId,
        "studies/" + c.draftId + "/",
        "PATCH",
        c.payload,
      );
    else if (input.kind === "test") {
      const r = z
        .object({ study_id: prolificId })
        .parse(
          await provider.request(
            a.workspaceId,
            "studies/" + c.draftId + "/test-study",
            "POST",
          ),
        );
      op.remoteId = r.study_id;
      result = await provider.request(
        a.workspaceId,
        "studies/" + r.study_id + "/",
      );
    } else
      result = await provider.request(
        a.workspaceId,
        "studies/" + (c.activeId || c.draftId) + "/transition/",
        "POST",
        { action: input.kind === "paid" ? "PUBLISH" : "PAUSE" },
      );
    const verified =
      input.kind === "pause"
        ? remoteProjection(result)
        : verifiedRemote(result, c);
    if (
      input.kind === "pause" &&
      (verified.id !== (c.activeId || c.draftId) ||
        verified.payload.project !== b.projectId ||
        verified.status !== "PAUSED")
    )
      fail(409, "The provider pause outcome is unresolved.");
    if (
      (input.kind === "test" || input.kind === "paid") &&
      !["ACTIVE", "PUBLISHING"].includes(verified.status)
    )
      fail(409, "The provider launch outcome is unresolved.");
    op.remoteId = verified.id;
    if (
      (input.kind === "create" || input.kind === "update") &&
      verified.status !== "UNPUBLISHED"
    )
      fail(409, "The provider draft is not unpublished.");
    if (input.kind === "test" && verified.id === c.draftId)
      fail(409, "The test endpoint did not return a separate test clone.");
    if (input.kind === "paid" && verified.id !== c.draftId)
      fail(409, "The launch returned a different provider study.");
    await transaction(async () => {
      await member(a);
      const current = await requireStudy(s.id, a),
        cfg = (await currentConfig(current))!;
      if (input.kind !== "pause") await fresh(current, cfg);
      if (
        cfg.version !== c.version ||
        cfg.operationId !== op.id ||
        current.dataVersion !== s.dataVersion ||
        provider.binding(a.workspaceId)?.hash !== b.hash
      )
        fail(
          409,
          "Sources or permissions changed after dispatch. Reconcile the provider outcome.",
        );
      const next = {
        ...cfg,
        ...(input.kind === "create" || input.kind === "update"
          ? { draftId: verified.id, remoteMarker: cfg.marker }
          : {
              activeId: verified.id,
              mode:
                input.kind === "test"
                  ? ("test" as const)
                  : cfg.mode || ("paid" as const),
            }),
        providerStatus: verified.status,
        connectionHash: b.hash,
        checkedAt: now(),
        quote: undefined,
        admissionsEnabled:
          (input.kind === "test" || input.kind === "paid") &&
          verified.status === "ACTIVE" &&
          current.fielding === "active",
        version: cfg.version + 1,
      };
      op = { ...op, state: "complete", resultVersion: next.version };
      await put("prolificOperation", op);
      await put("prolificConfig", next);
    });
    return respond({ operation: op, config: view((await currentConfig(s))!) });
  } catch {
    await put("prolificOperation", { ...op, state: "uncertain" });
    fail(
      409,
      "The provider outcome is uncertain. Refresh and resolve this request in Prolific; another automatic write will not be attempted.",
    );
  }
}
