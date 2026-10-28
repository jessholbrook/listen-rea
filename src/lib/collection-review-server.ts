import { z } from "zod";
import {
  db,
  get,
  list,
  put,
  hash,
  now,
  transaction,
  pruneLibraryCollections,
} from "./db";
import { body, canEdit, respond, fail, HttpError } from "./http";
import type { Actor, Interview, Study } from "./domain";
import type { LibraryCollection } from "./library-collections";
import type { SavedLibraryAnswer } from "./library-answers";
import { requireCurrentLibraryAnswer } from "./library-answers-server";
import { currentLibraryBrief } from "./library-briefs-server";
import {
  collectionCheck,
  type CollectionDashboard,
  type CollectionReviewState,
} from "./collection-review";
const kind = "libraryCollectionReview";
export async function collectionDashboardSnapshot(a: Actor, id: string) {
  await pruneLibraryCollections(a.workspaceId);
  let c = await get<LibraryCollection>("libraryCollection", id, a.workspaceId);
  if (!c) fail(404, "Collection unavailable.");
  const answers: SavedLibraryAnswer[] = [];
  for (const s of (
    await list<SavedLibraryAnswer>("libraryAnswer", a.workspaceId)
  ).filter((s) => s.filter.collectionId === id)) {
    try {
      answers.push(await requireCurrentLibraryAnswer(a, s.id));
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 404)) throw e;
    }
  }
  const briefs: CollectionDashboard["briefs"] = [];
  for (const briefId of c.briefIds) {
    try {
      const b = await currentLibraryBrief(a, briefId);
      briefs.push({
        id: b.id,
        title: b.title,
        version: b.version,
        status: !b.current
          ? "outdated"
          : b.canExport
            ? "approved"
            : "needs_review",
      });
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 404)) throw e;
    }
  }
  await pruneLibraryCollections(a.workspaceId);
  c = (await get<LibraryCollection>("libraryCollection", id, a.workspaceId))!;
  const all = await list<Interview>("interview", a.workspaceId),
    studies = await list<Study>("study", a.workspaceId);
  const related = await db
    .prepare(
      "SELECT kind,id,json_extract(data,'$.interviewId') AS interview_id,json_extract(data,'$.version') AS record_version,json_extract(data,'$.digest') AS digest,json_extract(data,'$.source') AS source,json_extract(data,'$.history[#-1].version') AS review_version,json_extract(data,'$.history[#-1].at') AS reviewed_at FROM documents WHERE workspace_id=? AND kind IN ('imageReview','participantPDFReview','participantDOCXReview','participantPPTXReview','participantPDFText','participantDOCXText','participantPPTXText') AND json_extract(data,'$.interviewId') IN (SELECT value FROM json_each(?)) ORDER BY kind,id",
    )
    .all(a.workspaceId, JSON.stringify(c.interviewIds));
  const sourceStates = c.interviewIds
    .map((interviewId) => {
      const i = all.find((i) => i.id === interviewId)!;
      return {
        interviewId,
        fingerprint: hash(
          JSON.stringify({
            version: i.version,
            revisionId: i.revisionId,
            language: i.language,
            attributes: i.attributes,
            origin: i.origin,
            turns: i.turns,
            study: studies.find((s) => s.id === i.studyId)?.title,
            evidence: related.filter((r) => String(r.interview_id) === i.id),
          }),
        ),
      };
    })
    .sort((a, b) => a.interviewId.localeCompare(b.interviewId));
  const baseline = await get<CollectionReviewState>(kind, id, a.workspaceId);
  const interviews: CollectionDashboard["interviews"] = sourceStates.map(
    (s) => {
      const i = all.find((i) => i.id === s.interviewId)!;
      const previous = baseline?.sourceStates.find(
        (p) => p.interviewId === i.id,
      );
      return {
        id: i.id,
        title: i.origin?.title || "Echo Lab interview",
        studyTitle: studies.find((s) => s.id === i.studyId)!.title,
        sourceVersion: i.version,
        approvedCitations: answers.filter((a) => {
          const r = a.history.at(-1)!;
          return (
            r.reviewed &&
            r.includeInExports &&
            r.citations.some((c) =>
              a.sources.some(
                (h) => h.id === c.evidenceId && h.interviewId === i.id,
              ),
            )
          );
        }).length,
        change: !baseline
          ? "unchecked"
          : !previous
            ? "added"
            : previous.fingerprint !== s.fingerprint
              ? "changed"
              : "unchanged",
      };
    },
  );
  const answerRows: CollectionDashboard["answers"] = answers
    .map((a): CollectionDashboard["answers"][number] => {
      const r = a.history.at(-1)!;
      return {
        id: a.id,
        scope: a.scope || "attachments",
        question: a.original.question,
        version: r.version,
        status: !r.reviewed
          ? "draft"
          : r.includeInExports
            ? "approved"
            : "reviewed",
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  briefs.sort((a, b) => a.id.localeCompare(b.id));
  const signature = hash(
    JSON.stringify({
      collection: [
        c.id,
        c.version,
        c.title,
        [...c.interviewIds].sort(),
        [...c.briefIds].sort(),
      ],
      sources: sourceStates,
      answers: answerRows,
      briefs,
    }),
  );
  const dashboard: CollectionDashboard = {
    collection: { id: c.id, title: c.title, version: c.version },
    canCheck: ["admin", "researcher", "collaborator"].includes(a.role),
    signature,
    reviewVersion: baseline?.version || 0,
    checkedAt: baseline?.checkedAt || null,
    coverage: {
      total: interviews.length,
      cited: interviews.filter((i) => i.approvedCitations > 0).length,
      uncited: interviews.filter((i) => !i.approvedCitations).length,
    },
    changes: {
      unchecked: interviews.filter((i) => i.change === "unchecked").length,
      added: interviews.filter((i) => i.change === "added").length,
      changed: interviews.filter((i) => i.change === "changed").length,
      unchanged: interviews.filter((i) => i.change === "unchanged").length,
      removed: baseline?.removedSinceCheck || 0,
    },
    interviews,
    answers: answerRows,
    briefs,
  };
  return { dashboard, sourceStates, baseline };
}
export async function dispatchCollectionReview(
  req: Request,
  p: string[],
  a: Actor,
) {
  if (p[1] !== "collections" || p[3] !== "dashboard") return null;
  if (p.length !== 4 && !(p.length === 5 && p[4] === "check"))
    fail(404, "Dashboard route unavailable.");
  const id = z.uuid().parse(p[2]);
  if (p.length === 4 && req.method === "GET")
    return transaction(async () =>
      respond({
        dashboard: (await collectionDashboardSnapshot(a, id)).dashboard,
      }),
    );
  if (p.length === 5 && req.method === "POST") {
    canEdit(a);
    const input = collectionCheck.parse(await body(req));
    return transaction(async () => {
      const before = await collectionDashboardSnapshot(a, id),
        d = before.dashboard;
      if (
        d.collection.version !== input.collectionVersion ||
        d.signature !== input.signature
      )
        fail(
          409,
          "The dashboard changed. Refresh and check current sources again.",
        );
      if (input.reviewVersion > d.reviewVersion)
        fail(409, "Another source check was saved. Refresh first.");
      if (
        before.baseline?.signature === input.signature &&
        JSON.stringify(before.baseline.sourceStates) ===
          JSON.stringify(before.sourceStates) &&
        !before.baseline.removedSinceCheck
      )
        return respond({ dashboard: d, reused: true });
      if (d.reviewVersion !== input.reviewVersion)
        fail(409, "Another source check was saved. Refresh first.");
      await put(kind, {
        id,
        workspaceId: a.workspaceId,
        version: d.reviewVersion + 1,
        checkedAt: now(),
        sourceStates: before.sourceStates,
        removedSinceCheck: 0,
        signature: input.signature,
      } satisfies CollectionReviewState);
      return respond({
        dashboard: (await collectionDashboardSnapshot(a, id)).dashboard,
      });
    });
  }
  fail(405, "Dashboard method unavailable.");
}
