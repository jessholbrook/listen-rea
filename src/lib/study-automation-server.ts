import { z } from "zod";
import {
  db,
  get,
  list,
  put,
  hash,
  uid,
  now,
  transaction,
  requireStudy,
} from "./db";
import { actor, body, fail, respond } from "./http";
import { guideSchema, type Actor, type Study, type Revision } from "./domain";
import type { ReadApiKey } from "./external-api";
import { validateConceptImages } from "./concept-images-server";
import { validateConceptVideos } from "./concept-videos-server";
import {
  ensureHistory,
  saveHistory,
  workspaceDefaults,
} from "./workflow-server";
import {
  automationOperations,
  automationProposal,
  type AutomationGrant,
  type AutomationPlan,
  type AutomationStudy,
} from "./study-automation";
export function automationStudy(s: Study): AutomationStudy {
  const snapshot = {
    id: s.id,
    title: s.title,
    version: s.version,
    dataVersion: s.dataVersion,
    revisionId: s.revisionId,
    fielding: s.fielding,
    guide: s.draft,
  };
  return { ...snapshot, fingerprint: hash(JSON.stringify(snapshot)) };
}
async function activeKey(id: string, workspaceId: string) {
  const key = await get<ReadApiKey>("readApiKey", id, workspaceId);
  if (!key || key.revokedAt || Date.parse(key.expiresAt) <= Date.now())
    fail(409, "The static API key is unavailable or expired.");
  const owner = await db
    .prepare("SELECT role,workspace_id FROM users WHERE id=?")
    .get(key.ownerId);
  if (!owner || owner.role !== "admin" || owner.workspace_id !== workspaceId)
    fail(409, "The API key issuer no longer has admin access.");
  return key;
}
export async function automationGrant(key: ReadApiKey) {
  // OAuth grants remain read-only. Only separately enabled static keys may request changes.
  const staticKey = await get<ReadApiKey>(
    "readApiKey",
    key.id,
    key.workspaceId,
  );
  if (!staticKey) return undefined;
  const grant = await get<AutomationGrant>(
    "automationGrant",
    key.id,
    key.workspaceId,
  );
  return grant?.enabled ? grant : undefined;
}
async function requireGrant(key: ReadApiKey) {
  const current = await activeKey(key.id, key.workspaceId),
    grant = await automationGrant(current);
  if (!grant)
    fail(
      403,
      "An admin must enable reviewed automation for this static API key.",
    );
  return { key: current, grant };
}
async function scopedStudy(key: ReadApiKey, id: string) {
  if (!key.studyIds.includes(id)) fail(404, "Study unavailable to this key.");
  const s = await get<Study>("study", id, key.workspaceId);
  if (!s) fail(404, "Study unavailable to this key.");
  return s;
}
function planView(p: AutomationPlan) {
  const { workspaceId, keyId, keyVersion, grantVersion, decision, ...v } = p;
  return {
    ...v,
    ...(decision
      ? { decision: { actorName: decision.actorName, at: decision.at } }
      : {}),
  };
}
export async function automationApi(
  req: Request,
  p: string[],
  authenticated: ReadApiKey,
) {
  if (new URL(req.url).search)
    fail(400, "Automation endpoints do not accept query parameters.");
  const { key, grant } = await requireGrant(authenticated);
  if (p.length === 2 && p[0] === "studies" && req.method === "GET")
    return respond({
      study: automationStudy(await scopedStudy(key, z.uuid().parse(p[1]))),
    });
  if (p[0] === "plans" && p.length === 2 && req.method === "GET") {
    const plan = await get<AutomationPlan>(
      "automationPlan",
      p[1],
      key.workspaceId,
    );
    if (!plan || plan.keyId !== key.id)
      fail(404, "Change request unavailable.");
    if (plan.studyId) await scopedStudy(key, plan.studyId);
    return respond({ plan: planView(plan) });
  }
  if (p.length !== 1 || p[0] !== "plans" || req.method !== "POST")
    fail(
      405,
      "Use GET for a scoped draft/request or POST to submit a change request.",
    );
  // The same bounded body applies to REST and MCP. Never accept caller-supplied authorization or approval fields.
  if (req.headers.get("content-type")?.split(";")[0] !== "application/json")
    fail(400, "Use an application/json automation request.");
  const reader = req.body?.getReader();
  if (!reader) fail(400, "A change request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 65536) {
        await reader.cancel();
        fail(413, "Automation requests are limited to 64 KiB.");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail(400, "Invalid JSON request.");
  }
  const input = automationProposal.parse(value);
  if (!grant.operations.includes(input.change.operation))
    fail(403, "This key cannot request that operation.");
  const id = hash(key.id + ":" + input.requestId),
    digest = hash(JSON.stringify(input));
  let plan!: AutomationPlan,
    reused = false;
  await transaction(async () => {
    const fresh = await requireGrant(key);
    if (
      fresh.grant.version !== grant.version ||
      fresh.key.version !== key.version
    )
      fail(409, "Automation permissions changed. Refresh first.");
    const receipt = await get<{ hash: string }>(
      "automationReceipt",
      id,
      key.workspaceId,
    );
    if (receipt) {
      if (receipt.hash !== digest)
        fail(409, "This request ID has different content.");
      const old = await get<AutomationPlan>(
        "automationPlan",
        id,
        key.workspaceId,
      );
      if (!old)
        fail(
          410,
          "This request was erased. Use a new request only after reviewing current sources.",
        );
      plan = old;
      reused = true;
      return;
    }
    const pending = await list<AutomationPlan>(
      "automationPlan",
      key.workspaceId,
    );
    if (
      pending.filter(
        (v) =>
          v.keyId === key.id &&
          v.state === "pending" &&
          v.expiresAt > Date.now(),
      ).length >= 50
    )
      fail(
        409,
        "Review pending requests before submitting more than 50 per key.",
      );
    const receiptCount = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM documents WHERE workspace_id=? AND kind='automationReceipt'",
      )
      .get(key.workspaceId);
    if (Number(receiptCount?.n) >= 2000)
      fail(409, "This workspace reached its automation receipt limit.");
    const change = input.change;
    let s: Study | undefined, published: AutomationPlan["published"];
    if (change.operation !== "create") {
      s = await scopedStudy(fresh.key, change.studyId);
      if (automationStudy(s).fingerprint !== change.fingerprint)
        fail(
          409,
          "The study changed. Read the current draft before proposing again.",
        );
      if (change.operation === "fielding") {
        const rev = s.revisionId
          ? await get<Revision>("revision", s.revisionId, s.workspaceId)
          : undefined;
        if (!rev || rev.studyId !== s.id)
          fail(400, "Publish the study before requesting fielding changes.");
        published = {
          revisionId: rev.id,
          title: rev.guide.title,
          questionCount: rev.guide.questions.length,
          limit: rev.guide.limit,
          guide: rev.guide,
        };
      }
    } else if (fresh.key.studyIds.length >= 50)
      fail(409, "This key has no capacity to receive another created study.");
    plan = {
      id,
      workspaceId: key.workspaceId,
      ...(s ? { studyId: s.id, before: automationStudy(s) } : {}),
      keyId: key.id,
      keyVersion: key.version,
      grantVersion: grant.version,
      proposal: input,
      ...(published ? { published } : {}),
      state: "pending",
      version: 1,
      createdAt: now(),
      expiresAt: Date.now() + 86400000,
    };
    await put("automationPlan", plan);
    await put("automationReceipt", {
      id,
      workspaceId: key.workspaceId,
      hash: digest,
    });
  });
  return respond({ plan: planView(plan) }, reused ? 200 : 201);
}
async function admin(a: Actor) {
  const current = await db
    .prepare("SELECT role,workspace_id FROM users WHERE id=?")
    .get(a.id);
  if (current?.role !== "admin" || current.workspace_id !== a.workspaceId)
    fail(403, "Current workspace admin access is required.");
}
async function readiness(p: AutomationPlan) {
  if (p.state !== "pending") return p.state;
  if (p.expiresAt <= Date.now()) return "expired";
  try {
    const key = await activeKey(p.keyId, p.workspaceId),
      grant = await automationGrant(key);
    if (
      !grant ||
      grant.version !== p.grantVersion ||
      key.version !== p.keyVersion ||
      !grant.operations.includes(p.proposal.change.operation)
    )
      return "permissions changed";
    if (p.studyId) {
      const study = await scopedStudy(key, p.studyId);
      if (automationStudy(study).fingerprint !== p.before?.fingerprint)
        return "study changed";
      if (p.proposal.change.operation === "fielding") {
        const revision = study.revisionId
          ? await get<Revision>("revision", study.revisionId, study.workspaceId)
          : undefined;
        if (
          !revision ||
          revision.studyId !== study.id ||
          hash(JSON.stringify(revision.guide)) !==
            hash(JSON.stringify(p.published?.guide))
        )
          return "published guide changed";
      }
    }
    return "ready";
  } catch {
    return "key or study unavailable";
  }
}
export async function dispatchAutomation(req: Request, p: string[]) {
  if (p[0] !== "automation") return null;
  const a = await actor();
  await admin(a);
  if (p.length === 1 && req.method === "GET") {
    const plans = (
      await list<AutomationPlan>("automationPlan", a.workspaceId)
    ).slice(0, 200);
    return respond({
      keys: (await list<ReadApiKey>("readApiKey", a.workspaceId)).map((k) => ({
        id: k.id,
        name: k.name,
        version: k.version,
        studyIds: k.studyIds,
        available: !k.revokedAt && Date.parse(k.expiresAt) > Date.now(),
      })),
      grants: await list<AutomationGrant>("automationGrant", a.workspaceId),
      plans: await Promise.all(
        plans.map(async (plan) => ({
          id: plan.id,
          studyId: plan.studyId,
          keyId: plan.keyId,
          operation: plan.proposal.change.operation,
          reason: plan.proposal.reason,
          state: plan.state,
          version: plan.version,
          createdAt: plan.createdAt,
          expiresAt: plan.expiresAt,
          readiness: await readiness(plan),
        })),
      ),
    });
  }
  if (p.length === 3 && p[1] === "plans" && req.method === "GET") {
    const plan = await get<AutomationPlan>(
      "automationPlan",
      p[2],
      a.workspaceId,
    );
    if (!plan) fail(404, "Change request unavailable.");
    return respond({
      plan: { ...planView(plan), readiness: await readiness(plan) },
    });
  }
  if (p.length === 3 && p[1] === "grants" && req.method === "PUT") {
    const input = z
      .object({
        version: z.number().int().min(0),
        enabled: z.boolean(),
        operations: z.array(z.enum(automationOperations)).min(1).max(4),
        reviewed: z.literal(true),
      })
      .strict()
      .parse(await body(req));
    if (new Set(input.operations).size !== input.operations.length)
      fail(400, "Choose unique automation permissions.");
    let grant!: AutomationGrant;
    await transaction(async () => {
      await admin(a);
      await activeKey(p[2], a.workspaceId);
      const old = await get<AutomationGrant>(
        "automationGrant",
        p[2],
        a.workspaceId,
      );
      if ((old?.version || 0) !== input.version)
        fail(409, "Automation permissions changed. Reload before saving.");
      grant = {
        id: p[2],
        keyId: p[2],
        workspaceId: a.workspaceId,
        enabled: input.enabled,
        operations: input.operations,
        version: (old?.version || 0) + 1,
        actorId: a.id,
        updatedAt: now(),
      };
      await put("automationGrant", grant);
    });
    return respond({ grant });
  }
  if (
    p.length === 4 &&
    p[1] === "plans" &&
    p[3] === "decision" &&
    req.method === "POST"
  ) {
    const input = z
        .object({
          version: z.number().int().positive(),
          requestId: z.uuid(),
          decision: z.enum(["apply", "reject"]),
          reviewed: z.literal(true),
        })
        .strict()
        .parse(await body(req)),
      digest = hash(JSON.stringify(input));
    let plan!: AutomationPlan;
    await transaction(async () => {
      await admin(a);
      const old = await get<AutomationPlan>(
        "automationPlan",
        p[2],
        a.workspaceId,
      );
      if (!old) fail(404, "Change request unavailable.");
      if (old.decision?.requestId === input.requestId) {
        if (old.decision.hash !== digest || old.decision.actorId !== a.id)
          fail(409, "This decision request has different content.");
        plan = old;
        return;
      }
      if (old.state !== "pending" || old.version !== input.version)
        fail(409, "The change request was already decided or changed.");
      let result: AutomationPlan["result"];
      if (input.decision === "apply") {
        if ((await readiness(old)) !== "ready")
          fail(
            409,
            "Study, key, permissions or request expiry changed. Submit a new request after reviewing current context.",
          );
        const key = await activeKey(old.keyId, a.workspaceId),
          change = old.proposal.change;
        let s: Study;
        if (change.operation === "create") {
          if (key.studyIds.length >= 50)
            fail(409, "The key cannot receive another study.");
          const defaults = await workspaceDefaults(a.workspaceId),
            guide = guideSchema.parse(change.guide);
          s = {
            id: uid(),
            workspaceId: a.workspaceId,
            title: guide.title,
            draft: guide,
            researchGuidelines: defaults.guidelines,
            revisionId: null,
            fielding: "draft",
            version: 1,
            dataVersion: 0,
            createdAt: now(),
            updatedAt: now(),
          };
          await validateConceptImages(s, guide);
          await validateConceptVideos(s, guide);
          await put("study", s);
          await saveHistory(s, a, "created");
          // Creation approval explicitly grants this one created study, never arbitrary future studies.
          await put("readApiKey", {
            ...key,
            studyIds: [...key.studyIds, s.id],
            version: key.version + 1,
          });
        } else {
          s = await requireStudy(change.studyId, a);
          await ensureHistory(s, a);
          if (change.operation === "edit") {
            await validateConceptImages(s, change.guide);
            await validateConceptVideos(s, change.guide);
            s.draft = change.guide;
            s.title = change.guide.title;
            s.version++;
            s.updatedAt = now();
            await put("study", s);
            await saveHistory(s, a, "saved");
          } else if (change.operation === "publish") {
            const guide = guideSchema.parse(s.draft);
            await validateConceptImages(s, guide);
            await validateConceptVideos(s, guide);
            const rev: Revision & { workspaceId: string } = {
              id: uid(),
              workspaceId: a.workspaceId,
              studyId: s.id,
              guide,
              createdAt: now(),
            };
            await put("revision", rev);
            s.revisionId = rev.id;
            if (s.fielding === "draft") s.fielding = "paused";
            s.version++;
            s.updatedAt = now();
            await put("study", s);
            await saveHistory(s, a, "published");
          } else {
            if (!s.revisionId) fail(409, "The published guide is unavailable.");
            s.fielding = change.state;
            s.version++;
            s.updatedAt = now();
            await put("study", s);
          }
        }
        result = {
          studyId: s.id,
          version: s.version,
          fielding: s.fielding,
          revisionId: s.revisionId,
        };
      }
      plan = {
        ...old,
        ...(result ? { studyId: result.studyId, result } : {}),
        state: input.decision === "apply" ? "applied" : "rejected",
        version: old.version + 1,
        decision: {
          requestId: input.requestId,
          hash: digest,
          actorId: a.id,
          actorName: a.name,
          at: now(),
        },
      };
      await put("automationPlan", plan);
      if (plan.studyId)
        await db
          .prepare(
            "UPDATE documents SET study_id=? WHERE kind='automationPlan' AND id=? AND workspace_id=?",
          )
          .run(plan.studyId, plan.id, a.workspaceId);
    });
    return respond({ plan: planView(plan) });
  }
  fail(405, "Unsupported automation management operation.");
}
