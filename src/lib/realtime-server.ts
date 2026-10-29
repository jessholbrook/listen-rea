import { z } from "zod";
import { db, get, put, transaction, uid, hash, now } from "./db";
import { participant, body, fail, respond, limit } from "./http";
import type { Interview } from "./domain";
import { aiReady, recordUsage } from "./ai";
import {
  openRealtime,
  hangupRealtime,
  realtimeModel,
} from "./realtime-provider";
import { responseLanguage } from "./localization";
export type RealtimeCall = {
  id: string;
  workspaceId: string;
  studyId: string;
  interviewId: string;
  turnVersion: number;
  state: "connecting" | "active" | "closed";
  expiresAt: number;
  inputHash: string;
  callId?: string;
  sdp?: string;
};
async function orphan(
  callId: string,
  i: Pick<RealtimeCall, "workspaceId" | "studyId">,
  hangup = hangupRealtime,
) {
  try {
    await hangup(callId);
  } catch {
    await put("deletion", {
      id: uid(),
      workspaceId: i.workspaceId,
      studyId: i.studyId,
      files: [],
      realtimeCalls: [callId],
      createdAt: now(),
    });
  }
}
export async function closeRealtime(
  id: string,
  force = false,
  hangup = hangupRealtime,
) {
  const c = await get<RealtimeCall>("realtimeCall", id);
  if (!c || c.state === "closed" || (!force && c.expiresAt > Date.now()))
    return;
  if (c.callId) await hangup(c.callId);
  await transaction(async () => {
    const current = await get<RealtimeCall>("realtimeCall", id);
    if (current)
      await put("realtimeCall", {
        ...current,
        state: "closed",
        sdp: undefined,
        callId: undefined,
      });
  });
}
export async function stopRealtimeTurn(i: Interview) {
  const rows = await db
    .prepare(
      "SELECT data FROM documents WHERE kind='realtimeCall' AND workspace_id=? AND json_extract(data,'$.interviewId')=? AND json_extract(data,'$.turnVersion')=? AND json_extract(data,'$.state')!='closed'",
    )
    .all(i.workspaceId, i.id, i.version);
  for (const row of rows) {
    const c = JSON.parse(String(row.data)) as RealtimeCall;
    try {
      await closeRealtime(c.id, true);
    } catch {
      if (c.callId) await orphan(c.callId, c);
    }
  }
}
export async function reapRealtime() {
  let closed = 0;
  for (const row of await db
    .prepare(
      "SELECT id FROM documents WHERE kind='realtimeCall' AND json_extract(data,'$.state')!='closed' AND json_extract(data,'$.expiresAt')<? LIMIT 100",
    )
    .all(Date.now())) {
    try {
      await closeRealtime(String(row.id));
      closed++;
    } catch {
      /* The durable call remains available for retry. */
    }
  }
  await db
    .prepare(
      "DELETE FROM documents WHERE kind='realtimeCall' AND json_extract(data,'$.state')='closed' AND json_extract(data,'$.expiresAt')<?",
    )
    .run(Date.now() - 86400000);
  return closed;
}
async function queueExpiry(c: RealtimeCall) {
  if (
    process.env.VERCEL &&
    process.env.RESEARCH_BACKGROUND_DRIVER !== "manual"
  ) {
    const { send } = await import("@vercel/queue");
    await send(
      "echo-lab-work",
      { realtimeId: c.id, action: "expireVoice" },
      {
        idempotencyKey: "voice-expiry:" + c.id,
        delaySeconds: 600,
        retentionSeconds: 86400,
        region: "iad1",
      },
    );
  }
}
export async function dispatchRealtime(
  req: Request,
  p: string[],
  deps = {
    ready: aiReady,
    open: openRealtime,
    hangup: hangupRealtime,
    queue: queueExpiry,
    usage: recordUsage,
  },
) {
  if (p[0] !== "interviews" || !p[1] || p[2] !== "realtime") return null;
  const i = await participant(req, p[1]);
  if (p.length === 4 && req.method === "DELETE") {
    const c = await get<RealtimeCall>("realtimeCall", p[3], i.workspaceId);
    if (!c || c.interviewId !== i.id) fail(404, "Voice session unavailable.");
    await closeRealtime(c.id, true, deps.hangup);
    return respond({ stopped: true });
  }
  if (p.length !== 3 || req.method !== "POST")
    fail(405, "Use POST to start live voice or DELETE to stop it.");
  const input = z
    .object({
      requestId: z.uuid(),
      version: z.number().int().min(0),
      consent: z.literal(true),
      sdp: z.string().min(20).max(64000).startsWith("v=0"),
    })
    .strict()
    .parse(await body(req));
  if (!deps.ready())
    fail(503, "Live voice requires the configured AI provider.");
  limit("realtime:" + i.id, 6);
  const q = i.guide.questions[i.current];
  if (
    i.status !== "active" ||
    i.pending ||
    i.version !== input.version ||
    q?.type !== "open" ||
    q.task
  )
    fail(
      409,
      "This question is unavailable for live voice. Reload or use text.",
    );
  const id = hash(i.id + ":" + input.requestId),
    inputHash = hash(input.sdp);
  let c: RealtimeCall = {
    id,
    workspaceId: i.workspaceId,
    studyId: i.studyId,
    interviewId: i.id,
    turnVersion: i.version,
    state: "connecting",
    expiresAt: Date.now() + 600000,
    inputHash,
  };
  let reused = false;
  await transaction(async () => {
    const previous = await get<RealtimeCall>("realtimeCall", id, i.workspaceId);
    if (previous) {
      if (
        previous.inputHash !== inputHash ||
        previous.turnVersion !== i.version ||
        previous.state !== "active" ||
        previous.expiresAt <= Date.now()
      )
        fail(
          409,
          "This connection request is no longer reusable. Start a new connection.",
        );
      c = previous;
      reused = true;
      return;
    }
    const active = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM documents WHERE kind='realtimeCall' AND workspace_id=? AND json_extract(data,'$.state')!='closed' AND json_extract(data,'$.expiresAt')>?",
      )
      .get(i.workspaceId, Date.now());
    const own = await db
      .prepare(
        "SELECT id FROM documents WHERE kind='realtimeCall' AND workspace_id=? AND json_extract(data,'$.interviewId')=? AND json_extract(data,'$.state')!='closed' AND json_extract(data,'$.expiresAt')>?",
      )
      .get(i.workspaceId, i.id, Date.now());
    if (own || Number(active?.n) >= 4)
      fail(
        409,
        "A voice connection is already open. Stop it first, or use text.",
      );
    await put("realtimeCall", c);
  });
  if (reused) return respond({ id: c.id, sdp: c.sdp, expiresAt: c.expiresAt });
  try {
    const opened = await deps.open(input.sdp, i.prompt, responseLanguage(i));
    let valid = false;
    await transaction(async () => {
      const fresh = await get<Interview>("interview", i.id),
        reserved = await get<RealtimeCall>("realtimeCall", id);
      if (
        fresh?.status === "active" &&
        !fresh.pending &&
        fresh.version === i.version &&
        reserved?.state === "connecting"
      ) {
        c = { ...c, ...opened, state: "active" };
        await put("realtimeCall", c);
        valid = true;
      }
    });
    if (!valid) {
      await orphan(opened.callId, c, deps.hangup);
      fail(409, "The interview changed while voice connected.");
    }
    try {
      await deps.queue(c);
    } catch {
      await orphan(opened.callId, c, deps.hangup);
      throw Error("REALTIME_EXPIRY_UNAVAILABLE");
    }
    await deps.usage(
      i.workspaceId,
      i.studyId,
      "realtime-session-start",
      realtimeModel(),
    );
    return respond({ id: c.id, sdp: c.sdp, expiresAt: c.expiresAt });
  } catch (e) {
    if (c.callId) await orphan(c.callId, c, deps.hangup);
    await transaction(async () => {
      const old = await get<RealtimeCall>("realtimeCall", id);
      if (old)
        await put("realtimeCall", {
          ...old,
          state: "closed",
          sdp: undefined,
          callId: undefined,
        });
    });
    throw e;
  }
}
