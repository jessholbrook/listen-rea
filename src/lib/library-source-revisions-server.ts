import { z } from "zod";
import {
  db,
  get,
  put,
  uid,
  hash,
  now,
  transaction,
  requireStudy,
  dirty,
  clearLibraryAnswers,
} from "./db";
import { body, canEdit, fail, respond } from "./http";
import type { Actor, Interview } from "./domain";
import {
  sourceRevisionInput,
  type SourceReview,
  type SourceRevisions,
} from "./library-source-revisions";
import {
  validateRecordingSections,
  type RecordingSection,
} from "./recording-sections";
import { transcriptSections } from "./library-import-server";
import { clearReporting } from "./reporting-cleanup";
import { cleanDeletions } from "./features";
const kind = "librarySourceRevision";
async function source(a: Actor, id: string) {
  const i = await get<Interview>("interview", id, a.workspaceId);
  if (!i || i.preview || i.excluded || i.status !== "complete" || !i.origin)
    fail(404, "Imported recording source unavailable.");
  const s = await requireStudy(i.studyId, a),
    m = await db
      .prepare(
        "SELECT id,mime,duration_ms FROM media WHERE interview_id=? AND workspace_id=? AND kind IN ('audio','import-video')",
      )
      .all(i.id, a.workspaceId);
  if (m.length !== 1)
    fail(409, "This source needs exactly one original recording.");
  return {
    i,
    s,
    media: {
      id: String(m[0].id),
      mime: String(m[0].mime),
      durationMs: Number(m[0].duration_ms),
    },
  };
}
function snapshot(i: Interview): {
  text: string;
  sections?: RecordingSection[];
} {
  let offset = 0;
  const text = i.turns.map((t) => t.answer).join("");
  const sections = i.turns.every((t) => t.recordingSection)
    ? i.turns.map((t) => {
        const start = offset;
        offset += t.answer.length;
        return {
          start,
          end: offset,
          speaker: t.recordingSection!.speaker,
          startMs: t.recordingSection!.startMs,
          endMs: t.recordingSection!.endMs,
        };
      })
    : undefined;
  return { text, ...(sections ? { sections } : {}) };
}
function view(d: SourceRevisions | null) {
  if (!d) return null;
  const { workspaceId, ...rest } = d;
  void workspaceId;
  return {
    ...rest,
    history: d.history.map(({ requestId, inputHash, ...h }) => {
      void requestId;
      void inputHash;
      return h;
    }),
    publications: d.publications.map(({ requestId, inputHash, ...p }) => {
      void requestId;
      void inputHash;
      return p;
    }),
  };
}
function capacity(d: SourceRevisions) {
  if (d.history.length > 20)
    fail(409, "This recording has reached its 20-version history limit.");
  if (Buffer.byteLength(JSON.stringify(d)) > 3 * 1024 * 1024)
    fail(413, "This recording exceeds its revision history storage limit.");
}
export async function dispatchSourceRevisions(
  req: Request,
  p: string[],
  a: Actor,
) {
  if (p[1] !== "sources" || p[3] !== "revisions") return null;
  if (p.length < 4 || p.length > 5) fail(404, "Revision route unavailable.");
  canEdit(a);
  const id = z.uuid().parse(p[2]);
  if (req.method === "GET" && p.length === 4) {
    const { i, media } = await source(a, id),
      d = await get<SourceRevisions>(kind, id, a.workspaceId);
    return respond({
      revision: view(d || null),
      base: snapshot(i),
      sourceVersion: i.version,
      media,
    });
  }
  if (
    (req.method === "PUT" && p.length === 4) ||
    (req.method === "POST" && p[4] === "restore")
  ) {
    const restoring = p[4] === "restore";
    const raw = await body(req);
    const restore = restoring
      ? z
          .object({
            requestId: z.uuid(),
            version: z.number().int().min(0),
            sourceVersion: z.number().int().positive(),
            reviewVersion: z.number().int().positive(),
            reason: z.string().trim().min(3).max(1000),
          })
          .strict()
          .parse(raw)
      : null;
    return transaction(async () => {
      const { i, media } = await source(a, id);
      let d = await get<SourceRevisions>(kind, id, a.workspaceId);
      const input = restore || sourceRevisionInput.parse(raw),
        sum = hash(
          JSON.stringify({ action: restoring ? "restore" : "save", ...input }),
        );
      const repeated = d?.history.find((h) => h.requestId === input.requestId);
      if (repeated) {
        if (repeated.inputHash !== sum)
          fail(409, "Revision request has different content.");
        return respond({
          revision: view(d!),
          sourceVersion: i.version,
          reused: true,
        });
      }
      if (
        i.version !== input.sourceVersion ||
        (d?.version || 0) !== input.version
      )
        fail(409, "Source or revision changed. Reload before saving.");
      if (!d) {
        const t = i.origin!.transcription;
        const initialAt = t?.reviewedAt || i.origin!.importedAt,
          initialEditor = t?.reviewedBy || {
            id: "",
            name: i.origin!.importedBy,
          };
        d = {
          id,
          interviewId: id,
          workspaceId: a.workspaceId,
          studyId: i.studyId,
          version: 0,
          createdAt: now(),
          history: [
            {
              ...snapshot(i),
              version: 1,
              reason: "Initial reviewed import",
              reviewed: true,
              at: initialAt,
              editor: initialEditor,
              baseSourceVersion: i.version,
            },
          ],
          publications: [
            {
              reviewVersion: 1,
              sourceVersion: i.version,
              at: initialAt,
              editor: initialEditor,
            },
          ],
        };
      }
      const selected = restoring
        ? d.history.find((h) => h.version === restore!.reviewVersion)
        : null;
      if (restoring && !selected) fail(404, "Historical review unavailable.");
      const content = restoring
        ? {
            text: selected!.text,
            sections: selected!.sections,
            reviewed: false,
            reason: input.reason,
          }
        : sourceRevisionInput.parse(raw);
      try {
        validateRecordingSections(
          content.text,
          content.sections,
          media.durationMs,
          content.reviewed,
        );
      } catch {
        fail(
          400,
          "Sections must cover the complete text and reviewed labels/times must fit the recording in order.",
        );
      }
      d.history.push({
        version: d.history.at(-1)!.version + 1,
        text: content.text,
        ...(content.sections ? { sections: content.sections } : {}),
        reason: content.reason,
        reviewed: content.reviewed,
        at: now(),
        editor: { id: a.id, name: a.name },
        baseSourceVersion: i.version,
        requestId: input.requestId,
        inputHash: sum,
      });
      d.version++;
      capacity(d);
      await put(kind, d);
      return respond({ revision: view(d), sourceVersion: i.version });
    });
  }
  if (req.method === "POST" && p[4] === "publish") {
    const input = z
        .object({
          requestId: z.uuid(),
          version: z.number().int().positive(),
          sourceVersion: z.number().int().positive(),
          reviewVersion: z.number().int().positive(),
          reviewed: z.literal(true),
        })
        .strict()
        .parse(await body(req)),
      sum = hash(JSON.stringify(input));
    const result = await transaction(async () => {
      const { i, s, media } = await source(a, id),
        d = await get<SourceRevisions>(kind, id, a.workspaceId);
      if (!d) fail(409, "Save a reviewed revision first.");
      const repeated = d.publications.find(
        (p) => p.requestId === input.requestId,
      );
      if (repeated) {
        if (repeated.inputHash !== sum)
          fail(409, "Publication request has different content.");
        return {
          revision: view(d),
          sourceVersion: i.version,
          publishedSourceVersion: repeated.sourceVersion,
          reused: true,
        };
      }
      const latest = d.history.at(-1)!;
      if (
        d.version !== input.version ||
        i.version !== input.sourceVersion ||
        latest.version !== input.reviewVersion ||
        latest.baseSourceVersion !== i.version ||
        !latest.reviewed ||
        d.publications.some((p) => p.reviewVersion === latest.version)
      )
        fail(
          409,
          "Save and review the latest draft against the current source before publishing.",
        );
      try {
        validateRecordingSections(
          latest.text,
          latest.sections,
          media.durationMs,
          true,
        );
      } catch {
        fail(409, "Review the speaker sections before publishing.");
      }
      const {
        recordingSection: _section,
        audioId: _audio,
        ...template
      } = i.turns[0];
      void _section;
      void _audio;
      i.turns = latest.sections
        ? latest.sections.map((s) => ({
            ...template,
            id: uid(),
            answer: latest.text.slice(s.start, s.end),
            recordingSection: {
              mediaId: media.id,
              mime: media.mime,
              speaker: s.speaker,
              startMs: s.startMs!,
              endMs: s.endMs!,
              reviewedAt: latest.at,
              reviewedBy: latest.editor,
            },
          }))
        : transcriptSections(latest.text).map((answer) => ({
            ...template,
            id: uid(),
            answer,
          }));
      if (media.mime.startsWith("audio/")) i.turns[0].audioId = media.id;
      i.version++;
      const publication = {
        reviewVersion: latest.version,
        sourceVersion: i.version,
        reason: latest.reason,
        at: now(),
        editor: { id: a.id, name: a.name },
      };
      i.origin!.recordingRevision = publication;
      const t = i.origin!.transcription;
      if (t) {
        t.reviewedTranscriptDigest = hash(latest.text);
        t.edited = t.reviewedTranscriptDigest !== t.originalTranscriptDigest;
        t.reviewedAt = latest.at;
        t.reviewedBy = latest.editor;
        t.revision = publication;
      }
      await clearLibraryAnswers(a.workspaceId, { field: "interviewId", id });
      await put("interview", i);
      await db
        .prepare(
          "DELETE FROM documents WHERE workspace_id=? AND study_id=? AND kind='analysis'",
        )
        .run(a.workspaceId, s.id);
      await db
        .prepare(
          "DELETE FROM documents WHERE kind='responseTranslation' AND workspace_id=? AND json_extract(data,'$.interviewId')=?",
        )
        .run(a.workspaceId, id);
      await db
        .prepare(
          "DELETE FROM documents WHERE workspace_id=? AND json_extract(data,'$.interviewId')=? AND kind IN ('visualRun','visualObservation','visualHistory','pulseReview')",
        )
        .run(a.workspaceId, id);
      await clearReporting(s);
      await dirty(s);
      d.publications.push({
        reviewVersion: latest.version,
        sourceVersion: i.version,
        at: publication.at,
        editor: publication.editor,
        requestId: input.requestId,
        inputHash: sum,
      });
      d.version++;
      capacity(d);
      await put(kind, d);
      return {
        revision: view(d),
        sourceVersion: i.version,
        publishedSourceVersion: i.version,
      };
    });
    await cleanDeletions();
    return respond(result);
  }
  fail(405, "Revision method unavailable.");
}
