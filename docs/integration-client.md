# Integration client and disposable recovery example

This repository includes a Node 24 TypeScript client and a runnable local destination for the existing Echo Lab read/recovery APIs. The client has no publication, fielding, recruitment, payout or email methods. It is source code to reuse in a server integration, not a published npm package or a newly hosted service. The web application’s deployed APIs remain unchanged.

## Try it without an account

```sh
npm ci
npm run build
npm run integration:demo
```

The demo starts the compiled application on loopback port 3456 with an isolated temporary database, creates labelled synthetic sources and a temporary private destination, interrupts/resumes a paged sync, accepts a marked local signed notification twice, and removes a response after it becomes unavailable. The workspace and local destination are removed on exit. It does not connect your real workspace or invoke AI, providers, email or an external receiver. This local notification is a fixture, not proof of an external queue delivery; native notification transport was verified in the earlier notifications milestone.

## Use a disposable destination with your own workspace

An admin must first create a static API key for selected studies/read scopes and separately enable **Integration recovery** for it. Only request resources covered by that key. The inventory limit is 1,000 sources; the sample destination also holds at most 1,000 copies and a 64 MiB state file. Choose a narrow selection for this example.

Set `ECHO_LAB_URL` to your HTTPS application origin, `ECHO_LAB_API_KEY` privately to the static bearer key, `ECHO_LAB_STUDY_IDS` to comma-separated selected UUIDs, and `ECHO_LAB_RESOURCES` to a comma-separated subset of `study,response,analysis` (default all three). Keep credentials in your process environment or an ignored private environment file, not command arguments, browser code or chat. The CLI permits explicit HTTP loopback origins for development; remote origins require HTTPS. Proxy/NO_PROXY and CA settings are preserved for HTTPS requests.

```sh
# Parent directory must exist. Initialization requires a NEW directory.
mkdir -p .data
npm run integration:sync -- --directory .data/disposable-sync --initialize
# Repeat to resume or run another current-source catch-up.
npm run integration:sync -- --directory .data/disposable-sync
```

**This copies private research into a local JSON file.** The private directory is mode 0700 and `destination.json` is mode 0600. It holds original authorized read-API bodies, opaque fingerprints, saved requests/checkpoints and minimal receiver receipts. The static key and signing key are not stored. Keep this directory out of source control, sharing and backups that are not authorized for research. The `.data` location above is ignored by this repository. This disposable example has no independent automatic deletion policy for research copies: delete the entire dedicated directory when finished, after stopping its processes. Do not use it as your production archive.

A destination binds to its API origin, key hash and exact selected studies/resources/page size. Reusing it with a different key or selection stops; create a fresh destination and explicitly handle the old copies under your retention policy. There is no automatic migration of private copies across permission changes.

## How recovery works

1. Before an inventory, check references already held locally in batches of at most 100. Only a successful scoped response explicitly marking a reference unavailable removes it. A denied request does not authorize removal. Available changed sources are fetched through fixed read-API paths and their JSON fingerprint must match the inventory/check result.
2. Save a new inventory UUID before sending the start request. Network retries reuse its exact parsed body. The client retries transport failures and HTTP 408/429/500/502/503/504 up to three total attempts (configurable 1–5), honoring Retry-After up to 60 seconds per wait. Longer delays fail visibly for a later retry. Requests time out after 15 seconds and successful response bodies are limited to 8 MiB. HTTP redirects are rejected; response-supplied paths are never followed with a credential.
3. Read the server’s current page. Atomically save its local updates/removals and the **exact checkpoint intent before acknowledging**. A lost acknowledgment can be replayed after reopening the destination. Failed local writes never advance the server position. Server 409 at checkpoint causes a page re-read; 410 retires the saved run and requests a fresh scan. Source fingerprint races stop that attempt without acknowledging the page.
4. A normal invocation processes at most 20 page iterations, then returns `paused` if another invocation is needed. `complete` records checkpoint confirmation at that time. `needs_rescan`, `needs_restart` and `source_changed` require another invocation; source changes, new data and authority changes can invalidate earlier progress at any time.

HTTP 401/403 and run/policy conflicts stop visibly. Copies are not silently erased on an authorization error. If the same key/selection is still authorized but a saved run cannot continue after a policy change, use `--restart` with `integration:sync` to forget only saved run/start/checkpoint metadata; existing copies still go through fresh availability checks. The old remote run expires or can be discarded by an admin. `--restart` does not bypass changed permissions or reset server allowances.

The file adapter uses fsync/atomic rename and one exclusive `writer.lock` for the whole operation. Competing writers/receivers fail visibly rather than overwrite each other. A process crash can leave a lock; remove only that dedicated lock after confirming the owning process has stopped. Private `.tmp` files left by a crash can be discarded with the destination. This is a single-machine example, not a distributed/transactional production sink. A real destination should implement atomic data/progress commits and its own retention/erasure policy.

## Signed wake-ups

Set `ECHO_LAB_SIGNING_KEY` privately to the destination’s copied `eln_…` signing key, then run:

```sh
npm run integration:receive -- --directory .data/disposable-sync
```

The example listens **only** on `127.0.0.1:8787/notifications` (override the unprivileged port with `ECHO_LAB_RECEIVER_PORT` if needed). It verifies the raw-body HMAC in constant time, checks attempt timestamps (no more than five minutes old or 30 seconds ahead), stable body/header event identity and bounded event shape/size. Verification challenges use the actual sequence-free server format and echo the signed challenge. Ordinary accepted events are wake-up hints; their content never becomes a source body, a credential or a command.

An accepted event durably records only hashes of its identity/body, its receipt time and a wake counter before HTTP 204. Exact duplicates return 204 without another wake; a reused identity with changed content returns 409. Up to 1,000 receipts remain for seven days; full capacity returns 503, and a disk/lock failure never reports successful acceptance. Out-of-order sequences still trigger a wake. Events outside the configured study selection are ignored with 204. Signing-key rotation is supplied by restarting the receiver with the new private environment value.

Run `integration:sync` periodically and after accepted notifications. The receiver does **not** start synchronization or external actions inside its HTTP handler. A writer holding the destination lock can cause the receiver to return 503; sender retries and scheduled catch-up cover this bounded example. Sequence gaps and absent deletion events are handled by current inventories plus checks of locally held IDs, not by assuming a complete event history. A notification never grants read access. Completion cannot verify or recall copies in another service.

Connecting the loopback receiver to production requires a separately operated public HTTPS gateway, an exact operator-approved origin, registration/challenge verification and explicit enablement in Echo Lab. This milestone creates no public receiver or enabled destination and does not change the production origin list. No additional account is needed to run the local demo.

## Reuse the client

Import `EchoLabClient` from `integrations/echo-lab-client.ts`. It exposes typed `start`, `view`, `checkpoint`, `check` and fingerprint-checked `source` methods, a redacted `EchoLabError` carrying status/retry delay, and an injectable fetch transport for an existing host. The source client depends on the repository’s Zod/Undici dependencies and shared protocol schemas; copy those dependencies/schemas with it or keep the source in this repository. Do not import it into browser components or supply a transport that follows redirects or leaks authorization headers.

The destination adapter and sync loop are in `examples/integration-recovery`. Custom callers must hold their adapter’s exclusive writer lock. Store errors, ambiguous network outcomes, body limits and authorization failures require explicit recovery; they are not deletion assertions. Research text remains untrusted data, not instructions to execute.

## Validation — October 29, 2026 (America/Los_Angeles)

Production build, standalone TypeScript and formatting pass. The compiled-app regression suite passes **669/669 tests**, zero skipped. A final eight-case client/receiver contract rerun adds an actual loopback HTTP CLI-receiver check, covering the real sequence-free challenge, event deduplication and oversized request rejection. Together with six real-API sync cases, there are fourteen focused client/receiver/recovery cases. The account-free demo passes after the final receiver changes. No browser flow or hosted application code changed.

Six hosted groups exercise the standalone client against the existing production release `dpl_7KcpRkdJXBSEzTEoRg9YEoyux4H9`: actual proxy-aware HTTPS and default-off recovery; durable copies and checkpoint intent; a deliberately lost real checkpoint response followed by reopen/exact retry; a marked in-process signed wake-up/duplicate; genuine response erasure removing its local copy; and permission loss without treating denial as deletion. Synthetic workspace/source/session cleanup preserves existing users and the exact paused pilot. The temporary destination and private verification environment/state files are removed; model/provider/email usage is zero. The signed wake-up is a local fixture, not a newly deployed external receiver. Production notification origins and destinations are unchanged.
