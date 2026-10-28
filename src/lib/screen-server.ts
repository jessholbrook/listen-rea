import { createHash } from "node:crypto";
import { z } from "zod";
import { actor, participant, body, respond, fail, limit } from "./http";
import { db, get, put, uid, now, transaction, requireStudy } from "./db";
import { ensureRecording, deleteRecording, maxRecordingBytes } from "./storage";
import { type Interview } from "./domain";
import {
  taskFor,
  maxScreenSegmentMs,
  type ScreenSession,
  type ScreenClip,
} from "./screen";

export async function captureSessions(i: Interview) {
  const sessions = (
    await db
      .prepare(
        "SELECT data FROM documents WHERE kind='capture' AND workspace_id=? AND study_id=? AND json_extract(data,'$.interviewId')=? ORDER BY rowid DESC",
      )
      .all(i.workspaceId, i.studyId, i.id)
  ).map((r) => JSON.parse(String(r.data)) as ScreenSession);
  const grouped = new Map<string, ScreenClip[]>();
  for (const r of await db
    .prepare(
      "SELECT id,capture_id,sequence,offset_ms,duration_ms,bytes FROM media WHERE interview_id=? AND workspace_id=? AND kind='screen' ORDER BY sequence",
    )
    .all(i.id, i.workspaceId)) {
    const id = String(r.capture_id),
      clips = grouped.get(id) || [];
    clips.push({
      id: String(r.id),
      sequence: Number(r.sequence),
      offsetMs: Number(r.offset_ms),
      durationMs: Number(r.duration_ms),
      bytes: Number(r.bytes),
    });
    grouped.set(id, clips);
  }
  return sessions.map((s) => ({ ...s, clips: grouped.get(s.id) || [] }));
}

async function activeTurn(i: Interview, c?: ScreenSession) {
  if (
    i.pending ||
    i.status !== "active" ||
    !taskFor(i) ||
    (c &&
      (c.turnVersion !== i.version ||
        c.questionId !== i.guide.questions[i.current].id))
  )
    fail(
      409,
      "This task changed or has finished. Saved clips remain available to the study team.",
    );
}
export async function requireClosedCaptures(i: Interview) {
  if (
    (await captureSessions(i)).some(
      (c) => c.turnVersion === i.version && c.status === "recording",
    )
  )
    fail(409, "Stop screen sharing and save its clips before continuing.");
}
async function boundedVideo(req: Request) {
  if (Number(req.headers.get("content-length")) > maxRecordingBytes)
    fail(413, "Screen clip is too large. Maximum 3 MB per clip.");
  if (!req.body) fail(400, "Screen clip is empty.");
  const reader = req.body.getReader(),
    chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxRecordingBytes) {
      await reader.cancel();
      fail(413, "Screen clip is too large. Maximum 3 MB per clip.");
    }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length < 16 || bytes.subarray(0, 4).toString("hex") !== "1a45dfa3")
    fail(400, "Use a supported WebM screen recording.");
  return bytes;
}
export async function dispatchScreen(
  req: Request,
  p: string[],
): Promise<Response | null> {
  const method = req.method;
  if (p[0] === "studies" && p[1] && p[2] === "captures" && method === "GET") {
    const a = await actor(),
      s = await requireStudy(p[1], a),
      id = new URL(req.url).searchParams.get("interview");
    const i = id
      ? await get<Interview>("interview", id, a.workspaceId)
      : undefined;
    if (!i || i.studyId !== s.id) fail(404, "Response not found.");
    return respond({ captures: await captureSessions(i) });
  }
  if (p[0] !== "interviews" || !p[1] || p[2] !== "captures") return null;
  const initial = await participant(req, p[1]);
  if (!p[3] && method === "GET")
    return respond({ captures: await captureSessions(initial) });
  if (!p[3] && method === "POST") {
    const input = z
      .object({ consent: z.literal(true), version: z.number().int() })
      .parse(await body(req));
    let capture: ScreenSession | undefined;
    await transaction(async () => {
      const i = (await get<Interview>("interview", initial.id))!;
      await activeTurn(i);
      if (i.version !== input.version)
        fail(409, "Reload the current task before sharing.");
      await requireClosedCaptures(i);
      if (
        (await captureSessions(i)).filter((c) => c.turnVersion === i.version)
          .length >= 10
      )
        fail(
          409,
          "This task has reached its sharing-session limit. You can continue with a written response.",
        );
      capture = {
        id: uid(),
        workspaceId: i.workspaceId,
        studyId: i.studyId,
        interviewId: i.id,
        questionId: i.guide.questions[i.current].id,
        turnVersion: i.version,
        prompt: i.prompt,
        consentAt: now(),
        createdAt: now(),
        status: "recording",
      };
      await put("capture", capture);
    });
    return respond({ capture }, 201);
  }
  if (!p[3]) return null;
  const c = await get<ScreenSession>("capture", p[3], initial.workspaceId);
  if (!c || c.interviewId !== initial.id)
    fail(404, "Screen session not found.");
  if (p[4] === "finish" && method === "POST") {
    const input = z
      .object({ status: z.enum(["stopped", "interrupted"]) })
      .parse(await body(req));
    await transaction(async () => {
      const current = (await get<ScreenSession>(
        "capture",
        c.id,
        initial.workspaceId,
      ))!;
      if (current.status === "recording") {
        current.status = input.status;
        current.stoppedAt = now();
        await put("capture", current);
      }
    });
    return respond({ ok: true });
  }
  if (p[4] !== "clips" || method !== "POST") return null;
  limit("screen:" + initial.id, 150);
  if (req.headers.get("x-recording-consent") !== "yes")
    fail(400, "Screen and microphone recording require explicit permission.");
  if ((req.headers.get("content-type") || "").split(";")[0] !== "video/webm")
    fail(400, "Use a supported WebM screen recording.");
  const meta = z
    .object({
      id: z.uuid().transform((value) => value.toLowerCase()),
      sequence: z.number().int().min(0).max(59),
      offsetMs: z.number().int().min(0).max(600000),
      durationMs: z.number().int().min(100).max(maxScreenSegmentMs),
    })
    .parse({
      id: req.headers.get("x-recording-id"),
      sequence: Number(req.headers.get("x-clip-sequence")),
      offsetMs: Number(req.headers.get("x-clip-offset")),
      durationMs: Number(req.headers.get("x-recording-duration")),
    });
  const bytes = await boundedVideo(req),
    digest = createHash("sha256").update(bytes).digest("hex");
  let written = false,
    reused = false;
  try {
    await transaction(async () => {
      const i = await get<Interview>(
        "interview",
        initial.id,
        initial.workspaceId,
      );
      const current = await get<ScreenSession>(
        "capture",
        c.id,
        initial.workspaceId,
      );
      if (!i || !current) fail(404, "Screen session no longer exists.");
      const existing = await db
        .prepare(
          "SELECT * FROM media WHERE id=? OR (capture_id=? AND sequence=?)",
        )
        .get(meta.id, c.id, meta.sequence);
      if (existing) {
        if (
          existing.id !== meta.id ||
          existing.capture_id !== c.id ||
          Number(existing.sequence) !== meta.sequence ||
          existing.digest !== digest ||
          Number(existing.offset_ms) !== meta.offsetMs ||
          Number(existing.duration_ms) !== meta.durationMs
        )
          fail(409, "This clip conflicts with a previously saved clip.");
        reused = true;
        return;
      }
      if (await get("participantImageDeleted", meta.id))
        fail(409, "This clip ID is unavailable. Start a new recording.");
      await activeTurn(i, current);
      if (current.status !== "recording")
        fail(
          409,
          "This sharing session is closed. Start a new sharing session to record more.",
        );
      const clips = (await captureSessions(i)).find(
        (s) => s.id === c.id,
      )!.clips!;
      const last = clips.at(-1);
      if (
        meta.sequence !== clips.length ||
        (last && meta.offsetMs < last.offsetMs + last.durationMs - 250)
      )
        fail(
          409,
          "Save clips in recording order without overlapping timestamps.",
        );
      if (
        meta.offsetMs + meta.durationMs >
        taskFor(i)!.maxSeconds * 1000 + 1000
      )
        fail(400, "This task recording exceeds its time limit.");
      try {
        await ensureRecording(meta.id, bytes, "video/webm");
      } catch (e) {
        if (e instanceof Error && e.message === "MEDIA_CONFLICT")
          fail(409, "This recording ID already contains different bytes.");
        throw e;
      }
      written = true;
      await db
        .prepare(
          "INSERT INTO media(id,interview_id,workspace_id,study_id,mime,bytes,duration_ms,created_at,consent_at,turn_version,kind,capture_id,sequence,offset_ms,digest) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          meta.id,
          i.id,
          i.workspaceId,
          i.studyId,
          "video/webm",
          bytes.length,
          meta.durationMs,
          now(),
          c.consentAt,
          i.version,
          "screen",
          c.id,
          meta.sequence,
          meta.offsetMs,
          digest,
        );
    });
  } catch (e) {
    if (written) {
      try {
        await deleteRecording(meta.id);
      } catch {
        await put("deletion", {
          id: uid(),
          workspaceId: c.workspaceId,
          studyId: c.studyId,
          files: [meta.id],
          createdAt: now(),
        });
      }
    }
    throw e;
  }
  const clip: ScreenClip = {
    id: meta.id,
    sequence: meta.sequence,
    offsetMs: meta.offsetMs,
    durationMs: meta.durationMs,
    bytes: bytes.length,
  };
  return respond({ clip, reused });
}
