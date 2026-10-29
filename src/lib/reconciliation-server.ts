import { z } from "zod";
import { db, get, put, list, hash, now, transaction } from "./db";
import { actor, body, respond, fail } from "./http";
import type { Actor, Study, Revision, Interview, Analysis } from "./domain";
import {
  studyDto,
  responseDto,
  analysisDto,
  eligibleResponse,
  type ReadApiKey,
} from "./external-api";
import { retention } from "./features";
import {
  reconciliationStart,
  reconciliationCheck,
  reconciliationCheckpoint,
  reconciliationIdentity,
  type ReconciliationRef,
  type ReconciliationGrant,
  type ReconciliationRun,
  type ReconciliationEntry,
} from "./integration-reconciliation";
import { pruneReconciliation } from "./reconciliation-lifecycle";
export async function reconciliationGrant(key: ReadApiKey) {
  const stored = await get<ReadApiKey>("readApiKey", key.id, key.workspaceId);
  if (!stored) return undefined;
  const grant = await get<ReconciliationGrant>(
    "reconciliationGrant",
    key.id,
    key.workspaceId,
  );
  return grant?.enabled ? grant : undefined;
}
async function authority(key: ReadApiKey) {
  const k = await get<ReadApiKey>("readApiKey", key.id, key.workspaceId);
  if (!k || k.revokedAt || Date.parse(k.expiresAt) <= Date.now())
    fail(403, "The static key is unavailable.");
  const grant = await reconciliationGrant(k);
  if (!grant)
    fail(403, "An admin must enable reconciliation for this static key.");
  for (const id of new Set([k.ownerId, grant.actorId])) {
    const u = await db
      .prepare("SELECT role,workspace_id FROM users WHERE id=?")
      .get(id);
    if (u?.role !== "admin" || u.workspace_id !== k.workspaceId)
      fail(403, "A current authorizing admin is required.");
  }
  return {
    key: k,
    grant,
    scopeHash: hash(
      JSON.stringify([
        k.id,
        k.version,
        [...k.studyIds].sort(),
        [...k.scopes].sort(),
        grant.version,
      ]),
    ),
  };
}
function scoped(
  key: ReadApiKey,
  studies: string[],
  resources: ReconciliationRef["resource"][],
) {
  if (studies.some((id) => !key.studyIds.includes(id)))
    fail(404, "A selected study is unavailable to this key.");
  const required = {
    study: "studies:read",
    response: "responses:read",
    analysis: "analyses:read",
  } as const;
  if (resources.some((r) => !key.scopes.includes(required[r])))
    fail(403, "The key does not grant every requested read scope.");
}
async function published(workspaceId: string, id: string) {
  const study = await get<Study>("study", id, workspaceId);
  if (!study?.revisionId) return null;
  const revision = await get<Revision>(
    "revision",
    study.revisionId,
    workspaceId,
  );
  return revision && revision.studyId === id ? { study, revision } : null;
}
// Same reviewed/current/citation eligibility as the existing analysis API, evaluated in SQL without loading all source transcripts into memory.
const analysisEligible = `json_extract(data,'$.reviewed')=1 AND json_extract(data,'$.dataVersion')=? AND NOT EXISTS (
 SELECT 1 FROM json_each(json_extract(documents.data,'$.themes')) theme,json_each(json_extract(theme.value,'$.citations')) citation
 WHERE NOT EXISTS (SELECT 1 FROM documents i,json_each(json_extract(i.data,'$.turns')) turn
 WHERE i.kind='interview' AND i.workspace_id=documents.workspace_id AND i.study_id=documents.study_id
 AND i.id=json_extract(citation.value,'$.interviewId') AND json_extract(i.data,'$.status')='complete'
 AND COALESCE(json_extract(i.data,'$.excluded'),0)=0 AND COALESCE(json_extract(i.data,'$.preview'),0)=0
 AND json_extract(turn.value,'$.id')=json_extract(citation.value,'$.turnId')
 AND instr(json_extract(turn.value,'$.answer'),json_extract(citation.value,'$.quote'))>0))`;
async function currentEntry(
  key: ReadApiKey,
  ref: ReconciliationRef,
  context?: Awaited<ReturnType<typeof published>>,
): Promise<ReconciliationEntry | null> {
  const p =
    context === undefined
      ? await published(key.workspaceId, ref.studyId)
      : context;
  if (!p) return null;
  if (ref.resource === "study")
    return ref.id === ref.studyId
      ? { ...ref, etag: hash(JSON.stringify(studyDto(p.study, p.revision))) }
      : null;
  if (ref.resource === "response") {
    const i = await get<Interview>("interview", ref.id, key.workspaceId);
    return i && i.studyId === ref.studyId && eligibleResponse(i)
      ? { ...ref, etag: hash(JSON.stringify(responseDto(i))) }
      : null;
  }
  const row = await db
    .prepare(
      "SELECT data FROM documents WHERE kind='analysis' AND workspace_id=? AND study_id=? AND id=? AND " +
        analysisEligible,
    )
    .get(key.workspaceId, ref.studyId, ref.id, p.study.dataVersion);
  if (!row) return null;
  const analysis = JSON.parse(String(row.data)) as Analysis;
  return { ...ref, etag: hash(JSON.stringify(analysisDto(analysis, true))) };
}
async function inventory(
  key: ReadApiKey,
  studyIds: string[],
  resources: ReconciliationRef["resource"][],
) {
  const entries: ReconciliationEntry[] = [];
  const append = (e: ReconciliationEntry) => {
    entries.push(e);
    if (entries.length > 1000)
      fail(
        409,
        "This inventory exceeds 1,000 sources. Narrow the studies/resources, or use the existing paginated read API and bulk availability checks.",
      );
  };
  for (const studyId of [...studyIds].sort()) {
    const p = await published(key.workspaceId, studyId);
    if (!p) continue;
    if (resources.includes("study"))
      append({
        resource: "study",
        studyId,
        id: studyId,
        etag: hash(JSON.stringify(studyDto(p.study, p.revision))),
      });
    for (const resource of resources.filter((r) => r !== "study")) {
      let after = "";
      for (;;) {
        const filter =
          resource === "response"
            ? "json_extract(data,'$.status')='complete' AND COALESCE(json_extract(data,'$.preview'),0)=0 AND COALESCE(json_extract(data,'$.excluded'),0)=0"
            : analysisEligible;
        const rows = await db
          .prepare(
            "SELECT id,data FROM documents WHERE kind=? AND workspace_id=? AND study_id=? AND id>? AND " +
              filter +
              " ORDER BY id LIMIT 10",
          )
          .all(
            resource === "response" ? "interview" : "analysis",
            key.workspaceId,
            studyId,
            after,
            ...(resource === "analysis" ? [p.study.dataVersion] : []),
          );
        for (const row of rows) {
          const value = JSON.parse(String(row.data));
          append({
            resource,
            studyId,
            id: String(row.id),
            etag: hash(
              JSON.stringify(
                resource === "response"
                  ? responseDto(value)
                  : analysisDto(value, true),
              ),
            ),
          });
        }
        if (rows.length < 10) break;
        after = String(rows.at(-1)!.id);
      }
    }
  }
  return entries.sort((a, b) =>
    reconciliationIdentity(a).localeCompare(reconciliationIdentity(b)),
  );
}
function summary(r: ReconciliationRun) {
  return {
    id: r.id,
    version: r.version,
    position: r.position,
    total: r.entries.length,
    pageSize: r.pageSize,
    state: r.state,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    expiresAt: r.expiresAt,
    scopeFingerprint: r.scopeHash,
  };
}
async function owned(id: string, key: ReadApiKey, scopeHash: string) {
  const r = await get<ReconciliationRun>(
    "reconciliationRun",
    id,
    key.workspaceId,
  );
  if (!r || r.keyId !== key.id) {
    const receipt = await get<{ keyHash: string }>(
      "reconciliationReceipt",
      id,
      key.workspaceId,
    );
    if (receipt?.keyHash === hash(key.id))
      fail(
        410,
        "This run is unavailable or erased. Start a new inventory with a new request ID.",
      );
    fail(404, "Reconciliation run not found.");
  }
  if (r.expiresAt <= Date.now())
    fail(410, "This run expired. Start a new inventory.");
  if (r.scopeHash !== scopeHash)
    fail(
      409,
      "Key permissions or reconciliation policy changed. Discard this checkpoint and start a newly authorized inventory.",
    );
  return r;
}
function page(r: ReconciliationRun, current: ReconciliationEntry[]) {
  const index = new Map(current.map((e) => [reconciliationIdentity(e), e]));
  const items = r.entries
    .slice(r.position, r.position + r.pageSize)
    .map((ref) => {
      const source = index.get(reconciliationIdentity(ref));
      return {
        resource: ref.resource,
        studyId: ref.studyId,
        id: ref.id,
        state: !source
          ? "unavailable"
          : source.etag === ref.etag
            ? "available"
            : "changed",
        etag: source?.etag || null,
        ...(source
          ? {
              path:
                "/api/v1/studies/" +
                ref.studyId +
                (ref.resource === "study"
                  ? ""
                  : "/" +
                    (ref.resource === "response" ? "responses" : "analyses") +
                    "/" +
                    ref.id),
            }
          : {}),
      };
    });
  const currentHash = hash(JSON.stringify(current));
  const token = hash(
    JSON.stringify([
      r.id,
      r.createdAt,
      r.scopeHash,
      r.version,
      r.position,
      items,
      currentHash,
    ]),
  );
  const rescan =
    current.some(
      (e) =>
        !r.entries.some(
          (ref) => reconciliationIdentity(ref) === reconciliationIdentity(e),
        ),
    ) ||
    r.entries.some(
      (ref, i) =>
        i < r.position &&
        (ref.confirmedEtag ?? null) !==
          (index.get(reconciliationIdentity(ref))?.etag ?? null),
    );
  return {
    position: r.position,
    items,
    pageToken: token,
    hasMore: r.position + items.length < r.entries.length,
    rescanRequired: rescan,
  };
}
async function requestBody(req: Request) {
  if (req.headers.get("content-type")?.split(";")[0] !== "application/json")
    fail(400, "Use application/json.");
  const reader = req.body?.getReader();
  if (!reader) fail(400, "A body is required.");
  let bytes = Buffer.alloc(0);
  try {
    for (;;) {
      const v = await reader.read();
      if (v.done) break;
      bytes = Buffer.concat([bytes, Buffer.from(v.value)]);
      if (bytes.length > 65536) {
        await reader.cancel();
        fail(413, "Reconciliation requests are limited to 64 KiB.");
      }
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(bytes.toString());
  } catch {
    fail(400, "Invalid JSON request.");
  }
}
export async function reconciliationApi(
  req: Request,
  p: string[],
  authenticated: ReadApiKey,
) {
  if (new URL(req.url).search)
    fail(400, "Reconciliation routes do not accept query parameters.");
  await retention();
  const context = await authority(authenticated);
  if (p.length === 1 && p[0] === "check" && req.method === "POST") {
    const input = reconciliationCheck.parse(await requestBody(req));
    let results: unknown[] = [];
    await transaction(async () => {
      const fresh = await authority(authenticated);
      scoped(
        fresh.key,
        input.items.map((i) => i.studyId),
        input.items.map((i) => i.resource),
      );
      for (const ref of input.items) {
        const current = await currentEntry(fresh.key, ref);
        results.push({
          ...ref,
          state: current ? "available" : "unavailable",
          etag: current?.etag || null,
        });
      }
    });
    return respond({ items: results, checkedAt: now() });
  }
  if (p.length === 1 && p[0] === "runs" && req.method === "POST") {
    const input = reconciliationStart.parse(await requestBody(req)),
      id = hash("reconciliation:" + context.key.id + ":" + input.requestId),
      digest = hash(JSON.stringify(input));
    let run!: ReconciliationRun,
      reused = false;
    await transaction(async () => {
      const fresh = await authority(authenticated);
      scoped(fresh.key, input.studyIds, input.resources);
      await pruneReconciliation(fresh.key.workspaceId);
      const receipt = await get<{ digest: string }>(
        "reconciliationReceipt",
        id,
        fresh.key.workspaceId,
      );
      if (receipt) {
        if (receipt.digest !== digest)
          fail(409, "This run request ID has different content.");
        run = await owned(id, fresh.key, fresh.scopeHash);
        reused = true;
        return;
      }
      const count = await db
        .prepare(
          "SELECT COUNT(*) AS n FROM documents WHERE kind='reconciliationReceipt' AND workspace_id=?",
        )
        .get(fresh.key.workspaceId);
      if (Number(count?.n) >= 2000)
        fail(
          409,
          "This workspace reached its seven-day reconciliation receipt capacity.",
        );
      const recent = await db
        .prepare(
          "SELECT COUNT(*) AS n FROM documents WHERE kind='reconciliationReceipt' AND workspace_id=? AND json_extract(data,'$.keyHash')=? AND json_extract(data,'$.createdAt')>=?",
        )
        .get(
          fresh.key.workspaceId,
          hash(fresh.key.id),
          new Date(Date.now() - 86400000).toISOString(),
        );
      if (Number(recent?.n) >= fresh.grant.limit24h)
        fail(
          429,
          "This key reached its inventory-start allowance for the preceding 24 hours.",
        );
      const active = await db
        .prepare(
          "SELECT COUNT(*) AS n FROM documents WHERE kind='reconciliationRun' AND workspace_id=? AND json_extract(data,'$.keyId')=? AND json_extract(data,'$.state')='active' AND json_extract(data,'$.expiresAt')>?",
        )
        .get(fresh.key.workspaceId, fresh.key.id, Date.now());
      if (Number(active?.n) >= 5)
        fail(
          409,
          "Finish or discard an active run before starting more than five.",
        );
      const entries = await inventory(
        fresh.key,
        input.studyIds,
        input.resources,
      );
      run = {
        id,
        workspaceId: fresh.key.workspaceId,
        keyId: fresh.key.id,
        scopeHash: fresh.scopeHash,
        studyIds: input.studyIds,
        resources: input.resources,
        pageSize: input.pageSize,
        entries,
        position: 0,
        version: 1,
        state: "active",
        createdAt: now(),
        updatedAt: now(),
        expiresAt: Date.now() + 86400000,
        checkpoints: [],
      };
      await put("reconciliationRun", run);
      await put("reconciliationReceipt", {
        id,
        workspaceId: run.workspaceId,
        keyHash: hash(run.keyId),
        digest,
        createdAt: run.createdAt,
      });
    });
    return respond({ run: summary(run) }, reused ? 200 : 201);
  }
  if (p[0] !== "runs" || !p[1] || p.length > 3)
    fail(404, "Reconciliation route not found.");
  if (p.length === 2 && req.method === "GET") {
    let result: unknown;
    await transaction(async () => {
      const fresh = await authority(authenticated),
        r = await owned(p[1], fresh.key, fresh.scopeHash),
        current = await inventory(fresh.key, r.studyIds, r.resources),
        view = page(r, current);
      result = {
        run: {
          ...summary(r),
          state:
            r.state === "complete" && view.rescanRequired
              ? "needs_rescan"
              : r.state,
        },
        page: r.state === "active" ? view : null,
        rescanRequired: view.rescanRequired,
      };
    });
    return respond(result);
  }
  if (p.length === 2 && req.method === "DELETE") {
    const input = z
      .object({ version: z.number().int().positive() })
      .strict()
      .parse(await requestBody(req));
    await transaction(async () => {
      const fresh = await authority(authenticated),
        r = await owned(p[1], fresh.key, fresh.scopeHash);
      if (r.version !== input.version)
        fail(409, "This run advanced. Refresh before discarding.");
      await db
        .prepare(
          "DELETE FROM documents WHERE kind='reconciliationRun' AND id=? AND workspace_id=?",
        )
        .run(r.id, r.workspaceId);
    });
    return respond({ discarded: true });
  }
  if (p.length === 3 && p[2] === "checkpoint" && req.method === "POST") {
    const input = reconciliationCheckpoint.parse(await requestBody(req)),
      digest = hash(JSON.stringify(input));
    let result: unknown;
    await transaction(async () => {
      const fresh = await authority(authenticated),
        r = await owned(p[1], fresh.key, fresh.scopeHash),
        previous = r.checkpoints.find((c) => c.requestId === input.requestId);
      if (previous) {
        if (previous.digest !== digest)
          fail(409, "This checkpoint request ID has different content.");
        result = { checkpoint: previous, reused: true };
        return;
      }
      if (
        r.state !== "active" ||
        r.version !== input.version ||
        r.position !== input.position
      )
        fail(
          409,
          "Run position/version changed. Resume from the current checkpoint.",
        );
      const current = await inventory(fresh.key, r.studyIds, r.resources),
        view = page(r, current);
      if (view.pageToken !== input.pageToken)
        fail(
          409,
          "Sources changed after the page was read. Re-read and reconcile that page before checkpointing.",
        );
      view.items.forEach((item, index) => {
        r.entries[r.position + index].confirmedEtag = item.etag;
      });
      r.position += view.items.length;
      r.version++;
      r.updatedAt = now();
      if (r.position === r.entries.length)
        r.state = page(r, current).rescanRequired ? "needs_rescan" : "complete";
      const checkpoint = {
        requestId: input.requestId,
        digest,
        version: r.version,
        position: r.position,
        state: r.state,
      };
      r.checkpoints.push(checkpoint);
      await put("reconciliationRun", r);
      result = { checkpoint, reused: false };
    });
    return respond(result);
  }
  fail(405, "Unsupported reconciliation action.");
}
async function admin(a: Actor) {
  const u = await db
    .prepare("SELECT role,workspace_id FROM users WHERE id=?")
    .get(a.id);
  if (u?.role !== "admin" || u.workspace_id !== a.workspaceId)
    fail(403, "Current admin access is required.");
}
export async function dispatchReconciliation(req: Request, p: string[]) {
  if (p[0] !== "integration-recovery") return null;
  const a = await actor();
  await admin(a);
  if (p.length === 1 && req.method === "GET") {
    const rows = await db
      .prepare(
        "SELECT id,json_extract(data,'$.keyId') AS keyId,json_extract(data,'$.state') AS state,json_extract(data,'$.position') AS position,json_array_length(json_extract(data,'$.entries')) AS total,json_extract(data,'$.version') AS version,json_extract(data,'$.createdAt') AS createdAt,json_extract(data,'$.expiresAt') AS expiresAt FROM documents WHERE kind='reconciliationRun' AND workspace_id=? ORDER BY rowid DESC LIMIT 200",
      )
      .all(a.workspaceId);
    return respond({
      keys: (await list<ReadApiKey>("readApiKey", a.workspaceId)).map((k) => ({
        id: k.id,
        name: k.name,
        available: !k.revokedAt && Date.parse(k.expiresAt) > Date.now(),
        studyCount: k.studyIds.length,
        scopes: k.scopes,
      })),
      grants: await list<ReconciliationGrant>(
        "reconciliationGrant",
        a.workspaceId,
      ),
      runs: rows,
    });
  }
  if (p.length === 3 && p[1] === "grants" && req.method === "PUT") {
    const input = z
      .object({
        version: z.number().int().min(0),
        enabled: z.boolean(),
        limit24h: z.number().int().min(1).max(50),
        reviewed: z.literal(true),
      })
      .strict()
      .parse(await body(req));
    let grant!: ReconciliationGrant;
    await transaction(async () => {
      await admin(a);
      const key = await get<ReadApiKey>("readApiKey", p[2], a.workspaceId);
      if (!key) fail(404, "Static key not found.");
      const old = await get<ReconciliationGrant>(
        "reconciliationGrant",
        key.id,
        a.workspaceId,
      );
      if ((old?.version || 0) !== input.version)
        fail(409, "Recovery policy changed. Refresh first.");
      grant = {
        id: key.id,
        keyId: key.id,
        workspaceId: a.workspaceId,
        enabled: input.enabled,
        limit24h: input.limit24h,
        version: input.version + 1,
        actorId: a.id,
        updatedAt: now(),
      };
      await put("reconciliationGrant", grant);
    });
    return respond({ grant });
  }
  if (p.length === 3 && p[1] === "runs" && req.method === "DELETE") {
    const input = z
      .object({
        version: z.number().int().positive(),
        reviewed: z.literal(true),
      })
      .strict()
      .parse(await body(req));
    await transaction(async () => {
      await admin(a);
      const r = await get<ReconciliationRun>(
        "reconciliationRun",
        p[2],
        a.workspaceId,
      );
      if (!r) fail(404, "Run not found.");
      if (r.version !== input.version)
        fail(409, "This run advanced. Refresh first.");
      await db
        .prepare(
          "DELETE FROM documents WHERE kind='reconciliationRun' AND id=? AND workspace_id=?",
        )
        .run(r.id, a.workspaceId);
    });
    return respond({ discarded: true });
  }
  fail(405, "Unsupported integration recovery management action.");
}
