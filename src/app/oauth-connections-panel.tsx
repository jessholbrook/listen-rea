"use client";
import { useEffect, useState } from "react";
type Connection = {
  id: string;
  name: string;
  clientId: string;
  redirectUri: string;
  studyIds: string[];
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  version: number;
};
type Data = {
  connections: Connection[];
  studies: { id: string; title: string }[];
};
async function call(path: string, data?: unknown) {
  const r = await fetch("/api/oauth/" + path, {
    method: data ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await r.json();
  if (!r.ok)
    throw new Error(result.error_description || "Connection request failed.");
  return result;
}
export default function OAuthConnectionsPanel() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [revoke, setRevoke] = useState<string | null>(null);
  async function load() {
    setBusy(true);
    setError("");
    try {
      setData(await call("connections"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="oauth-connections">
      <h3>MCP connections</h3>
      <p>
        In a compatible OAuth client, add this workspace’s <code>/api/mcp</code>{" "}
        address and choose Connect. Sign in here to approve specific studies and
        read permissions. No API key needs to be copied.
      </p>
      <p>
        Vercel access remains required separately; clients must support the
        project’s protection settings. No email or domain setup is needed.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <button className="button" disabled={busy} onClick={() => void load()}>
        Refresh MCP connections
      </button>
      {data && !data.connections.length && (
        <p>No OAuth connections approved yet.</p>
      )}
      {data?.connections.map((g) => (
        <article className="oauth-connection" key={g.id}>
          <strong>{g.name}</strong>
          <p className="small">
            Client {g.clientId}
            <br />
            Return address: {g.redirectUri}
          </p>
          <p>{g.scopes.join(", ")}</p>
          <details>
            <summary>{g.studyIds.length} allowed studies</summary>
            <ul>
              {g.studyIds.map((id) => (
                <li key={id}>
                  {data.studies.find((s) => s.id === id)?.title ||
                    "Unavailable study"}{" "}
                  · {id.slice(0, 8)}
                </li>
              ))}
            </ul>
          </details>
          <p>
            {g.revokedAt
              ? "Revoked"
              : Date.parse(g.expiresAt) <= Date.now()
                ? "Expired"
                : "Active"}{" "}
            · Expires {new Date(g.expiresAt).toLocaleString()}
            <br />
            Last used:{" "}
            {g.lastUsedAt ? new Date(g.lastUsedAt).toLocaleString() : "Never"}
          </p>
          {!g.revokedAt &&
            (revoke === g.id ? (
              <div>
                <p>
                  Revoke this connection? Its access and refresh tokens will
                  stop working on new requests.
                </p>
                <div className="inline">
                  <button
                    className="button danger"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        await call("disconnect", {
                          id: g.id,
                          version: g.version,
                        });
                        setRevoke(null);
                        setNotice("MCP connection revoked.");
                        await load();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Confirm connection revocation
                  </button>
                  <button
                    className="button"
                    onClick={() => setRevoke(null)}
                    disabled={busy}
                  >
                    Keep connection
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="button"
                onClick={() => setRevoke(g.id)}
                disabled={busy}
              >
                Revoke connection
              </button>
            ))}
        </article>
      ))}
    </section>
  );
}
