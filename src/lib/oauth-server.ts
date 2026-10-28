import { z, ZodError } from "zod";
import { cookies } from "next/headers";
import { actor, HttpError } from "./http";
import { db, get, put, list, hash, now, uid, transaction } from "./db";
import type { Study } from "./domain";
import { apiScopes } from "./external-api";
import {
  OAuthError,
  oauthFail,
  oauthOrigin,
  resourceFor,
  oauthWorkspace,
  clientInput,
  scopesFor,
  liveClient,
  issuerActive,
  oauthRate,
  pruneOAuth,
  opaque,
  pkce,
  issueOAuthTokens,
  redirectResult,
  type OAuthClient,
  type OAuthPending,
  type OAuthGrant,
  type OAuthCode,
  type OAuthCredential,
} from "./oauth";

const noStore = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
};
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Retry-After",
};
async function requestBody(req: Request) {
  if (Number(req.headers.get("content-length") || 0) > 8192)
    oauthFail("invalid_request", "OAuth request exceeds 8 KiB.", 413);
  const reader = req.body?.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  if (!reader) oauthFail("invalid_request", "A request body is required.");
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 8192) {
        await reader.cancel();
        oauthFail("invalid_request", "OAuth request exceeds 8 KiB.", 413);
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks).toString("utf8"),
    type = (req.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
  if (type === "application/json") {
    try {
      return JSON.parse(text);
    } catch {
      oauthFail("invalid_request", "Invalid JSON.");
    }
  }
  if (type === "application/x-www-form-urlencoded")
    return uniqueParams(new URLSearchParams(text));
  oauthFail("invalid_request", "Use JSON or form-encoded parameters.", 415);
}
function uniqueParams(params: URLSearchParams) {
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    if (Object.hasOwn(result, key))
      oauthFail(
        "invalid_request",
        "Duplicate OAuth parameters are not allowed.",
      );
    Object.defineProperty(result, key, { value, enumerable: true });
  }
  return result;
}
function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (
    (origin && origin !== oauthOrigin(req)) ||
    req.headers.get("sec-fetch-site") === "cross-site"
  )
    oauthFail(
      "access_denied",
      "Approve connections from the Echo Lab consent page.",
      403,
    );
}
async function admin() {
  const a = await actor();
  if (a.role !== "admin")
    oauthFail(
      "access_denied",
      "Only workspace admins can approve or manage MCP connections.",
      403,
    );
  return a;
}
const consentInput = z
  .object({
    pending: z.string().regex(/^elp_[A-Za-z0-9_-]{43}$/),
    decision: z.enum(["allow", "deny"]),
    studyIds: z.array(z.uuid()).max(50).default([]),
    scopes: z.array(z.enum(apiScopes)).max(3).default([]),
    days: z.number().int().min(1).max(30).default(30),
  })
  .strict();
export async function oauthMetadata(req: Request, protectedResource = false) {
  try {
    const origin = oauthOrigin(req);
    const body = protectedResource
      ? {
          resource: resourceFor(req),
          authorization_servers: [origin],
          scopes_supported: apiScopes,
          bearer_methods_supported: ["header"],
          resource_name: "Echo Lab read-only research",
        }
      : {
          issuer: origin,
          authorization_endpoint: origin + "/oauth/authorize",
          token_endpoint: origin + "/api/oauth/token",
          registration_endpoint: origin + "/api/oauth/register",
          revocation_endpoint: origin + "/api/oauth/revoke",
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
          revocation_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: apiScopes,
          authorization_response_iss_parameter_supported: true,
          client_id_metadata_document_supported: false,
        };
    return Response.json(body, { headers: { ...noStore, ...cors } });
  } catch {
    return Response.json(
      {
        error: "server_error",
        error_description: "OAuth public URL is not configured.",
      },
      { status: 503, headers: { ...noStore, ...cors } },
    );
  }
}
export async function oauthEndpoint(req: Request, action: string) {
  const publicAction = ["register", "token", "revoke"].includes(action),
    headers = { ...noStore, ...(publicAction ? cors : {}) };
  const json = (value: unknown, status = 200) =>
    Response.json(value, { status, headers });
  try {
    if (req.method === "OPTIONS" && publicAction)
      return new Response(null, { status: 204, headers });
    if (action === "consent" && req.method === "GET") {
      sameOrigin(req);
      const params = uniqueParams(new URL(req.url).searchParams);
      if (
        Object.keys(params).some(
          (k) =>
            ![
              "client_id",
              "redirect_uri",
              "response_type",
              "code_challenge",
              "code_challenge_method",
              "state",
              "scope",
              "resource",
            ].includes(k),
        )
      )
        oauthFail("invalid_request", "Unsupported authorization parameter.");
      const input = z
        .object({
          client_id: z.string().max(100),
          redirect_uri: z.string().max(2048),
          response_type: z.literal("code"),
          code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          code_challenge_method: z.literal("S256"),
          state: z.string().max(1024).optional(),
          scope: z.string().max(100).optional(),
          resource: z.string().max(2048),
        })
        .parse(params);
      const client = await liveClient(input.client_id);
      if (!client.redirect_uris.includes(input.redirect_uri))
        oauthFail(
          "invalid_request",
          "The callback address is not registered for this client.",
        );
      if (input.resource !== resourceFor(req))
        oauthFail("invalid_target", "Request the Echo Lab MCP resource.");
      const scopes = scopesFor(input.scope),
        a = await admin(),
        raw = opaque("elp_");
      await transaction(async () => {
        await oauthRate("consent", 120);
        await pruneOAuth();
        const pending = await list<OAuthPending>("oauthPending", a.workspaceId);
        if (pending.filter((p) => !p.used && p.ownerId === a.id).length >= 20)
          oauthFail(
            "temporarily_unavailable",
            "Too many pending connections. Wait ten minutes before retrying.",
            429,
          );
        await put("oauthPending", {
          id: hash(raw),
          workspaceId: a.workspaceId,
          ownerId: a.id,
          sessionHash: hash((await cookies()).get("research_session")!.value),
          clientId: client.id,
          redirectUri: input.redirect_uri,
          resource: input.resource,
          scopes,
          challenge: input.code_challenge,
          state: input.state,
          expiresAt: Date.now() + 10 * 60000,
        } satisfies OAuthPending);
      });
      return json({
        pending: raw,
        client: {
          name: client.client_name,
          id: client.id,
          redirectUri: input.redirect_uri,
        },
        scopes,
        studies: (await list<Study>("study", a.workspaceId)).map((s) => ({
          id: s.id,
          title: s.title,
          published: !!s.revisionId,
        })),
        user: { name: a.name, email: a.email },
        resource: input.resource,
      });
    }
    if (action === "connections" && req.method === "GET") {
      const a = await admin();
      return json({
        connections: (await list<OAuthGrant>("oauthGrant", a.workspaceId)).map(
          (g) => ({
            id: g.id,
            name: g.name,
            clientId: g.clientId,
            redirectUri: g.redirectUri,
            studyIds: g.studyIds,
            scopes: g.scopes,
            createdAt: g.createdAt,
            expiresAt: g.expiresAt,
            lastUsedAt: g.lastUsedAt || null,
            revokedAt: g.revokedAt || null,
            version: g.version,
          }),
        ),
        studies: (await list<Study>("study", a.workspaceId)).map((s) => ({
          id: s.id,
          title: s.title,
        })),
      });
    }
    if (req.method !== "POST")
      return new Response(null, {
        status: 405,
        headers: { ...headers, Allow: "POST" },
      });
    const input = await requestBody(req);
    if (publicAction)
      await transaction(async () => {
        await oauthRate(
          action === "register" ? "register" : "token",
          action === "register" ? 60 : 300,
          action === "register" ? 3600000 : 60000,
        );
        await pruneOAuth();
      });
    if (action === "register") {
      const data = clientInput.parse(input);
      if (!data.grant_types.includes("authorization_code"))
        oauthFail(
          "invalid_client_metadata",
          "Authorization-code support is required.",
        );
      if (data.scope !== undefined) scopesFor(data.scope);
      const client = await transaction(async () => {
        const count = await db
          .prepare(
            "SELECT COUNT(*) AS n FROM documents WHERE kind='oauthClient'",
          )
          .get();
        if (Number(count?.n) >= 1000)
          oauthFail(
            "temporarily_unavailable",
            "Client registration is at capacity.",
            429,
          );
        const c: OAuthClient = {
          id: "elc_" + uid(),
          workspaceId: oauthWorkspace,
          client_name: data.client_name,
          redirect_uris: [...new Set(data.redirect_uris)],
          createdAt: now(),
          expiresAt: Date.now() + 90 * 86400000,
        };
        await put("oauthClient", c);
        return c;
      });
      return json(
        {
          client_id: client.id,
          client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
          client_name: client.client_name,
          redirect_uris: client.redirect_uris,
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        },
        201,
      );
    }
    if (action === "consent") {
      sameOrigin(req);
      if (
        !(req.headers.get("content-type") || "")
          .toLowerCase()
          .startsWith("application/json")
      )
        oauthFail("invalid_request", "Use JSON from the consent page.");
      const data = consentInput.parse(input),
        a = await admin();
      const result = await transaction(async () => {
        const p = await get<OAuthPending>(
          "oauthPending",
          hash(data.pending),
          a.workspaceId,
        );
        if (
          !p ||
          p.ownerId !== a.id ||
          p.sessionHash !==
            hash((await cookies()).get("research_session")?.value || "") ||
          p.used ||
          p.expiresAt <= Date.now()
        )
          oauthFail(
            "invalid_request",
            "This approval expired or was already used. Restart the client connection.",
          );
        const client = await liveClient(p.clientId);
        if (data.decision === "deny") {
          await put("oauthPending", { ...p, used: true });
          return {
            redirect: redirectResult(
              p,
              {
                error: "access_denied",
                error_description: "The workspace admin declined access.",
              },
              oauthOrigin(req),
            ),
          };
        }
        if (
          !data.studyIds.length ||
          !data.scopes.length ||
          new Set(data.studyIds).size !== data.studyIds.length ||
          new Set(data.scopes).size !== data.scopes.length ||
          data.scopes.some((s) => !p.scopes.includes(s))
        )
          oauthFail(
            "invalid_scope",
            "Select unique studies and a subset of the requested read permissions.",
          );
        for (const id of data.studyIds)
          if (!(await get<Study>("study", id, a.workspaceId)))
            oauthFail(
              "invalid_request",
              "A selected study is unavailable in your workspace.",
            );
        const grants = await list<OAuthGrant>("oauthGrant", a.workspaceId);
        if (
          grants.length >= 100 ||
          grants.filter(
            (g) => !g.revokedAt && Date.parse(g.expiresAt) > Date.now(),
          ).length >= 20
        )
          oauthFail(
            "access_denied",
            "This workspace has reached its MCP connection limit.",
            409,
          );
        const grant: OAuthGrant = {
          id: uid(),
          workspaceId: a.workspaceId,
          ownerId: a.id,
          name: client.client_name,
          clientId: client.id,
          redirectUri: p.redirectUri,
          resource: p.resource,
          studyIds: data.studyIds,
          scopes: data.scopes,
          createdAt: now(),
          expiresAt: new Date(Date.now() + data.days * 86400000).toISOString(),
          version: 1,
        };
        await put("oauthGrant", grant);
        await put("oauthClient", {
          ...client,
          expiresAt: Date.now() + 90 * 86400000,
        });
        const raw = opaque("elc_");
        await put("oauthCode", {
          id: hash(raw),
          workspaceId: a.workspaceId,
          ownerId: a.id,
          clientId: p.clientId,
          redirectUri: p.redirectUri,
          resource: p.resource,
          challenge: p.challenge,
          grantId: grant.id,
          expiresAt: Date.now() + 5 * 60000,
        } satisfies OAuthCode);
        await put("oauthPending", { ...p, used: true });
        return { redirect: redirectResult(p, { code: raw }, oauthOrigin(req)) };
      });
      return json(result);
    }
    if (action === "disconnect") {
      sameOrigin(req);
      const a = await admin(),
        data = z
          .object({ id: z.uuid(), version: z.number().int().min(1) })
          .strict()
          .parse(input);
      await transaction(async () => {
        const g = await get<OAuthGrant>("oauthGrant", data.id, a.workspaceId);
        if (!g) oauthFail("invalid_request", "Connection not found.", 404);
        if (g.revokedAt) return;
        if (g.version !== data.version)
          oauthFail(
            "invalid_request",
            "Connection changed. Refresh before revoking.",
            409,
          );
        await put("oauthGrant", {
          ...g,
          revokedAt: now(),
          version: g.version + 1,
        });
      });
      return json({ ok: true });
    }
    if (action === "token" || action === "revoke") {
      const fields = z.record(z.string(), z.string().max(4096)).parse(input);
      if (req.headers.has("authorization") || fields.client_secret)
        oauthFail(
          "invalid_client",
          "Use a public client with PKCE and no client secret.",
          401,
        );
      const result = await transaction(async () => {
        await liveClient(fields.client_id || "");
        if (action === "revoke") {
          const raw = fields.token || "";
          const record = await get<OAuthCredential>(
            raw.startsWith("elr_") ? "oauthRefresh" : "oauthAccess",
            hash(raw),
          );
          if (record?.clientId === fields.client_id) {
            const g = await get<OAuthGrant>(
              "oauthGrant",
              record.grantId,
              record.workspaceId,
            );
            if (g && !g.revokedAt)
              await put("oauthGrant", {
                ...g,
                revokedAt: now(),
                version: g.version + 1,
              });
          }
          return {};
        }
        if (fields.resource !== resourceFor(req))
          oauthFail(
            "invalid_target",
            "Supply the exact Echo Lab MCP resource.",
          );
        const invalid = () =>
          oauthFail(
            "invalid_grant",
            "The code or refresh token is invalid, expired or revoked.",
          );
        if (fields.grant_type === "authorization_code") {
          const c = await get<OAuthCode>("oauthCode", hash(fields.code || ""));
          if (
            !c ||
            c.expiresAt <= Date.now() ||
            c.clientId !== fields.client_id ||
            c.redirectUri !== fields.redirect_uri ||
            c.resource !== fields.resource ||
            !/^[A-Za-z0-9._~-]{43,128}$/.test(fields.code_verifier || "") ||
            pkce(fields.code_verifier) !== c.challenge
          )
            invalid();
          const code = c!;
          const g = await get<OAuthGrant>(
            "oauthGrant",
            code.grantId,
            code.workspaceId,
          );
          if (!g || !(await issuerActive(g))) invalid();
          if (code.used) {
            await put("oauthGrant", {
              ...g!,
              revokedAt: now(),
              version: g!.version + 1,
            });
            return {
              error: "invalid_grant",
              error_description:
                "Authorization code replay revoked this connection. Connect again.",
            };
          }
          await put("oauthCode", { ...code, used: true });
          return issueOAuthTokens(g!);
        }
        if (fields.grant_type === "refresh_token") {
          const r = await get<OAuthCredential>(
            "oauthRefresh",
            hash(fields.refresh_token || ""),
          );
          if (
            !r ||
            r.clientId !== fields.client_id ||
            r.resource !== fields.resource ||
            r.expiresAt <= Date.now()
          )
            invalid();
          const refresh = r!,
            g = await get<OAuthGrant>(
              "oauthGrant",
              refresh.grantId,
              refresh.workspaceId,
            );
          if (!g || !(await issuerActive(g))) invalid();
          if (refresh.used) {
            await put("oauthGrant", {
              ...g!,
              revokedAt: now(),
              version: g!.version + 1,
            });
            return {
              error: "invalid_grant",
              error_description:
                "Refresh token replay revoked this connection. Connect again.",
            };
          }
          if (fields.scope && fields.scope !== g!.scopes.join(" "))
            oauthFail(
              "invalid_scope",
              "Refresh cannot change this connection's permissions. Connect again to change access.",
            );
          await put("oauthRefresh", { ...refresh, used: true });
          return issueOAuthTokens(g!);
        }
        return oauthFail(
          "unsupported_grant_type",
          "Use an authorization code or rotating refresh token.",
        );
      });
      return json(result, "error" in result ? 400 : 200);
    }
    return json(
      {
        error: "invalid_request",
        error_description: "OAuth endpoint not found.",
      },
      404,
    );
  } catch (e) {
    const status =
      e instanceof OAuthError
        ? e.status
        : e instanceof HttpError
          ? e.status
          : e instanceof ZodError
            ? 400
            : 500;
    if (status === 429)
      (headers as Record<string, string>)["Retry-After"] = String(
        (action === "register" ? 3600 : 60) -
          (Math.floor(Date.now() / 1000) % (action === "register" ? 3600 : 60)),
      );
    return json(
      {
        error:
          e instanceof OAuthError
            ? e.code
            : status === 401 || status === 403
              ? "access_denied"
              : status === 500
                ? "server_error"
                : "invalid_request",
        error_description:
          e instanceof OAuthError || e instanceof HttpError
            ? e.message
            : status === 500
              ? "The connection request could not be completed."
              : "Check the OAuth parameters and retry.",
      },
      status,
    );
  }
}
