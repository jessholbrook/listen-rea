"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import {
  notificationTypes,
  type NotificationEndpoint,
  type NotificationDelivery,
} from "@/lib/integration-notifications";
type Endpoint = Omit<NotificationEndpoint, "sealedKey"> & {
  destinationApproved: boolean;
};
type Data = {
  encryptionReady: boolean;
  endpoints: Endpoint[];
  deliveries: NotificationDelivery[];
  studies: { id: string; title: string }[];
};
const labels = {
  "study.changed": "Study versions and fielding",
  "response.changed": "Included completed responses",
  "job.changed": "Background job states",
};
const config = (e: Endpoint) => ({
  name: e.name,
  url: e.url,
  studyIds: e.studyIds,
  eventTypes: e.eventTypes,
});
export default function NotificationPanel() {
  const [data, setData] = useState<Data | null>(null),
    [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [studyIds, setStudies] = useState<string[]>([]),
    [eventTypes, setEvents] = useState<string[]>([]),
    [reviewed, setReviewed] = useState(false),
    [secret, setSecret] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef<{
      fingerprint: string;
      requestId: string;
      secret: string;
    } | null>(null),
    generation = useRef(0);
  async function load() {
    const g = ++generation.current;
    const value = await api("notifications");
    if (g === generation.current) setData(value);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    return () => {
      generation.current++;
    };
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel visual-stack notification-panel"
      aria-label="Integration notifications"
    >
      <h3>Integration notifications</h3>
      <p>
        Send signed metadata to your own HTTPS receiver when selected studies,
        included completed responses or background job states change. Payloads
        contain IDs and state/version information, without research text,
        recordings, participant contact details or API credentials.
      </p>
      <p>
        Destinations start disabled. Verify ownership, choose studies/event
        types and explicitly enable future changes. Changing settings cancels
        queued deliveries. Receivers must verify signatures and deduplicate
        event IDs; retries can deliver an event more than once.
      </p>
      {error && <p role="alert">{error}</p>}
      {!data ? (
        <p>Loading notification settings…</p>
      ) : (
        <>
          {!data.encryptionReady && (
            <p className="notice">
              Private signing-key storage needs deployment setup before a
              destination can be registered.
            </p>
          )}
          <button
            className="button"
            disabled={busy}
            onClick={() => void run(async () => {})}
          >
            Refresh notifications
          </button>
          <details>
            <summary>Register a destination</summary>
            <form
              className="visual-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const value = { name, url, studyIds, eventTypes },
                    fingerprint = JSON.stringify(value);
                  if (
                    !request.current ||
                    request.current.fingerprint !== fingerprint
                  ) {
                    const bytes = crypto.getRandomValues(new Uint8Array(32));
                    request.current = {
                      fingerprint,
                      requestId: crypto.randomUUID(),
                      secret: Array.from(bytes, (b) =>
                        b.toString(16).padStart(2, "0"),
                      ).join(""),
                    };
                  }
                  const r = await api("notifications", "POST", {
                    ...value,
                    ...request.current,
                    fingerprint: undefined,
                    reviewed,
                  });
                  setSecret(r.signingKey);
                  request.current = null;
                  setName("");
                  setUrl("");
                  setReviewed(false);
                });
              }}
            >
              <label>
                Destination name
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setReviewed(false);
                  }}
                />
              </label>
              <label>
                Receiver HTTPS URL
                <input
                  type="url"
                  required
                  maxLength={1000}
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setReviewed(false);
                  }}
                />
              </label>
              <p className="small muted">
                The deployment administrator must approve the destination
                origin. Use an owned receiver without credentials, query
                parameters or a custom port in the URL.
              </p>
              <fieldset>
                <legend>Selected studies</legend>
                {data.studies.map((s) => (
                  <label className="checkbox-label" key={s.id}>
                    <input
                      type="checkbox"
                      checked={studyIds.includes(s.id)}
                      onChange={(e) => {
                        setStudies((v) =>
                          e.target.checked
                            ? [...v, s.id]
                            : v.filter((id) => id !== s.id),
                        );
                        setReviewed(false);
                      }}
                    />
                    {s.title}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>Event types</legend>
                {notificationTypes.map((type) => (
                  <label className="checkbox-label" key={type}>
                    <input
                      type="checkbox"
                      checked={eventTypes.includes(type)}
                      onChange={(e) => {
                        setEvents((v) =>
                          e.target.checked
                            ? [...v, type]
                            : v.filter((t) => t !== type),
                        );
                        setReviewed(false);
                      }}
                    />
                    {labels[type]}
                  </label>
                ))}
              </fieldset>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                I own this receiver and reviewed the metadata, selected studies
                and event types it may receive.
              </label>
              <button
                className="button"
                disabled={
                  busy ||
                  !data.encryptionReady ||
                  !reviewed ||
                  !studyIds.length ||
                  !eventTypes.length
                }
              >
                Register disabled destination
              </button>
            </form>
          </details>
          {secret && (
            <div className="panel visual-stack">
              <strong>Copy the signing key to your receiver</strong>
              <p>
                This key is shown for this operation only. Keep it private; it
                is not an API access key. Closing this settings view clears it.
                If lost, rotate the key.
              </p>
              <input
                type="password"
                aria-label="Notification signing key"
                readOnly
                value={secret}
              />
              <button
                className="button"
                onClick={() => void navigator.clipboard.writeText(secret)}
              >
                Copy notification signing key
              </button>
              <button className="button" onClick={() => setSecret("")}>
                Hide signing key
              </button>
            </div>
          )}
          {data.endpoints.map((endpoint) => (
            <EndpointCard
              key={endpoint.id + ":" + endpoint.version}
              endpoint={endpoint}
              refresh={load}
              showKey={setSecret}
              studies={data.studies}
            />
          ))}
          <h4>Delivery log</h4>
          <p className="small muted">
            Up to 200 recent deliveries; seven-day retention. The attempt count
            includes reserved attempts with an uncertain outcome. Success means
            an HTTP 2xx acknowledgment, not completion of a receiver’s
            downstream workflow. Failed deliveries support up to three reviewed
            retry cycles using the same event ID.
          </p>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api("notifications/dispatch", "POST", {});
              })
            }
          >
            Dispatch pending notifications
          </button>
          {!data.deliveries.length && <p>No notification deliveries yet.</p>}
          {data.deliveries.map((d) => (
            <article className="panel visual-stack" key={d.id}>
              <strong>
                {d.eventType} · {d.state}
              </strong>
              <small>
                {data.endpoints.find((e) => e.id === d.endpointId)?.name ||
                  "Removed destination"}{" "}
                · {new Date(d.createdAt).toLocaleString()}
              </small>
              <p>
                Event {d.eventId} · Study {d.studyId}
              </p>
              <p>
                {d.attempts} attempts ·{" "}
                {d.httpStatus ? "HTTP " + d.httpStatus : "No HTTP status"}
                {d.error ? " · " + d.error : ""}
              </p>
              {d.state === "pending" && (
                <p>
                  Next attempt no earlier than{" "}
                  {new Date(d.nextAt).toLocaleString()}.
                </p>
              )}
              {d.state === "failed" && (
                <button
                  className="button"
                  disabled={busy || d.manualRetries >= 3}
                  onClick={() =>
                    void run(async () => {
                      await api(
                        "notifications/deliveries/" + d.id + "/retry",
                        "POST",
                        {
                          version: d.version,
                          requestId: crypto.randomUUID(),
                          reviewed: true,
                        },
                      );
                    })
                  }
                >
                  Retry failed notification
                </button>
              )}
            </article>
          ))}
          <p className="small muted">
            Only changes captured after enablement are sent. Each destination
            retains up to 1,000 deliveries; overflow is counted on the
            destination and requires catch-up through current API reads.
            Delivery order is not guaranteed. Erasure/exclusion can cancel
            pending notifications; data already sent to a receiver cannot be
            recalled.
          </p>
        </>
      )}
    </section>
  );
}
function EndpointCard({
  endpoint: e,
  refresh,
  showKey,
  studies,
}: {
  endpoint: Endpoint;
  refresh: () => Promise<void>;
  showKey: (key: string) => void;
  studies: Data["studies"];
}) {
  const [name, setName] = useState(e.name),
    [url, setUrl] = useState(e.url),
    [studyIds, setStudies] = useState(e.studyIds),
    [eventTypes, setEvents] = useState(e.eventTypes),
    [enabled, setEnabled] = useState(e.enabled),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const rotation = useRef<string | null>(null);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      className="panel visual-stack"
      aria-label={"Notification destination " + e.name}
    >
      <h4>{e.name}</h4>
      <p>
        {e.enabled ? "Enabled" : "Disabled"} ·{" "}
        {e.verifiedAt ? "Verified receiver" : "Ownership not verified"} ·{" "}
        {e.destinationApproved ? "Origin approved" : "Origin approval required"}
      </p>
      <p>{e.url}</p>
      <p>
        {e.studyIds.length} selected studies ·{" "}
        {e.eventTypes.map((t) => labels[t]).join(", ")}
      </p>
      {e.dropped > 0 && (
        <p role="alert">
          {e.dropped} events could not be retained at capacity. Catch up through
          current API reads; sequence gaps identify missing events.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <details>
        <summary>Edit destination and scope</summary>
        <label>
          Destination name
          <input
            value={name}
            maxLength={80}
            onChange={(event) => {
              setName(event.target.value);
              setReviewed(false);
            }}
          />
        </label>
        <label>
          Receiver HTTPS URL
          <input
            type="url"
            value={url}
            maxLength={1000}
            onChange={(event) => {
              setUrl(event.target.value);
              setEnabled(false);
              setReviewed(false);
            }}
          />
        </label>
        <fieldset>
          <legend>Selected studies</legend>
          {studies.map((s) => (
            <label className="checkbox-label" key={s.id}>
              <input
                type="checkbox"
                checked={studyIds.includes(s.id)}
                onChange={(event) => {
                  setStudies((v) =>
                    event.target.checked
                      ? [...v, s.id]
                      : v.filter((id) => id !== s.id),
                  );
                  setReviewed(false);
                }}
              />
              {s.title}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Event types</legend>
          {notificationTypes.map((type) => (
            <label className="checkbox-label" key={type}>
              <input
                type="checkbox"
                checked={eventTypes.includes(type)}
                onChange={(event) => {
                  setEvents((v) =>
                    event.target.checked
                      ? [...v, type]
                      : v.filter((t) => t !== type),
                  );
                  setReviewed(false);
                }}
              />
              {labels[type]}
            </label>
          ))}
        </fieldset>
      </details>
      <label className="checkbox-label">
        <input
          type="checkbox"
          disabled={busy}
          checked={enabled}
          onChange={(event) => {
            setEnabled(event.target.checked);
            setReviewed(false);
          }}
        />
        Enable future notifications
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          disabled={busy}
          checked={reviewed}
          onChange={(event) => setReviewed(event.target.checked)}
        />
        I reviewed this destination and scope. Saving settings or rotating keys
        cancels its queued deliveries; removal also erases its delivery log.
      </label>
      <div className="button-row">
        <button
          className="button"
          disabled={
            busy ||
            !reviewed ||
            !studyIds.length ||
            !eventTypes.length ||
            (enabled &&
              (!e.verifiedAt || !e.destinationApproved || url !== e.url))
          }
          onClick={() =>
            void run(async () => {
              await api("notifications/" + e.id, "PUT", {
                name,
                url,
                studyIds,
                eventTypes,
                version: e.version,
                enabled,
                reviewed: true,
              });
            })
          }
        >
          Save notification settings
        </button>
        <button
          className="button"
          disabled={
            busy || !reviewed || !e.destinationApproved || url !== e.url
          }
          onClick={() =>
            void run(async () => {
              await api("notifications/" + e.id + "/verify", "POST", {
                version: e.version,
                reviewed: true,
              });
            })
          }
        >
          Verify notification receiver
        </button>
        {e.enabled && (
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api("notifications/" + e.id, "PUT", {
                  ...config(e),
                  version: e.version,
                  enabled: false,
                  reviewed: true,
                });
              })
            }
          >
            Disable notifications immediately
          </button>
        )}
        <button
          className="button"
          disabled={busy || !reviewed}
          onClick={() =>
            void run(async () => {
              rotation.current ||= crypto.randomUUID();
              const r = await api("notifications/" + e.id + "/rotate", "POST", {
                version: e.version,
                requestId: rotation.current,
                reviewed: true,
              });
              showKey(r.signingKey);
            })
          }
        >
          Rotate notification signing key
        </button>
        <button
          className="button danger"
          disabled={busy || !reviewed}
          onClick={() =>
            void run(async () => {
              await api("notifications/" + e.id, "DELETE", {
                version: e.version,
                reviewed: true,
              });
            })
          }
        >
          Remove notification destination
        </button>
      </div>
    </article>
  );
}
