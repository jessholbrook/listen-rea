import {
  libraryReviewKinds,
  libraryTextKinds,
  librarySourceChanges,
  type LibraryRemoval,
} from "./library-answer-lifecycle";
import type { AnalysisScope } from "./domain";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  randomBytes,
  createHash,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import {
  createClient,
  type Client,
  type Transaction,
  type InValue,
} from "@libsql/client";
import { databaseFetch } from "./database-transport";
import type { Actor, Study, Interview, Analysis, Revision } from "./domain";
export const dataDir =
  process.env.RESEARCH_DATA_DIR || path.join(process.cwd(), ".data");
const schema = `
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,workspace_id TEXT NOT NULL,role TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS auth_sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS documents(kind TEXT NOT NULL,id TEXT NOT NULL,workspace_id TEXT NOT NULL,study_id TEXT NOT NULL DEFAULT '',data TEXT NOT NULL,PRIMARY KEY(kind,id));
CREATE INDEX IF NOT EXISTS documents_workspace ON documents(kind,workspace_id,study_id);
CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,interview_id TEXT NOT NULL,workspace_id TEXT NOT NULL,study_id TEXT NOT NULL,mime TEXT NOT NULL,bytes INTEGER NOT NULL,duration_ms INTEGER NOT NULL,created_at TEXT NOT NULL,consent_at TEXT NOT NULL DEFAULT '',turn_version INTEGER NOT NULL DEFAULT 0,transcript TEXT);
CREATE TABLE IF NOT EXISTS shares(hash TEXT PRIMARY KEY,study_id TEXT NOT NULL,workspace_id TEXT NOT NULL,analysis_id TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS usage(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,study_id TEXT,operation TEXT NOT NULL,model TEXT NOT NULL,input_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0,audio_seconds REAL NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,role TEXT NOT NULL,expires INTEGER NOT NULL);
`;
const context = new AsyncLocalStorage<Transaction>();
let initializing: Promise<Client> | undefined;
export function remoteDatabaseUrl(value: string) {
  const parsed = new URL(value.replace(/^libsql:/, "https:"));
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new Error("DEPLOYMENT_STORAGE_REQUIRED");
  return parsed.toString();
}
export function databaseMode() {
  return process.env.LIBSQL_URL || process.env.TURSO_DATABASE_URL
    ? "libsql"
    : "local";
}
async function database() {
  if (!initializing)
    initializing = (async () => {
      const url = process.env.LIBSQL_URL || process.env.TURSO_DATABASE_URL;
      const authToken = process.env.LIBSQL_URL
        ? process.env.LIBSQL_AUTH_TOKEN
        : process.env.TURSO_AUTH_TOKEN;
      if (process.env.VERCEL && !url)
        throw new Error("DEPLOYMENT_STORAGE_REQUIRED");
      if (!url) mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      const client = createClient({
        url:
          (url ? remoteDatabaseUrl(url) : undefined) ||
          "file:" + path.join(dataDir, "research.sqlite"),
        authToken,
        ...(url ? { fetch: databaseFetch } : {}),
      });
      if (!url) await client.execute("PRAGMA journal_mode=WAL");
      await client.executeMultiple(schema);
      // Upgrade the initial local schema without resetting existing studies.
      for (const [name, type] of [
        ["consent_at", "TEXT NOT NULL DEFAULT ''"],
        ["turn_version", "INTEGER NOT NULL DEFAULT 0"],
        ["transcript", "TEXT"],
        ["kind", "TEXT NOT NULL DEFAULT 'audio'"],
        ["capture_id", "TEXT NOT NULL DEFAULT ''"],
        ["sequence", "INTEGER NOT NULL DEFAULT 0"],
        ["offset_ms", "INTEGER NOT NULL DEFAULT 0"],
        ["digest", "TEXT NOT NULL DEFAULT ''"],
      ]) {
        if (
          !(await client.execute("PRAGMA table_info(media)")).rows.some(
            (r) => r.name === name,
          )
        ) {
          try {
            await client.execute(
              `ALTER TABLE media ADD COLUMN ${name} ${type}`,
            );
          } catch (e) {
            if (
              !(await client.execute("PRAGMA table_info(media)")).rows.some(
                (r) => r.name === name,
              )
            )
              throw e;
          }
        }
      }
      await client.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS screen_clip_sequence ON media(capture_id,sequence) WHERE kind='screen'",
      );
      await client.execute(
        "CREATE INDEX IF NOT EXISTS media_interview ON media(interview_id,kind)",
      );
      return client;
    })().catch((e) => {
      initializing = undefined;
      throw e;
    });
  return initializing;
}
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  queue = result.then(
    () => {},
    () => {},
  );
  return result;
}
async function execute(sql: string, args: InValue[] = []) {
  const tx = context.getStore();
  if (tx) return tx.execute({ sql, args });
  return serialized(async () => {
    const connection = await database();
    return connection.execute({ sql, args });
  });
}
export const db = {
  prepare(sql: string) {
    return {
      async run(...args: InValue[]) {
        return execute(sql, args);
      },
      async get(...args: InValue[]) {
        return (await execute(sql, args)).rows[0];
      },
      async all(...args: InValue[]) {
        return (await execute(sql, args)).rows;
      },
    };
  },
};
export const uid = () => randomUUID();
export const token = () => randomBytes(32).toString("base64url");
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const now = () => new Date().toISOString();
export async function put<
  T extends { id: string; workspaceId: string; studyId?: string },
>(kind: string, value: T): Promise<void> {
  const tracked =
    kind === "interview" ||
    kind === "study" ||
    Object.hasOwn(libraryReviewKinds, kind) ||
    Object.hasOwn(libraryTextKinds, kind);
  if (tracked && !context.getStore())
    return transaction(() => put(kind, value));
  let previous: unknown;
  if (tracked) {
    const field =
      kind === "interview"
        ? "interviewId"
        : kind === "study"
          ? "studyId"
          : "attachmentId";
    const row = await db
      .prepare(
        `SELECT data FROM documents WHERE kind=? AND id=? AND workspace_id=? AND EXISTS (SELECT 1 FROM documents a,json_each(COALESCE(json_extract(a.data,'$.dependencies'),json_extract(a.data,'$.sources'),'[]')) evidence WHERE a.kind IN ('libraryAnswer','libraryEmbedding','libraryBrief') AND a.workspace_id=? AND json_extract(evidence.value,'$.${field}')=?)`,
      )
      .get(kind, value.id, value.workspaceId, value.workspaceId, value.id);
    if (row) previous = JSON.parse(String(row.data));
  }
  await db
    .prepare(
      "INSERT INTO documents(kind,id,workspace_id,study_id,data) VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
    )
    .run(
      kind,
      value.id,
      value.workspaceId,
      value.studyId || value.id,
      JSON.stringify(value),
    );
  for (const removal of librarySourceChanges(kind, previous, value))
    await clearLibraryAnswers(value.workspaceId, removal);
  if (
    kind === "interview" &&
    ((value as any).excluded ||
      (value as any).preview ||
      (value as any).status !== "complete")
  )
    await pruneLibraryCollections(value.workspaceId);
}
export async function clearLibraryAnswers(
  workspaceId: string,
  removal: LibraryRemoval,
): Promise<void> {
  if (!context.getStore())
    return transaction(() => clearLibraryAnswers(workspaceId, removal));
  const { field, id, format, kind } = removal;
  // Only fixed field names from the typed classifier enter SQL; values remain bound parameters.
  if (!["attachmentId", "interviewId", "turnId", "studyId"].includes(field))
    throw new Error("INVALID_LIBRARY_SOURCE");
  const predicate = `workspace_id=? AND EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(documents.data,'$.dependencies'),json_extract(documents.data,'$.sources'),'[]')) evidence WHERE json_extract(evidence.value,'$.${field}')=?${format ? " AND json_extract(evidence.value,'$.format')=?" : ""}${kind ? " AND json_extract(evidence.value,'$.kind')=?" : ""})`;
  for (const row of await db
    .prepare(
      `SELECT data FROM documents WHERE kind='libraryAnswer' AND json_extract(data,'$.filter.collectionId') IS NOT NULL AND ${predicate}`,
    )
    .all(
      workspaceId,
      id,
      ...(format ? [format] : []),
      ...(kind ? [kind] : []),
    )) {
    const answer = JSON.parse(String(row.data));
    await put("libraryCollectionAnswerTombstone", {
      id: hash(workspaceId + ":" + answer.requestId),
      workspaceId,
      createdAt: now(),
    });
  }
  await db
    .prepare(
      `DELETE FROM documents WHERE kind IN ('libraryAnswer','libraryEmbedding','libraryBrief') AND workspace_id=? AND EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(documents.data,'$.dependencies'),json_extract(documents.data,'$.sources'),'[]')) evidence WHERE json_extract(evidence.value,'$.${field}')=?${format ? " AND json_extract(evidence.value,'$.format')=?" : ""}${kind ? " AND json_extract(evidence.value,'$.kind')=?" : ""})`,
    )
    .run(workspaceId, id, ...(format ? [format] : []), ...(kind ? [kind] : []));
  await pruneLibraryCollections(workspaceId);
}
export async function get<T>(
  kind: string,
  id: string,
  workspaceId?: string,
): Promise<T | undefined> {
  const r = await db
    .prepare(
      `SELECT data FROM documents WHERE kind=? AND id=?${workspaceId ? " AND workspace_id=?" : ""}`,
    )
    .get(kind, id, ...(workspaceId ? [workspaceId] : []));
  return r ? JSON.parse(r.data as string) : undefined;
}
export async function list<T>(
  kind: string,
  workspaceId: string,
  studyId?: string,
): Promise<T[]> {
  return (
    await db
      .prepare(
        `SELECT data FROM documents WHERE kind=? AND workspace_id=?${studyId ? " AND study_id=?" : ""} ORDER BY rowid DESC`,
      )
      .all(kind, workspaceId, ...(studyId ? [studyId] : []))
  ).map((r) => JSON.parse(r.data as string));
}
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (context.getStore()) return fn();
  return serialized(async () => {
    const client = await database();
    const tx = await client.transaction("write");
    try {
      const value = await context.run(tx, fn);
      await tx.commit();
      return value;
    } catch (e) {
      await tx.rollback();
      throw e;
    } finally {
      tx.close();
    }
  });
}
export function passwordHash(password: string) {
  const salt = token();
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function passwordMatches(password: string, stored: string) {
  const [salt, digest] = stored.split(":");
  const actual = scryptSync(password, salt, 64),
    expected = Buffer.from(digest, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export async function actorFor(session: string): Promise<Actor | undefined> {
  const r = await db
    .prepare(
      "SELECT u.id,u.email,u.name,u.workspace_id,u.role FROM auth_sessions s JOIN users u ON s.user_id=u.id WHERE s.hash=? AND s.expires>?",
    )
    .get(hash(session), Date.now());
  return r
    ? {
        id: r.id as string,
        email: r.email as string,
        name: r.name as string,
        workspaceId: r.workspace_id as string,
        role: r.role as Actor["role"],
      }
    : undefined;
}
export async function requireStudy(id: string, actor: Actor): Promise<Study> {
  const study = await get<Study>("study", id, actor.workspaceId);
  if (!study) throw new Error("NOT_FOUND");
  return study;
}
export async function dirty(study: Study) {
  study.dataVersion++;
  study.updatedAt = now();
  await put("study", study);
}
export async function interviews(study: Study) {
  return list<Interview>("interview", study.workspaceId, study.id);
}
export async function latestAnalysis(study: Study, scope?: AnalysisScope) {
  return (await list<Analysis>("analysis", study.workspaceId, study.id)).find(
    (a) =>
      scope
        ? a.scope?.conceptId === scope.conceptId &&
          a.scope.revisionId === scope.revisionId
        : !a.scope,
  );
}
export async function revision(id: string, actor: Actor) {
  return get<Revision>("revision", id, actor.workspaceId);
}

export function secretsMatch(a: string, b: string) {
  return timingSafeEqual(
    Buffer.from(hash(a), "hex"),
    Buffer.from(hash(b), "hex"),
  );
}

// Collection records contain only organizer titles and current references, never source copies/history.
export async function clearCollectionAnswers(
  workspaceId: string,
  collectionId: string,
): Promise<void> {
  if (!context.getStore())
    return transaction(() => clearCollectionAnswers(workspaceId, collectionId));
  const answers = await db
    .prepare(
      "SELECT id,data FROM documents WHERE kind='libraryAnswer' AND workspace_id=? AND json_extract(data,'$.filter.collectionId')=?",
    )
    .all(workspaceId, collectionId);
  for (const row of answers) {
    const answer = JSON.parse(String(row.data));
    await put("libraryCollectionAnswerTombstone", {
      id: hash(workspaceId + ":" + answer.requestId),
      workspaceId,
      createdAt: now(),
    });
    await db
      .prepare(
        "DELETE FROM documents WHERE kind='libraryBrief' AND workspace_id=? AND (EXISTS (SELECT 1 FROM json_each(json_extract(data,'$.answerDependencies')) d WHERE d.value=?) OR EXISTS (SELECT 1 FROM json_each(json_extract(data,'$.sections')) s WHERE json_extract(s.value,'$.answerId')=?))",
      )
      .run(workspaceId, String(row.id), String(row.id));
  }
  await db
    .prepare(
      "DELETE FROM documents WHERE kind='libraryAnswer' AND workspace_id=? AND json_extract(data,'$.filter.collectionId')=?",
    )
    .run(workspaceId, collectionId);
}
export async function pruneLibraryCollections(
  workspaceId: string,
): Promise<void> {
  if (!context.getStore())
    return transaction(() => pruneLibraryCollections(workspaceId));
  const collections = await list<
    import("./library-collections").LibraryCollection
  >("libraryCollection", workspaceId);
  if (!collections.length) {
    await pruneCollectionTasks(workspaceId);
    await pruneCollectionHandoffs(workspaceId);
    await db
      .prepare(
        "DELETE FROM documents WHERE kind='libraryCollectionReview' AND workspace_id=?",
      )
      .run(workspaceId);
    return;
  }
  const eligible = new Set(
    (
      await db
        .prepare(
          "SELECT i.id FROM documents i WHERE i.kind='interview' AND i.workspace_id=? AND json_extract(i.data,'$.status')='complete' AND NOT COALESCE(json_extract(i.data,'$.excluded'),0) AND NOT COALESCE(json_extract(i.data,'$.preview'),0) AND EXISTS (SELECT 1 FROM documents s WHERE s.kind='study' AND s.id=i.study_id AND s.workspace_id=i.workspace_id)",
        )
        .all(workspaceId)
    ).map((r) => String(r.id)),
  );
  const next = collections.map((c) => ({
    ...c,
    interviewIds: c.interviewIds.filter((id) => eligible.has(id)),
  }));
  for (let n = 0; n < next.length; n++)
    if (next[n].interviewIds.length !== collections[n].interviewIds.length)
      await clearCollectionAnswers(workspaceId, next[n].id);
  const briefs = new Set(
    (
      await db
        .prepare(
          "SELECT id FROM documents WHERE kind='libraryBrief' AND workspace_id=?",
        )
        .all(workspaceId)
    ).map((r) => String(r.id)),
  );
  for (let n = 0; n < next.length; n++) {
    const c = next[n];
    c.briefIds = c.briefIds.filter((id) => briefs.has(id));
    if (
      c.interviewIds.length === collections[n].interviewIds.length &&
      c.briefIds.length === collections[n].briefIds.length
    )
      continue;
    c.version++;
    c.updatedAt = now();
    await put("libraryCollection", c);
  }
  await pruneCollectionReviewStates(workspaceId);
  await pruneCollectionTasks(workspaceId);
  await pruneCollectionHandoffs(workspaceId);
}

async function pruneCollectionReviewStates(workspaceId: string) {
  const collections = await list<
    import("./library-collections").LibraryCollection
  >("libraryCollection", workspaceId);
  for (const state of await list<
    import("./collection-review").CollectionReviewState
  >("libraryCollectionReview", workspaceId)) {
    const c = collections.find((c) => c.id === state.id);
    if (!c) {
      await db
        .prepare(
          "DELETE FROM documents WHERE kind='libraryCollectionReview' AND workspace_id=? AND id=?",
        )
        .run(workspaceId, state.id);
      continue;
    }
    const states = state.sourceStates.filter((s) =>
      c.interviewIds.includes(s.interviewId),
    );
    if (states.length === state.sourceStates.length) continue;
    await put("libraryCollectionReview", {
      ...state,
      sourceStates: states,
      removedSinceCheck:
        state.removedSinceCheck + state.sourceStates.length - states.length,
      version: state.version + 1,
    });
  }
}

// Keep task text and links inside the lifetime of their collection and source.
export async function removeCollectionTask(
  t: import("./collection-tasks").CollectionTask,
) {
  await put("libraryCollectionTaskTombstone", {
    id: hash(t.workspaceId + ":" + t.requestId),
    workspaceId: t.workspaceId,
    createdAt: now(),
  });
  await db
    .prepare(
      "DELETE FROM documents WHERE kind='libraryCollectionTask' AND workspace_id=? AND id=?",
    )
    .run(t.workspaceId, t.id);
  await db
    .prepare(
      "DELETE FROM documents WHERE kind='libraryTaskActivity' AND workspace_id=? AND id=?",
    )
    .run(t.workspaceId, t.id);
}
async function pruneCollectionTasks(workspaceId: string) {
  const collections = await list<
    import("./library-collections").LibraryCollection
  >("libraryCollection", workspaceId);
  const members = new Set(
    (
      await db
        .prepare("SELECT id FROM users WHERE workspace_id=?")
        .all(workspaceId)
    ).map((m) => String(m.id)),
  );
  // Resolve dependency membership in batches rather than issuing a read per task.
  const dependencies = await db
    .prepare(
      "SELECT kind,id,json_extract(data,'$.filter.collectionId') AS collection_id FROM documents WHERE workspace_id=? AND kind IN ('libraryAnswer','libraryBrief')",
    )
    .all(workspaceId);
  const answers = new Map(
    dependencies
      .filter((r) => r.kind === "libraryAnswer")
      .map((r) => [String(r.id), String(r.collection_id)]),
  );
  const briefs = new Set(
    dependencies
      .filter((r) => r.kind === "libraryBrief")
      .map((r) => String(r.id)),
  );
  for (const t of await list<import("./collection-tasks").CollectionTask>(
    "libraryCollectionTask",
    workspaceId,
  )) {
    const c = collections.find((c) => c.id === t.collectionId),
      target = t.target;
    let valid = !!c;
    if (c && target) {
      if (target.kind === "interview")
        valid = c.interviewIds.includes(target.id);
      if (target.kind === "brief")
        valid = c.briefIds.includes(target.id) && briefs.has(target.id);
      if (target.kind === "answer") valid = answers.get(target.id) === c.id;
    }
    if (!valid) {
      await removeCollectionTask(t);
      continue;
    }
    if (t.assigneeId && !members.has(t.assigneeId)) {
      const updated = {
        ...t,
        assigneeId: null,
        version: t.version + 1,
        updatedAt: now(),
      };
      await put("libraryCollectionTask", updated);
      const { recordTaskActivity } = await import("./task-activity-records");
      await recordTaskActivity(updated, t, null, "assignee_unavailable");
    }
  }
  await db
    .prepare(
      "DELETE FROM documents WHERE workspace_id=? AND kind='libraryTaskActivity' AND id NOT IN (SELECT id FROM documents WHERE workspace_id=? AND kind='libraryCollectionTask')",
    )
    .run(workspaceId, workspaceId);
}

export async function removeCollectionHandoff(
  p: import("./collection-handoff").CollectionHandoff,
) {
  await put("libraryCollectionHandoffTombstone", {
    id: hash(p.workspaceId + ":" + p.requestId),
    workspaceId: p.workspaceId,
    createdAt: now(),
  });
  await db
    .prepare(
      "DELETE FROM documents WHERE kind IN ('libraryHandoffFeedback','libraryReviewActivity') AND workspace_id=? AND id=?",
    )
    .run(p.workspaceId, p.id);
  await db
    .prepare(
      "DELETE FROM documents WHERE kind='libraryCollectionHandoff' AND workspace_id=? AND id=?",
    )
    .run(p.workspaceId, p.id);
}
async function pruneCollectionHandoffs(workspaceId: string) {
  const packets = await list<import("./collection-handoff").CollectionHandoff>(
    "libraryCollectionHandoff",
    workspaceId,
  );
  await db
    .prepare(
      "DELETE FROM documents WHERE kind IN ('libraryHandoffFeedback','libraryReviewActivity') AND workspace_id=? AND NOT EXISTS (SELECT 1 FROM documents p WHERE p.kind='libraryCollectionHandoff' AND p.id=documents.id AND p.workspace_id=documents.workspace_id)",
    )
    .run(workspaceId);
  if (!packets.length) return;
  const collections = await list<
    import("./library-collections").LibraryCollection
  >("libraryCollection", workspaceId);
  const answers = new Set(
    (
      await db
        .prepare(
          "SELECT id FROM documents WHERE workspace_id=? AND kind='libraryAnswer'",
        )
        .all(workspaceId)
    ).map((r) => String(r.id)),
  );
  const tasks = new Set(
    (
      await db
        .prepare(
          "SELECT id FROM documents WHERE workspace_id=? AND kind='libraryCollectionTask'",
        )
        .all(workspaceId)
    ).map((r) => String(r.id)),
  );
  for (const p of packets) {
    const c = collections.find((c) => c.id === p.collectionId);
    if (
      !c ||
      p.memberInterviewIds.some((id) => !c.interviewIds.includes(id)) ||
      p.briefDependencies.some((id) => !c.briefIds.includes(id)) ||
      p.answerDependencies.some((id) => !answers.has(id)) ||
      p.taskDependencies.some((id) => !tasks.has(id))
    )
      await removeCollectionHandoff(p);
  }
}
