# Qualtrics survey handoff

The first F42 integration matches a Qualtrics response to an Echo Lab interview by `ResponseID`. It adds reviewed study settings, duplicate-safe admission, an authenticated matching roster/CSV and optional participant-chosen completion destinations. No Qualtrics API key, domain, Resend account or model call is needed for configuration. This is a redirect integration; it does not read/write Qualtrics surveys, synchronize answers or certify that a participant completed a vendor survey.

## Set up

1. In **Study → Fielding → Qualtrics survey handoff**, an admin enables the connection. Optionally save a separate HTTPS destination for completed, screened-out and stopped interviews. Leave a destination blank to end in Echo Lab. Review the addresses and identifier sharing, then save. Settings use optimistic versions; a stale save conflicts rather than overwriting another admin's work.
2. Copy the generated Qualtrics redirect template. In Qualtrics Survey Builder, select **End of Survey → Redirect to URL** and paste it:

   ```text
   https://echo-lab-psi.vercel.app/s/<study-id>?ResponseID=${e://Field/ResponseID}
   ```

   Keep the piped expression unchanged; Qualtrics substitutes its response identifier. Add a supported `language` query parameter if needed. An unexpanded, empty or repeated ResponseID is rejected by the participant page. Existing fielding state, capacity, recording consent and invitation-only admission remain in force. For invitation-only recruitment, add that participant's private `#invite=…` fragment to the template; the shared URL alone grants no admission.
3. Publish the guide and deliberately open fielding using the existing controls. Participants see the usual study information and consent before admission. A normal link without ResponseID continues to use normal admission. A ResponseID link requires an enabled connection for a new admission.
4. If a destination was configured for the participant's ending, Echo Lab displays its origin and a **Continue to survey** button. It does not navigate automatically. Each click rechecks the saved destination and live enabled state. Only the configured URL's existing query fields plus `ResponseID` and `echo_status` are sent. No transcript, admission token, internal interview ID, invitation fragment or arbitrary incoming return URL is forwarded.
5. Open the matching roster or **Export handoff CSV**. Join the `ResponseID` column with the Qualtrics export. Status, exclusion, immutable revision, language, destination configuration version and dates come from the stored Echo Lab source. Workspace members with study access can read/export this roster; only admins can configure destinations.

A destination may be a second Qualtrics survey or another approved HTTPS page. Qualtrics' original End of Survey redirect ends that original survey: this integration does not reopen its completed response. The receiving survey/page must be configured separately to use incoming identifiers if needed. Destination query status values are ordinary browser values and can be forged; they are not a signed completion receipt or proof of payment eligibility. No payouts or participant messages are sent.

## Identity, retries and lifecycle

ResponseIDs are case-sensitive opaque identifiers of 1–128 ASCII letters, digits, underscores or hyphens. Use Qualtrics' generated IDs rather than contact details. They remain self-reported URL values, not verified identities. A participant can use a different ID; deduplication is per ID, not proof of a unique person.

Admission atomically claims one ID per study. The browser generates a random 32-byte admission secret and saves it with the consented request. The server stores a hash of that secret and an immutable request fingerprint. A retry with the same secret and original body recovers the same interview/token, including when an invitation has already been claimed or fielding/capacity later changes. Changed inputs or another secret cannot recover the response. Competing requests cannot create two interviews for the same ID. Different IDs use different browser session keys, so one participant's survey link does not resume another ID's interview.

The complete pending admission body is saved locally before submission; a reload retries it before checking an already-used invitation. A successful admission saves the regular participant session and clears that pending body. Clearing browser storage loses both recovery proof and the regular session. Contact the research team in that case. No raw secret is placed in the participant URL or stored on the server.

Each admitted interview freezes its reviewed destination URLs and configuration version. Later edits apply to new admissions. Disabling the connection blocks new handoff admissions and subsequent destination reads, including click-time rechecks. Already admitted participants retain normal interview access, and a proven admission retry can recover an existing interview while disabled. Existing downloaded links/exports cannot be recalled. Re-enabling uses the original approved snapshots for those interviews. Blank destinations, active interviews, previews and ordinary admissions never receive a handoff destination.

ResponseID is held in a dedicated private handoff record, outside generic response tags, participant interview projections and API/MCP answer projections. Participant free text can still contain volunteered identifiers; this is not anonymization. The participant page uses `Referrer-Policy: no-referrer`. Admission secrets and participant tokens are kept in the existing browser storage model; use the intended browser/device and secure the workspace.

Deleting or retaining out an interview clears its raw ResponseID, recovery hashes/fingerprint, interview reference and saved destinations. A spent-ID hash remains as a content-free tombstone to prevent deleted IDs being admitted again. Deleted rows remain in the matching CSV with blank IDs and `response_deleted` status. The limit is 1,000 retained handoff records per study, including tombstones. Use a new study/wave when a new round should admit the same external IDs. CSV exports escape spreadsheet formula prefixes. Existing retention runs on requests; this release adds no scheduler.

## Internal contract

| Route | Authority and behavior |
| --- | --- |
| `GET /api/studies/:id/survey-handoff` | Workspace session and study access; settings, safe roster, recruitment mode and `canManage`. |
| `PUT /api/studies/:id/survey-handoff` | Admin session; `version`, `enabled`, `routes:{complete,screened_out,withdrawn}`, `reviewed`. Enabling requires review. |
| `GET /api/studies/:id/survey-handoff/export` | Workspace session and study access; private CSV with server source statuses. |
| `POST /api/public/:id` | Existing consent/admission contract plus optional `surveyHandoff:{responseId,secret}`; no callback URL accepted from the participant. |
| `GET /api/interviews/:id/survey-handoff` | That interview's participant token; `{destination:null}` or a derived saved `{url,origin}` for its terminal status. |

Destination URLs require HTTPS, a domain host, no userinfo/fragment, no localhost/IP destination, and no existing `ResponseID`, `echo_status` or known credential parameters. Each is limited to 2,048 characters. The server never fetches destinations, and unknown participant query/body fields cannot select a return URL. No CORS grant, new public API/MCP write scopes, vendor webhook, verified identity, panel procurement or incentive eligibility authority is added.

## Verification and limits

All 104 automated tests pass. The handoff checks cover template/ID/destination rules, admin/cross-workspace controls, stale settings, concurrent duplicate admission and exact recovery, private projections, unchanged invitation and preview boundaries, terminal outcomes, frozen destination versions, disable/recovery, matching exports, exclusion and source deletion/tombstones. Strict TypeScript, production compilation and compiled-server handoff lifecycle are checked. Browser checks cover reviewed settings/template, invalid IDs, consent, lost-admission-response recovery (including invitation-only recruitment after fielding is paused), per-ID resume, explicit returns, click-time disabling, CSV, source deletion and desktop/mobile layout. Hosted checks pass for setup/review/version controls, hashed-only recovery proof, duplicate recovery, private projections, frozen destinations, matching CSV, all three endings, preview/disable boundaries, exclusion and deletion/tombstones. Synthetic workspace/source/identifier/destination/session records and temporary production credential/state files were removed; existing owners and the paused pilot were preserved.

No actual Qualtrics account or survey was connected, and no real participant was recruited. A real vendor survey end-to-end check remains pending before recruiting, including incoming IDs, language, invitation fragments if used, and how the receiving destination records query fields. Vercel deployment protection remains enabled and must also permit the intended participant access. This release does not change that policy or configure a vendor account.

Documentation reviewed October 20, 2026: [Listen's Qualtrics redirect/ResponseID guide](https://docs.listenlabs.com/integrating-with-qualtrics) and [Qualtrics End of Survey element](https://www.qualtrics.com/support/survey-platform/survey-module/survey-flow/standard-elements/end-of-survey-element/). The optional Echo Lab return destinations, duplicate recovery and roster are our implementation choices; they are not claims about Listen's private internals.

[Rally custom-test handoff](rally-handoff.md) is now implemented with independent settings and pid/studyID matching. Next proposed build for approval: **Decipher/Forsta handoff support**. Native iOS recording, SaaS billing and enterprise programs remain separately scoped. Resend/domain setup and live email remain deferred.
