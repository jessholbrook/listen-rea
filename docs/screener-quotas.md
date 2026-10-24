# Screener-answer quota groups

Echo Lab now supports maximum-count groups defined by answers to published leading single- or multiple-choice questions. Configure them in **Study → Fielding → Participant quotas**, alongside the existing [tag-based groups](participant-quotas.md).

## Set up screening

1. Publish a guide beginning with the screening questions. The supported prefix consists of consecutive single-/multiple-choice questions without question/section branches, carry-forward, tasks or concept blocks. Other question types end the available screening prefix. Existing single-choice eligibility-rejection options still work; rejecting options cannot define a qualifying quota answer.
2. Add a group and select **Match using → Screening answers**. Choose a published question and qualifying answer. Add up to four distinct questions when all answers must match. Multiple-select conditions mean the selected set must contain the configured option; it need not equal the whole set.
3. Set the maximum count and enable the group/quotas. Up to 20 groups may combine tag-based and screener-based groups. A single group uses one source type; mixed tag-and-answer predicates within one group remain outside this stage.
4. If **Only admit participants matching an enabled group** is selected, candidates must match either an admission-tag group or a frozen screener group. When screening groups are present, this requirement is deferred until screening ends for candidates who have not matched a tag group.
5. Refresh progress to see people still screening, completed/active group counts, full-group rejections and total quota screen-outs. The Responses tab shows **Quota group full** or **No quota group matched** for quota-driven screen-outs, with the saved reason in the transcript view.

## Screening boundary and reservations

For each new interview, Echo Lab freezes the enabled screener rules, match requirement and the index of their last referenced question. Every question through that boundary is answered before the quota check. The boundary may be earlier than the end of all available choice questions: it is determined by the enabled groups' actual references. Existing guide eligibility checks can screen someone out sooner.

Tag groups keep their existing admission-time reservation. Screening candidates do **not** reserve screener-group places before reaching the boundary. They do occupy places under the independent total-study limit, so a large number of unfinished screenings can temporarily prevent further arrivals. There is no automatic timeout or deliberate over-recruitment.

The final screening answer, canonical saved option IDs, reservation decision and resulting source status commit in one database write transaction. Multiple matching groups must all have space. Simultaneous candidates competing for the last group place result in one reservation and one saved screen-out. A successful candidate proceeds to the next guide question (or completes if screening was the entire guide). A full group, or an unmet required match, produces a saved `screened_out` source before any later main-interview answer can be accepted.

Retries of the same answer request return its saved result and do not recount or append another answer. Reloading the original participant session preserves the outcome. Completed sources retain places even when excluded from analysis; withdrawal, ordinary eligibility rejection, quota screen-out, source deletion and retention expiry release reservations as appropriate. Screening candidates and already-screened-out sources do not count as occupied screener-group places.

## Frozen definitions and live controls

Matching definitions lock as soon as any retained source has the group in its screening plan, even before qualification. They cannot change source type, question/option references or be removed while referenced. Caps, labels and enabled states remain editable. Add a new group for a different definition. Completed/active assignments remain fixed and are never retrospectively reclassified.

At the boundary, candidates match their frozen definitions and frozen required-match setting, while checking **current caps and current group enabled states**. Disabled groups impose no cap and create no new reservation. Their frozen definition can still satisfy that candidate's original required-match rule. Disabling quotas entirely bypasses the check when the candidate reaches the boundary. Re-enabling later does not re-evaluate a source that already passed or bypassed screening. Groups added after a source began do not affect it.

New admissions validate screener references against the current published guide. Removing/renaming a referenced ID, removing an option, making it an eligibility rejection or inserting an unsupported question before the boundary blocks new admissions until the quota configuration is repaired. Existing sources continue using their frozen guide and screening plan. Publishing alone does not change their matching rules. Keep question/option IDs tied to the same meaning across revisions; changing labels/text while retaining IDs does not create a new group definition or establish comparability.

## Invitations, survey returns and privacy

Screening happens after normal consent/admission. Unlike an admission-time tag-cap rejection, a later screener-quota rejection **retains an interview and consumes its invitation/handoff claim**. The source contains the saved screening answers and explicit screen-out reason. It cannot be resumed as a fresh candidate by reusing the link.

Survey-handoff participants use the existing approved `screened_out` destination, if configured. They choose the normal explicit return button; the quota system does not call vendors or send automatic callbacks. Exact proven handoff recovery still returns the existing source, including its screen-out, after a pause or full cap. The private matching roster reflects that saved status, and source deletion applies existing identifier/proof/route redaction.

The internal screening plan, group IDs and quota version are stripped from researcher/participant interview projections and do not add external API/MCP fields. The quota cause is available to authorized researchers; participants receive the normal localized generic screen-out ending. Existing public guide metadata remains available under its existing contract; this feature does not make later question text secret. Quotas do not establish identity or representative sampling. No real participant has been recruited or contacted.

## Internal API additions

Existing quota endpoints/roles/versioning remain. Rules may include `source:"screener"` with `conditions:[{key:<questionId>,value:<optionId>}]`. Omitting `source`, or setting it to `"tags"`, preserves the tag-based contract. Published question IDs may begin with digits. Invalid references and eligibility-rejecting options are rejected when enabling/configuring screening.

`GET /api/studies/:id/quotas` additionally returns eligible `screeners` with nonrejecting options, total `screening`/`quotaScreenOuts`, and per-group `screening`/`rejected` counts. A per-group candidate count includes pending plans that reference the group, not only people who will eventually match. `linked` includes those retained plans for definition-locking purposes. Limits and existing access rules are unchanged.

## Verification and next stage

119 automated tests include canonical single/multiple matching, conjunctions, supported-prefix validation, nonrejecting choices, immutable snapshots, deferred reservations, simultaneous last-place commits, duplicate answer retries, persisted causes, preview/eligibility behavior, disabling, incompatible new publication, original-guide continuity, no-match rules and private invitation/Decipher handoff returns/recovery/deletion. The screening and original tag-cap HTTP lifecycles also run against the compiled server. Strict TypeScript, production build and desktop/mobile screening browser flows pass; tag-cap, invitation and Decipher browser regressions are checked.

Hosted synthetic verification covers deferred candidates, atomic overlapping caps, retries, private plans/reasons, frozen definitions, existing Decipher screen-out return/recovery, completion/exclusion/deletion, unmatched/eligibility outcomes, disabled checks, publication guards and cleanup. Existing owners and the paused pilot are preserved. Real study/pilot and actual vendor-account testing remain deferred, as do Resend/domain setup and live email.

Minimum/exact targets are now implemented; see [target contract](quota-targets.md). Percentage quotas are now implemented; see [relative quota rules](quota-percentages.md). Participant branding is implemented; see [logo, colors and snapshots](participant-branding.md). Private concept images are implemented; see [image contract](concept-images.md). Prototype links and tasks are implemented; see [prototype contract](prototype-concepts.md). Private video concepts are implemented; see [video rules](concept-videos.md). Next proposed build for approval: **timed concept presentation (F11)**. Minimum/exact targets now have a disjoint-partition stage; see [target contract](quota-targets.md). Percentage quotas are now implemented; see [relative quotas](quota-percentages.md). Automatic balancing remains later work.

Source: [Listen Labs quota documentation](https://docs.listenlabs.com/setup-to-launch/quotas), reviewed October 20, 2026. Echo Lab's reservation timing, conservative total-limit behavior and supported screening prefix are its own documented implementation contract.
