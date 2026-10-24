"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
type Data = {
  pending: string;
  client: { name: string; id: string; redirectUri: string };
  scopes: string[];
  studies: { id: string; title: string; published: boolean }[];
  user: { name: string; email: string };
  resource: string;
};
const descriptions: Record<string, string> = {
  "studies:read": "Published study metadata",
  "responses:read": "Completed included responses and original answers",
  "analyses:read": "Reviewed current analyses, memos and cited quotes",
};
export default function Consent() {
  const [data, setData] = useState<Data | null>(null),
    [login, setLogin] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [studies, setStudies] = useState<string[]>([]),
    [scopes, setScopes] = useState<string[]>([]),
    [days, setDays] = useState(30),
    [confirmed, setConfirmed] = useState(false);
  async function load() {
    setError("");
    setBusy(true);
    try {
      const r = await fetch("/api/oauth/consent" + location.search, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const value = await r.json();
      if (r.status === 401) {
        setLogin(true);
        return;
      }
      if (!r.ok)
        throw new Error(
          value.error_description || "This connection request is unavailable.",
        );
      setData(value);
      setScopes(value.scopes);
      setLogin(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setLoaded(true);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function decide(decision: "allow" | "deny") {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/oauth/consent", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pending: data.pending,
          decision,
          studyIds: studies,
          scopes,
          days,
        }),
      });
      const value = await r.json();
      if (!r.ok)
        throw new Error(
          value.error_description ||
            "Approval failed. Restart the connection from your client.",
        );
      location.assign(value.redirect);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <main className="oauth-consent">
      <a href="/" className="eyebrow">
        Echo Lab
      </a>
      <h1>Connect a research tool</h1>
      {!loaded && <p role="status">Loading connection request…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {login && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              await api("auth/login", "POST", {
                email: form.get("email"),
                password: form.get("password"),
              });
              await load();
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          <p>
            Sign in to your Echo Lab workspace to review this request. Only
            admins can approve connections.
          </p>
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="button primary" disabled={busy}>
            Sign in to review
          </button>
        </form>
      )}
      {data && (
        <>
          <p>
            Signed in as <strong>{data.user.email}</strong>.
          </p>
          <h2>{data.client.name}</h2>
          <p>
            The client supplied this name. Echo Lab has not verified its
            identity. Approve only a tool you intended to connect.
          </p>
          <dl>
            <dt>Client ID</dt>
            <dd>{data.client.id}</dd>
            <dt>Return address</dt>
            <dd>{data.client.redirectUri}</dd>
            <dt>Research server</dt>
            <dd>{data.resource}</dd>
          </dl>
          <p>
            This tool will receive the data you approve. Original answers and
            memos may contain personal information. Review the tool’s data
            policies before sharing. Removing sources or revoking a connection
            cannot erase copies it already downloaded.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void decide("allow");
            }}
          >
            <fieldset>
              <legend>Read permissions</legend>
              {data.scopes.map((scope) => (
                <label className="oauth-check" key={scope}>
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={(e) =>
                      setScopes(
                        e.target.checked
                          ? [...scopes, scope]
                          : scopes.filter((s) => s !== scope),
                      )
                    }
                  />
                  {descriptions[scope]}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Allowed studies</legend>
              <p>
                Choose up to 50. Future new studies are never added
                automatically.
              </p>
              {!data.studies.length && (
                <p>
                  No studies yet. Create a study in Echo Lab, then restart the
                  connection.
                </p>
              )}
              {data.studies.map((s) => (
                <label className="oauth-check" key={s.id}>
                  <input
                    type="checkbox"
                    aria-label={`Allow ${s.title} (${s.id.slice(0, 8)})`}
                    checked={studies.includes(s.id)}
                    disabled={!studies.includes(s.id) && studies.length >= 50}
                    onChange={(e) =>
                      setStudies(
                        e.target.checked
                          ? [...studies, s.id]
                          : studies.filter((id) => id !== s.id),
                      )
                    }
                  />
                  <span>
                    {s.title}{" "}
                    <small>
                      {s.id.slice(0, 8)}
                      {!s.published && " · Reads start after publication"}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
            <label>
              Connection valid for days
              <input
                type="number"
                min={1}
                max={30}
                required
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </label>
            <label className="oauth-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I reviewed this tool’s return address, studies and read
              permissions.
            </label>
            <p>
              You can revoke this connection in Team & settings. It cannot edit
              research, launch studies, send email, pay incentives or retrieve
              recordings.
            </p>
            <div className="inline">
              <button
                className="button primary"
                disabled={
                  busy || !confirmed || !studies.length || !scopes.length
                }
              >
                Approve connection
              </button>
              <button
                className="button"
                type="button"
                disabled={busy}
                onClick={() => void decide("deny")}
              >
                Decline connection
              </button>
            </div>
          </form>
        </>
      )}
    </main>
  );
}
