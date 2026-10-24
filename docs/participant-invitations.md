# Participant invitations and fielding

Echo Lab supports manually shared, tracked one-use participant links from **Study → Fielding → Participant invitations**. Existing studies default to general-link admission. A researcher/admin can switch independently to individual invitations only; collaborators can inspect the roster and export but cannot issue, replace, revoke or change admission.

## Workflow

1. Publish a reviewed guide. Enter participant references (prefer codes; one per line, up to 50 per batch), expiry of 1–90 days, an optional available reviewed language and an optional common tag.
2. Generate links and save the private link CSV or copy each link before closing the dialog. Share each link yourself. The roster retains no reusable links; no email is sent. “Marked shared” is your manual record, not proof of delivery or opening.
3. Track ready/shared, in-progress, complete, screened-out, withdrawn, expired, revoked, replaced and deleted-response states. Refresh to retrieve current status. Export the authenticated roster CSV for reconciliation; it omits link tokens.
4. Replace a lost unused link to invalidate the original. Claimed links cannot be replaced. Revoke stops new admission. Neither expiry nor revocation terminates an admitted interview: the participant can resume using the saved session in their original browser.

Each link admits one interview, not a verified identity. A person can hold multiple links or use a general link while that mode is enabled. References are unique within a study (Unicode normalized and case-insensitive); they are team labels, not participant identity verification. A study supports up to 1,000 invitation records including replaced/redacted records until retention cleanup.

Invitations and general links share the published native interview limit. A generated or opened invitation does not reserve a slot. Admission atomically checks fielding, capacity and unused invitation, then creates the interview and claims the link. Paused/full admission does not consume the link. Active/complete interviews reserve slots; screened-out/withdrawn interviews release them. Excluding a completed response does not release its place. No quota, panel callback, payment or automatic reminder is implemented.

## Privacy, retries and recovery

Raw link tokens stay in the browser URL fragment and reach the API through a header/body, never a query parameter. The invitation registry stores only token hashes and a batch fingerprint. Optional [email drafts](participant-email.md) retain the full outgoing message/link encrypted with a separate server key. The browser generates a random batch secret and stable request ID; exact retries regenerate the same scoped links, while a changed payload with the same request ID conflicts. The secret is held only for the pending browser request and never stored by the server. Reloading after losing the result requires replacing unused links.

Preset tags override matching participant-supplied query attributes. Invitation references, binding IDs and attributes are omitted from participant interview responses; the team retains attributes for segmentation. Query parameters do not prove eligibility. Separate hashed local-storage session keys isolate invitations in a shared browser. Changing an invitation fragment reloads the participant page. Browser data loss or switching devices cannot recover a used link; contact the research team for a new invitation. Keep the private link CSV securely: anyone possessing a valid link can use it.

“Erase invitation details” removes that record’s reference/tags and revokes unused admission. It deliberately preserves an existing interview and its collected attributes; the confirmation explains this. Deleting a response in **Responses** also erases its bound invitation reference/tags and response pointer and leaves a used/deleted tombstone, so the old link cannot admit again. Retention uses the workspace service’s request-driven retention period (default 90 days): old invitation details are erased while a source survives, and obsolete records/batches are removed. Private downloaded CSVs and manually shared copies are outside application deletion.

The current Vercel deployment still requires Vercel sign-in. Participant invitations do not bypass deployment protection. This release supports the internal team; unrestricted external recruitment needs a separate access decision.

## Verification

The full automated suite passes **81 tests**; strict TypeScript and the production build pass. Localization and mixed-method browser regressions pass. `npm test` covers token/session scoping, input bounds, normalized reference duplicates, redaction, concurrent one-use admission, retry conflicts, workspace/role access, trusted tags, replacement, revocation/resume, shared capacity, expiry, CSV and full source deletion. `npm run test:invitations` exercises desktop/mobile fielding, link downloads, shared state, fragment navigation, isolated saved sessions, used links and replacements. The HTTP lifecycle also runs against the compiled production server. Hosted synthetic verification uses an isolated disposable workspace and preserves existing owners and the paused pilot. No real participant study or delivery test is claimed.

The initial [incentive eligibility and manual payment ledger](participant-incentives.md) is now implemented. A payout provider and actual money movement remain separate decisions. Email invitations/manual reminders are also implemented, with live sending awaiting provider/sender setup. See [participant email](participant-email.md).
