# Incentive eligibility and manual payment tracking

**Study → Fielding → Participant incentives** provides an internal review and reconciliation ledger. Echo Lab does not send money, deliver gift cards, verify identity, calculate tax or connect to a payout provider. Participant-facing promises must be communicated separately by the research team; the internal terms form is not shown to participants.

## Review terms and eligibility

A researcher/admin can enable reviews and set an amount, currency and written review terms. Supported currencies are USD, EUR, GBP, CAD and AUD, each stored as integer minor units with two decimal places. There is no currency conversion. Amounts are bounded to 1–10,000,000 minor units. Terms have independent optimistic versions; stale saves and approval of a version the reviewer has not seen are rejected.

The roster includes native participant responses, from general or individual invitation links. Imported interviews and previews are omitted. A completed, included response is a review candidate; active, withdrawn, screened-out and excluded responses are ineligible for approval. Completion alone never approves an incentive. Collaborators can read/export the ledger but cannot change terms or make ledger decisions.

Each approval freezes the current amount, currency, description and terms version. Subsequent edits or disabling reviews do not change approved amounts or prevent reconciliation of an existing approval. A reason is required for every decision. Declining is reversible through a new eligibility review. Excluding a source holds an existing unpaid approval; payment recording is blocked until the source is eligible again. The ledger does not detect the same person in multiple interviews. Review duplicates, consent obligations and any promised compensation yourself. The initial rule deliberately provides no automatic eligibility exceptions or payments; a screen-out/withdrawal compensation policy requires separate scope.

## Recording an external payment

1. Review the original response and explicitly approve the incentive.
2. Send the payment using your separate approved process.
3. Select **Record payment**, enter its unique reference, method and actual date, add a reconciliation reason, and confirm that payment was sent outside Echo Lab.

The server uses the approved amount/currency, checks current source eligibility again and records who entered the payment and when. Do not enter bank/card numbers, gift-card redemption codes or participant contact details. Use an opaque transaction reference, not a redeemable credential. Historical dates use noon UTC; today's date records the current UTC time. Future dates are rejected (with a one-minute clock tolerance).

Transactions serialize the source check, version check, payment-reference claim and ledger update. Exact request retries are harmless; a request ID reused with changed content conflicts. Different requests with a stale version also conflict. Payment references are unique across the workspace, normalized for Unicode/case and trimmed, including voided records and deleted sources. Browser retries keep their original request ID and timestamp. A reload loses that pending request context: refresh the ledger before taking another action. Each source supports up to 100 audit events.

**Void payment record** corrects the ledger only: it does not reverse a transfer or refund money. Its reason, actor, timestamp and original payment remain in history. A replacement requires reapproval under the then-current terms and a new payment reference. A paid source excluded later remains in recorded-paid totals and displays its current eligibility issue; exclusion never implies a refund. Totals show eligible approved/unpaid amounts and active recorded payments separately by currency; voided amounts are omitted.

## Evidence, export and deletion

The ledger links to Responses and uses retained invitation references when available, otherwise a short response ID. History preserves decision reasons, reviewers, terms snapshots, payment details and voids. The authenticated CSV includes response state, eligibility issues, ledger status, minor-unit amounts, currency, payment history and review events. Exports describe manual records, not verified payment-provider settlement.

Deleting a response, including request-driven retention (default 90 days), deletes its incentive record, reasons, raw payment references and request receipts inside the source deletion transaction. They then disappear from totals and export. Application deletion does not reverse external payments or erase downloaded CSVs. A workspace-scoped hash tombstone remains for each used payment reference to prevent reuse: it contains no reference text, response/study pointer, participant label or review reason. This deduplication marker is retained independently of source retention. If financial record preservation is required, agree on an external retention process before real payouts.

## Validation

The full suite passes **83 automated tests**. Strict TypeScript, the production build, the compiled-server incentive lifecycle and incentive/invitation desktop/mobile browser checks pass. Automated coverage checks native eligibility and minor-unit bounds, terms/version conflicts, role/workspace isolation, frozen approvals, exclusion holds, exact concurrent retries, unique references (including after void/deletion), currency-separated totals, explicit voids, future-date rejection, export and source erasure. The same HTTP lifecycle runs against the compiled production server. Browser coverage checks terms editing, review confirmation, frozen amounts after a currency change, payment confirmation, history/export, correction and mobile layout. Invitation regression also caught and fixed a transient double-dialog focus trap during link replacement. Hosted checks use a disposable synthetic workspace, clean up its records and preserve existing owners and the paused pilot. No actual payment or real participant study is part of these checks.

Email invitations/manual reminders are now implemented; see [email configuration and limits](participant-email.md). Live sending awaits a verified Resend sender/key. After that checkpoint, next proposed build is a read-only external API with scoped API keys.
