import { z } from "zod";
import { validateRecordingSections } from "./recording-sections";
import {
  db,
  get,
  list,
  put,
  uid,
  hash,
  now,
  transaction,
  requireStudy,
  dirty,
} from "./db";
import { body, canEdit, fail, respond, limit } from "./http";
import type { Actor, Interview } from "./domain";
import {
  recordingView as view,
  maxImportTranscript,
  transcriptionStepMs,
  recordingCreate,
  recordingBatchCreate,
  recordingReview,
  type LibraryRecording,
} from "./library-recordings";
import {
  maxRecordingBytes,
  ensureRecording,
  readRecording,
  recordingResponse,
} from "./storage";
import {
  inspectImportMedia,
  extractImportAudio,
  matchesImportMedia as signature,
} from "./import-media";
import { providerRequest, recordUsage } from "./ai";
import { transcriptionBody } from "./speech";
import { removePendingRecording } from "./library-recording-lifecycle";
import { cleanDeletions } from "./features";
import { createLibraryImport } from "./library-import-server";
import { dispatchRecordingUpload } from "./library-recording-uploads";
import { importInput } from "./library";
const kind = "libraryRecording";
async function requireRecording(a: Actor, id: string) {
  const r = await get<LibraryRecording>(kind, id, a.workspaceId);
  if (!r) fail(404, "Recording draft unavailable.");
  await requireStudy(r.studyId, a);
  return r;
}
export async function transcribeExternalRecording(
  bytes: Buffer,
  r: LibraryRecording,
  signal: AbortSignal,
  request: typeof providerRequest = providerRequest,
  usage: typeof recordUsage = recordUsage,
) {
  const startMs = (r.job?.completed.length || 0) * transcriptionStepMs,
    durationMs = Math.min(transcriptionStepMs, r.file!.durationMs - startMs),
    audio = await extractImportAudio(bytes, signal, startMs, durationMs),
    model = process.env.RESEARCH_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
  const form = transcriptionBody(
    audio,
    "audio/wav",
    "recording.wav",
    model,
    r.language!,
  );
  const response = await request("audio/transcriptions", form, true, signal);
  const output = (await response.json()) as { text?: unknown };
  const text = z.string().trim().min(3).max(12000).parse(output.text);
  await usage(
    r.workspaceId,
    r.studyId,
    "library-recording-transcription",
    model,
    0,
    0,
    durationMs / 1000,
  );
  return { text, model, generatedAt: now() };
}
async function bytesFrom(req: Request) {
  if (Number(req.headers.get("content-length") || 0) > maxRecordingBytes)
    fail(413, "Use a file at most 3 MiB.");
  const reader = req.body?.getReader();
  if (!reader) fail(400, "Choose a media file.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxRecordingBytes) {
      await reader.cancel();
      fail(413, "Use a file at most 3 MiB.");
    }
    chunks.push(value);
  }
  if (!size) fail(400, "Choose a media file.");
  return Buffer.concat(chunks);
}
export async function dispatchLibraryRecordings(
  req: Request,
  p: string[],
  a: Actor,
  transcribe: typeof transcribeExternalRecording = transcribeExternalRecording,
) {
  if (p[1] !== "recordings") return null;
  const canWrite = ["admin", "researcher", "collaborator"].includes(a.role);
  if (p.length === 2 && req.method === "GET") {
    const rows = await list<LibraryRecording>(kind, a.workspaceId);
    return respond({
      recordings: rows.map((r) => ({
        id: r.id,
        studyId: r.studyId,
        title: r.title || "",
        status: r.status,
        version: r.version,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        interviewId: r.interviewId,
        batchId: r.batchId,
        lastError: r.lastError,
        uploadProgress: r.upload
          ? {
              completed: r.upload.parts.filter((p) => p.digest).length,
              total: r.upload.parts.length,
            }
          : undefined,
        transcriptionProgress: r.job
          ? { completed: r.job.completed.length, total: r.job.total }
          : undefined,
      })),
      canEdit: canWrite,
    });
  }
  if (p.length === 2 && req.method === "POST") {
    canEdit(a);
    const input = recordingCreate.parse(await body(req)),
      inputHash = hash(JSON.stringify(input));
    await requireStudy(input.studyId, a);
    return transaction(async () => {
      if (
        (await get(
          "libraryRecordingTombstone",
          hash(a.workspaceId + ":" + input.requestId),
          a.workspaceId,
        )) ||
        (await get(
          "libraryRecordingTombstone",
          hash(input.requestId),
          a.workspaceId,
        ))
      )
        fail(409, "This recording request was deleted. Start a new upload.");
      const all = await list<LibraryRecording>(kind, a.workspaceId),
        existing = all.find((r) => r.requestId === input.requestId);
      if (existing) {
        if (existing.inputHash !== inputHash)
          fail(409, "This upload request has different settings.");
        return respond({ recording: view(existing), reused: true });
      }
      if (all.filter((r) => r.status !== "imported").length >= 20)
        fail(
          409,
          "This workspace has 20 pending recordings. Import or delete one first.",
        );
      const days = Math.min(
        7,
        Math.max(1, Number(process.env.RESEARCH_RETENTION_DAYS || 90)),
      );
      const r: LibraryRecording = {
        ...input,
        id: uid(),
        workspaceId: a.workspaceId,
        inputHash,
        createdAt: now(),
        expiresAt: new Date(Date.now() + days * 86400000).toISOString(),
        version: 1,
        status: "awaiting_upload",
      };
      await put(kind, r);
      return respond({ recording: view(r) }, 201);
    });
  }
  if (p.length === 3 && p[2] === "batch" && req.method === "POST") {
    canEdit(a);
    const input = recordingBatchCreate.parse(await body(req));
    await requireStudy(input.studyId, a);
    return transaction(async () => {
      if (
        await get(
          "libraryRecordingBatchTombstone",
          hash(a.workspaceId + ":" + input.requestId),
          a.workspaceId,
        )
      )
        fail(409, "A recording in this batch was deleted. Start a new batch.");
      const all = await list<LibraryRecording>(kind, a.workspaceId);
      const inputs = input.items.map((item) => ({
        ...item,
        studyId: input.studyId,
        language: input.language,
        permissionConfirmed: true,
        transcriptionPermission: true,
      }));
      for (const item of inputs) {
        if (
          (await get(
            "libraryRecordingTombstone",
            hash(a.workspaceId + ":" + item.requestId),
            a.workspaceId,
          )) ||
          (await get(
            "libraryRecordingTombstone",
            hash(item.requestId),
            a.workspaceId,
          ))
        )
          fail(
            409,
            "A recording in this batch was deleted. Start a new batch.",
          );
      }
      const group = all.filter((r) => r.batchId === input.requestId),
        existing = inputs.map((item) =>
          all.find((r) => r.requestId === item.requestId),
        );
      if (group.length || existing.some(Boolean)) {
        if (
          group.length !== inputs.length ||
          existing.some(
            (r, i) =>
              !r ||
              r.batchId !== input.requestId ||
              r.inputHash !== hash(JSON.stringify(inputs[i])),
          )
        )
          fail(
            409,
            "This batch request has different settings or missing recordings.",
          );
        return respond({
          recordings: existing.map((r) => view(r!)),
          reused: true,
        });
      }
      if (
        all.filter((r) => r.status !== "imported").length + inputs.length >
        20
      )
        fail(
          409,
          "This batch would exceed the workspace limit of 20 pending recordings.",
        );
      const createdAt = now(),
        expiresAt = new Date(
          Date.now() +
            Math.min(
              7,
              Math.max(1, Number(process.env.RESEARCH_RETENTION_DAYS || 90)),
            ) *
              86400000,
        ).toISOString();
      const recordings: LibraryRecording[] = inputs.map((item) => ({
        ...item,
        id: uid(),
        workspaceId: a.workspaceId,
        batchId: input.requestId,
        inputHash: hash(JSON.stringify(item)),
        createdAt,
        expiresAt,
        version: 1,
        status: "awaiting_upload",
      }));
      for (const r of recordings) await put(kind, r);
      return respond({ recordings: recordings.map(view) }, 201);
    });
  }
  if (p.length < 3 || p.length > 4) fail(404, "Recording route unavailable.");
  const id = z.uuid().parse(p[2]);
  let r = await requireRecording(a, id);
  if (p.length === 3 && req.method === "GET")
    return respond({ recording: view(r), canEdit: canWrite });
  if (p[3] === "file" && req.method === "GET") {
    if (!r.file || r.status === "imported")
      fail(404, "Use the imported response to play its recording.");
    return recordingResponse(req, r.file.id, r.file.mime);
  }
  canEdit(a);
  const uploading = await dispatchRecordingUpload(req, p[3], a, r);
  if (uploading) return uploading;
  if (p[3] === "file" && req.method === "PUT") {
    if (r.upload) fail(409, "Resume this upload through its private parts.");
    if (r.status !== "awaiting_upload" && r.status !== "uploaded")
      fail(409, "This recording no longer accepts an upload.");
    const version = z.coerce
        .number()
        .int()
        .positive()
        .parse(req.headers.get("x-recording-version")),
      mime = (req.headers.get("content-type") || "").split(";")[0];
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
      fail(400, "Use WAV, Ogg, MP4 or WebM audio/video.");
    const bytes = await bytesFrom(req),
      digest = hash(bytes.toString("base64"));
    if (!signature(bytes, mime))
      fail(400, "File signature does not match its media type.");
    if (r.file) {
      if (r.file.digest !== digest || r.file.mime !== mime)
        fail(
          409,
          "This upload is immutable. Delete the pending recording to replace it.",
        );
      return respond({ recording: view(r), reused: true });
    }
    if (r.version !== version) fail(409, "Recording changed. Refresh first.");
    let durationMs: number;
    try {
      durationMs = await inspectImportMedia(
        bytes,
        mime.startsWith("video/"),
        req.signal,
      );
    } catch {
      fail(
        400,
        "Media must decode with audio and be at most 10 minutes; video imports need a video stream.",
      );
    }
    const fileId = uid(),
      jobId = uid();
    await put("deletion", {
      id: jobId,
      workspaceId: a.workspaceId,
      studyId: r.studyId,
      files: [fileId],
      createdAt: now(),
      notBefore: Date.now() + 300000,
    });
    try {
      await ensureRecording(fileId, bytes, mime);
      return await transaction(async () => {
        const current = await requireRecording(a, id);
        if (current.version !== version || current.status !== "awaiting_upload")
          fail(409, "Recording changed during upload.");
        current.file = {
          id: fileId,
          mime,
          bytes: bytes.length,
          digest,
          durationMs,
        };
        current.status = "uploaded";
        current.version++;
        await put(kind, current);
        await db
          .prepare(
            "DELETE FROM documents WHERE kind='deletion' AND id=? AND workspace_id=?",
          )
          .run(jobId, a.workspaceId);
        return respond({ recording: view(current) });
      });
    } catch (e) {
      await db
        .prepare(
          "UPDATE documents SET data=json_set(data,'$.notBefore',0) WHERE kind='deletion' AND id=? AND workspace_id=?",
        )
        .run(jobId, a.workspaceId);
      await cleanDeletions();
      throw e;
    }
  }
  if (p[3] === "transcribe" && req.method === "POST") {
    const input = z
      .object({
        version: z.number().int().positive(),
        permissionConfirmed: z.literal(true),
      })
      .strict()
      .parse(await body(req));
    limit("library-recording-transcribe:" + a.workspaceId, 20);
    const attempt = uid();
    r = await transaction(async () => {
      const current = await requireRecording(a, id);
      if (current.version !== input.version)
        fail(409, "Recording changed. Refresh first.");
      if (current.original)
        fail(409, "An original transcript already exists; review it instead.");
      if (!current.file || current.status === "imported")
        fail(409, "Upload a recording first.");
      if (current.attempt && Date.now() - current.attempt.at < 120000)
        fail(
          409,
          "A transcription is already running. Refresh after it finishes.",
        );
      current.job ||= {
        total: Math.ceil(current.file.durationMs / transcriptionStepMs),
        completed: [],
      };
      current.attempt = { id: attempt, at: Date.now() };
      current.status = "transcribing";
      current.lastError = undefined;
      current.version++;
      await put(kind, current);
      return current;
    });
    try {
      const bytes = await readRecording(r.file!.id),
        output = await transcribe(bytes, r, AbortSignal.timeout(105000));
      const valid = z
        .object({
          text: z.string().trim().min(3).max(12000),
          model: z.string().min(1).max(100),
          generatedAt: z.string().datetime(),
        })
        .strict()
        .parse(output);
      return await transaction(async () => {
        const current = await requireRecording(a, id);
        if (current.attempt?.id !== attempt || current.version !== r.version)
          fail(409, "Recording changed during transcription.");
        current.job!.completed.push(valid);
        const text = current.job!.completed.map((c) => c.text).join("\n\n");
        if (text.length > maxImportTranscript)
          fail(
            413,
            "Transcript exceeds 150,000 characters. Import a shorter recording.",
          );
        current.attempt = undefined;
        current.version++;
        if (current.job!.completed.length < current.job!.total) {
          current.status = "uploaded";
          await put(kind, current);
          return respond({ recording: view(current) });
        }
        current.original = {
          ...valid,
          text,
          model: [...new Set(current.job!.completed.map((c) => c.model))].join(
            ", ",
          ),
        };
        current.job = undefined;
        current.history = [
          {
            version: 1,
            text,
            reviewed: false,
            at: now(),
            editor: { id: a.id, name: a.name },
          },
        ];
        current.status = "draft";
        current.attempt = undefined;
        current.version++;
        await put(kind, current);
        return respond({ recording: view(current) });
      });
    } catch (e) {
      await transaction(async () => {
        const current = await get<LibraryRecording>(kind, id, a.workspaceId);
        if (current?.attempt?.id === attempt) {
          current.attempt = undefined;
          current.status = "uploaded";
          current.lastError = "provider_or_processing";
          current.version++;
          await put(kind, current);
        }
      });
      throw e;
    }
  }
  if (p.length === 3 && req.method === "PUT") {
    const input = recordingReview.parse(await body(req));
    return transaction(async () => {
      const current = await requireRecording(a, id);
      if (
        current.version !== input.version ||
        current.status !== "draft" ||
        !current.original
      )
        fail(409, "Reload the current transcript draft.");
      if ((current.history?.length || 0) >= 20)
        fail(409, "This draft has 20 review revisions.");
      try {
        validateRecordingSections(
          input.text,
          input.sections,
          current.file!.durationMs,
          input.reviewed,
        );
      } catch {
        fail(
          400,
          "Speaker sections must cover the complete text in order, fit the recording and have reviewed speaker labels and nonoverlapping time ranges before approval.",
        );
      }
      current.history!.push({
        version: current.history!.at(-1)!.version + 1,
        text: input.text,
        reviewed: input.reviewed,
        ...(input.sections ? { sections: input.sections } : {}),
        at: now(),
        editor: { id: a.id, name: a.name },
      });
      current.version++;
      if (Buffer.byteLength(JSON.stringify(current)) > 4 * 1024 * 1024)
        fail(413, "This draft exceeds its history storage limit.");
      await put(kind, current);
      return respond({ recording: view(current) });
    });
  }
  if (p[3] === "approve" && req.method === "POST") {
    const input = z
      .object({
        version: z.number().int().positive(),
        reviewed: z.literal(true),
      })
      .strict()
      .parse(await body(req));
    return transaction(async () => {
      const current = await requireRecording(a, id);
      if (current.status === "imported") {
        if (
          !(await get<Interview>(
            "interview",
            current.interviewId!,
            a.workspaceId,
          ))
        )
          fail(404, "Imported response was erased.");
        return respond({
          recording: view(current),
          interviewId: current.interviewId,
          reused: true,
        });
      }
      if (
        current.version !== input.version ||
        current.status !== "draft" ||
        !current.history?.at(-1)?.reviewed ||
        !current.file ||
        !current.original
      )
        fail(
          409,
          "Save an explicitly reviewed transcript revision before approving import.",
        );
      const latest = current.history.at(-1)!;
      const imported = await createLibraryImport(
        a,
        importInput
          .extend({
            transcript: z.string().trim().min(10).max(maxImportTranscript),
          })
          .parse({
            studyId: current.studyId,
            requestId: current.id,
            externalId: current.externalId,
            title: current.title,
            language: current.language,
            transcript: latest.text,
            prompt: "Reviewed external recording transcript",
            permissionConfirmed: true,
            transcriptReviewed: true,
          }),
      );
      const i = (await get<Interview>(
        "interview",
        imported.interviewId,
        a.workspaceId,
      ))!;
      if (latest.sections) {
        try {
          validateRecordingSections(
            latest.text,
            latest.sections,
            current.file.durationMs,
            true,
          );
        } catch {
          fail(409, "Review the speaker sections before importing.");
        }
        const template = i.turns[0];
        i.turns = latest.sections.map((s) => ({
          ...template,
          id: uid(),
          answer: latest.text.slice(s.start, s.end),
          recordingSection: {
            mediaId: current.file!.id,
            mime: current.file!.mime,
            speaker: s.speaker,
            startMs: s.startMs!,
            endMs: s.endMs!,
            reviewedAt: latest.at,
            reviewedBy: latest.editor,
          },
        }));
      }
      i.origin!.transcription = {
        model: current.original.model,
        generatedAt: current.original.generatedAt,
        recordingDigest: current.file.digest,
        originalTranscriptDigest: hash(current.original.text),
        reviewedTranscriptDigest: hash(latest.text),
        edited: latest.text !== current.original.text,
        reviewedAt: latest.at,
        reviewedBy: latest.editor,
      };
      const video = current.file.mime.startsWith("video/");
      if (!video) i.turns[0].audioId = current.file.id;
      i.version++;
      await db
        .prepare(
          "INSERT INTO media(id,interview_id,workspace_id,study_id,mime,bytes,duration_ms,created_at,consent_at,turn_version,kind,digest) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          current.file.id,
          i.id,
          a.workspaceId,
          i.studyId,
          current.file.mime,
          current.file.bytes,
          current.file.durationMs,
          now(),
          i.consentAt,
          0,
          video ? "import-video" : "audio",
          current.file.digest,
        );
      await put("interview", i);
      const receipt: LibraryRecording = {
        id: current.id,
        ...(current.batchId ? { batchId: current.batchId } : {}),
        workspaceId: a.workspaceId,
        studyId: current.studyId,
        requestId: current.requestId,
        inputHash: current.inputHash,
        createdAt: current.createdAt,
        expiresAt: current.expiresAt,
        version: current.version + 1,
        status: "imported",
        interviewId: i.id,
      };
      await put(kind, receipt);
      return respond({ recording: view(receipt), interviewId: i.id });
    });
  }
  if (p.length === 3 && req.method === "DELETE") {
    const { version } = z
      .object({ version: z.number().int().positive() })
      .strict()
      .parse(await body(req));
    await transaction(async () => {
      const current = await requireRecording(a, id);
      if (current.version !== version)
        fail(409, "Recording changed. Refresh first.");
      if (current.status === "imported")
        fail(
          409,
          "Delete the imported response in its study to erase the recording and dependent research.",
        );
      await removePendingRecording(current);
    });
    await cleanDeletions();
    return respond({ deleted: true });
  }
  fail(405, "Recording method unavailable.");
}
