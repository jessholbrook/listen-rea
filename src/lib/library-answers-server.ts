import { collectionScope } from "./library-collection-scope";
import { transcriptAnswerCurrent } from "./library-transcript-sources-server";
import { z } from "zod";
import {
  db,
  get,
  list,
  put,
  uid,
  hash,
  now,
  transaction,
  pruneLibraryCollections,
} from "./db";
import { body, canEdit, fail, respond, HttpError } from "./http";
import type { Actor } from "./domain";
import { libraryAttachmentCorpus } from "./library-attachment-corpus";
import {
  libraryAttachmentFilter,
  type LibraryAttachmentAnswer,
  type LibraryAttachmentFilter,
  type LibraryAttachmentHit,
} from "./library-attachments";
import {
  libraryAnswerEdit,
  libraryAnswerExport,
  validateSavedLibraryCitations,
  type SavedLibraryAnswer,
} from "./library-answers";
import type { Language } from "./localization";
const kind = "libraryAnswer";
async function remove(a: Actor, id: string) {
  await db
    .prepare(
      "DELETE FROM documents WHERE kind='libraryBrief' AND workspace_id=? AND (EXISTS (SELECT 1 FROM json_each(json_extract(data,'$.sections')) section WHERE json_extract(section.value,'$.answerId')=?) OR EXISTS (SELECT 1 FROM json_each(json_extract(data,'$.answerDependencies')) dependency WHERE dependency.value=?))",
    )
    .run(a.workspaceId, id, id);
  await db
    .prepare(
      "DELETE FROM documents WHERE kind='libraryAnswer' AND id=? AND workspace_id=?",
    )
    .run(id, a.workspaceId);
  await pruneLibraryCollections(a.workspaceId);
}
async function current(a: Actor, s: SavedLibraryAnswer) {
  try {
    if (s.filter.collectionId) {
      await collectionScope(a, s.filter.collectionId);
      if (!(await get(kind, s.id, a.workspaceId))) return false;
    }
    if (s.scope === "transcripts") {
      if (await transcriptAnswerCurrent(a, s)) return true;
      await remove(a, s.id);
      return false;
    }
    const dependencies =
      s.dependencies ||
      s.sources.map((h) => ({ ...h, fingerprint: hash(JSON.stringify(h)) }));
    const ids = [...new Set(dependencies.map((h) => h.studyId))];
    const c = await libraryAttachmentCorpus(a, {
      ...s.filter,
      studyIds: ids,
      query: "",
    });
    if (
      !s.sources.length ||
      dependencies.some(
        (d) =>
          !c.hits.some(
            (h) => h.id === d.id && hash(JSON.stringify(h)) === d.fingerprint,
          ),
      ) ||
      s.sources.some(
        (f) =>
          !c.hits.some(
            (h) => h.id === f.id && JSON.stringify(h) === JSON.stringify(f),
          ),
      )
    ) {
      await remove(a, s.id);
      return false;
    }
    return true;
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) {
      await remove(a, s.id);
      return false;
    }
    // Unavailable/corrupt storage must not be mistaken for permanent source withdrawal.
    throw e;
  }
}
export async function requireCurrentLibraryAnswer(
  a: Actor,
  id: string,
  scope?: "attachments" | "transcripts",
) {
  const s = await get<SavedLibraryAnswer>(kind, id, a.workspaceId);
  if (
    !s ||
    (scope && (s.scope || "attachments") !== scope) ||
    !(await current(a, s))
  )
    fail(
      404,
      "This saved library answer is unavailable; a source may have changed or been withdrawn.",
    );
  return s;
}
function details(s: SavedLibraryAnswer) {
  const { workspaceId, requestId, inputHash, dependencies, ...publicView } = s;
  void dependencies;
  void workspaceId;
  void requestId;
  void inputHash;
  return publicView;
}
function originalResponse(s: SavedLibraryAnswer) {
  return {
    ...s.original,
    language: s.language,
    citations: s.original.citations.map((c) => ({
      ...c,
      source: s.sources.find((h) => h.id === c.evidenceId)!,
    })),
    generated: true,
    savedAnswerId: s.id,
  };
}
export async function existingLibraryDraft(
  a: Actor,
  requestId: string,
  inputHash: string,
) {
  if (
    await get(
      "libraryCollectionAnswerTombstone",
      hash(a.workspaceId + ":" + requestId),
      a.workspaceId,
    )
  )
    fail(
      409,
      "This collection answer was removed after a membership change. Ask again with a new request ID.",
    );
  const saved = await list<SavedLibraryAnswer>(kind, a.workspaceId);
  const existing = saved.find((s) => s.requestId === requestId);
  if (!existing) {
    if (saved.length >= 100)
      fail(
        409,
        "This workspace has 100 saved library answers. Delete an answer before saving another.",
      );
    return null;
  }
  if (existing.inputHash !== inputHash)
    fail(409, "This request ID was used with a different question or filters.");
  if (!(await current(a, existing)))
    fail(
      409,
      "The previously saved answer lost a source. Ask again with a new request ID.",
    );
  return originalResponse(existing);
}
export async function saveLibraryDraft(
  a: Actor,
  input: LibraryAttachmentFilter & {
    question: string;
    language: Language;
    requestId?: string;
  },
  inputHash: string,
  result: LibraryAttachmentAnswer,
  evidence: LibraryAttachmentHit[],
) {
  const repeated = await existingLibraryDraft(a, input.requestId!, inputHash);
  if (repeated) return repeated;
  if ((await list<SavedLibraryAnswer>(kind, a.workspaceId)).length >= 100)
    fail(
      409,
      "This workspace has 100 saved library answers. Delete an answer before saving another.",
    );
  const filter = libraryAttachmentFilter.parse({
    collectionId: input.collectionId,
    studyIds: input.studyIds,
    formats: input.formats,
    kinds: input.kinds,
    query: input.query,
    ...(input.attribute ? { attribute: input.attribute } : {}),
  });
  const citations = result.citations.map(({ evidenceId, quote }) => ({
    evidenceId,
    quote,
  }));
  const sources = [
    ...new Map(result.citations.map((c) => [c.evidenceId, c.source])).values(),
  ];
  try {
    validateSavedLibraryCitations(
      { answer: result.answer, citations },
      sources,
    );
  } catch {
    fail(
      400,
      "Saving requires at least one distinct exact citation to included evidence.",
    );
  }
  if (!result.model || !result.promptVersion || !result.generatedAt)
    fail(500, "Answer provenance is unavailable.");
  const s: SavedLibraryAnswer = {
    id: uid(),
    workspaceId: a.workspaceId,
    requestId: input.requestId!,
    inputHash,
    createdAt: now(),
    createdBy: { id: a.id, name: a.name },
    filter,
    language: input.language,
    original: {
      answer: result.answer,
      citations,
      question: input.question,
      model: result.model,
      promptVersion: result.promptVersion,
      generatedAt: result.generatedAt,
      evidenceCount: result.evidenceCount,
      searchedStudies: result.searchedStudies,
      ...(result.retrieval ? { retrieval: result.retrieval } : {}),
    },
    sources,
    dependencies: evidence.map((h) => ({
      id: h.id,
      studyId: h.studyId,
      interviewId: h.interviewId,
      turnId: h.turnId,
      attachmentId: h.attachmentId,
      format: h.format,
      kind: h.kind,
      fingerprint: hash(JSON.stringify(h)),
    })),
    history: [
      {
        answer: result.answer,
        citations,
        version: 1,
        at: now(),
        editor: { id: a.id, name: a.name },
        reviewed: false,
        includeInExports: false,
      },
    ],
  };
  if (JSON.stringify(s).length > 250000)
    fail(413, "This saved answer exceeds its storage limit.");
  await put(kind, s);
  return originalResponse(s);
}
export async function dispatchLibraryAnswers(
  req: Request,
  p: string[],
  a: Actor,
  scope: "attachments" | "transcripts" | "all" = "attachments",
) {
  if (p.length === 3 && req.method === "GET") {
    const rows = [];
    for (const s of await list<SavedLibraryAnswer>(kind, a.workspaceId))
      if (
        (scope === "all" || (s.scope || "attachments") === scope) &&
        (await current(a, s))
      ) {
        const r = s.history.at(-1)!;
        rows.push({
          id: s.id,
          scope: s.scope || "attachments",
          question: s.original.question,
          language: s.language,
          createdAt: s.createdAt,
          version: r.version,
          reviewed: r.reviewed,
          includeInExports: r.includeInExports,
        });
      }
    return respond({
      answers: rows,
      canEdit: ["admin", "researcher", "collaborator"].includes(a.role),
    });
  }
  if (p.length < 4 || p.length > 5)
    fail(404, "Saved library answer route unavailable.");
  const id = z.uuid().parse(p[3]);
  const candidate = await get<SavedLibraryAnswer>(kind, id, a.workspaceId);
  if (
    candidate &&
    scope !== "all" &&
    (candidate.scope || "attachments") !== scope
  )
    fail(404, "Saved answer unavailable.");
  if (p.length === 5) {
    if (req.method !== "GET" || p[4] !== "export")
      fail(404, "Saved library answer route unavailable.");
    const format = z
      .enum(["md", "csv"])
      .parse(new URL(req.url).searchParams.get("format") || "md");
    return transaction(async () => {
      const s = await get<SavedLibraryAnswer>(kind, id, a.workspaceId);
      if (!s || !(await current(a, s)))
        return respond(
          {
            error:
              "This saved library answer lost a source and is unavailable.",
          },
          404,
        );
      if (!s.history.at(-1)?.includeInExports || !s.history.at(-1)?.reviewed)
        fail(
          409,
          "Review this answer and approve its latest revision for export first.",
        );
      const content = libraryAnswerExport(s, format, new URL(req.url).origin);
      return new Response(content, {
        headers: {
          "Content-Type":
            format === "csv"
              ? "text/csv; charset=utf-8"
              : "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="echo-lab-library-answer-${s.id}.${format}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    });
  }
  if (req.method === "GET") {
    const s = await requireCurrentLibraryAnswer(a, id);
    return respond({
      answer: details(s),
      canEdit: ["admin", "researcher", "collaborator"].includes(a.role),
    });
  }
  if (!["PUT", "DELETE"].includes(req.method)) fail(405, "Method unavailable.");
  canEdit(a);
  const input =
    req.method === "PUT"
      ? libraryAnswerEdit.parse(await body(req))
      : z
          .object({ version: z.number().int().positive() })
          .strict()
          .parse(await body(req));
  // Committing stale-source removal must survive the 404; perform this check before the mutation transaction too.
  await requireCurrentLibraryAnswer(a, id);
  return transaction(async () => {
    const s = await get<SavedLibraryAnswer>(kind, id, a.workspaceId);
    if (!s || !(await current(a, s)))
      return respond(
        {
          error: "This saved library answer lost a source and is unavailable.",
        },
        404,
      );
    const previous = s.history.at(-1)!;
    if (previous.version !== input.version)
      fail(409, "This saved answer changed. Reload its latest revision.");
    if (req.method === "DELETE") {
      await remove(a, id);
      return respond({ deleted: true });
    }
    const edit = libraryAnswerEdit.parse(input);
    try {
      validateSavedLibraryCitations(edit, s.sources);
    } catch {
      fail(
        400,
        "Keep distinct complete citations from this answer’s frozen included sources.",
      );
    }
    if (edit.includeInExports && !edit.reviewed)
      fail(400, "Export approval requires explicit researcher review.");
    if (s.history.length >= 20)
      fail(409, "This answer has reached its limit of 20 review revisions.");
    s.history.push({
      answer: edit.answer,
      citations: edit.citations,
      version: previous.version + 1,
      at: now(),
      editor: { id: a.id, name: a.name },
      reviewed: edit.reviewed,
      includeInExports: edit.includeInExports,
    });
    if (JSON.stringify(s).length > 250000)
      fail(
        413,
        "This saved answer exceeds its storage limit. Delete it to remove its history.",
      );
    await put(kind, s);
    return respond({
      answer: details(s),
      canEdit: ["admin", "researcher", "collaborator"].includes(a.role),
    });
  });
}
