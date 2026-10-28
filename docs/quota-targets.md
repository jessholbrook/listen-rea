# Minimum and exact count quotas

Echo Lab adds **Minimum**, **Maximum** and **Exact** quota types to **Study → Fielding → Participant quotas**. Targets are absolute participant counts, based on the current published study limit. Existing maximum-only groups remain compatible.

- **Minimum:** protect enough remaining study places for at least the configured count from this group. There is no upper cap for the group.
- **Maximum:** stop new matching participants when the count is reached; this is the previous behavior.
- **Exact:** combine a minimum with a maximum at the same count.

These controls preserve capacity; they cannot provide respondents, guarantee completion or establish representative sampling. Reservations and completed interviews are shown separately.

## Supported group definitions

When any minimum or exact target is enabled, **all enabled groups must form one disjoint partition**: one condition per group, the same source, the same tag/question key and distinct values. Use either a single participant tag or a single **single-choice** screening question. Maximum groups in the same configuration must use that partition too. Disable overlapping or mixed groups before enabling lower bounds.

Multiple-select, multi-condition and mixed tag/screener partitions are unsupported for minimum/exact targets. They remain available for maximum-only configurations. This restriction makes the feasibility calculation well defined: one participant can fill at most one enabled target group.

Publish a guide before enabling lower bounds. Each target is 1–1,000; the sum of enabled minimum/exact counts must fit the published study limit. Existing retained native interviews also consume capacity. The server rejects a target configuration when there are too few remaining places to meet its deficits, even if the targets alone would fit an empty study. Previews and imported sources do not consume quota capacity.

## Set up

1. Publish the intended study limit and screening questions, if used.
2. Add distinct groups using the same tag or one leading single-choice question.
3. Select each group's **Quota type** and count. A maximum retains its **Maximum participants** field; minimum/exact use **Target participants**.
4. Choose whether ungrouped participants may qualify, enable quotas and save. Permission and stale-version checks are unchanged: researchers/admins configure; collaborators can view progress.
5. Refresh progress to see places protected for remaining targets, active reservations and additional completed interviews needed. Raising a minimum is subject to feasibility checks. An exact target cannot be set below its current reserved count; reducing a maximum still has its prior behavior of blocking arrivals without evicting existing sources.

Turning a used group from maximum to minimum/exact is allowed if its unchanged definition and the whole configuration are valid. Changing the definition/source of a used group remains forbidden. Labels, type, counts and enabled states remain versioned live controls.

## Admission and classification

For a candidate, Echo Lab calculates each enabled lower-bound group's remaining deficit after tentatively counting the candidate. The sum must fit the study places left after that admission. Otherwise the candidate is refused to preserve those places. Exact/maximum caps still apply independently.

For example, a three-person study with a minimum of two customers can admit one outsider. A second outsider is rejected until the two customer places are filled or the configuration changes. A minimum of two customers does not cap customers at two: more may enter when there is capacity after protecting other groups. An exact target of two also rejects a third matching participant.

**Tag groups:** matching and target protection happen in the normal admission transaction. A rejected admission creates no source and consumes no invitation or handoff claim. Trusted invitation tags still override URL tags. URL tags remain self-reported.

**Screener groups:** candidates first enter the frozen screening flow. Pending screening candidates occupy the physical total-study limit but remain unclassified for target feasibility. They do not fill a lower bound until they qualify. At the boundary, their saved single-choice answer, assignment and target-protection decision commit atomically. Two outsider candidates competing for the last unprotected place produce one qualification and one saved screen-out. The screen-out cause is **Places protected for quota targets** in the Responses tab, distinct from **Quota group full** and **No quota group matched**.

An existing source is excluded from the tentative occupancy calculation before its qualification is counted, avoiding a double charge. Exact answer retries return the saved outcome. Multiple-choice screening is not permitted for active lower-bound partitions.

## Counts and changes

Completed and active reservations count toward group occupancy, including completed sources excluded from analysis. An active reservation is not evidence that a completed target has been met. Withdrawal, eligibility/quota screen-out, deletion and retention expiry release occupied places. Freed capacity may become protected again when a minimum/exact group falls below its target.

Targets apply to frozen existing group assignments and future assignments; prior unassigned responses do not retroactively fill a new target. Old unassigned native sources still consume overall capacity, including interviews admitted while quotas were disabled. Enabling/re-enabling lower bounds therefore requires a fresh feasibility check. If a configuration is no longer feasible, lower the targets, increase the published study limit or make the appropriate source corrections before enabling it.

Targets remain fixed numbers when the published study limit changes. A larger limit can free unprotected space; a smaller limit can make targets invalid. New admissions then stop under the existing total-limit check or a quota-target review error. Draft-only limit edits do not change admission. Existing qualified sources are not evicted. Existing pending screenings use live target/cap checks against current published capacity; already passed/bypassed sources are not re-evaluated.

Matching definitions and the required-match setting remain frozen in screener plans. A newly enabled live minimum/exact budget can constrain an older pending candidate's qualification, but does not retrospectively award that candidate a newly added group. Configure targets before recruiting. Existing guide-reference guards still stop incompatible new admissions, while older sources retain their guide and matching plan.

Disabling quotas or a group suspends its live constraints. Re-enabling does not reclassify sources that passed while disabled. Disabling all lower-bound groups restores the flexible maximum-only grouping contract. No automatic recruitment, timeout, fielding closure, sampling validity claim or payment is added.

## Invitations, returns and privacy

Minimum protection at tag admission preserves unused invitations and handoff IDs on rejection. A later screener rejection has a saved interview and consumes its existing invitation/claim, just like other screen-outs. Approved screened-out destinations, explicit participant return controls, recovery proof, private matching rosters and deletion redaction retain their existing behavior.

Participants receive the existing localized admission-unavailable or generic screen-out ending. Internal target/group details and the new quota cause are not exposed in participant interview projections. Authorized researchers can see the cause and progress. There is no new external API/MCP write authority or projected answer field.

## Internal API

Quota rules accept optional `kind:"maximum"|"minimum"|"exact"`. Omitting it preserves `maximum`. The existing `limit` field contains the selected type's absolute count. Existing source and condition fields are unchanged.

Private quota GET adds `totalLimit`, `targetCapacity:{settled,remaining,needed,feasible,deficits}` and per-group `needed`, `completeNeeded`, `targetMet` and `protected`. A minimum has `full:false`; exact/maximum use their cap. For a minimum, legacy `remaining` describes the gap to its configured number, not an upper allowance. `needed` uses reservations, while `completeNeeded` uses completed sources. `protected` counts retained screening rejections attributed to an unmet lower bound; full-group `rejected` counts remain separate. Source reason `quota_minimum` is stripped from participant projections like other quota causes.

## Validation and next item

125 automated tests pass, including an independent exhaustive enumeration of small categorical samples that compares each candidate decision with all feasible remaining completions. Integration checks cover exact-cap races, target protection, live published limits, above-minimum admission, impossible edits, active/completed counts, exclusions, withdrawal/deletion, invitation preservation, trusted tags, handoff recovery, disabled targets and concurrent screener protection. All nine tag/screener/target lifecycle tests also pass against the compiled server. Strict TypeScript, production build, desktop/mobile target browser and earlier quota/invitation/Decipher browser regressions pass.

Hosted verification uses disposable synthetic workspaces and checks tag protection, exact caps, published-capacity changes, minimum overflow, target progress, source lifecycle and handoff recovery; it also checks simultaneous screening protection, private causes, saved returns/retries, live exact changes and deletion. Temporary production credentials, plans, settings, sources and sessions are removed; existing owners and the paused pilot are preserved. Human study/vendor testing and Resend/domain/live-email setup remain deferred.

Percentage quotas are now implemented; see [rounding and publication rules](quota-percentages.md). Participant branding is implemented; see [logo, colors and snapshots](participant-branding.md). Private concept images are implemented; see [image contract](concept-images.md). Prototype links and tasks are implemented; see [prototype contract](prototype-concepts.md). Private video concepts are implemented; see [video rules](concept-videos.md). Next proposed build for approval: **timed concept presentation (F11)**.

Source: [Listen Labs quota documentation](https://docs.listenlabs.com/setup-to-launch/quotas), reviewed October 20, 2026. Echo Lab's disjoint-partition restriction and reservation-based feasibility policy are documented here; broader overlap/minimum behavior is not claimed.
