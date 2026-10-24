import test from "node:test";
import assert from "node:assert/strict";
import {
  semanticDimensions,
  semanticModel,
  semanticVersion,
  validVector,
  cosine,
  transcriptChunks,
  embeddingBatch,
  hybridNeighbors,
  type SemanticItem,
  type LibraryEmbedding,
} from "../src/lib/library-semantic";
import { embedLibraryTexts } from "../src/lib/library-semantic-server";
export const unit = (position = 0) =>
  Array.from({ length: semanticDimensions }, (_, i) =>
    i === position ? 1 : 0,
  );
const item = (id: string, text: string): SemanticItem => ({
  id,
  text,
  fingerprint: id,
  ref: {
    id,
    studyId: "study",
    interviewId: "response",
    turnId: id,
    format: "transcript",
    kind: "transcript",
  },
  hit: {
    studyId: "study",
    studyTitle: "Private title",
    interviewId: "response",
    turnId: id,
    revisionId: "revision",
    quote: text,
    prompt: "Private prompt",
    source: "external",
    sourceTitle: "Private source",
    externalId: "Private external id",
    attributes: { private: "private value" },
  },
});
const row = (h: SemanticItem, vector = unit()): LibraryEmbedding => ({
  id: h.id,
  workspaceId: "workspace",
  scope: "transcripts",
  sourceId: h.id,
  fingerprint: h.fingerprint,
  model: semanticModel,
  dimensions: semanticDimensions,
  version: semanticVersion,
  createdAt: "now",
  vector,
  dependencies: [h.ref],
});
test("meaning retrieval finds nonliteral neighbors, fuses exact words and rejects stale/model-mismatched/invalid vectors", () => {
  const a = item("save", "Save draft before review."),
    b = item("invoice", "Monthly invoices are paid."),
    c = item("unindexed", "private unindexed source");
  assert.equal(a.text.includes("unfinished"), false);
  assert.equal(
    hybridNeighbors([a, b, c], [row(a), row(b, unit(1))], unit(), [], 1)[0].id,
    "save",
  );
  assert.equal(
    hybridNeighbors(
      [a, b],
      [row(a), row(b, unit(1))],
      unit(),
      ["invoice"],
      1,
    )[0].id,
    "invoice",
  );
  assert.equal(
    hybridNeighbors([a], [{ ...row(a), fingerprint: "stale" }], unit(), [])
      .length,
    0,
  );
  assert.equal(
    hybridNeighbors([a], [{ ...row(a), model: "other" }], unit(), []).length,
    0,
  );
  assert.equal(cosine(unit(), unit()), 1);
  assert.equal(cosine(unit(), unit(1)), 0);
  for (const v of [
    [],
    Array(256).fill(0),
    Array(256).fill(NaN),
    Array(256).fill(Infinity),
    Array(256).fill(1e-300),
    Array(255).fill(1),
  ])
    assert.equal(validVector(v), false);
});
test("transcript chunks remain exact contiguous text and index batches never truncate evidence or exceed character/count limits", () => {
  const text =
      "Participant: " +
      "This is a synthetic research observation. ".repeat(300),
    chunks = transcriptChunks(text);
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.equal(text.slice(c.start, c.end), c.text);
    assert.ok(c.text.length <= 1500);
  }
  assert.equal(chunks.at(-1)!.end, text.length);
  for (let n = 1; n < chunks.length; n++)
    assert.ok(chunks[n].start < chunks[n - 1].end);
  const many = Array.from({ length: 200 }, (_, n) =>
    item(String(n), "x".repeat(1500)),
  );
  const batch = embeddingBatch(many);
  assert.equal(batch.length, 26);
  assert.ok(batch.reduce((n, h) => n + h.text.length, 0) <= 40000);
  assert.equal(
    embeddingBatch(many.map((h) => ({ ...h, text: "small text" }))).length,
    100,
  );
});
test("embedding requests send only bounded texts and fixed model/options, validate provider order, and record model usage without content", async () => {
  let recorded: any[] = [];
  let payload: any;
  const request: any = async (
    route: string,
    body: any,
    _multipart: boolean,
    signal: AbortSignal,
  ) => {
    assert.equal(route, "embeddings");
    assert.ok(signal instanceof AbortSignal);
    payload = body;
    return {
      json: async () => ({
        model: semanticModel,
        data: [
          { index: 1, embedding: unit(1) },
          { index: 0, embedding: unit() },
        ],
        usage: { prompt_tokens: 12 },
      }),
    };
  };
  const result = await embedLibraryTexts(
    ["selected note", "other selected passage"],
    "workspace",
    "library-embedding-index",
    request,
    async (...args) => {
      recorded = args;
    },
  );
  assert.deepEqual(payload, {
    model: semanticModel,
    dimensions: 256,
    encoding_format: "float",
    input: ["selected note", "other selected passage"],
  });
  assert.deepEqual(result, [unit(), unit(1)]);
  assert.deepEqual(recorded, [
    "workspace",
    "",
    "library-embedding-index",
    semanticModel,
    12,
  ]);
  const bad: any = async () => ({
    json: async () => ({
      model: semanticModel,
      data: [
        { index: 0, embedding: unit() },
        { index: 0, embedding: unit() },
      ],
    }),
  });
  await assert.rejects(
    () =>
      embedLibraryTexts(
        ["one", "two"],
        "workspace",
        "library-embedding-index",
        bad,
        async () => {},
      ),
    /INVALID_EMBEDDING/,
  );
  await assert.rejects(
    () =>
      embedLibraryTexts(
        [""],
        "workspace",
        "library-embedding-index",
        request,
        async () => {},
      ),
    /INVALID_EMBEDDING_INPUT/,
  );
});
