import { createHash } from "node:crypto";
import { fingerprint } from "../../integrations/echo-lab-client";
import {
  verifyNotification,
  readNotification,
} from "../../integrations/notification-receiver";
import type { Destination } from "./store";
/** Call inside the destination's exclusive writer lock; HTTP 2xx follows durable acceptance. */
export async function acceptNotification(
  req: Request,
  secret: string,
  studyIds: string[],
  destination: Destination,
  now = Date.now(),
) {
  let raw: Buffer, event: ReturnType<typeof verifyNotification>;
  try {
    raw = await readNotification(req);
    event = verifyNotification(raw, req.headers, secret, now);
  } catch {
    return Response.json(
      { error: "Invalid signed notification." },
      { status: 400 },
    );
  }
  if (event.type === "endpoint.verification")
    return Response.json({ echo_lab_challenge: event.data.challenge });
  if (!studyIds.includes(String(event.data.studyId)))
    return new Response(null, { status: 204 });
  const s = await destination.load(),
    idHash = fingerprint(event.id),
    bodyHash = createHash("sha256").update(raw).digest("hex");
  s.receipts = s.receipts.filter((r) => r.at >= now - 7 * 86400000);
  const old = s.receipts.find((r) => r.idHash === idHash);
  if (old)
    return old.bodyHash === bodyHash
      ? new Response(null, { status: 204 })
      : Response.json({ error: "Event identity changed." }, { status: 409 });
  if (s.receipts.length >= 1000)
    return Response.json(
      {
        error:
          "Receiver capacity reached. Run scheduled catch-up and retry later.",
      },
      { status: 503 },
    );
  s.receipts.push({ idHash, bodyHash, at: now });
  s.wake++;
  await destination.save(s);
  return new Response(null, { status: 204 });
}
