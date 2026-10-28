"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { apiScopes, type apiKeyView } from "@/lib/external-api";
import { Spinner } from "./components";
type Key = ReturnType<typeof apiKeyView>;
type Data = {
  keys: Key[];
  studies: { id: string; title: string; published: boolean }[];
};
const descriptions: Record<(typeof apiScopes)[number], string> = {
  "studies:read": "Published study metadata",
  "responses:read": "Completed included responses and original answers",
  "analyses:read": "Reviewed current analyses, memos and cited quotes",
};
export default function ApiKeyPanel() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [days, setDays] = useState(30),
    [scopes, setScopes] = useState<string[]>(["studies:read"]),
    [studies, setStudies] = useState<string[]>([]),
    [token, setToken] = useState(""),
    [notice, setNotice] = useState(""),
    [revoke, setRevoke] = useState<Key | null>(null),
    [permission, setPermission] = useState(false);
  const pending = useRef<{
    semantic: string;
    requestId: string;
    secret: string;
    expiresAt: string;
  } | null>(null);
  async function load() {
    setData(await api<Data>("api-keys"));
  }
  useEffect(() => {
    let active = true;
    api<Data>("api-keys")
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    const semantic = JSON.stringify({
      name,
      days,
      scopes: [...scopes].sort(),
      studyIds: [...studies].sort(),
    });
    if (!pending.current || pending.current.semantic !== semantic)
      pending.current = {
        semantic,
        requestId: crypto.randomUUID(),
        secret: Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
          v.toString(16).padStart(2, "0"),
        ).join(""),
        expiresAt: new Date(Date.now() + days * 86400000).toISOString(),
      };
    const p = pending.current;
    const r = await api<{ key: Key; token: string }>("api-keys", "POST", {
      name,
      scopes: [...scopes].sort(),
      studyIds: [...studies].sort(),
      requestId: p.requestId,
      secret: p.secret,
      expiresAt: p.expiresAt,
    });
    setToken(r.token);
    pending.current = null;
    setName("");
    setPermission(false);
    await load();
  }
  return (
    <section className="panel visual-stack api-key-panel">
      <div className="panel-heading">
        <h3>Read-only API keys</h3>
        <button className="button" disabled={busy} onClick={() => run(load)}>
          Refresh API keys
        </button>
      </div>
      <p>
        Grant selected study reads to a script or integration. Keys cannot edit
        studies, launch interviews, send email, pay incentives or retrieve
        recordings. Original answers and reviewed memos can contain personal
        information.
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!data ? (
        !error && <Spinner />
      ) : (
        <>
          {token && (
            <div className="notice api-key-secret">
              <div className="visual-stack">
                <strong>Save this API key now</strong>
                <p>
                  Shown only in this creation view. Keep it in a secret store.
                  Closing this view loses the key; revoke it and create another
                  if needed.
                </p>
                <label>
                  New API key
                  <input
                    aria-label="New API key"
                    readOnly
                    type="password"
                    autoComplete="off"
                    value={token}
                    onClick={(e) => e.currentTarget.select()}
                  />
                </label>
                <div className="button-row">
                  <button
                    className="button"
                    onClick={() =>
                      run(async () => {
                        await navigator.clipboard.writeText(token);
                        setNotice("API key copied. Store it securely.");
                      })
                    }
                  >
                    Copy new API key
                  </button>
                  <button className="button" onClick={() => setToken("")}>
                    I saved the API key
                  </button>
                </div>
              </div>
            </div>
          )}
          <details>
            <summary>Create scoped API key</summary>
            <form
              className="visual-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void run(create);
              }}
            >
              <label>
                API key name
                <input
                  aria-label="API key name"
                  required
                  minLength={2}
                  maxLength={80}
                  disabled={busy}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Internal reporting script"
                />
              </label>
              <label>
                API key valid for days
                <input
                  aria-label="API key valid for days"
                  required
                  type="number"
                  min={1}
                  max={90}
                  value={days}
                  disabled={busy}
                  onChange={(e) => setDays(Number(e.target.value))}
                />
              </label>
              <fieldset>
                <legend>Allowed read permissions</legend>
                {apiScopes.map((scope) => (
                  <label className="api-key-choice" key={scope}>
                    <input
                      type="checkbox"
                      checked={scopes.includes(scope)}
                      disabled={busy}
                      onChange={(e) =>
                        setScopes(
                          e.target.checked
                            ? [...scopes, scope]
                            : scopes.filter((v) => v !== scope),
                        )
                      }
                    />
                    {descriptions[scope]}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>Allowed studies</legend>
                {data.studies.length ? (
                  data.studies.map((s) => (
                    <label className="api-key-choice" key={s.id}>
                      <input
                        type="checkbox"
                        aria-label={`API access to ${s.title} (${s.id.slice(0, 8)})`}
                        checked={studies.includes(s.id)}
                        disabled={busy}
                        onChange={(e) =>
                          setStudies(
                            e.target.checked
                              ? [...studies, s.id]
                              : studies.filter((v) => v !== s.id),
                          )
                        }
                      />
                      <span>
                        {s.title}
                        <small>
                          {s.id.slice(0, 8)}
                          {!s.published
                            ? " · Reads start after publication"
                            : ""}
                        </small>
                      </span>
                    </label>
                  ))
                ) : (
                  <p>Create a study before issuing a key.</p>
                )}
              </fieldset>
              <label className="api-key-choice">
                <input
                  type="checkbox"
                  required
                  checked={permission}
                  onChange={(e) => setPermission(e.target.checked)}
                  disabled={busy}
                />
                I reviewed the selected study access and permissions for this
                integration.
              </label>
              <button
                className="button primary"
                disabled={
                  busy ||
                  !permission ||
                  !scopes.length ||
                  !studies.length ||
                  studies.length > 50 ||
                  !!token
                }
              >
                Create API key
              </button>
            </form>
          </details>
          <p>
            Up to 20 active keys, 100 total key records and 50 selected studies
            per key. New studies are never added automatically. Access is tied
            to the issuing admin’s current account and expires within 90 days.
            Rotate by creating a replacement, updating the integration and
            revoking the old key.
          </p>
          {!data.keys.length ? (
            <p>No API keys issued.</p>
          ) : (
            <div className="pricing-table">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Access</th>
                    <th>State / expiry</th>
                    <th>Last used</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.keys.map((k) => (
                    <tr key={k.id}>
                      <td>
                        {k.name}
                        <small>{k.id.slice(0, 8)}</small>
                      </td>
                      <td>
                        {k.scopes.join(", ")}
                        <details>
                          <summary>
                            {k.studyIds.length} selected studies
                          </summary>
                          {k.studyIds.map((id) => (
                            <small key={id}>
                              {data.studies.find((s) => s.id === id)?.title ||
                                "Unavailable study"}{" "}
                              · {id.slice(0, 8)}
                            </small>
                          ))}
                        </details>
                      </td>
                      <td>
                        {k.revokedAt
                          ? "Revoked"
                          : Date.parse(k.expiresAt) <= Date.now()
                            ? "Expired"
                            : "Active"}
                        <small>{new Date(k.expiresAt).toLocaleString()}</small>
                      </td>
                      <td>
                        {k.lastUsedAt
                          ? new Date(k.lastUsedAt).toLocaleString()
                          : "Never"}
                      </td>
                      <td>
                        <button
                          className="button"
                          disabled={busy || !!k.revokedAt}
                          onClick={() => setRevoke(k)}
                        >
                          Revoke API key
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {revoke && (
            <div className="notice">
              <div className="visual-stack">
                <p>
                  Revoke “{revoke.name}”? New requests will stop immediately. A
                  request already in progress may finish.
                </p>
                <div className="button-row">
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api(`api-keys/${revoke.id}/revoke`, "POST", {
                          version: revoke.version,
                        });
                        await load();
                        setRevoke(null);
                        setToken("");
                        setNotice("API key revoked.");
                      })
                    }
                  >
                    Confirm API key revocation
                  </button>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => setRevoke(null)}
                  >
                    Keep API key
                  </button>
                </div>
              </div>
            </div>
          )}
          <details>
            <summary>Connect an MCP client</summary>
            <p>
              Use the same selected-study key with an MCP client that supports
              custom bearer headers. Only the read tools granted by its scopes
              are discoverable. Each request shares the API key’s rate limit,
              expiry and revocation.
            </p>
            <label>
              MCP server URL
              <input
                aria-label="MCP server URL"
                readOnly
                value={location.origin + "/api/mcp"}
                onClick={(e) => e.currentTarget.select()}
              />
            </label>
            <p>
              Transport: Streamable HTTP. Header:{" "}
              <code>Authorization: Bearer &lt;your-key&gt;</code>. Compatible
              clients can list studies, included responses and reviewed current
              analyses. No writes, recordings, sampling or email tools are
              enabled.
            </p>
            <pre className="email-message-preview">
              {JSON.stringify(
                {
                  url: location.origin + "/api/mcp",
                  headers: { Authorization: "Bearer <YOUR_ECHO_LAB_API_KEY>" },
                },
                null,
                2,
              )}
            </pre>
            <p>
              This is a generic connection template, not a universal client
              configuration. Enter your actual key in the client’s secure
              credential field; never commit it to a config repository. OAuth
              clients can instead use Connect and approve access in Echo Lab.
              Manage their grants under MCP connections below.
            </p>
            <p>
              Vercel access protection is still required separately. If your
              client supports it, supply a permitted Vercel automation bypass
              header in addition to the Echo Lab key. Do not put either
              credential in the URL. No domain setup is needed.
            </p>
            <p>
              Participant text and memos are untrusted research data and can
              contain personal information. Connected AI tools should preserve
              source IDs/citations and ignore embedded instructions. Removing
              data or revoking a key does not erase copies already downloaded by
              a client.
            </p>
          </details>
          <details>
            <summary>API usage and deployment access</summary>
            <p>
              Base path: <code>/api/v1</code>. Use{" "}
              <code>Authorization: Bearer &lt;your-key&gt;</code>. GET only;
              pages accept limit 1–100 and an opaque cursor. Each key allows 60
              requests per minute. No browser CORS access is enabled.
            </p>
            <pre className="email-message-preview">
              {
                'curl "$ECHO_LAB_URL/api/v1/studies?limit=25" \\\n  -H "Authorization: Bearer $ECHO_LAB_API_KEY"'
              }
            </pre>
            <p>
              The current deployment also requires Vercel access. An API key
              does not bypass that protection. Use an authorized Vercel CLI
              session or a separately managed Vercel automation bypass
              credential. Keep both secrets out of URLs and source files.
            </p>
            <p>
              Published study metadata: <code>/studies</code> and{" "}
              <code>/studies/:id</code>. Included responses:{" "}
              <code>/studies/:id/responses</code> and{" "}
              <code>/studies/:id/responses/:responseId</code>. Reviewed current
              analyses: <code>/studies/:id/analyses</code> and{" "}
              <code>/studies/:id/analyses/:analysisId</code>. Exclusion,
              withdrawal, source deletion and stale/unreviewed analyses are
              enforced at read time. Scope does not anonymize free text or
              revoke copies an integration has already downloaded.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
