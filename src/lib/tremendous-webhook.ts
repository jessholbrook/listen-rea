import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db, get, put, list, hash, now, transaction } from "./db";
import type { TremendousOrder } from "./tremendous";
import { tremendousTransport } from "./tremendous-provider";
import { requestTremendousWake, type TremendousWake } from "./tremendous-queue";
export async function tremendousWebhook(
  req: Request,
  enqueue = requestTremendousWake,
) {
  const workspaceId = process.env.RESEARCH_TREMENDOUS_ECHO_WORKSPACE_ID,
    secret = process.env.RESEARCH_TREMENDOUS_SANDBOX_WEBHOOK_SECRET;
  const json = (v: unknown, status = 200) =>
    Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
  if (
    !workspaceId ||
    !secret ||
    secret.length < 16 ||
    !tremendousTransport.binding(workspaceId)
  )
    return json({ error: "Sandbox webhook not configured" }, 503);
  const signature = req.headers.get("tremendous-webhook-signature") || "";
  if (!/^sha256=[a-f0-9]{64}$/.test(signature))
    return json({ error: "Invalid webhook authentication" }, 401);
  const reader = req.body?.getReader();
  if (!reader) return json({ error: "Body required" }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const v = await reader.read();
    if (v.done) break;
    size += v.value.length;
    if (size > 32768) {
      await reader.cancel();
      return json({ error: "Body too large" }, 413);
    }
    chunks.push(v.value);
  }
  const bytes = Buffer.concat(chunks),
    expected = createHmac("sha256", secret).update(bytes).digest();
  if (!timingSafeEqual(Buffer.from(signature.slice(7), "hex"), expected))
    return json({ error: "Invalid webhook authentication" }, 401);
  let event;
  try {
    event = z
      .object({
        uuid: z.uuid(),
        event: z.string().max(100),
        created_utc: z.iso.datetime({ offset: true }),
        payload: z.object({
          resource: z.object({
            id: z.string().max(100),
            type: z.string().max(60),
          }),
        }),
      })
      .parse(JSON.parse(bytes.toString()));
  } catch {
    return json({ error: "Invalid event" }, 400);
  }
  // Provider HMAC has no signed request timestamp. Bound event age/replay window; daily provider reads recover older events.
  const age = Date.now() - Date.parse(event.created_utc);
  if (age < -300000 || age > 7 * 86400000)
    return json({ accepted: true, ignored: true });
  const id = hash("tremendous-sandbox:" + workspaceId + ":" + event.uuid),
    digest = hash(bytes.toString());
  const studies = new Set<string>();
  let duplicate = false;
  await transaction(async () => {
    const old = await get<{ digest: string }>(
      "tremendousEvent",
      id,
      workspaceId,
    );
    if (old) {
      if (old.digest !== digest) throw Error("TREMENDOUS_EVENT_CONFLICT");
      duplicate = true;
      return;
    }
    const count = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM documents WHERE kind='tremendousEvent' AND workspace_id=?",
      )
      .get(workspaceId);
    if (Number(count?.n) >= 10000) throw Error("TREMENDOUS_EVENT_LIMIT");
    await put("tremendousEvent", { id, workspaceId, digest, createdAt: now() });
    const resource = event.payload.resource;
    for (const o of await list<TremendousOrder>(
      "tremendousOrder",
      workspaceId,
    )) {
      if (
        (resource.type === "orders" && o.orderId === resource.id) ||
        (resource.type === "rewards" && o.rewardId === resource.id)
      )
        studies.add(o.studyId);
    }
    // Event content is a wake signal only. Status, payment and redemption are never inferred from a webhook.
    for (const studyId of studies) {
      const w = await get<TremendousWake>(
        "tremendousWake",
        studyId,
        workspaceId,
      );
      await put(
        "tremendousWake",
        w
          ? { ...w, dirty: true }
          : {
              id: studyId,
              workspaceId,
              studyId,
              generation: id,
              attempts: 0,
              state: "pending",
              createdAt: now(),
            },
      );
    }
  });
  for (const studyId of studies)
    await enqueue({ id: studyId, studyId, workspaceId } as Parameters<
      typeof enqueue
    >[0]);
  return json({ accepted: true, duplicate });
}
