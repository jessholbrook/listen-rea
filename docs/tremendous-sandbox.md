# Tremendous sandbox reward links

Echo Lab can prepare and test USD reward links for its own invited participants. This release supports **sandbox only**. It accepts only `TEST_` credentials and uses the fixed `https://testflight.tremendous.com/api/v2` origin. There is no production host, production enablement flag, live payout, wallet funding, refund, cancellation, provider email/SMS or automatic reward issuance.

Open **Fielding → Tremendous reward links**. Plans can be saved before connecting an account. Production deployment is initially unconnected; local and hosted tests use explicitly marked provider fixtures. Real Tremendous account/API compatibility and external fulfillment remain unvalidated until a sandbox account is connected.

## Review and order

1. Complete an interview recruited through an Echo Lab invitation. Native open-link interviews, previews/imports, Prolific and other panel/survey handoffs are excluded.
2. Review eligibility in the existing incentive ledger. The incentive must be currently approved, included, complete, USD and have no active manual payment. Its approved amount/terms remain frozen in the ledger.
3. An admin saves a reviewed sandbox plan: one explicit US merchant gift-card product ID, a simulated USD face-value budget in cents and a note. Product currency/country/denomination availability is rechecked with the provider before ordering. The initial recipient is the generic name `Research participant`; no answers, real name, email, phone or invitation reference is transmitted. Whether a connected account accepts this contact-free LINK payload must be validated before use.
4. Refresh approvals, check the review box and explicitly create each sandbox reward. Each order uses simulated `BALANCE` funding and the current approved amount. Only a current workspace admin can verify, order, retry or reconcile. Generic fielding, REST/MCP automation and incentive approval never create a provider order.

The budget reserves **face value**, not a guaranteed total including every provider fee. Unknown, rejected and failed reservations continue to count; maximum 100 orders per study. Reported provider cost/currency is displayed separately after the provider reports it. This is a sandbox test limit, not production financial controls. Saving a changed plan does not alter existing orders or free reservations.

One opaque `external_id` is derived from a namespaced hash of the workspace/study/interview. The provider journal and an unlinked spent hash are committed before the single order mutation. Concurrent/exact requests return that reservation instead of issuing another order. A timeout, conflicting payload, malformed result or uncertain provider error holds the outcome as unknown. Reconcile that exact external reference using provider reads; an unknown outcome cannot be retried or replaced.

Only definitively rejected requests (HTTP 400/401/402/403/422/429) permit an explicit retry of the **same frozen payload and external ID**, with unchanged approval, plan and connection. HTTP 402 is shown as insufficient funds. Once an order exists, failed/canceled/pending provider states do not permit a new order. There is no automatic reissue, refund or compensation decision.

Sandbox orders remain separate from manual payment records. They never mark the real incentive paid. Recording an external payment or changing approval holds a sandbox claim. Actual compensation obligations must still be handled outside this sandbox feature.

## Participant-only links

The participant returns in the original browser, which already holds their interview token. On the completion screen, a sandbox reward panel appears only for own-invitation studies with a saved plan. A token-authorized status check reveals availability, not a redeemable link. Only a current approved source with a provider-confirmed `EXECUTED` order can request a link.

After explicit sandbox/privacy acknowledgment, Echo Lab rechecks the organization, reads the existing order, validates the reward/amount and generates a link for that reward. It rechecks the source and approval after the provider response before disclosure. An overlapping newer reconciliation supersedes an older read. Only a strict sandbox reward URL is accepted. Claim responses are private/no-store, links use no-referrer/noopener, and the URL lives only in the participant page's memory until reload. There is no separate claim token in a URL or email.

The original create-order link is discarded. Redeemable links and returned contact fields are not copied into the database, researcher panel, incentive ledger, CSV, API/MCP results, shared reports or routine logs. Only the participant's authorized claim response contains a link. Claim count records link disclosure, **not delivery to a named human, product redemption or payment**.

Generating another Tremendous link does not invalidate previous links. Holding a claim, changing approval, deleting the response or hiding the page cannot revoke a link already disclosed. Losing the original interview token/browser currently has no alternative claim recovery path.

## Reconciliation and events

Order execution state, reported cost/currency, reward identifier, delivery status and participant link views are separate. `EXECUTED` and `SUCCEEDED` delivery do not establish redemption; exports explicitly show `not_observed` for redemption. Provider reads reconcile the existing external reference. Each refresh handles up to five orders, oldest synchronization first; repeat for larger rosters. Rejected requests with no remote order are skipped. Any unresolved read is reported without issuing a replacement.

Optional `POST /api/webhooks/tremendous` verifies the raw body using the documented `Tremendous-Webhook-Signature: sha256=<hex HMAC-SHA256>`. UUID/digest receipts deduplicate events and reject conflicting reuse. Events are limited to 32 KiB and a seven-day age window (with five minutes of future clock tolerance); daily provider reads recover older notifications. Raw payloads, recipient information and event status assertions are not stored.

Known order/reward events commit content-free study wakes alongside the receipt. The existing Vercel Queue processes read-only reconciliation, with leases, bounded retries and a new generation when another event arrives during processing. Daily maintenance recovers durable wakes and refreshes configured plans; manual reconciliation remains available. Out-of-order notifications cannot set payment/redemption state themselves. A generation fence prevents late earlier reads from replacing a newer provider result. No queue worker can create an order or generate a participant link.

## Setup later

Create a separate [Tremendous sandbox account](https://developers.tremendous.com/docs/sandbox-environment) and configure these server-only variables:

- `RESEARCH_TREMENDOUS_SANDBOX_API_KEY`: sandbox `TEST_` key.
- `RESEARCH_TREMENDOUS_ECHO_WORKSPACE_ID`: exact intended Echo Lab workspace.
- `RESEARCH_TREMENDOUS_SANDBOX_ORGANIZATION_ID`: expected sandbox organization ID. The organization returned by the key is verified before provider actions.
- `RESEARCH_TREMENDOUS_SANDBOX_ENABLED=true`: explicit sandbox enablement; defaults false.
- Optional `RESEARCH_TREMENDOUS_SANDBOX_WEBHOOK_SECRET`: sandbox webhook signing secret, at least 16 characters. Register the Echo Lab endpoint through Tremendous separately; this release does not create a webhook for you.

A binding hash includes the sandbox key, workspace and organization. Rotating the key or changing organizations holds existing orders/claims until their original binding is restored. Credential migration requires a separately reviewed implementation; do not use another account to retry an existing obligation. Only one workspace is connected per deployment.

Tremendous supplies simulated sandbox funds. Some partner-site/email fulfillment steps are unavailable in the sandbox. No Resend account or sending domain is needed. Real production payouts require separate account approval, product/country selection, cost/funding controls, financial retention and treatment of earned compensation; they are not implemented or authorized by this release.

## Erasure and validation boundary

Source erasure deletes the local order, raw interview linkage and claim metadata with the existing incentive ledger. Late in-flight writes/reads cannot restore it. The spent hash persists without a study/interview link, amount, provider reference or recipient information to prevent replay. Provider-side orders and previously disclosed links remain outside application erasure. Downloaded CSVs remain outside deletion too. This local behavior is not a production financial-record retention policy.

Automated checks exercise marked provider behavior, including concurrent exact requests, stable rejected retries, insufficient funds, uncertain outcomes, pending/failed states, current roles/source/approval/binding/budget, link privacy, webhook deduplication, read-only workers, overlapping reads and erasure. Native browser and hosted checks are recorded in the deployment/status documents. They do not establish actual provider interoperability or production payout readiness.

Primary references reviewed October 29, 2026 (America/Los_Angeles): [sandbox](https://developers.tremendous.com/docs/sandbox-environment), [create order and idempotence](https://developers.tremendous.com/reference/create-order), [retrieve order](https://developers.tremendous.com/reference/get-order), [product availability](https://developers.tremendous.com/reference/get-product), [link delivery and secrecy](https://developers.tremendous.com/docs/link-delivery), [raw-body webhook signatures](https://developers.tremendous.com/docs/webhooks-1).
