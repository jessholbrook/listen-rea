# Decipher (Forsta) handoff

Echo Lab supports a survey → interview → survey journey using Decipher's standard `rid` participant key. Researchers review return addresses; participants explicitly choose **Continue to Decipher** after an interview ending. A private roster/CSV matches IDs to Echo Lab responses. No Decipher API key, new domain, email provider or model call is needed. A Decipher survey/account is needed to verify vendor-side resumption.

## Setup

1. In **Study → Fielding → Decipher (Forsta) handoff**, enable the connection and enter the approved HTTPS survey address for completed interviews. Omit `rid`: Echo Lab appends the admitted ID. Saved static query fields are preserved. Leave screened-out and stopped destinations blank unless your survey supports an appropriate separate route. An admin must review the addresses and ID sharing before saving.
2. In the Decipher Survey Editor, add a **Redirect Logic Node** at the intended interview point. Use the generated participant URL:

   ```text
   https://echo-lab-psi.vercel.app/s/<echo-study-id>?handoff=forsta
   ```

   Set **Participant ID Query Parameter** to `rid` and **Participant ID Value** to `$uuid`. Verify that Decipher expands the value before launching Echo Lab. The actual URL should have `&rid=<opaque-expanded-id>`; angle-bracket examples are explanatory. The marker makes a missing ID fail clearly. Unmarked links containing a valid `rid` also work.
3. Publish the Echo Lab study and open fielding. Normal consent, language, screeners, capacity and fielding rules apply. Invitation-only studies also require each participant's private Echo Lab invitation fragment; the shared redirect grants no admission by itself.
4. Participants see the approved destination origin and choose **Continue to Decipher**. Each click rechecks the connection's enabled state. There is no automatic redirect, server-side vendor status update or payment.
5. Use **Refresh Decipher handoff status** or **Export Decipher handoff CSV** to match `rid` to interview ID, status, exclusion, revision, language, destination version and dates. These are Echo Lab statuses, not fetched Decipher statuses.

Before recruiting, test the complete journey in your Decipher account: correct expanded ID, correct survey resumption point, appropriate handling of all endings and removal/exclusion of test data. Vercel access protection remains required.

## Contract and limits

The initial connection supports the documented default key `rid`, with a case-sensitive opaque value of 1–128 ASCII letters, digits, underscores or hyphens. It rejects contact details, unexpanded `$uuid`, duplicate IDs, missing marked IDs and mixed Qualtrics/Rally/Decipher identifiers. Custom ID query keys are not supported. IDs are self-reported URL values, not authenticated identities.

Return addresses require HTTPS/domain hosts, at most 2,048 characters, no credentials, fragment, local/IP destination, reserved credential fields or merge fields. Saved `rid` query keys are rejected, including case variants, so a fixed person's ID cannot be shared with other participants. Echo Lab appends exactly `rid` from the admitted claim; it adds no `echo_status`, ResponseID or invented vendor fields. Arbitrary incoming parameters, including incoming redirect URLs, are **not forwarded**. Only static fields in the reviewed saved address survive. This is deliberately narrower than Listen's documented “Keep existing URL parameters” switch. Studies requiring dynamic extra return values or custom ID keys need a separate reviewed extension.

A return address is never fetched by the server. Browser-carried IDs and URLs are not signed eligibility or payment receipts. Survey resumption depends on the configured Decipher survey; synthetic checks cannot establish that behavior.

## Isolation, recovery and deletion

Settings, enable/disable controls and matching CSV are independent from Qualtrics and Rally. Forsta claims and browser sessions are scoped by Echo Lab study + provider + rid. Use a separate Echo Lab study for a different Decipher survey if IDs may overlap. Legacy Qualtrics hashes/tokens and Rally study-pair behavior remain compatible. Omitting the admission provider still means Qualtrics.

An admission atomically saves the claim, private ID and reviewed destination snapshot. New settings affect new admissions. Existing sources retain their approved snapshot. Disabling blocks new Decipher admissions and all later destination requests/clicks; previously downloaded links/exports cannot be recalled. Existing fielding capacity and the 1,000 claim/tombstone cap per Echo Lab study remain shared across providers.

Exact retry recovery uses the existing browser-secret/hashed-proof mechanism. A consented pending request is saved before submission and retried before public availability checks, allowing recovery after a lost response, used invitation, pause or disabled connection. The original body and secret must match; clearing browser storage loses proof/session access. Recovery returns the existing source and never creates another.

`rid` is removed from general research tags on handoff admission. The raw ID lives in the private claim/roster rather than participant projections or API/MCP answer projections. Participant free text can still contain volunteered identifiers. The existing participant `no-referrer` policy applies. Source deletion or retention expiry clears rid, interview reference, recovery proof/fingerprint and destinations. A provider-scoped spent-ID hash remains to prevent re-admitting the deleted response. Deleted CSV rows have blank IDs.

## Internal endpoints

| Endpoint | Behavior |
| --- | --- |
| `GET /api/studies/:id/forsta-handoff` | Authorized workspace/study settings, roster and `canManage`. |
| `PUT /api/studies/:id/forsta-handoff` | Admin-only strict versioned settings: `version`, `enabled`, `routes`, `reviewed`. |
| `GET /api/studies/:id/forsta-handoff/export` | Private CSV beginning with `rid,interview_id`. |
| `POST /api/public/:id` | Existing admission with `surveyHandoff:{provider:"forsta",responseId:<rid>,secret:<random-64-hex>}`. No `externalStudyId`. |
| `GET /api/interviews/:id/survey-handoff` | Source participant token; terminal approved destination with `provider:"forsta"`, or null for active, preview, disabled or blank endings. |

No external API/MCP write authority is added. Resend/domain setup and live email remain deferred.

## Validation

108 automated tests cover shared behavior and Decipher-specific reviewed URL validation, namespace coexistence, atomic retries, invitation boundaries, private projections, frozen return addresses, all terminal outcomes, disabling, exclusion and deletion/tombstones. Strict TypeScript, production compilation and the compiled-server Decipher/Qualtrics/Rally lifecycle suites pass. Decipher desktop/mobile browser checks cover reviewed settings, malformed/mixed IDs, missing marked IDs, consent, lost-response and invitation-only recovery after a pause, per-ID sessions, explicit return, disable rechecks, matching export and deletion. Qualtrics/Rally browser regressions are also run.

Production synthetic verification checks settings/versioning, atomic recovery, proof secrecy, exact return rid, private matching CSV, Qualtrics coexistence, frozen destinations, terminal outcomes, previews, disabling and source deletion. Synthetic data/sessions and temporary credentials are removed, preserving existing owners and the paused pilot. Actual vendor-account testing remains deferred; no real participant was contacted.

Documentation reviewed October 20, 2026: [Listen's Decipher (Forsta) guide](https://docs.listenlabs.com/integrating-with-forsta), which documents Redirect Logic Node, the usual `rid`/`$uuid` fields and returning to the survey with preserved IDs. Echo Lab's narrower contract and explicit participant return are described above.

Maximum-count admission-tag quotas are now implemented; see [counting rules](participant-quotas.md). Screener-answer groups are also implemented; see [screening contract](screener-quotas.md). Minimum/exact targets are now implemented; see [target contract](quota-targets.md). Percentage quotas are now implemented; see [relative quota rules](quota-percentages.md). Participant branding is implemented; see [logo, colors and snapshots](participant-branding.md). Private concept images are implemented; see [image contract](concept-images.md). Prototype links and tasks are implemented; see [prototype contract](prototype-concepts.md). Private video concepts are implemented; see [video rules](concept-videos.md). Next proposed build for approval: **timed concept presentation (F11)**. Panel partnerships, payouts, native iOS, billing and enterprise operations retain their separate scopes.
