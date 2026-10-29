import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db, get, put, list, hash, now, transaction } from "./db";
import type { ProlificConfig } from "./prolific";
import { requestProlificWake, type ProlificWake } from "./prolific-queue";
export async function prolificWebhook(
  req: Request,
  enqueue = requestProlificWake,
) {
  const workspaceId = process.env.RESEARCH_PROLIFIC_ECHO_WORKSPACE_ID,
    secret = process.env.RESEARCH_PROLIFIC_WEBHOOK_SECRET;
  const json = (value: unknown, status = 200) =>
    Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  if (!workspaceId || !secret || secret.length < 16)
    return json({ error: "Webhook not configured" }, 503);
  const timestamp = req.headers.get("x-prolific-request-timestamp") || "",
    signature = req.headers.get("x-prolific-request-signature") || "",
    eventId = req.headers.get("x-event-id") || "";
  if (
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(eventId)
  )
    return json({ error: "Invalid webhook authentication" }, 401);
  const reader = req.body?.getReader();
  if (!reader) return json({ error: "Body required" }, 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const p = await reader.read();
    if (p.done) break;
    length += p.value.length;
    if (length > 32768) {
      await reader.cancel();
      return json({ error: "Body too large" }, 413);
    }
    chunks.push(p.value);
  }
  const bytes = Buffer.concat(chunks),
    expected = createHmac("sha256", secret)
      .update(timestamp)
      .update(bytes)
      .digest("base64");
  if (
    Buffer.byteLength(signature) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    return json({ error: "Invalid webhook authentication" }, 401);
  try {
    z.object({
      event_type: z.string().max(100),
      resource_id: z.string().max(128),
    }).parse(JSON.parse(bytes.toString()));
  } catch {
    return json({ error: "Invalid event" }, 400);
  }
  const id = hash(workspaceId + ":" + eventId),
    digest = hash(bytes.toString());
  let duplicate = false;
  await transaction(async () => {
    const old = await get<{ digest: string }>("prolificEvent", id, workspaceId);
    if (old) {
      if (old.digest !== digest) throw Error("PROLIFIC_EVENT_CONFLICT");
      duplicate = true;
      return;
    }
    const count = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM documents WHERE kind='prolificEvent' AND workspace_id=?",
      )
      .get(workspaceId);
    if (Number(count?.n) >= 10000) throw Error("PROLIFIC_EVENT_LIMIT");
    await put("prolificEvent", { id, workspaceId, digest, createdAt: now() });
    // Store durable wakes in the same commit as the event receipt; never persist raw event/participant identifiers.
    for (const c of (await list<ProlificConfig>("prolificConfig", workspaceId))
      .filter((c) => c.draftId && c.connectionHash)
      .slice(0, 20)) {
      const w = await get<ProlificWake>("prolificWake", c.id, workspaceId);
      if (w) await put("prolificWake", { ...w, dirty: true });
      if (!w)
        await put("prolificWake", {
          id: c.id,
          workspaceId,
          studyId: c.id,
          generation: id,
          attempts: 0,
          state: "pending",
          createdAt: now(),
        });
    }
  });
  if (!duplicate)
    for (const c of (await list<ProlificConfig>("prolificConfig", workspaceId))
      .filter((c) => c.draftId && c.connectionHash)
      .slice(0, 20))
      await enqueue(c);
  return json({ accepted: true, duplicate });
}
