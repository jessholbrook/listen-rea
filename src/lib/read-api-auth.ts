import { db, get, put, hash, now, transaction } from "./db";
import { fail } from "./http";
import type { ReadApiKey } from "./external-api";
import {
  issuerActive,
  resourceFor,
  type OAuthCredential,
  type OAuthGrant,
} from "./oauth";
export async function authenticateReadKey(
  req: Request,
  headers: Record<string, string>,
  allowOAuth = false,
) {
  const credential = req.headers.get("authorization") || "";
  const bearer = /^Bearer +(\S+)$/i.exec(credential);
  const oauthToken =
    !!bearer && allowOAuth && /^elo_[A-Za-z0-9_-]{43}$/.test(bearer[1]);
  if (!bearer || (!/^elk_[0-9a-f]{64}$/.test(bearer[1]) && !oauthToken)) {
    headers["WWW-Authenticate"] = 'Bearer realm="Echo Lab API"';
    fail(401, "A valid API bearer key is required.");
  }
  let key!: ReadApiKey;
  await transaction(async () => {
    let k: ReadApiKey | undefined;
    const kind = oauthToken ? "oauthGrant" : "readApiKey";
    if (oauthToken) {
      const access = await get<OAuthCredential>("oauthAccess", hash(bearer[1]));
      if (
        !access ||
        access.expiresAt <= Date.now() ||
        access.resource !== resourceFor(req)
      )
        fail(401, "The MCP access token is invalid or expired.");
      const grant = await get<OAuthGrant>(
        "oauthGrant",
        access.grantId,
        access.workspaceId,
      );
      if (
        !grant ||
        grant.clientId !== access.clientId ||
        grant.resource !== access.resource ||
        !(await issuerActive(grant))
      )
        fail(401, "The MCP connection is no longer authorized.");
      k = grant;
    } else k = await get<ReadApiKey>("readApiKey", hash(bearer[1]));
    if (!k || k.revokedAt || Date.parse(k.expiresAt) <= Date.now())
      fail(401, "The API key is invalid, expired or revoked.");
    const issuer = await db
      .prepare("SELECT role,workspace_id FROM users WHERE id=?")
      .get(k.ownerId);
    if (
      !issuer ||
      issuer.role !== "admin" ||
      issuer.workspace_id !== k.workspaceId
    )
      fail(401, "The API key is no longer authorized.");
    const minute = Math.floor(Date.now() / 60000),
      used = k.rateMinute === minute ? k.rateCount || 0 : 0;
    headers["X-RateLimit-Limit"] = "60";
    headers["X-RateLimit-Remaining"] = String(Math.max(0, 60 - used - 1));
    if (used >= 60) {
      headers["Retry-After"] = String(
        60 - (Math.floor(Date.now() / 1000) % 60),
      );
      fail(429, "API key rate limit reached. Retry after the indicated delay.");
    }
    key = {
      ...k,
      lastUsedAt: now(),
      rateMinute: minute,
      rateCount: used + 1,
    };
    await put(kind, key);
  });

  return key;
}
