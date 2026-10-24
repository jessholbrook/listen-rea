import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { apiScopes, type ReadApiKey } from "./external-api";
import { db, get, put, hash } from "./db";

export const oauthWorkspace = "__oauth__";
export type OAuthClient = {
  id: string;
  workspaceId: string;
  client_name: string;
  redirect_uris: string[];
  createdAt: string;
  expiresAt: number;
};
export type OAuthGrant = ReadApiKey & {
  clientId: string;
  redirectUri: string;
  resource: string;
};
export type OAuthPending = {
  id: string;
  workspaceId: string;
  ownerId: string;
  sessionHash: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: ReadApiKey["scopes"];
  challenge: string;
  state?: string;
  expiresAt: number;
  used?: boolean;
};
export type OAuthCode = Omit<
  OAuthPending,
  "sessionHash" | "state" | "scopes"
> & { grantId: string };
export type OAuthCredential = {
  id: string;
  workspaceId: string;
  grantId: string;
  clientId: string;
  resource: string;
  expiresAt: number;
  used?: boolean;
};
export class OAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function oauthFail(code: string, message: string, status = 400): never {
  throw new OAuthError(code, message, status);
}
export function oauthOrigin(req: Request) {
  const configured = process.env.RESEARCH_PUBLIC_URL;
  if (configured) {
    const u = new URL(configured);
    if (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      u.pathname === "/" &&
      !u.search &&
      !u.hash
    )
      return u.origin;
    if (!process.env.VERCEL && isLoopback(u) && u.protocol === "http:")
      return u.origin;
    oauthFail("server_error", "Configure the public HTTPS workspace URL.", 503);
  }
  const u = new URL(req.url);
  if (!process.env.VERCEL && isLoopback(u)) {
    // Next normalizes local request URLs to localhost. Preserve the browser's
    // loopback spelling so issuer/resource/Origin checks remain exact.
    const host = req.headers.get("host");
    if (host && /^[a-z0-9.\[\]:-]+$/i.test(host)) {
      const local = new URL(u);
      local.host = host;
      if (isLoopback(local)) return local.origin;
    }
    return u.origin;
  }
  return oauthFail(
    "server_error",
    "Configure the public HTTPS workspace URL.",
    503,
  );
}
export const resourceFor = (req: Request) => oauthOrigin(req) + "/api/mcp";
export const metadataFor = (req: Request) =>
  oauthOrigin(req) + "/.well-known/oauth-protected-resource/api/mcp";
function isLoopback(u: URL) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
}
export function safeRedirect(value: string) {
  try {
    const u = new URL(value);
    return (
      !u.username &&
      !u.password &&
      !u.hash &&
      value.length <= 2048 &&
      (u.protocol === "https:" || (u.protocol === "http:" && isLoopback(u))) &&
      !["code", "state", "error", "error_description", "iss"].some((k) =>
        u.searchParams.has(k),
      )
    );
  } catch {
    return false;
  }
}
export const clientInput = z.object({
  client_name: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[^\x00-\x1f\x7f]+$/)
    .default("MCP client"),
  redirect_uris: z
    .array(
      z
        .string()
        .refine(
          safeRedirect,
          "Use an HTTPS or loopback HTTP callback without fragments or credentials.",
        ),
    )
    .min(1)
    .max(5),
  token_endpoint_auth_method: z.literal("none").default("none"),
  grant_types: z
    .array(z.enum(["authorization_code", "refresh_token"]))
    .min(1)
    .max(2)
    .default(["authorization_code", "refresh_token"]),
  response_types: z.array(z.literal("code")).length(1).default(["code"]),
  scope: z.string().optional(),
});
export function scopesFor(value: string | undefined) {
  const scopes =
    value === undefined ? [...apiScopes] : value.split(" ").filter(Boolean);
  if (
    !scopes.length ||
    scopes.length > 3 ||
    new Set(scopes).size !== scopes.length ||
    scopes.some((s) => !(apiScopes as readonly string[]).includes(s))
  )
    oauthFail("invalid_scope", "Request only the supported read permissions.");
  return scopes as ReadApiKey["scopes"];
}
export const pkce = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
export const opaque = (prefix: string) =>
  prefix + randomBytes(32).toString("base64url");
export async function liveClient(id: string) {
  const client = await get<OAuthClient>("oauthClient", id, oauthWorkspace);
  if (!client || client.expiresAt <= Date.now())
    oauthFail(
      "invalid_client",
      "This client is not registered or has expired.",
    );
  return client;
}
export async function issuerActive(grant: OAuthGrant) {
  if (grant.revokedAt || Date.parse(grant.expiresAt) <= Date.now())
    return false;
  const user = await db
    .prepare("SELECT role,workspace_id FROM users WHERE id=?")
    .get(grant.ownerId);
  return user?.role === "admin" && user.workspace_id === grant.workspaceId;
}
// Call inside a database transaction: these fixed counters bound unauthenticated traffic across instances.
export async function oauthRate(name: string, maximum: number, period = 60000) {
  const window = Math.floor(Date.now() / period),
    id = "oauth:" + name;
  const rate = await get<{ window: number; count: number }>(
    "oauthRate",
    id,
    oauthWorkspace,
  );
  const count = rate?.window === window ? rate.count : 0;
  if (count >= maximum)
    oauthFail(
      "temporarily_unavailable",
      "Too many OAuth requests. Try again later.",
      429,
    );
  await put("oauthRate", {
    id,
    workspaceId: oauthWorkspace,
    window,
    count: count + 1,
  });
}
export async function pruneOAuth() {
  for (const kind of [
    "oauthClient",
    "oauthPending",
    "oauthCode",
    "oauthAccess",
    "oauthRefresh",
  ])
    await db
      .prepare(
        "DELETE FROM documents WHERE kind=? AND CAST(json_extract(data,'$.expiresAt') AS INTEGER)<?",
      )
      .run(kind, Date.now());
}
export async function issueOAuthTokens(grant: OAuthGrant) {
  const access = opaque("elo_"),
    refresh = opaque("elr_"),
    t = Date.now();
  const common = {
    workspaceId: grant.workspaceId,
    grantId: grant.id,
    clientId: grant.clientId,
    resource: grant.resource,
  };
  const expires = Math.min(t + 15 * 60000, Date.parse(grant.expiresAt));
  await put("oauthAccess", {
    ...common,
    id: hash(access),
    expiresAt: expires,
  } satisfies OAuthCredential);
  await put("oauthRefresh", {
    ...common,
    id: hash(refresh),
    expiresAt: Date.parse(grant.expiresAt),
  } satisfies OAuthCredential);
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: Math.max(0, Math.floor((expires - t) / 1000)),
    refresh_token: refresh,
    scope: grant.scopes.join(" "),
  };
}
export function redirectResult(
  pending: Pick<OAuthPending, "redirectUri" | "state">,
  values: Record<string, string>,
  issuer: string,
) {
  const u = new URL(pending.redirectUri);
  for (const [key, value] of Object.entries(values))
    u.searchParams.set(key, value);
  if (pending.state !== undefined) u.searchParams.set("state", pending.state);
  u.searchParams.set("iss", issuer);
  return u.toString();
}
