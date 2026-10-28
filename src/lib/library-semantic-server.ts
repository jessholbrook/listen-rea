import { collectionScope } from "./library-collection-scope";
import { z } from "zod";
import { db, get, list, put, hash, now, transaction } from "./db";
import { body, canEdit, fail, respond, limit } from "./http";
import { providerRequest, recordUsage } from "./ai";
import type { Actor } from "./domain";
import { libraryAttachmentCorpus } from "./library-attachment-corpus";
import { transcriptLibraryCorpus } from "./library-transcript-corpus";
import {
  libraryAttachmentFilter,
  type LibraryAttachmentFilter,
  type LibraryAttachmentHit,
} from "./library-attachments";
import { queryTerms, type LibraryHit } from "./library";
import {
  semanticModel,
  semanticDimensions,
  semanticVersion,
  transcriptChunks,
  validVector,
  embeddingBatch,
  hybridNeighbors,
  type SemanticItem,
  type SemanticScope,
  type LibraryEmbedding,
  type SemanticCoverage,
  type SemanticRetrieval,
} from "./library-semantic";
export async function embedLibraryTexts(
  texts: string[],
  workspaceId: string,
  operation: "library-embedding-index" | "library-embedding-query",
  request: typeof providerRequest = providerRequest,
  usage: typeof recordUsage = recordUsage,
) {
  if (
    !texts.length ||
    texts.length > 100 ||
    texts.some((t) => !t.trim() || t.length > 4000) ||
    texts.reduce((n, t) => n + t.length, 0) > 40000
  )
    throw Error("INVALID_EMBEDDING_INPUT");
  const res = await request(
    "embeddings",
    {
      model: semanticModel,
      dimensions: semanticDimensions,
      encoding_format: "float",
      input: texts,
    },
    false,
    AbortSignal.timeout(25000),
  );
  const json = (await res.json()) as {
    model?: string;
    data?: { index: number; embedding: unknown }[];
    usage?: { prompt_tokens: number };
  };
  if (
    json.model !== semanticModel ||
    !Array.isArray(json.data) ||
    json.data.length !== texts.length
  )
    throw Error("INVALID_EMBEDDING");
  const vectors: number[][] = [];
  for (const row of json.data) {
    if (
      !Number.isInteger(row.index) ||
      row.index < 0 ||
      row.index >= texts.length ||
      vectors[row.index] ||
      !validVector(row.embedding)
    )
      throw Error("INVALID_EMBEDDING");
    vectors[row.index] = row.embedding;
  }
  if (vectors.length !== texts.length || vectors.some((v) => !validVector(v)))
    throw Error("INVALID_EMBEDDING");
  await usage(
    workspaceId,
    "",
    operation,
    semanticModel,
    json.usage?.prompt_tokens || 0,
  );
  return vectors;
}
export async function semanticSnapshot(
  a: Actor,
  scope: SemanticScope,
  filter: LibraryAttachmentFilter,
) {
  const collection = await collectionScope(a, filter.collectionId);
  const unsegmented = {
    ...filter,
    attribute: undefined,
    query: "",
  };
  const items: SemanticItem[] = [];
  let corpusFingerprint: string;
  if (scope === "attachments") {
    const c = await libraryAttachmentCorpus(a, unsegmented);
    corpusFingerprint = c.fingerprint;
    for (const h of c.hits)
      items.push({
        id: h.id,
        text: h.text,
        fingerprint: hash(JSON.stringify(h)),
        ref: {
          id: h.id,
          studyId: h.studyId,
          interviewId: h.interviewId,
          turnId: h.turnId,
          attachmentId: h.attachmentId,
          format: h.format,
          kind: h.kind,
        },
        hit: h,
      });
  } else {
    const c = await transcriptLibraryCorpus(a, unsegmented);
    corpusFingerprint = c.fingerprint;
    if (c.studies.length > 100 || c.responses.length > 2000)
      fail(
        413,
        "Narrow semantic retrieval to at most 100 studies and 2,000 completed responses.",
      );
    for (const h of c.hits)
      for (const chunk of transcriptChunks(h.quote)) {
        const fingerprint = hash(JSON.stringify([h, chunk.start, chunk.end])),
          id = hash("transcript:" + fingerprint);
        if (items.length >= 5000)
          fail(
            413,
            "Narrow semantic retrieval to at most 5,000 eligible transcript chunks.",
          );
        items.push({
          id,
          text: chunk.text,
          fingerprint,
          ref: {
            id,
            studyId: h.studyId,
            interviewId: h.interviewId,
            turnId: h.turnId,
            format: "transcript",
            kind: "transcript",
          },
          hit: {
            ...h,
            quote: chunk.text,
            semanticChunkId: id,
            semanticStart: chunk.start,
            semanticEnd: chunk.end,
          },
        });
      }
  }
  if (items.length > 5000)
    fail(
      413,
      "Narrow semantic retrieval to at most 5,000 eligible evidence records or transcript chunks.",
    );
  const eligible = items.filter(
    (h) =>
      (!collection || collection.interviewIds.includes(h.hit.interviewId)) &&
      h.text.trim().length >= 3 &&
      h.text.length <= 2000 &&
      (!filter.attribute ||
        h.hit.attributes[filter.attribute.key] === filter.attribute.value),
  );
  return {
    collectionInterviewIds: collection?.interviewIds,
    all: items,
    items: eligible,
    fingerprint: hash(
      corpusFingerprint +
        JSON.stringify(filter) +
        (collection
          ? JSON.stringify([
              collection.id,
              collection.version,
              collection.interviewIds,
            ])
          : ""),
    ),
    scope,
  };
}
const kind = "libraryEmbedding";
const epochId = (a: Actor, scope: SemanticScope) =>
  hash(a.workspaceId + ":" + scope);
async function epoch(a: Actor, scope: SemanticScope) {
  return (
    (
      await get<{ epoch: number }>(
        "libraryIndexState",
        epochId(a, scope),
        a.workspaceId,
      )
    )?.epoch || 0
  );
}

const indexID = (workspace: string, scope: SemanticScope, id: string) =>
  hash([workspace, scope, id, semanticVersion].join(":"));
async function rows(a: Actor, scope: SemanticScope) {
  return (await list<LibraryEmbedding>(kind, a.workspaceId)).filter(
    (r) => r.scope === scope,
  );
}
export function activeRows(items: SemanticItem[], rows: LibraryEmbedding[]) {
  const byId = new Map(items.map((h) => [h.id, h]));
  return rows.filter(
    (r) =>
      r.version === semanticVersion &&
      r.model === semanticModel &&
      r.dimensions === semanticDimensions &&
      validVector(r.vector) &&
      byId.get(r.sourceId)?.fingerprint === r.fingerprint,
  );
}
function coverage(
  a: Actor,
  scope: SemanticScope,
  items: SemanticItem[],
  indexed: LibraryEmbedding[],
): SemanticCoverage {
  const count = activeRows(items, indexed).length;
  return {
    scope,
    indexed: count,
    eligible: items.length,
    missing: items.length - count,
    partial: count < items.length,
    model: semanticModel,
    dimensions: semanticDimensions,
    version: semanticVersion,
    canEdit: ["admin", "researcher", "collaborator"].includes(a.role),
  };
}
async function reconcile(
  a: Actor,
  scope: SemanticScope,
  filter: LibraryAttachmentFilter,
  snapshot: Awaited<ReturnType<typeof semanticSnapshot>>,
) {
  const current = new Map(snapshot.all.map((h) => [h.id, h])),
    records = await rows(a, scope);
  for (const r of records) {
    const ref = r.dependencies[0];
    if (
      snapshot.collectionInterviewIds &&
      !snapshot.collectionInterviewIds.includes(ref.interviewId)
    )
      continue;
    if (filter.studyIds.length && !filter.studyIds.includes(ref.studyId))
      continue;
    if (
      scope === "attachments" &&
      (!filter.formats.includes(ref.format as LibraryAttachmentHit["format"]) ||
        !filter.kinds.includes(ref.kind as LibraryAttachmentHit["kind"]))
    )
      continue;
    if (
      current.get(r.sourceId)?.fingerprint !== r.fingerprint ||
      r.version !== semanticVersion ||
      r.model !== semanticModel ||
      !validVector(r.vector)
    )
      await db
        .prepare(
          "DELETE FROM documents WHERE kind='libraryEmbedding' AND id=? AND workspace_id=?",
        )
        .run(r.id, a.workspaceId);
  }
  return rows(a, scope);
}
export const semanticControl = libraryAttachmentFilter
  .extend({ scope: z.enum(["transcripts", "attachments"]) })
  .strict();
export async function dispatchLibrarySemantic(
  req: Request,
  p: string[],
  a: Actor,
  embed: typeof embedLibraryTexts = embedLibraryTexts,
) {
  if (p[1] !== "semantic") return null;
  if (p.length !== 3 || !["status", "index"].includes(p[2]))
    fail(404, "Semantic library route unavailable.");
  if (req.method === "DELETE" && p[2] === "index") {
    canEdit(a);
    const { scope } = z
      .object({ scope: z.enum(["transcripts", "attachments"]) })
      .strict()
      .parse(await body(req));
    return transaction(async () => {
      await db
        .prepare(
          "DELETE FROM documents WHERE kind='libraryEmbedding' AND workspace_id=? AND json_extract(data,'$.scope')=?",
        )
        .run(a.workspaceId, scope);
      await put("libraryIndexState", {
        id: epochId(a, scope),
        workspaceId: a.workspaceId,
        epoch: (await epoch(a, scope)) + 1,
      });
      return respond({ cleared: true, scope });
    });
  }
  if (req.method !== "POST") fail(405, "Method unavailable.");
  const input = semanticControl.parse(await body(req)),
    scope = input.scope;
  if (p[2] === "status") {
    const s = await semanticSnapshot(a, scope, input);
    const indexed = await reconcile(a, scope, input, s);
    return respond({ coverage: coverage(a, scope, s.items, indexed) });
  }
  canEdit(a);
  limit("library-index:" + a.workspaceId, 10);
  const generation = await epoch(a, scope);
  const before = await semanticSnapshot(a, scope, input),
    existing = await reconcile(a, scope, input, before),
    current = activeRows(before.items, existing),
    ids = new Set(current.map((r) => r.sourceId)),
    batch = embeddingBatch(before.items.filter((h) => !ids.has(h.id)));
  if (!batch.length)
    return respond({
      coverage: coverage(a, scope, before.items, existing),
      built: 0,
    });
  const total = await list<LibraryEmbedding>(kind, a.workspaceId);
  if (total.length + batch.length > 2000)
    fail(
      413,
      "This workspace index supports 2,000 vectors. Clear unused source-type indexes or narrow the filters.",
    );
  const vectors = await embed(
    batch.map((h) => h.text),
    a.workspaceId,
    "library-embedding-index",
  );
  if (vectors.length !== batch.length || vectors.some((v) => !validVector(v)))
    throw Error("INVALID_EMBEDDING");
  return transaction(async () => {
    const after = await semanticSnapshot(a, scope, input);
    if ((await epoch(a, scope)) !== generation)
      fail(
        409,
        "The index was cleared while building. Check coverage before indexing again.",
      );
    if (after.fingerprint !== before.fingerprint)
      fail(
        409,
        "Library sources changed while indexing. Check coverage and try again.",
      );
    if (
      (await list<LibraryEmbedding>(kind, a.workspaceId)).length +
        batch.length >
      2000
    )
      fail(
        413,
        "Workspace index capacity changed. Check coverage before indexing again.",
      );
    for (let n = 0; n < batch.length; n++) {
      const h = batch[n];
      await put(kind, {
        id: indexID(a.workspaceId, scope, h.id),
        workspaceId: a.workspaceId,
        scope,
        sourceId: h.id,
        fingerprint: h.fingerprint,
        model: semanticModel,
        dimensions: semanticDimensions,
        version: semanticVersion,
        vector: vectors[n],
        createdAt: now(),
        dependencies: [h.ref],
      });
    }
    return respond({
      coverage: coverage(a, scope, after.items, await rows(a, scope)),
      built: batch.length,
    });
  });
}
export async function retrieveLibrarySemantic(
  a: Actor,
  scope: SemanticScope,
  filter: LibraryAttachmentFilter,
  query: string,
  maximum = 50,
  embed: typeof embedLibraryTexts = embedLibraryTexts,
) {
  if (query.trim().length < 3 || query.length > 4000)
    fail(400, "Enter at least three characters for meaning-based retrieval.");
  limit("library-semantic-query:" + a.workspaceId, 30);
  const generation = await epoch(a, scope);
  const before = await semanticSnapshot(a, scope, filter),
    records = await reconcile(a, scope, filter, before),
    indexed = activeRows(before.items, records),
    info = coverage(a, scope, before.items, indexed);
  const meta: SemanticRetrieval = {
    mode: "semantic",
    strategy: "hybrid-rrf-v1",
    model: semanticModel,
    version: semanticVersion,
    indexed: info.indexed,
    eligible: info.eligible,
    partial: info.partial,
  };
  if (!indexed.length) return { items: [] as SemanticItem[], retrieval: meta };
  const vectors = await embed(
    [query],
    a.workspaceId,
    "library-embedding-query",
  );
  if (vectors.length !== 1 || !validVector(vectors[0]))
    throw Error("INVALID_EMBEDDING");
  const after = await semanticSnapshot(a, scope, filter);
  if ((await epoch(a, scope)) !== generation)
    fail(409, "The index was cleared while searching. Search again.");
  if (after.fingerprint !== before.fingerprint)
    fail(409, "Library sources changed while searching. Search again.");
  const words = queryTerms(query),
    lexical = before.items
      .map((h, i) => ({
        h,
        i,
        score: words.reduce(
          (n, t) => n + (h.text.toLocaleLowerCase().includes(t) ? 3 : 0),
          0,
        ),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((r) => r.h.id);
  return {
    items: hybridNeighbors(after.items, indexed, vectors[0], lexical, maximum),
    retrieval: meta,
  };
}
