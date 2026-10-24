import { dispatchUnifiedPlanning } from "./unified-planning-server";
import { dispatchOperationsPins } from "./operations-pins-server";
import { dispatchOperationsReport } from "./operations-report-server";
import { dispatchTaskActivity } from "./task-activity-server";
import { dispatchOperationsTriage } from "./operations-triage-server";
import { dispatchSavedReviewViews } from "./saved-review-views-server";
import { dispatchReviewActivity } from "./review-activity-server";
import { dispatchBatchReviewPlans } from "./batch-review-plans-server";
import { dispatchReviewPlans } from "./review-plans-server";
import { dispatchReviewInbox } from "./team-review-inbox-server";
import { dispatchCollectionHandoff } from "./collection-handoff-server";
import { dispatchActionCenter } from "./research-action-center-server";
import { dispatchCollectionTasks } from "./collection-tasks-server";
import { dispatchCollectionReview } from "./collection-review-server";
import { dispatchLibraryCollections } from "./library-collections-server";
import { dispatchSourceRevisions } from "./library-source-revisions-server";
import { dispatchLibraryRecordings } from "./library-recordings-server";
import { createLibraryImport } from "./library-import-server";
import {
  dispatchTranscriptAnswers,
  answerTranscriptQuestion,
} from "./library-transcript-qa-server";
import { dispatchLibraryBriefs } from "./library-briefs-server";
import {
  dispatchLibrarySemantic,
  retrieveLibrarySemantic,
} from "./library-semantic-server";
import { libraryAttachmentFilter } from "./library-attachments";
import { transcriptLibraryCorpus as corpus } from "./library-transcript-corpus";
import { dispatchLibraryAttachments } from "./library-attachments-server";
import {
  responseLanguage,
  languageSchema,
  languageNames,
  insufficientEvidence,
} from "./localization";
import { z } from "zod";
import {
  db,
  get,
  list,
  put,
  uid,
  now,
  hash,
  token,
  transaction,
  requireStudy,
  dirty,
} from "./db";
import { actor, canEdit, body, respond, fail, limit } from "./http";
import { retention, cleanDeletions } from "./features";
import { generate, aiReady } from "./ai";
import { csv } from "./evidence";
import {
  templateGuide,
  type Actor,
  type Study,
  type Interview,
} from "./domain";
import {
  importInput,
  libraryFilter,
  libraryAnswer,
  verifiedLibraryAnswer,
  rankEvidence,
  excerpt,
  parseAttributeCsv,
  type LibraryFilter,
  type LibraryHit,
} from "./library";
import { maxRecordingBytes, writeRecording } from "./storage";
import { inspectImportMedia } from "./import-media";
async function attributePreview(a: Actor, studyId: string, text: string) {
  await requireStudy(studyId, a);
  let parsed: ReturnType<typeof parseAttributeCsv>;
  try {
    parsed = parseAttributeCsv(text);
  } catch (e) {
    fail(400, (e as Error).message);
  }
  const all = (
      await list<Interview>("interview", a.workspaceId, studyId)
    ).filter((i) => !i.preview),
    seen = new Set<string>(),
    targets = new Set<string>();
  const rows = parsed.rows.map((r) => {
    const matches = all.filter((i) =>
      parsed.identifier === "response_id"
        ? i.id === r.identifier
        : i.origin?.externalId === r.identifier,
    );
    let error = r.error;
    if (!r.identifier) error = "Identifier is empty.";
    else if (seen.has(r.identifier)) error = "Duplicate identifier in CSV.";
    else if (!matches.length) error = "No matching response in this study.";
    else if (matches.length > 1)
      error = "Identifier matches multiple responses.";
    const i = matches[0];
    if (!error && i && targets.has(i.id))
      error = "Response appears more than once.";
    seen.add(r.identifier);
    if (i) targets.add(i.id);
    if (i && new Set([...Object.keys(i.attributes), ...parsed.keys]).size > 30)
      error = "A response may have at most 30 attributes.";
    return {
      ...r,
      error,
      interviewId: !error ? i.id : null,
      previous: !error
        ? Object.fromEntries(
            parsed.keys.map((k) => [k, i.attributes[k] ?? null]),
          )
        : null,
    };
  });
  return {
    rows,
    keys: parsed.keys,
    valid: rows.every((r) => !r.error),
    fingerprint: hash(
      JSON.stringify({
        text,
        targets: all.map((i) => [
          i.id,
          i.version,
          i.attributes,
          i.origin?.externalId,
        ]),
      }),
    ),
  };
}
export async function dispatchLibrary(
  req: Request,
  p: string[],
): Promise<Response | null> {
  if (p[0] !== "library") return null;
  await retention();
  const a = await actor(),
    method = req.method;
  const pins = await dispatchOperationsPins(req, p, a);
  if (pins) return pins;
  const unified = await dispatchUnifiedPlanning(req, p, a);
  if (unified) return unified;
  const report = await dispatchOperationsReport(req, p, a);
  if (report) return report;
  const taskActivity = await dispatchTaskActivity(req, p, a);
  if (taskActivity) return taskActivity;
  const triage = await dispatchOperationsTriage(req, p, a);
  if (triage) return triage;
  const handoff = await dispatchCollectionHandoff(req, p, a);
  if (handoff) return handoff;
  const savedViews = await dispatchSavedReviewViews(req, p, a);
  if (savedViews) return savedViews;
  const activity = await dispatchReviewActivity(req, p, a);
  if (activity) return activity;
  const batch = await dispatchBatchReviewPlans(req, p, a);
  if (batch) return batch;
  const plans = await dispatchReviewPlans(req, p, a);
  if (plans) return plans;
  const inbox = await dispatchReviewInbox(req, p, a);
  if (inbox) return inbox;
  const actionCenter = await dispatchActionCenter(req, p, a);
  if (actionCenter) return actionCenter;
  const tasks = await dispatchCollectionTasks(req, p, a);
  if (tasks) return tasks;
  const dashboard = await dispatchCollectionReview(req, p, a);
  if (dashboard) return dashboard;
  const collections = await dispatchLibraryCollections(req, p, a);
  if (collections) return collections;
  const revisions = await dispatchSourceRevisions(req, p, a);
  if (revisions) return revisions;
  const recordings = await dispatchLibraryRecordings(req, p, a);
  if (recordings) return recordings;
  const transcriptAnswers = await dispatchTranscriptAnswers(req, p, a);
  if (transcriptAnswers) return transcriptAnswers;
  const briefs = await dispatchLibraryBriefs(req, p, a);
  if (briefs) return briefs;
  const semantic = await dispatchLibrarySemantic(req, p, a);
  if (semantic) return semantic;
  const attachments = await dispatchLibraryAttachments(req, p, a);
  if (attachments) return attachments;
  if (p.length === 1 && method === "GET") {
    const c = await corpus(a, { studyIds: [], query: "" });
    const sources = c.responses.map((i) => ({
      id: i.id,
      studyId: i.studyId,
      studyTitle: c.studies.find((s) => s.id === i.studyId)!.title,
      title: i.origin?.title || "Echo Lab interview",
      externalId: i.origin?.externalId || "",
      source: i.origin ? "external" : "interview",
      createdAt: i.createdAt,
      attributes: i.attributes,
    }));
    return respond({
      studies: c.studies.map((s) => ({ id: s.id, title: s.title })),
      sources,
      ai: aiReady(),
    });
  }
  if (p[1] === "search" && method === "POST") {
    const filter = libraryFilter
      .extend({ retrieval: z.enum(["keyword", "semantic"]).default("keyword") })
      .strict()
      .parse(await body(req));
    if (filter.retrieval === "semantic") {
      const found = await retrieveLibrarySemantic(
        a,
        "transcripts",
        libraryAttachmentFilter.parse({
          studyIds: filter.studyIds,
          collectionId: filter.collectionId,
          attribute: filter.attribute,
          query: filter.query,
        }),
        filter.query,
      );
      return respond({
        hits: found.items.map((h) => h.hit),
        total: found.retrieval.indexed,
        limited: found.retrieval.indexed > 50,
        retrieval: found.retrieval,
      });
    }
    const c = await corpus(a, filter),
      ranked = rankEvidence(c.hits, filter.query, 10001);
    return respond({
      hits: ranked
        .slice(0, 50)
        .map((h) => ({ ...h, quote: excerpt(h.quote, filter.query) })),
      total: ranked.length,
      limited: ranked.length > 50,
    });
  }
  if (p[1] === "sources" && p[2] && p.length === 3 && method === "GET") {
    const i = await get<Interview>("interview", p[2], a.workspaceId);
    if (!i || i.preview || i.excluded || i.status !== "complete")
      fail(404, "Source is no longer included in the library.");
    const s = await requireStudy(i.studyId, a),
      media = await db
        .prepare(
          "SELECT id,mime,duration_ms FROM media WHERE interview_id=? AND workspace_id=?",
        )
        .all(i.id, a.workspaceId);
    return respond({
      source: {
        id: i.id,
        studyId: s.id,
        studyTitle: s.title,
        revisionId: i.revisionId,
        version: i.version,
        canRevise:
          !!i.origin &&
          media.filter(
            (m) =>
              String(m.mime).startsWith("audio/") ||
              String(m.mime).startsWith("video/"),
          ).length === 1 &&
          ["admin", "researcher", "collaborator"].includes(a.role),
        language: responseLanguage(i),
        attributes: i.attributes,
        origin: i.origin || null,
        turns: i.turns,
        media,
      },
    });
  }
  if (p[1] === "qa" && method === "POST")
    return answerTranscriptQuestion(req, a);
  if (p[1] === "imports" && p.length === 2 && method === "POST") {
    canEdit(a);
    const input = importInput.parse(await body(req)),
      fingerprint = hash(JSON.stringify(input));
    const imported = await createLibraryImport(a, input);
    return respond(imported, imported.reused ? 200 : 201);
  }
  if (
    p[1] === "imports" &&
    p[2] &&
    p[3] === "media" &&
    p.length === 4 &&
    method === "POST"
  ) {
    canEdit(a);
    const i = await get<Interview>("interview", p[2], a.workspaceId);
    if (!i?.origin) fail(404, "Imported interview not found.");
    const mime = (req.headers.get("content-type") || "").split(";")[0],
      video = mime.startsWith("video/");
    if (
      ![
        "audio/wav",
        "audio/mp4",
        "audio/webm",
        "audio/ogg",
        "video/mp4",
        "video/webm",
      ].includes(mime)
    )
      fail(400, "Use WAV, Ogg, MP4 or WebM media.");
    if (Number(req.headers.get("content-length") || 0) > maxRecordingBytes)
      fail(413, "Media must be at most 3 MiB.");
    const reader = req.body?.getReader();
    if (!reader) fail(400, "Choose a media file.");
    let total = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxRecordingBytes) {
        await reader.cancel();
        fail(413, "Media must be at most 3 MiB.");
      }
      chunks.push(value);
    }
    if (!total) fail(400, "Choose a media file.");
    const bytes = Buffer.concat(chunks),
      digest = hash(bytes.toString("base64"));
    const validContainer = mime.endsWith("/webm")
      ? bytes.subarray(0, 4).toString("hex") === "1a45dfa3"
      : mime.endsWith("/mp4")
        ? bytes.subarray(4, 8).toString() === "ftyp"
        : mime === "audio/ogg"
          ? bytes.subarray(0, 4).toString() === "OggS"
          : bytes.subarray(0, 4).toString() === "RIFF" &&
            bytes.subarray(8, 12).toString() === "WAVE";
    if (!validContainer)
      fail(400, "The file does not match its supported media format.");
    const existing = await db
      .prepare(
        "SELECT id,digest,mime FROM media WHERE interview_id=? AND workspace_id=?",
      )
      .get(i.id, a.workspaceId);
    if (existing) {
      if (existing.digest !== digest || existing.mime !== mime)
        fail(
          409,
          "This import already has media. Delete the response to replace it.",
        );
      return respond({ mediaId: existing.id, reused: true });
    }
    let durationMs: number;
    try {
      durationMs = await inspectImportMedia(bytes, video, req.signal);
    } catch {
      fail(
        400,
        "Media could not be decoded. Use a file up to 10 minutes with audio, and video for video imports.",
      );
    }
    const mediaId = uid(),
      deletionId = uid();
    await put("deletion", {
      id: deletionId,
      workspaceId: a.workspaceId,
      studyId: i.studyId,
      files: [mediaId],
      createdAt: now(),
      notBefore: Date.now() + 300000,
    });
    try {
      await writeRecording(mediaId, bytes, mime);
      await transaction(async () => {
        const current = await get<Interview>("interview", i.id, a.workspaceId);
        if (!current || current.version !== i.version)
          fail(409, "The imported response changed. Refresh and try again.");
        if (
          await db
            .prepare("SELECT id FROM media WHERE interview_id=?")
            .get(i.id)
        )
          fail(409, "Media was already attached to this import.");
        await db
          .prepare(
            "INSERT INTO media(id,interview_id,workspace_id,study_id,mime,bytes,duration_ms,created_at,consent_at,turn_version,kind,digest) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            mediaId,
            i.id,
            a.workspaceId,
            i.studyId,
            mime,
            total,
            durationMs,
            now(),
            i.consentAt,
            0,
            video ? "import-video" : "audio",
            digest,
          );
        if (!video) current.turns[0].audioId = mediaId;
        current.version++;
        await put("interview", current);
        await dirty(await requireStudy(i.studyId, a));
        await db
          .prepare("DELETE FROM documents WHERE kind='deletion' AND id=?")
          .run(deletionId);
      });
    } catch (e) {
      await db
        .prepare(
          "UPDATE documents SET data=json_set(data,'$.notBefore',0) WHERE kind='deletion' AND id=?",
        )
        .run(deletionId);
      await cleanDeletions();
      throw e;
    }
    return respond({ mediaId, durationMs, reused: false }, 201);
  }
  if (
    p[1] === "attributes" &&
    p[2] &&
    method === "GET" &&
    p[3] === "template"
  ) {
    await requireStudy(p[2], a);
    const all = (
      await list<Interview>("interview", a.workspaceId, p[2])
    ).filter((i) => !i.preview);
    return new Response(
      csv([
        ["response_id", "segment"],
        ...all.map((i) => [i.id, i.attributes.segment || ""]),
      ]),
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="participant-attributes.csv"',
          "Cache-Control": "no-store",
        },
      },
    );
  }
  if (
    p[1] === "attributes" &&
    p[2] &&
    method === "POST" &&
    ["preview", "apply"].includes(p[3])
  ) {
    canEdit(a);
    const input = z
      .object({
        csv: z.string().max(120000),
        fingerprint: z.string().optional(),
      })
      .parse(await body(req));
    return transaction(async () => {
      const preview = await attributePreview(a, p[2], input.csv);
      if (p[3] === "preview") return respond(preview);
      if (!preview.valid)
        fail(400, "Fix every matching error before applying attributes.");
      if (input.fingerprint !== preview.fingerprint)
        fail(409, "Responses or attributes changed. Preview the CSV again.");
      for (const row of preview.rows) {
        const i = (await get<Interview>(
          "interview",
          row.interviewId!,
          a.workspaceId,
        ))!;
        i.attributes = { ...i.attributes, ...row.attributes };
        await put("interview", i);
      }
      await dirty(await requireStudy(p[2], a));
      return respond({ updated: preview.rows.length });
    });
  }
  fail(404, "Library route not found.");
}
