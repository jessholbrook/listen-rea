import { fetch, EnvHttpProxyAgent } from "undici";
import type { EmailPayload } from "./invitation-email";
const dispatcher = new EnvHttpProxyAgent();
export function emailConfiguration() {
  const key = process.env.RESEND_API_KEY || "",
    from = process.env.RESEARCH_EMAIL_FROM || "",
    replyTo = process.env.RESEARCH_EMAIL_REPLY_TO || "",
    origin = process.env.RESEARCH_PUBLIC_URL || "";
  const address = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
  let validOrigin = false;
  try {
    const u = new URL(origin);
    validOrigin =
      u.origin === origin &&
      (u.protocol === "https:" ||
        (!process.env.VERCEL &&
          ["localhost", "127.0.0.1"].includes(u.hostname)));
  } catch {}
  return {
    key,
    from,
    replyTo,
    origin,
    metadataReady: address.test(from) && address.test(replyTo) && validOrigin,
    ready: !!key && address.test(from) && address.test(replyTo) && validOrigin,
  };
}
export async function sendInvitationEmail(
  payload: EmailPayload,
  id: string,
  transport: typeof fetch = fetch,
) {
  const c = emailConfiguration();
  if (!c.ready) throw new Error("EMAIL_NOT_CONFIGURED");
  try {
    const r = await transport("https://api.resend.com/emails", {
      method: "POST",
      dispatcher,
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: "Bearer " + c.key,
        "Content-Type": "application/json",
        "Idempotency-Key": "echo-invitation/" + id,
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok)
      return {
        ok: false as const,
        uncertain: r.status >= 500 || [408, 409, 429].includes(r.status),
        error:
          r.status === 401 || r.status === 403
            ? "Provider authentication or sender verification failed."
            : "The provider did not accept this request. Check the provider dashboard before retrying.",
      };
    const value = (await r.json()) as { id?: unknown };
    if (typeof value.id !== "string" || !value.id || value.id.length > 200)
      return {
        ok: false as const,
        uncertain: true,
        error:
          "The provider response could not be confirmed. Retry this same message only.",
      };
    return { ok: true as const, id: value.id };
  } catch {
    return {
      ok: false as const,
      uncertain: true,
      error:
        "The provider response was interrupted. Delivery may have been accepted. Retry this same message only.",
    };
  }
}
export async function invitationDelivery(
  id: string,
  transport: typeof fetch = fetch,
) {
  const c = emailConfiguration();
  if (!c.ready) throw new Error("EMAIL_NOT_CONFIGURED");
  try {
    const r = await transport(
      "https://api.resend.com/emails/" + encodeURIComponent(id),
      {
        dispatcher,
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: "Bearer " + c.key },
      },
    );
    if (!r.ok) return null;
    const value = (await r.json()) as { last_event?: unknown };
    return typeof value.last_event === "string" ? value.last_event : null;
  } catch {
    return null;
  }
}
