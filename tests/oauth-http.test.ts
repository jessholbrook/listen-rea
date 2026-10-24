import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { createClient } from "@libsql/client";
import {
  auth,
  Client,
  StreamableHTTPClientTransport,
  type OAuthClientProvider,
} from "@modelcontextprotocol/client";
import { start, stop, client, base, dataDirectory } from "./harness";
import { emotionInterview } from "./emotion-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3132 : 3131 }),
  { timeout: 90000 },
);
after(stop);
const digest = (s: string) =>
  createHash("sha256").update(s).digest("base64url");
async function setup() {
  const owner = await client(),
    other = await client(),
    anon = await client();
  for (const c of [owner, other])
    await c("auth/signup", "POST", {
      name: "OAuth admin",
      email: randomUUID() + "@example.test",
      password: "oauth-test-password",
    });
  let s = (await owner("studies", "POST", { title: "OAuth allowed study" }))
    .study;
  s = (
    await owner(`studies/${s.id}`, "PUT", {
      guide: emotionInterview().guide,
      version: s.version,
    })
  ).study;
  s = (await owner(`studies/${s.id}/publish`, "POST", { version: s.version }))
    .study;
  const hidden = (await owner("studies", "POST", { title: "Ungranted study" }))
    .study;
  const foreign = (await other("studies", "POST", { title: "Other workspace" }))
    .study;
  return { owner, other, anon, s, hidden, foreign };
}
async function form(
  action: string,
  fields: Record<string, string>,
  expected = 200,
) {
  const response = await fetch(base + "/api/oauth/" + action, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  const data = await response.json();
  assert.equal(response.status, expected, data.error_description);
  return data;
}
async function rpc(access: string, method = "tools/list", params?: unknown) {
  const r = await fetch(base + "/api/mcp", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + access,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }),
  });
  const wire = await r.text();
  const json = wire.startsWith("{")
    ? JSON.parse(wire)
    : JSON.parse(
        wire
          .split("\n")
          .find((line) => line.startsWith("data:"))!
          .slice(5),
      );
  return { status: r.status, ...json };
}
test(
  "Official OAuth client discovers, registers, obtains a narrowed study grant, refreshes and loses access after admin revocation",
  { timeout: 90000 },
  async () => {
    const { owner, s, hidden } = await setup();
    const unauth = await fetch(base + "/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    assert.equal(unauth.status, 401);
    assert.ok(
      unauth.headers.get("www-authenticate")?.includes("resource_metadata="),
    );
    let info: any,
      saved: any,
      discovery: any,
      authorization: URL | undefined,
      verifier = "";
    const state = randomUUID(),
      provider: OAuthClientProvider = {
        redirectUrl: "http://127.0.0.1:8765/callback",
        clientMetadata: {
          client_name: "Official SDK OAuth",
          redirect_uris: ["http://127.0.0.1:8765/callback"],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        },
        state: () => state,
        discoveryState: () => discovery,
        saveDiscoveryState: (value) => {
          discovery = value;
        },
        clientInformation: () => info,
        saveClientInformation: (value) => {
          info = value;
        },
        tokens: () => saved,
        saveTokens: (value) => {
          saved = value;
        },
        redirectToAuthorization: (url) => {
          authorization = url;
        },
        saveCodeVerifier: (value) => {
          verifier = value;
        },
        codeVerifier: () => verifier,
      };
    await auth(provider, {
      serverUrl: base + "/api/mcp",
      scope: "studies:read responses:read",
    });
    assert.ok(authorization);
    assert.ok(info.client_id);
    assert.ok(verifier.length >= 43);
    assert.equal(authorization.searchParams.get("resource"), base + "/api/mcp");
    const consent = await owner("oauth/consent?" + authorization.searchParams);
    assert.equal(consent.status, 200);
    assert.equal(consent.client.id, info.client_id);
    const decision = await owner("oauth/consent", "POST", {
      pending: consent.pending,
      decision: "allow",
      studyIds: [s.id],
      scopes: ["studies:read"],
      days: 7,
    });
    assert.equal(decision.status, 200);
    const callback = new URL(decision.redirect);
    assert.equal(callback.origin, "http://127.0.0.1:8765");
    assert.equal(callback.searchParams.get("state"), state);
    assert.equal(callback.searchParams.get("iss"), base);
    await auth(provider, {
      serverUrl: base + "/api/mcp",
      authorizationCode: callback.searchParams.get("code")!,
      iss: callback.searchParams.get("iss")!,
    });
    assert.match(saved.access_token, /^elo_[A-Za-z0-9_-]{43}$/);
    assert.match(saved.refresh_token, /^elr_/);
    assert.equal(saved.scope, "studies:read");
    assert.ok(saved.expires_in > 0 && saved.expires_in <= 900);
    const mcp = new Client({ name: "oauth-client-test", version: "1" });
    try {
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL(base + "/api/mcp"), {
          authProvider: provider,
        }),
      );
      assert.deepEqual(
        (await mcp.listTools()).tools.map((t) => t.name).sort(),
        ["get_study", "list_studies"],
      );
      const read = await mcp.callTool({ name: "list_studies", arguments: {} });
      assert.ok(JSON.stringify(read).includes(s.id));
      assert.ok(!JSON.stringify(read).includes(hidden.id));
      assert.equal(
        (
          await mcp.callTool({
            name: "get_study",
            arguments: { studyId: hidden.id },
          })
        ).isError,
        true,
      );
    } finally {
      await mcp.close();
    }
    assert.equal(
      (
        await fetch(base + "/api/v1/studies", {
          headers: { Authorization: "Bearer " + saved.access_token },
        })
      ).status,
      401,
    );
    const first = { ...saved };
    await auth(provider, { serverUrl: base + "/api/mcp" });
    assert.notEqual(saved.access_token, first.access_token);
    assert.notEqual(saved.refresh_token, first.refresh_token);
    assert.equal((await rpc(saved.access_token)).status, 200);
    const connections = await owner("oauth/connections");
    const grant = connections.connections.find(
      (g: any) => g.clientId === info.client_id,
    );
    assert.ok(grant.lastUsedAt);
    assert.deepEqual(grant.studyIds, [s.id]);
    assert.ok(!JSON.stringify(connections).includes(saved.access_token));
    const local = createClient({
      url: "file:" + dataDirectory() + "/research.sqlite",
    });
    try {
      const stored = JSON.stringify(
        (
          await local.execute({
            sql: "SELECT data FROM documents WHERE workspace_id=?",
            args: [s.workspaceId],
          })
        ).rows,
      );
      for (const secret of [
        saved.access_token,
        saved.refresh_token,
        first.refresh_token,
        consent.pending,
        callback.searchParams.get("code")!,
      ])
        assert.ok(!stored.includes(secret));
    } finally {
      local.close();
    }
    assert.equal(
      (
        await owner("oauth/disconnect", "POST", {
          id: grant.id,
          version: grant.version,
        })
      ).status,
      200,
    );
    assert.equal((await rpc(saved.access_token)).status, 401);
    assert.equal(
      (
        await form(
          "token",
          {
            grant_type: "refresh_token",
            client_id: info.client_id,
            refresh_token: saved.refresh_token,
            resource: base + "/api/mcp",
          },
          400,
        )
      ).error,
      "invalid_grant",
    );
  },
);

test(
  "OAuth rejects redirect, PKCE, audience, session and scope substitution; code/refresh replay revokes the family and expiry/issuer checks hold",
  { timeout: 90000 },
  async () => {
    const { owner, other, anon, s, foreign } = await setup(),
      verifier = randomBytes(48).toString("base64url");
    const callback = "https://client.example.test/oauth/callback";
    for (const redirect of [
      "https://client.example.test/cb#fragment",
      "http://example.test/cb",
      "https://user:password@example.test/cb",
      "javascript:alert(1)",
      "https://example.test/cb?code=shadow",
    ]) {
      assert.equal(
        (await anon("oauth/register", "POST", { redirect_uris: [redirect] }))
          .status,
        400,
      );
    }
    const registered = await anon("oauth/register", "POST", {
      client_name: "Protocol checks",
      redirect_uris: [callback],
    });
    assert.equal(registered.status, 201);
    const fields = {
      client_id: registered.client_id,
      redirect_uri: callback,
      response_type: "code",
      code_challenge: digest(verifier),
      code_challenge_method: "S256",
      resource: base + "/api/mcp",
      scope: "studies:read",
      state: "review-state",
    };
    const pending = async (changes = {}) =>
      owner("oauth/consent?" + new URLSearchParams({ ...fields, ...changes }));
    assert.equal(
      (await pending({ redirect_uri: callback + "/evil" })).status,
      400,
    );
    assert.equal(
      (await pending({ code_challenge_method: "plain" })).status,
      400,
    );
    assert.equal(
      (await pending({ resource: "https://elsewhere.example/api/mcp" })).error,
      "invalid_target",
    );
    assert.equal(
      (await pending({ scope: "studies:write" })).error,
      "invalid_scope",
    );
    assert.equal(
      (
        await owner(
          "oauth/consent?" +
            new URLSearchParams(fields) +
            "&resource=duplicate",
        )
      ).status,
      400,
    );
    const p = await pending();
    assert.equal(p.status, 200);
    const approval = {
      pending: p.pending,
      decision: "allow",
      studyIds: [s.id],
      scopes: ["studies:read"],
    };
    assert.equal((await anon("oauth/consent", "POST", approval)).status, 401);
    assert.equal((await other("oauth/consent", "POST", approval)).status, 400);
    assert.equal(
      (
        await owner("oauth/consent", "POST", approval, {
          Origin: "https://attacker.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await owner("oauth/consent", "POST", {
          ...approval,
          scopes: ["responses:read"],
        })
      ).error,
      "invalid_scope",
    );
    assert.equal(
      (
        await owner("oauth/consent", "POST", {
          ...approval,
          studyIds: [foreign.id],
        })
      ).status,
      400,
    );
    const approved = await owner("oauth/consent", "POST", approval),
      code = new URL(approved.redirect).searchParams.get("code")!;
    assert.equal((await owner("oauth/consent", "POST", approval)).status, 400);
    const exchange = {
      grant_type: "authorization_code",
      client_id: registered.client_id,
      code,
      redirect_uri: callback,
      code_verifier: verifier,
      resource: base + "/api/mcp",
    };
    await form(
      "token",
      { ...exchange, code_verifier: randomBytes(48).toString("base64url") },
      400,
    );
    await form("token", { ...exchange, redirect_uri: callback + "/evil" }, 400);
    await form("token", { ...exchange, resource: base + "/api/v1" }, 400);
    const credentials = await form("token", exchange);
    await form("token", exchange, 400);
    assert.equal((await rpc(credentials.access_token)).status, 401);
    const newGrant = async () => {
      const c = await pending(),
        approved = await owner("oauth/consent", "POST", {
          ...approval,
          pending: c.pending,
        });
      return form("token", {
        ...exchange,
        code: new URL(approved.redirect).searchParams.get("code")!,
      });
    };
    const initial = await newGrant(),
      refresh = {
        grant_type: "refresh_token",
        client_id: registered.client_id,
        refresh_token: initial.refresh_token,
        resource: base + "/api/mcp",
      };
    const outcomes = await Promise.all(
      [0, 1].map(async () => {
        const r = await fetch(base + "/api/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(refresh),
        });
        return { status: r.status, ...(await r.json()) };
      }),
    );
    assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 400]);
    const rotated = outcomes.find((r) => r.status === 200)!;
    assert.equal((await rpc(rotated.access_token)).status, 401);
    await form(
      "token",
      { ...refresh, refresh_token: rotated.refresh_token },
      400,
    );
    const active = await newGrant();
    const local = createClient({
      url: "file:" + dataDirectory() + "/research.sqlite",
    });
    try {
      const hash = (s: string) => createHash("sha256").update(s).digest("hex");
      const access = JSON.parse(
        (
          await local.execute({
            sql: "SELECT data FROM documents WHERE kind='oauthAccess' AND id=?",
            args: [hash(active.access_token)],
          })
        ).rows[0].data as string,
      );
      const grant = JSON.parse(
        (
          await local.execute({
            sql: "SELECT data FROM documents WHERE kind='oauthGrant' AND id=?",
            args: [access.grantId],
          })
        ).rows[0].data as string,
      );
      await local.execute({
        sql: "UPDATE users SET role='researcher' WHERE id=?",
        args: [grant.ownerId],
      });
      assert.equal((await rpc(active.access_token)).status, 401);
      await form(
        "token",
        { ...refresh, refresh_token: active.refresh_token },
        400,
      );
      await local.execute({
        sql: "UPDATE users SET role='admin' WHERE id=?",
        args: [grant.ownerId],
      });
      assert.equal((await rpc(active.access_token)).status, 200);
      await local.execute({
        sql: "UPDATE documents SET data=? WHERE kind='oauthAccess' AND id=?",
        args: [
          JSON.stringify({ ...access, expiresAt: Date.now() - 1000 }),
          access.id,
        ],
      });
      assert.equal((await rpc(active.access_token)).status, 401);
    } finally {
      local.close();
    }
    const fresh = await form("token", {
      ...refresh,
      refresh_token: active.refresh_token,
    });
    assert.equal((await rpc(fresh.access_token)).status, 200);
    await form("revoke", {
      client_id: registered.client_id,
      token: fresh.refresh_token,
    });
    assert.equal((await rpc(fresh.access_token)).status, 401);
    await form("revoke", { client_id: registered.client_id, token: "unknown" });
    const denied = await pending(),
      decision = await owner("oauth/consent", "POST", {
        pending: denied.pending,
        decision: "deny",
      });
    assert.equal(
      new URL(decision.redirect).searchParams.get("error"),
      "access_denied",
    );
    assert.equal(
      new URL(decision.redirect).searchParams.get("state"),
      fields.state,
    );
    assert.equal(
      (
        await owner("oauth/consent", "POST", {
          ...approval,
          pending: denied.pending,
        })
      ).status,
      400,
    );
  },
);

test(
  "OAuth consent is bound to the browser session; expired codes, client substitution, oversized bodies and durable request caps fail safely",
  { timeout: 90000 },
  async () => {
    const { owner, other, anon, s } = await setup();
    const verifier = randomBytes(48).toString("base64url"),
      callback = "https://session.example.test/callback";
    const registered = await anon("oauth/register", "POST", {
      redirect_uris: [callback],
    });
    const registered2 = await anon("oauth/register", "POST", {
      redirect_uris: [callback],
    });
    const params = new URLSearchParams({
      client_id: registered.client_id,
      redirect_uri: callback,
      response_type: "code",
      code_challenge: digest(verifier),
      code_challenge_method: "S256",
      resource: base + "/api/mcp",
      scope: "studies:read",
    });
    const pending = await owner("oauth/consent?" + params);
    const approval = {
      pending: pending.pending,
      decision: "allow",
      studyIds: [s.id],
      scopes: ["studies:read"],
    };
    const session2 = await client();
    await session2("auth/login", "POST", {
      email: (await owner("me")).user.email,
      password: "oauth-test-password",
    });
    assert.equal(
      (await session2("oauth/consent", "POST", approval)).status,
      400,
    );
    const invite = (await owner("invites", "POST", { role: "collaborator" }))
        .invite,
      collab = await client();
    await collab("auth/signup", "POST", {
      name: "Read collaborator",
      email: randomUUID() + "@example.test",
      password: "oauth-test-password",
      invite,
    });
    assert.equal((await collab("oauth/consent?" + params)).status, 403);
    assert.equal((await collab("oauth/connections")).status, 403);
    assert.equal(
      (await owner("oauth/consent", "POST", { ...approval, days: 31 })).status,
      400,
    );
    const decision = await owner("oauth/consent", "POST", approval),
      code = new URL(decision.redirect).searchParams.get("code")!;
    const exchange = {
      client_id: registered.client_id,
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: callback,
      resource: base + "/api/mcp",
    };
    await form("token", { ...exchange, client_id: registered2.client_id }, 400);
    const active = await form("token", exchange);
    await form("revoke", {
      client_id: registered2.client_id,
      token: active.refresh_token,
    });
    assert.equal((await rpc(active.access_token)).status, 200);
    const connection = (await owner("oauth/connections")).connections[0];
    assert.equal(
      (
        await other("oauth/disconnect", "POST", {
          id: connection.id,
          version: 1,
        })
      ).status,
      404,
    );
    const pending2 = await owner("oauth/consent?" + params);
    const approved2 = await owner("oauth/consent", "POST", {
      ...approval,
      pending: pending2.pending,
    });
    const code2 = new URL(approved2.redirect).searchParams.get("code")!;
    const local = createClient({
      url: "file:" + dataDirectory() + "/research.sqlite",
    });
    try {
      const sha = (v: string) => createHash("sha256").update(v).digest("hex");
      const record = JSON.parse(
        (
          await local.execute({
            sql: "SELECT data FROM documents WHERE kind='oauthCode' AND id=?",
            args: [sha(code2)],
          })
        ).rows[0].data as string,
      );
      await local.execute({
        sql: "UPDATE documents SET data=? WHERE kind='oauthCode' AND id=?",
        args: [
          JSON.stringify({ ...record, expiresAt: Date.now() - 1000 }),
          record.id,
        ],
      });
      await form("token", { ...exchange, code: code2 }, 400);
      const grant = JSON.parse(
        (
          await local.execute({
            sql: "SELECT data FROM documents WHERE kind='oauthGrant' AND id=?",
            args: [connection.id],
          })
        ).rows[0].data as string,
      );
      await local.execute({
        sql: "UPDATE documents SET data=? WHERE kind='oauthGrant' AND id=?",
        args: [
          JSON.stringify({
            ...grant,
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          }),
          grant.id,
        ],
      });
      assert.equal((await rpc(active.access_token)).status, 401);
      await form(
        "token",
        {
          grant_type: "refresh_token",
          client_id: registered.client_id,
          refresh_token: active.refresh_token,
          resource: base + "/api/mcp",
        },
        400,
      );
      const before = JSON.parse(
        (
          await local.execute(
            "SELECT data FROM documents WHERE kind='oauthRate' AND id='oauth:token'",
          )
        ).rows[0].data as string,
      );
      await form(
        "token",
        { grant_type: "authorization_code", client_id: "unregistered" },
        400,
      );
      const after = JSON.parse(
        (
          await local.execute(
            "SELECT data FROM documents WHERE kind='oauthRate' AND id='oauth:token'",
          )
        ).rows[0].data as string,
      );
      if (before.window === after.window)
        assert.equal(after.count, before.count + 1);
      const window = Math.floor(Date.now() / 60000);
      await local.execute({
        sql: "UPDATE documents SET data=? WHERE kind='oauthRate' AND id='oauth:token'",
        args: [JSON.stringify({ ...after, window, count: 300 })],
      });
      if (Math.floor(Date.now() / 60000) === window)
        await form("token", { client_id: registered.client_id }, 429);
    } finally {
      local.close();
    }
    const oversized = await fetch(base + "/api/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(8192) }),
    });
    assert.equal(oversized.status, 413);
    const duplicate = await fetch(base + "/api/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "client_id=one&client_id=two",
    });
    assert.equal(duplicate.status, 400);
  },
);
