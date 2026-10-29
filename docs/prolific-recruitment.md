# Prolific recruitment connector

Echo Lab now supports reviewed general-audience recruitment plans, unpublished Prolific drafts, separately enabled no-credit tests, guarded paid launch, participant handoff and read-only submission reconciliation. Find it under **Study → Fielding → Prolific recruitment**.

**The connector is unconnected in production and paid launch is disabled by default.** No account, recruitment or payment was created for this build. Provider transport behavior is tested with marked fixtures. Real Prolific account/API compatibility, no-credit access and end-to-end participant/payment behavior still need account-level validation. Human pilot and domain-dependent email remain deferred.

## Prepare a plan

Publish the Echo Lab guide first. Save a recruitment title, participant description, estimated duration, currency, reward, places, total cap, microphone requirement and participant-facing review/withdrawal/technical-problem terms. The panel lets you inspect the exact bound published guide, which can differ from an unpublished editor draft. Saving does not contact Prolific.

Initial scope: one internal Echo Lab workspace bound to one configured researcher/project; up to 20 study bindings; desktop; USD or GBP; 1–100 places; 1–60 minutes; general eligible panel with no demographic filters. The minimum supported reward follows Prolific’s recommended $12/£9 hourly rate. Currency changes do not convert numbers. Guides with in-interview rejecting/screen-out options are unsupported until provider-specific screening compensation is implemented. Ordinary Echo Lab recruitment and manual incentive tracking retain their existing behavior.

Provider places must fit the published guide limit and remaining native capacity at launch. While this Prolific connection accepts new participants, its unused allocation reserves local capacity against ordinary invitation/handoff traffic. One participant can claim only one Prolific place for this binding, even under a different provider session. Spent/deleted claims continue to consume that bounded allocation; replacement recruitment is not automatic here. Holding local admissions releases unused local reservation but does not pause Prolific or cancel compensation obligations.

## Connect an account later

An operator configures these server-side deployment variables; never put a provider token in a guide, participant URL or browser field:

| Variable                                | Purpose                                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `RESEARCH_PROLIFIC_API_KEY`             | Prolific API token.                                                                                      |
| `RESEARCH_PROLIFIC_ECHO_WORKSPACE_ID`   | Exact Echo Lab workspace authorized to use it.                                                           |
| `RESEARCH_PROLIFIC_RESEARCHER_ID`       | Expected account ID from Prolific’s user API.                                                            |
| `RESEARCH_PROLIFIC_PROJECT_ID`          | Expected provider project; no implicit first-project selection.                                          |
| `RESEARCH_PUBLIC_URL`                   | Stable public HTTPS Echo Lab origin.                                                                     |
| `RESEARCH_PROLIFIC_WEBHOOK_SECRET`      | Vendor webhook shared secret, at least 16 characters.                                                    |
| `RESEARCH_PROLIFIC_TEST_ENABLED`        | Defaults false. Enable only after confirming the account’s no-credit test feature and test participants. |
| `RESEARCH_PROLIFIC_PAID_LAUNCH_ENABLED` | Defaults false. Separately enabling it exposes guarded paid launch; it does not itself launch anything.  |

**Verify Prolific account** checks the configured researcher and project through the authenticated API. A different Echo Lab workspace cannot use this connection. Provider writes and quotes recheck identity; rotating credentials invalidates the saved connection fingerprint and requires explicit verification/review. Verification holds admissions and clears the quote. A plan saved before connection must be saved again for the configured project.

The public testing reference documents no-credit testing, while the test-study endpoint requires the feature to be enabled for the workspace and an existing test participant. Prolific uses its regular API host for these tests, not a separate Tremendous-style sandbox. There is no fallback to ordinary paid publication. Account setup, test-participant creation and funding stay in Prolific; this connector does not create accounts, top up a wallet or send participant messages.

Verify intended access to participant URLs and `/api/webhooks/prolific` under the project’s Vercel protection policy before real recruitment. This release does not change that policy or put a bypass secret into participant links.

## Provider drafts and launch

After inspecting the plan and bound guide, an admin can create or update an **unpublished** provider draft. The server constructs the payload: explicit project, URL parameters, one submission per participant, no automatic rejection categories, no audience filters and a completion code with only `MANUALLY_REVIEW`. It binds the draft to the exact published Echo Lab revision and an opaque integration marker. Unknown or externally changed provider settings fail review checks.

Opening Echo Lab fielding or applying an existing API/MCP automation request never publishes Prolific. Open local fielding before a provider launch so incoming participants can enter. A successful test/paid launch activates the matching local handoff only when both sides are ready. A visible mismatch identifies an active provider with paused/closed local fielding. Existing sessions can resume; blocking new local admissions does not instantly stop provider recruitment.

**Launch no-credit Prolific test** calls only `/studies/:id/test-study`, then fetches and validates the returned separate test clone. The original unpublished draft and clone IDs remain distinct. An unavailable test feature fails rather than publishing a paid study. A launched binding remains immutable in this interface; use a separate Echo Lab study/binding for a later paid run.

**Refresh provider quote** reads projected rewards, fees and tax in account minor units. All required components must be present, integral and in the configured currency. The quote lasts five minutes and binds the exact provider draft/settings and connection. Paid launch additionally requires the deployment gate, current admin membership, a fresh plan/quote, enough remaining local capacity, explicit funding/budget confirmation and a second provider cost read. A changed quote or a total above the saved cap sends no publish request.

The cap gates the initial launch quote; it is not a guarantee against all future provider liabilities, fair-pay adjustments, tax changes or dashboard actions. Prolific itself enforces wallet availability. Echo Lab does not automatically fund, increase places/rewards, restart paused studies, replace returns/rejections, approve submissions or send bonuses. Those actions remain in the provider dashboard. Prolific can reopen places on returns/rejections independently; review that behavior and any partial-pay obligations there.

**Pause Prolific recruitment** stops new provider recruitment through the documented pause transition and holds local admissions. It remains available for the bound provider ID even after an external description/guide edit, so stale content does not prevent an admin from requesting a pause. Local hold is immediate and does not send a provider write. After a provider-side resume or an uncertain outcome, reconcile and explicitly enable current admissions again. Already admitted participants can finish and retrieve their saved return destination while new admissions are paused.

## Unknown outcomes and retry

Every provider mutation has a durable request ID, body hash, actor and operation record before dispatch. A completed exact retry returns its original receipt. A new request with an unresolved predecessor is rejected. There is no automatic retry of create, update, test clone, publish or pause writes.

When a response is lost, **Resolve reviewed provider outcome** validates the operator-supplied provider ID against the reviewed payload, project and integration marker. It does not send another mutation and leaves admissions held. Resolving an uncertain test additionally requires confirmation in Prolific that the ID is the generated no-credit clone, not the original draft. If an outcome cannot be established, keep it held and resolve it through Prolific/support. Do not start over with a new ID to evade the journal.

Publishing another Echo Lab revision invalidates the old binding for admissions and launch. Source erasure clears a quote, holds admissions and changes the configuration version. An in-flight external action cannot be undone by deleting local data: a late result is held for reconciliation rather than silently published into current local state.

## Participant handoff

The generated link uses `handoff=prolific` and the documented `PROLIFIC_PID`, `STUDY_ID`, `SESSION_ID` placeholders. The participant client requires one of each, rejects mixed/duplicate/missing provider parameters, and keeps these identifiers out of generic answer attributes. Server admission requires the configured active provider study, current revision, fresh status (24-hour maximum age), local fielding, capacity and normal consent/invitation rules.

Claims are namespaced by Echo Lab workspace/study, provider study and participant ID. Session ID is bound into recovery proof. Exact retries recover the same interview even after new admissions close; changed sessions/secrets cannot recover another person’s interview. Existing Qualtrics/Rally/Decipher namespaces remain separate.

URL identifiers remain self-reported claims. Reconciliation matches the claimed participant and session to authenticated, study-scoped provider submissions; arrival alone does not verify identity or payment. Prolific’s optional signed launch JWT is not implemented in this first connector; use the documented ordinary URL-parameter mode.

A completed interview receives only the saved Prolific manual-review completion destination. Withdrawn/screened-out endings return to the provider homepage without a completed code. No invented timed-out/technical-failure completion code is issued. A return click does not approve compensation. Published screen-out guides are blocked from initial setup; unexpected withdrawal/failure compensation still needs provider review.

## Reconciliation and deadlines

The roster and private CSV keep these separate: local interview state, exclusion from research, matched IDs, provider submission status, provider-reported payment state and review deadline. `APPROVED` is not synthesized into `paid`; the latter is shown only when the provider supplies that payment state. Current source exclusion never sends a payment rejection or cancels an earned obligation.

Prolific documents automatic approval after **21 days awaiting review**. The panel shows the derived deadline and a warning within three days or after it passes. This is an on-screen alert, not a new email service. Provider status is authoritative; Echo Lab’s pending state cannot stop that automatic approval.

Manual refresh and queued/daily refreshes read current provider data and replace a complete bounded snapshot. Pagination is limited to 1,000 submissions; an incomplete/oversized response does not silently replace the roster. New source/connection changes during a read invalidate the commit. There is no in-app approve/reject/bonus/payment endpoint in this milestone.

Signed webhooks require raw-body HMAC-SHA256 verification with the documented timestamp/signature headers, a five-minute freshness window, a bounded body and `X-Event-ID` deduplication. Receipts contain hashes only; raw event/participant/status payloads are not stored or treated as authoritative. They create durable reconciliation wakes for at most 20 bound studies, then dispatch to the existing Vercel Queue. The worker performs only reads, with a lease and up to three attempts per wake. An event arriving during work schedules another generation. Manual refresh and daily maintenance recover pending work; failed wakes can be scheduled anew. Event receipts age out after seven days. Status visibility is not guaranteed instantaneous.

## Source erasure and limits

Deleting/retaining out a response removes its raw Prolific participant/study/session IDs, recovery proof and cached reconciliation rows, clears quotes and holds admissions. A spent claim hash remains to prevent readmission. Subsequent provider reads skip erased claims, so a webhook cannot recreate their raw identifiers in the roster. Other providers and the paused pilot are not modified.

Authored study recruitment settings, provider-study IDs and content-free operation/event receipts remain separate from erased participant research. External provider records, already incurred compensation and downloaded CSVs are not erased/reversed by local deletion. A financial retention contract is still needed before adding in-app compensation writes; current manual-ledger behavior is unchanged.

## Validation and next step

Contract/server checks cover independently calculated fees/deadlines, unpublished/test/paid state transitions with marked provider responses, gates and budget changes, retry/uncertain outcomes, source privacy/late results, signed event receipts, worker wake recovery and local capacity reservation. The browser workflow uses the real handlers/database/native participant flow with a marked external transport: review, unpublished draft, test clone, consent/answer/return, payment/inclusion separation, private CSV and mobile layout. These tests do not prove actual Prolific API/account access.

Hosted verification checks unconfigured/default-disabled behavior and uses a deliberately marked cached-provider fixture only inside a disposable synthetic workspace to exercise native admission, return, private projections and erasure. No real Prolific traffic, funded study, payout, email or model operation is used. See deployment notes for final release evidence.

Next proposed build: **Tremendous reward links for our own invitees, sandbox-only by default**. Prolific account connection and actual no-credit vendor validation can be completed separately when credentials and test access are available. The [integration plan](provider-integration-plan.md) records provider sources and the remaining paid-operation boundaries.
