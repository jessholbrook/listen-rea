# Signed integration notifications

Echo Lab can notify an owned HTTPS receiver when selected studies, included completed responses or background job states change. **Team & settings → Integration notifications** provides registration, scope/verification, explicit enablement, key rotation, immediate disable and a bounded delivery/retry log. Destinations are disabled by default. Provider accounts, sending domains and Resend are not required.

## Register and enable

An admin registers a name, exact receiver URL, selected studies and event types, confirming ownership and the intended metadata disclosure. A workspace can have five destinations, each selecting up to 50 current workspace studies. The deployment operator must separately approve exact HTTPS origins in `RESEARCH_NOTIFICATION_ALLOWED_ORIGINS`; wildcards are unsupported. No origin is implicitly trusted. New registrations start disabled, and no existing records are replayed automatically.

Registration returns an `eln_…` signing key for copying to the receiver. The UI masks it and clears it when hidden or the settings view closes. It is not an Echo Lab API access key. It is stored only as AES-256-GCM ciphertext with endpoint-ID associated data, using the separate server-only `RESEARCH_NOTIFICATION_ENCRYPTION_KEY` (32 random bytes, base64). Configuration/log reads never return the key or ciphertext. The registration client retains its stable UUID/secret only in memory for an exact retry; after losing that result, use key rotation rather than trying to reveal a stored key.

The receiver must accept a signed `endpoint.verification` POST and return HTTP 2xx with `{"echo_lab_challenge":"<the incoming data.challenge>"}`. This checks receiver behavior; the admin's ownership assertion and the operator's vetted origin list remain required. Verification itself contains a random challenge, not research metadata. A verified receiver still needs explicit enablement before future source changes are captured.

Saving destination/scope/enablement changes cancels pending/failed deliveries from the previous policy version. A URL change clears verification and cannot be enabled until saved, verified and reviewed again. Rotation creates a new key, disables delivery, clears verification and cancels older queued payloads. Immediate disable requires no extra configuration steps. Removing a destination also removes its delivery log and encrypted key; an opaque registration receipt prevents old registration requests recreating it. Neither disable, rotation nor deletion recalls data already disclosed or a request already in flight.

## Payload and signature contract

Every event uses JSON:

```json
{
  "id": "stable-event-uuid",
  "type": "study.changed",
  "occurredAt": "2026-10-29T12:00:00.000Z",
  "sequence": 1,
  "data": {
    "studyId": "study-uuid",
    "id": "study-uuid",
    "version": 2,
    "dataVersion": 0,
    "revisionId": null,
    "fielding": "draft"
  }
}
```

Protocol timestamps are ISO UTC; the interface displays dates in the viewer's local time. Available types are:

| Type | Trigger and fields |
| --- | --- |
| `study.changed` | Creation or version/data-version/publication/fielding metadata change. Includes study ID, version, data version, revision ID and fielding state. Authored text changes without a version change do not create a separate event. |
| `response.changed` | A completed, included, non-preview response becomes available or its version changes. Includes study/response ID, version and `status:"complete"`. Incomplete/excluded/preview responses are not sent. Re-inclusion can create another availability event. |
| `job.changed` | Background job state changes, including creation, retry and terminal states. Includes study/job ID, version, kind and state. Progress within the same state is not an event. Target/file IDs, private errors, leases and provider credentials are omitted. |

Payloads omit titles, guides, questions/answers, participant names/contact information/tags, recording URLs, provider identifiers and API credentials. IDs and activity metadata can still be identifying information; these payloads are not claimed to be anonymous. Treat them as private. Notifications are hints about historical changes, not current authorization or instructions to perform another action. Re-read current data through the separately authorized API as needed; an event does not grant API access.

Headers:

- `Echo-Lab-Event-Id`: the payload's stable UUID.
- `Echo-Lab-Timestamp`: Unix seconds for this attempt.
- `Echo-Lab-Attempt`: lifetime reserved-attempt count, for diagnostics; this header is not independently signed.
- `Echo-Lab-Signature`: `v1=` plus lowercase hexadecimal HMAC-SHA256, using the exact copied signing-key string over `timestamp + "." + rawRequestBody`.

Verify the HMAC against the **raw bytes**, check timestamp freshness (for example, five minutes), compare signatures in constant time, and deduplicate event IDs for at least the seven-day delivery window. Check the body ID matches the event-ID header. Never treat the attempt counter or a received notification as authorization to publish, pay, send email or expose source data. Acknowledge only after durably accepting the event. The shared signing key authenticates a shared-secret protocol, not non-repudiation.

## Durability, retries and limits

Source writes and outbox insertion commit in the same database transaction. Rolled-back source writes create no delivery. A content-free workspace wake is also durable, then published **after commit** to the existing Vercel Queue; dispatch failure cannot roll back saved research. Queue messages contain workspace/generation IDs, not URLs, secrets or payloads. Daily maintenance and an explicit **Dispatch pending notifications** control recover dispatch. Local/self-hosted delayed retries need the existing `npm run worker` process; immediate request-lifetime dispatch alone is insufficient.

Workers claim a workspace lease and up to five due deliveries, then re-read the current endpoint, authorizing admin, policy version, study and source availability immediately before sending. Separate attempt tokens fence late results. Generation/lease ownership prevents an older batch overwriting a newer recovery lease. Endpoint changes, departed authorizers and source removal stop future attempts. A receiver may still receive a request that was already sent when revocation/erasure committed.

HTTP 2xx marks acknowledgment only; it does not prove the receiver completed a downstream workflow. Network failures, HTTP 408/429 and 5xx retry automatically, with delays of 10 seconds, one minute, five minutes and 15 minutes. Other HTTP failures, including redirects, become failed deliveries. Redirects are never followed. Each automatic cycle has five attempts. An admin can explicitly retry a current failed event up to three more cycles, keeping its event ID/body; delivered or canceled events cannot be replayed through this control. Events expire after seven days. HTTP requests time out after ten seconds, with a separate five-second DNS check bound.

Delivery is **at least once**. A timeout/process failure can mean the receiver accepted a request before Echo Lab recorded it. Exact body and event ID remain stable across retries; timestamps/signatures change. Delivery order is not guaranteed, and rapid changes may arrive after newer states. The per-destination sequence increases across captured changes, including overflow; gaps can also follow cancellation, scope changes or loss. It is not an ordered stream or proof of an intact historical dataset.

Each destination retains at most 1,000 deliveries for seven days. At capacity, source writes still succeed; new notifications are not retained, a visible dropped-event count/time increases, and sequence gaps remain detectable. This explicit bounded overflow is not a guarantee of complete event history. Catch up through current API reads. The UI lists the latest 200 deliveries, with attempts, state, last HTTP status and next attempt time; it does not expose raw payloads/response bodies/signing material. There is no unlimited event archive or historical replay. Registration receipts are capped at 200 per workspace and contain no destination URL, key or study/participant IDs.

## Destination controls and erasure

Only current workspace admins manage destinations and retries. The current admin who most recently authorized a destination must remain an admin before delivery. Selected studies are checked in the workspace at registration/update and again during delivery. HTTPS without URL credentials, queries, fragments or nonstandard ports is required; IP-literal/local/internal destinations are rejected. Every attempt requires an exact operator-approved origin, resolves DNS and rejects nonpublic answers, uses normal TLS verification and preserves the configured session proxy/CA trust. No caller-selected authentication headers are supported.

The origin list is an operator trust boundary: approve only controlled, vetted public receivers. DNS checking is not a promise of transport-level address pinning through an HTTP proxy, and this is not a self-service arbitrary-URL fetch endpoint. If a deployment needs stronger egress guarantees, enforce them in its network policy as well. Receiver responses are bounded for verification and discarded for ordinary delivery; raw network errors and bodies are not copied into logs.

Response exclusion/withdrawal removes its response notifications. Source erasure conservatively removes this study's delivery records, including payloads/history, through the existing source/reporting cleanup. Job delivery rechecks the current job/target and any linked interview. Late workers cannot recreate deleted records or mark canceled events delivered. Outgoing deletion events are intentionally unsupported; receivers must handle current-source denial and reconcile through the read API. Deleting local records cannot erase downloaded copies at another service. Destination configuration and its selected-study list are authored settings with their own lifecycle, separate from response erasure.

## Setup and validation

Production needs the separate encryption key and exact comma-separated HTTPS origin list. Keep the encryption key private and stable; changing it without migration makes older ciphertext unavailable. Rotating each endpoint under the current master key creates a replacement signing key and requires verification/enablement again. Development can generate a local private key in the ignored data directory; hosted production never falls back to local key storage. Defaults do not enable any destination.

Native verification uses a temporary owned HTTPS receiver that verifies HMAC/freshness and deliberately returns 503 on the first attempt, then 204. This exercises actual Vercel Queue retry and outbound HTTPS. Temporary destination settings, receiver resources and origin permission are removed afterward. Local contract/browser checks use a marked sender to exercise failures, concurrency, erasure and UI; they do not replace the separate hosted transport check. Release evidence and remaining limits are recorded in the deployment/status documents.

Provider accounts, real recruitment/compensation, the human pilot and domain-dependent email remain deferred. Proposed next approval: integration reconciliation and catch-up tooling for gaps/unavailable sources, rather than assuming notifications form a complete event archive.
