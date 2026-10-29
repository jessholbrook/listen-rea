import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { notificationTypes } from "../src/lib/integration-notifications";
const envelope = z
  .object({
    id: z.uuid(),
    type: z.enum([...notificationTypes, "endpoint.verification"]),
    occurredAt: z.iso.datetime(),
    sequence: z.number().int().positive().optional(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();
export function verifyNotification(
  raw: Uint8Array,
  headers: Headers,
  secret: string,
  now = Date.now(),
) {
  if (raw.byteLength > 65536 || !/^eln_[a-f0-9]{64}$/.test(secret))
    throw Error("Invalid notification.");
  const timestamp = headers.get("echo-lab-timestamp") || "",
    signature = headers.get("echo-lab-signature") || "";
  if (!/^\d{1,12}$/.test(timestamp) || !/^v1=[a-f0-9]{64}$/.test(signature))
    throw Error("Invalid notification.");
  const age = now / 1000 - Number(timestamp);
  if (age > 300 || age < -30) throw Error("Expired notification.");
  const expected = createHmac("sha256", secret)
    .update(timestamp + ".")
    .update(raw)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(3), "hex")))
    throw Error("Invalid notification.");
  const event = envelope.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)),
  );
  if (event.id !== headers.get("echo-lab-event-id"))
    throw Error("Invalid notification.");
  if (event.type === "endpoint.verification")
    z.object({ challenge: z.uuid() }).strict().parse(event.data);
  else {
    if (event.sequence === undefined)
      throw Error("Invalid notification sequence.");
    z.object({
      studyId: z.uuid(),
      id: z.uuid(),
      version: z.number().int().nonnegative(),
    })
      .passthrough()
      .parse(event.data);
  }
  return event;
}
export async function readNotification(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw Error("Missing body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const p = await reader.read();
      if (p.done) break;
      size += p.value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw Error("Notification exceeds 64 KiB.");
      }
      chunks.push(p.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
