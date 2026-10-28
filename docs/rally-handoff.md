# Rally custom-test handoff

Echo Lab now supports Rally's custom unmoderated-test workflow: preserve `pid` and `studyID`, review separate return destinations, recover duplicate/lost admissions and export a private matching roster. No Rally API key, new domain, email provider or model call is required to configure Echo Lab. A Rally account/study is still needed to test the vendor side.

This implements a custom tool connection. Listen's native Rally partnership, automatic redirects and automatic status synchronization do not transfer to Echo Lab. This release does not call Rally APIs, send webhooks, update participant status server-to-server or send incentives. Any status update caused by following Rally's actual return link must be verified in the account before recruitment.

## Set up

1. In **Study → Fielding → Rally study handoff**, enter the expected opaque Rally `studyID` and enable the connection. New admissions must match that ID exactly. Only workspace admins can change these settings; authorized workspace members can review/export matching rows.
2. If Rally provides a return URL, paste it into the appropriate ending: completed, screened out or stopped. Leave an ending blank to finish in Echo Lab. Use Rally's completion link only for completed interviews; use distinct vendor-approved links for other endings if available. Review the destinations and identifier sharing, then save.
3. In Rally, create an **Unmoderated Test** and use its **custom test link** option. Paste the generated Echo Lab test URL:

   ```text
   https://echo-lab-psi.vercel.app/s/<echo-study-id>?handoff=rally
   ```

   Verify that the launched link supplies the actual `pid` and `studyID`, for example:

   ```text
   https://echo-lab-psi.vercel.app/s/<echo-study-id>?handoff=rally&pid=<actual-participant-id>&studyID=<actual-rally-study-id>
   ```

   These angle-bracket examples are explanatory, not Rally merge-field syntax. No undocumented Rally variable syntax is generated. Keep the `handoff=rally` marker: it makes a launch without identifiers fail clearly instead of creating an unmatched ordinary interview. Unmarked links with a valid `pid`/`studyID` pair also work. Do not select **Listen Labs** as Echo Lab's integration.
4. Publish and open fielding with the existing controls. Participants give the normal Echo Lab consent. Capacity, pauses, screeners, recording consent, language rules and invitation-only admission all still apply. In invitation-only mode, each participant also needs their individual Echo Lab invitation fragment; the shared Rally link grants no admission by itself.
5. At a configured terminal ending, participants see the destination origin and choose **Continue to Rally**. Each click rechecks the live enabled state. Echo Lab navigates only to the saved URL, filling supported placeholders; it never trusts an incoming redirect/return URL.
6. Review **Refresh Rally handoff status** or download **Export Rally handoff CSV** to match `pid` **and** `studyID` to Echo Lab source IDs, revision, status, exclusion, language, configuration version and dates. These are Echo Lab source statuses, not fetched Rally statuses.

Both identifiers are required, case-sensitive opaque values of 1–128 ASCII letters, digits, underscores or hyphens. Names, email addresses, unresolved placeholders, duplicate ID parameters, a missing pair or mixed Qualtrics/Rally IDs are rejected. IDs remain self-reported URL values rather than verified identities.

## Return URL templates

Copy the return URL format supplied for the Rally test. Echo Lab supports `{pid}` and `{studyID}` placeholders in the **path or query values**, including URI-encoded placeholders. The origin must remain fixed. For example, this is a synthetic format, not a claim about Rally's production endpoint:

```text
https://rally-return.example.test/studies/{studyID}/complete?participant={pid}
```

Echo Lab fills the placeholders from the admitted source's identifiers and preserves other saved query fields. It does **not** append `ResponseID`, `echo_status`, `pid`, `studyID` or any invented Rally status fields. Configure the exact vendor-required parameter names in the URL template instead. Static return links also work. A fixed `studyID` query value must match the configured expected ID; a fixed `pid` query value is rejected to avoid sharing one participant's return link with everyone.

URLs require HTTPS and a domain host, at most 2,048 saved characters, no userinfo, fragment, localhost/IP destination, credential query parameters, placeholder host/query keys or unsupported placeholders. Browser-carried completion URLs can be copied or forged; they are not signed eligibility/payment receipts. The server does not fetch saved URLs. If a Rally return link requires a contract outside these limits, leave the destination blank and review that contract separately rather than weakening the validator.

## Isolation, recovery and deletion

Rally uses independent per-study settings, enable/disable controls, roster and CSV. Qualtrics settings, `ResponseID` URLs, legacy claim hashes, admission tokens and CSV columns remain compatible. Provider namespaces prevent a Rally `pid` colliding with an identical Qualtrics ResponseID. Rally duplicate detection and browser sessions use the **Echo Lab study + Rally studyID + pid** pair, so a person can participate separately in another Rally study.

Admissions atomically save a claim with the provider, identifiers and reviewed destination snapshot. New settings apply to new admissions; an earlier source keeps its approved URLs and Rally study binding. Changing the expected Rally studyID does not relabel old sources or send them to the new study's destination. Disabling Rally blocks new Rally admissions and subsequent destination reads/clicks without disabling Qualtrics.

The existing random admission-secret and hashed-only proof mechanism supports exact retries, including a lost admission response, an already-used invitation, a later pause and settings changes. The original request must match, and another secret cannot recover the interview. The browser saves a consented pending request before submission and retries it before checking public invitation/fielding state. A proven retry can recover an existing source even when new admissions are disabled; it cannot create another source. Clearing browser storage loses recovery proof/session access.

Rally identifiers are kept in the private claim, not generic participant tags, participant interview projections or API/MCP answer projections. Participant free text can still contain volunteered identifiers; this is not anonymization. The existing participant no-referrer policy applies. Deleting or retaining out a source clears **both** raw identifiers, recovery hashes/fingerprint, interview reference and saved destinations. A provider-scoped spent-ID hash remains to prevent re-admitting that deleted pair. Deleted CSV rows have blank identifiers. The shared handoff cap is 1,000 retained claim/tombstone records per Echo Lab study across providers; normal interview capacity is also shared.

## Internal endpoints and compatibility

| Endpoint | Behavior |
| --- | --- |
| `GET /api/studies/:id/rally-handoff` | Workspace/study-authorized settings and matching roster with `canManage`. |
| `PUT /api/studies/:id/rally-handoff` | Admin-only versioned settings: `enabled`, `externalStudyId`, `routes`, `reviewed`. Enabling requires review and an expected Rally study ID. |
| `GET /api/studies/:id/rally-handoff/export` | Private CSV beginning with `pid,studyID`. |
| `POST /api/public/:id` | Existing consent/admission contract with `surveyHandoff:{provider:"rally",responseId:<pid>,externalStudyId:<studyID>,secret:<random-64-hex>}`. |
| `GET /api/interviews/:id/survey-handoff` | That source's participant token; no destination for active, preview, deleted, disabled or unconfigured endings. Rally destinations add `provider:"rally"` for the localized return button. |

Omitting the admission provider still means Qualtrics. The original `/survey-handoff` management/export routes remain Qualtrics-only. No new external API/MCP write grants, identity authority or recruitment provider access is added. Existing Vercel protection remains required for participants and every hosted request; this build does not change that policy.

## Validation and next item

The suite contains 104 automated tests. New checks cover provider/study-pair admission, mismatched study IDs, admin/cross-workspace controls, independent settings and CSVs, same-ID Qualtrics coexistence, concurrent retries, old-source recovery across study-setting changes, exact return template expansion, frozen URLs, terminal outcomes, preview/disable boundaries, exclusion and deletion of both identifiers. The browser covers reviewed setup, the missing-ID marker, malformed/mixed/mismatched IDs, lost-response and invitation-only recovery after a pause, pair-scoped resume, explicit returns, disable rechecks, matching CSV, deletion and desktop/mobile layout. Production compilation, strict TypeScript, compiled-server lifecycle and the Qualtrics browser regression are checked. Hosted checks pass for reviewed/versioned settings, study binding, concurrent pair admission/recovery, private projections, hashed-only proof, return expansion, matching CSV, Qualtrics coexistence, cross-study isolation, frozen destinations, terminal outcomes, previews, disabling, exclusion and deletion/tombstones. Synthetic workspace/identifier/proof/route/source/session records and temporary production credentials were removed; existing owners and the paused pilot were preserved.

No actual Rally participant or vendor account was connected. Before recruiting, verify launched identifier names/values, the actual return URL format and the resulting Rally participant status in a real test study. Automatic partner synchronization is not claimed. Resend/domain setup and live email remain deferred.

Documentation reviewed October 20, 2026: [Listen's Rally guide](https://docs.listenlabs.com/integrating-with-rally), which names `pid` and `studyID` for its partnership, and [Rally's Create an Unmoderated Test Study guide](https://help.rallyuxr.com/articles/6353607009-create-an-unmoderated-test-study), whose Test section documents custom tools and a participant-clicked return link with tool-dependent compatibility.

Next proposed build for approval: **Decipher/Forsta handoff support (F42 follow-on)**, after reviewing its documented ID/routing contract. Native iOS capture, SaaS billing and enterprise programs remain separately scoped.
