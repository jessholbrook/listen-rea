# Integration reconciliation and catch-up

Echo Lab can help a trusted integration recover after missed or expired notifications. An admin separately enables recovery for a **static API key** in **Team & settings → Integration recovery**. Existing keys and OAuth clients gain no tools or permissions automatically. No provider account, email service or extra deployment secret is required.

Recovery inherits the key’s selected studies and read scopes: `study` requires `studies:read`, `response` requires `responses:read`, and `analysis` requires `analyses:read`. Only published studies, included completed non-preview responses, and reviewed/current/citation-valid analyses are eligible. Private drafts, recordings and participant contact fields remain outside this interface. The current key issuer and recovery authorizer must still be workspace admins.

## Recovery protocol

All paths below start with `/api/v1/reconciliation`. Use the static bearer credential in the Authorization header. JSON bodies are strict, limited to 64 KiB, and query parameters are rejected. Responses are private/no-store. REST and MCP share the existing key limit of 60 requests/minute.

1. `POST /runs` with `{requestId, studyIds, resources, pageSize}`. `requestId` is a new UUID, `studyIds` contains 1–50 unique granted study IDs, `resources` is a unique subset of `study`, `response`, `analysis`, and `pageSize` is 1–100 (default 50). The returned run has an opaque ID, version, position, total, state and expiry. Exact retries with the same UUID reuse that run; different content conflicts.
2. `GET /runs/:id` returns the server’s current page. Each item has resource/study/source IDs, `state` (`available`, `changed`, `unavailable`), a current opaque `etag` or null, and an existing read-API `path` when available. `changed` compares with the initial inventory. Fetch source bodies through those read routes. Apply updates/removals to your own destination **before acknowledging**.
3. `POST /runs/:id/checkpoint` with `{requestId, version, position, pageToken}` from that page. Use a new UUID for each page and retain the exact request for retries. Only the current server position can advance. A page token covers the entire currently eligible inventory, permissions and version. If anything changes after GET, the checkpoint returns 409: re-read the page, reapply it and acknowledge with a new request ID. Concurrent exact retries commit once and return the same historical checkpoint receipt.
4. Continue GET/checkpoint until `complete` or `needs_rescan`. An empty inventory still requires its empty page acknowledgment. New sources or changes to previously confirmed sources require a new run. Even a previously complete run is reported as `needs_rescan` by GET if current sources drift. No snapshot is permanently fresh.
5. `DELETE /runs/:id` with `{version}` discards your own saved progress. Admins can also inspect recent run summaries and explicitly discard a run. Discard never erases a destination’s research copy.

Checkpoint completion records **the client’s confirmation**, not independently verified downstream processing. Exact checkpoint retries return the original acknowledgment, even if sources later change. Read current run/source state before relying on it. Source bodies may also change between GET and fetching their read paths; apply the latest body, and let checkpoint validation force another page read when necessary.

A notification is an at-least-once wake-up hint, not the dataset or a deletion feed. A catch-up inventory contains current sources only: it cannot enumerate every source your integration fetched in the past. Persist your own references and check them as below. Avoid deleting local data solely because an unfinished or failed inventory omitted it.

## Checking references already held by a client

`POST /check` accepts `{items:[{resource,studyId,id}]}` with 1–100 references. Results echo the references with generic `available`/`unavailable` states and current etags. There is no distinction between deletion, exclusion, unpublished content, invalid evidence or another unavailable-source condition. A study outside current key scope is rejected; it is not a deletion assertion. Revoked credentials or insufficient scopes are authorization errors, not evidence that research was erased.

Echo Lab does not persist the submitted references or create a missing-ID ledger. The client must decide how to suppress/remove its local copies under its own retention policy. Server erasure cannot recall content already fetched by a client.

## Bounds, revocation and erasure

- Inventories hold at most **1,000 source references**, never research bodies; narrow studies/resources or use the existing paginated read API plus bulk checks for larger datasets. The server queries source bodies in small batches to compute etags. Etags are opaque SHA-256 fingerprints, not anonymized research or access credentials.
- Each key can have at most five active inventories. An admin sets a rolling 24-hour new-run allowance of 1–50 (default 10). Exact retries do not consume another start. Discarding runs or changing policy does not reset the allowance.
- Runs expire after 24 hours. Runs and creation receipts age out after seven days during maintenance; creation also prunes its workspace. Workspace receipt capacity is 2,000 within that window. Expired/erased runs return 410 while their receipts remain; an unknown ID returns 404. After receipt expiry, a reused UUID can no longer be recognized: **always generate new UUIDs for new operations**.
- Key/read-scope or recovery-policy version changes invalidate existing checkpoints. Disable immediately blocks recovery. Revocation, expiry, lost admin authority and current workspace boundaries are checked on every action, including retries. Scope fingerprints describe these permissions, not external destination state.
- Source erasure deletes entire runs spanning the affected study, including their checkpoint receipts and source IDs. Only content-free creation receipts remain temporarily, preserving replay protection and allowance accounting. A late request cannot reconstruct the erased run. Starting a fresh, newly authorized inventory uses current sources.
- Admin summaries show the saved checkpoint state and at most 200 recent runs. They do not continuously recheck source freshness; clients must GET their run. Availability checks do not store source IDs submitted by clients.

## MCP tools

Separately enabled static keys discover `start_reconciliation`, `get_reconciliation`, `checkpoint_reconciliation` and `check_source_availability`. Start and checkpoint are correctly annotated progress writes; get/check are read-only. Checkpoint accepts an additional `runId`; get takes `{runId}`. Start/check schemas match REST. These tools cannot publish, change fielding, recruit, pay, send notifications or update an external destination. Existing read tools remain the way to fetch source bodies.

## Validation

The focused suite covers opt-in/current roles/scopes, DTO/analysis eligibility, concurrent exact starts/checkpoints, stale page rejection, server-position resume, drift and new-source rescans, stateless missing-ID checks, strict/body/snapshot/active/rolling bounds, expiry, erasure, receipt pruning, admin discard and official MCP discovery/calls. The browser check covers policy acknowledgment reset, progress refresh, discard, immediate disable and mobile overflow. Synthetic sources are labelled; no model or provider calls are needed.

Release validation (October 29, 2026, America/Los_Angeles): production build, standalone TypeScript, formatting, **656/656 automated tests** (zero skipped), all nine focused recovery cases and six compiled-app browser suites pass. The focused suite was additionally rerun with explicit unavailable-page acknowledgments and changes to already confirmed responses. Browser regressions cover notifications, delegated drafts, reviewed automation, API-key management and OAuth alongside recovery.

Six hosted groups on [the immutable release](https://echo-m7vsa6wmp-jessholbrook-gmailcoms-projects.vercel.app) verify default-off/current admin and selected-study boundaries, actual MCP start/checkpoint with REST retry/resume, source reads through the existing API, drift and stale-token rejection, transient missing-ID checks, source erasure/replay prevention, immediate disable/revocation and complete synthetic cleanup. One native typed interview was used. No model, notification receiver, email, recruitment or payout operation was invoked. Hosted analysis eligibility was not independently exercised; exact analysis DTO/citation eligibility is covered locally against the scoped read API. Existing users and the exact paused pilot were preserved. Private recording storage remains at zero files/bytes, and private verification environment/state files were removed.
