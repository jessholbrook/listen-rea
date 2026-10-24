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
import { body, canEdit, respond, fail, HttpError } from "./http";
import type { Actor } from "./domain";
import { requireCurrentLibraryAnswer } from "./library-answers-server";
import type { SavedLibraryAnswer } from "./library-answers";
import {
  briefCreate,
  briefEdit,
  briefExport,
  type LibraryBrief,
  type BriefDetails,
  type BriefSection,
} from "./library-briefs";
const kind = "libraryBrief";
async function remove(a: Actor, id: string) {
  await db
    .prepare(
      "DELETE FROM documents WHERE kind='libraryBrief' AND workspace_id=? AND id=?",
    )
    .run(a.workspaceId, id);
  await pruneLibraryCollections(a.workspaceId);
}
async function stored(a: Actor, id: string) {
  const b = await get<LibraryBrief>(kind, id, a.workspaceId);
  if (!b)
    fail(
      404,
      "This brief is unavailable; an answer or source may have been removed.",
    );
  return b;
}
async function resolve(
  a: Actor,
  b: LibraryBrief,
): Promise<{ details: BriefDetails; answers: SavedLibraryAnswer[] }> {
  const answers: SavedLibraryAnswer[] = [];
  try {
    const all = new Map<string, SavedLibraryAnswer>();
    for (const id of new Set([
      ...(b.answerDependencies || []),
      ...b.sections.map((s) => s.answerId),
    ]))
      all.set(id, await requireCurrentLibraryAnswer(a, id));
    for (const section of b.sections) answers.push(all.get(section.answerId)!);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) {
      await remove(a, b.id);
      fail(404, "This brief lost an answer or source and was removed.");
    }
    throw e;
  }
  const sections = b.sections.map((section, i) => {
    const s = answers[i],
      r = s.history.at(-1)!;
    const state =
      !r.reviewed || !r.includeInExports
        ? "unapproved"
        : r.version !== section.answerVersion
          ? "changed"
          : "current";
    return {
      ...section,
      state,
      latestVersion: r.version,
      ...(state === "current"
        ? {
            answer: {
              id: s.id,
              language: s.language,
              original: {
                question: s.original.question,
                model: s.original.model,
                promptVersion: s.original.promptVersion,
                generatedAt: s.original.generatedAt,
                ...(s.original.retrieval
                  ? { retrieval: s.original.retrieval }
                  : {}),
              },
              sources: s.sources.filter((h) =>
                r.citations.some((c) => c.evidenceId === h.id),
              ),
              revision: r,
            },
          }
        : {}),
    } as BriefDetails["sections"][number];
  });
  const current = sections.every((s) => s.state === "current");
  const {
    workspaceId,
    requestId,
    inputHash,
    dependencies,
    answerDependencies,
    ...publicView
  } = b;
  void answerDependencies;
  void workspaceId;
  void requestId;
  void inputHash;
  void dependencies;
  return {
    answers,
    details: {
      ...publicView,
      sections,
      current,
      reviewed: current && b.reviewed,
      includeInExports: current && b.includeInExports,
      canExport: current && b.reviewed && b.includeInExports,
    },
  };
}
export async function currentLibraryBrief(a: Actor, id: string) {
  return (await resolve(a, await stored(a, id))).details;
}
async function selectedAnswers(a: Actor, sections: BriefSection[]) {
  const answers = [];
  for (const section of sections) {
    const s = await requireCurrentLibraryAnswer(a, section.answerId),
      r = s.history.at(-1)!;
    if (
      r.version !== section.answerVersion ||
      !r.reviewed ||
      !r.includeInExports
    )
      fail(
        409,
        "Choose the latest reviewed, export-approved revision of every answer.",
      );
    answers.push(s);
  }
  return answers;
}
function dependencies(answers: SavedLibraryAnswer[]) {
  return [
    ...new Map(
      answers
        .flatMap(
          (s) =>
            s.dependencies ||
            s.sources.map((h) => ({
              id: h.id,
              studyId: h.studyId,
              interviewId: h.interviewId,
              turnId: h.turnId,
              attachmentId: h.attachmentId,
              format: h.format,
              kind: h.kind,
              fingerprint: hash(JSON.stringify(h)),
            })),
        )
        .map((d) => [d.id + ":" + d.fingerprint, d]),
    ).values(),
  ];
}
async function save(b: LibraryBrief) {
  if (JSON.stringify(b).length > 250000)
    fail(
      413,
      "This brief exceeds its storage limit. Use fewer sections or shorter commentary.",
    );
  await put(kind, b);
}
export async function dispatchLibraryBriefs(
  req: Request,
  p: string[],
  a: Actor,
) {
  if (p[1] !== "briefs") return null;
  const canWrite = ["admin", "researcher", "collaborator"].includes(a.role);
  if (p.length === 2 && req.method === "GET") {
    const rows = [];
    for (const b of await list<LibraryBrief>(kind, a.workspaceId)) {
      try {
        const { details: d } = await resolve(a, b);
        rows.push({
          id: d.id,
          title: d.title,
          language: d.language,
          version: d.version,
          updatedAt: d.updatedAt,
          sectionCount: d.sections.length,
          current: d.current,
          canExport: d.canExport,
        });
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 404)) throw e;
      }
    }
    return respond({ briefs: rows, canEdit: canWrite });
  }
  if (p.length === 2 && req.method === "POST") {
    canEdit(a);
    const input = briefCreate.parse(await body(req));
    const { requestId, ...content } = input,
      inputHash = hash(JSON.stringify(content));
    await selectedAnswers(a, input.sections);
    return transaction(async () => {
      const all = await list<LibraryBrief>(kind, a.workspaceId),
        repeated = all.find((b) => b.requestId === requestId);
      if (repeated) {
        if (repeated.inputHash !== inputHash)
          fail(409, "This request ID was used for a different brief.");
        return respond({
          brief: (await resolve(a, repeated)).details,
          reused: true,
        });
      }
      if (all.length >= 50)
        fail(
          409,
          "This workspace has 50 briefs. Delete a brief before creating another.",
        );
      const answers = await selectedAnswers(a, input.sections),
        date = now();
      const b: LibraryBrief = {
        ...content,
        id: uid(),
        workspaceId: a.workspaceId,
        requestId,
        inputHash,
        version: 1,
        createdAt: date,
        updatedAt: date,
        updatedBy: { id: a.id, name: a.name },
        reviewed: false,
        includeInExports: false,
        dependencies: dependencies(answers),
        answerDependencies: answers.map((a) => a.id),
      };
      await save(b);
      return respond({ brief: (await resolve(a, b)).details }, 201);
    });
  }
  if (p.length < 3 || p.length > 4) fail(404, "Brief route unavailable.");
  const id = z.uuid().parse(p[2]);
  if (p.length === 4) {
    if (req.method !== "GET" || p[3] !== "export")
      fail(404, "Brief route unavailable.");
    const format = z
      .enum(["md", "csv"])
      .parse(new URL(req.url).searchParams.get("format") || "md");
    await resolve(a, await stored(a, id));
    return transaction(async () => {
      const b = await stored(a, id),
        { details, answers } = await resolve(a, b);
      if (!details.canExport)
        fail(
          409,
          "Refresh and review this brief and every answer, then approve its latest revision for export.",
        );
      let text: string;
      try {
        text = briefExport(b, answers, format, new URL(req.url).origin);
      } catch (e) {
        if ((e as Error).message === "BRIEF_EXPORT_TOO_LARGE")
          fail(
            413,
            "This export exceeds one million characters. Use fewer sections.",
          );
        throw e;
      }
      return new Response(text, {
        headers: {
          "Content-Type":
            format === "csv"
              ? "text/csv; charset=utf-8"
              : "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="echo-lab-brief-${b.id}.${format}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    });
  }
  if (req.method === "GET")
    return respond({
      brief: (await resolve(a, await stored(a, id))).details,
      canEdit: canWrite,
    });
  if (!["PUT", "DELETE"].includes(req.method)) fail(405, "Method unavailable.");
  canEdit(a);
  const input =
    req.method === "PUT"
      ? briefEdit.parse(await body(req))
      : z
          .object({ version: z.number().int().positive() })
          .strict()
          .parse(await body(req));
  await resolve(a, await stored(a, id));
  if (req.method === "PUT")
    await selectedAnswers(a, briefEdit.parse(input).sections);
  return transaction(async () => {
    const previous = await stored(a, id);
    if (previous.version !== input.version)
      fail(409, "This brief changed. Reload its latest revision.");
    if (req.method === "DELETE") {
      await remove(a, id);
      return respond({ deleted: true });
    }
    const edit = briefEdit.parse(input),
      answers = await selectedAnswers(a, edit.sections);
    if (edit.includeInExports && !edit.reviewed)
      fail(400, "Brief export approval requires explicit researcher review.");
    const b: LibraryBrief = {
      ...previous,
      ...edit,
      version: previous.version + 1,
      updatedAt: now(),
      updatedBy: { id: a.id, name: a.name },
      dependencies: [
        ...new Map(
          [...(previous.dependencies || []), ...dependencies(answers)].map(
            (d) => [d.id + ":" + d.fingerprint, d],
          ),
        ).values(),
      ],
      answerDependencies: [
        ...new Set([
          ...(previous.answerDependencies ||
            previous.sections.map((s) => s.answerId)),
          ...answers.map((a) => a.id),
        ]),
      ],
    };
    await save(b);
    return respond({ brief: (await resolve(a, b)).details });
  });
}
