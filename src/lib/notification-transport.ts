import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createHmac } from "node:crypto";
import { providerFetch } from "./provider-transport";
import { notificationUrl } from "./integration-notifications";
export function notificationAllowed(url: string) {
  const u = new URL(notificationUrl(url));
  return (process.env.RESEARCH_NOTIFICATION_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(u.origin);
}
export function publicNotificationAddress(ip: string) {
  if (isIP(ip) === 4) {
    const a = ip.split(".").map(Number);
    return !(
      a[0] === 0 ||
      a[0] === 10 ||
      a[0] === 127 ||
      a[0] >= 224 ||
      (a[0] === 169 && a[1] === 254) ||
      (a[0] === 172 && a[1] >= 16 && a[1] <= 31) ||
      (a[0] === 192 && a[1] === 168) ||
      (a[0] === 100 && a[1] >= 64 && a[1] <= 127) ||
      (a[0] === 198 && [18, 19, 51].includes(a[1])) ||
      (a[0] === 192 && a[1] === 0) ||
      (a[0] === 203 && a[1] === 0)
    );
  }
  // Accept global-unicast IPv6 only; deny mapped IPv4, ULA, link-local, loopback and documentation space.
  return (
    isIP(ip) === 6 &&
    /^[23][0-9a-f]{3}:/i.test(ip) &&
    !/^2001:(?:db8|0|10|20):/i.test(ip)
  );
}
export function notificationHeaders(
  secret: string,
  eventId: string,
  body: string,
  attempt: number,
  timestamp = Math.floor(Date.now() / 1000).toString(),
) {
  return {
    "Content-Type": "application/json",
    "Echo-Lab-Event-Id": eventId,
    "Echo-Lab-Timestamp": timestamp,
    "Echo-Lab-Attempt": String(attempt),
    "Echo-Lab-Signature":
      "v1=" +
      createHmac("sha256", secret)
        .update(timestamp + "." + body)
        .digest("hex"),
  };
}
export type NotificationSender = (
  url: string,
  headers: Record<string, string>,
  body: string,
) => Promise<{ status: number; challenge?: string }>;
export const sendNotification: NotificationSender = async (
  url,
  headers,
  body,
) => {
  if (!notificationAllowed(url))
    throw Error("NOTIFICATION_ORIGIN_NOT_APPROVED");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const records = await Promise.race([
    lookup(new URL(url).hostname, { all: true }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error("NOTIFICATION_DNS_TIMEOUT")), 5000);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
  if (
    !records.length ||
    records.some((r) => !publicNotificationAddress(r.address))
  )
    throw Error("NOTIFICATION_DESTINATION_UNAVAILABLE");
  const r = await providerFetch(
    url,
    { method: "POST", headers, body, redirect: "manual" },
    { timeoutMs: 10000 },
  );
  let challenge: string | undefined;
  if (
    headers["Echo-Lab-Verification"] === "1" &&
    r.status >= 200 &&
    r.status < 300
  ) {
    const reader = r.body?.getReader();
    let bytes = Buffer.alloc(0);
    if (reader)
      try {
        for (;;) {
          const v = await reader.read();
          if (v.done) break;
          bytes = Buffer.concat([bytes, Buffer.from(v.value)]);
          if (bytes.length > 1024)
            throw Error("NOTIFICATION_VERIFICATION_LIMIT");
        }
      } finally {
        await reader.cancel();
      }
    try {
      challenge = JSON.parse(bytes.toString()).echo_lab_challenge;
    } catch {}
  } else await r.body?.cancel();
  return { status: r.status, challenge };
};
