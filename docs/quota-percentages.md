# Percentage-based quotas

Participant quotas now accept **Participant count** or **Percentage** units for Maximum, Minimum and Exact rules. Percentages use the **published total study limit**, not the draft limit or the number of responses collected so far. The existing count unit remains the default for older settings.

## Set up

1. Publish the intended study limit and screening questions, if used.
2. In **Study → Fielding → Participant quotas**, choose a group's **Quota type**, then **Quota unit → Percentage**.
3. Enter a value above 0 and at most 100, with at most two decimal places. Each group shows its effective whole-person count, such as **50% of published limit 6 = 3 participants**. Unsaved changes are estimates until saved.
4. Review the effective counts and save. Existing permissions, stale-write checks, group-definition locks, matching rules and invitation precedence still apply. Count and percentage units can be mixed.
5. Refresh progress after publishing a different study limit. Percentage counts scale automatically; quota configuration versions do not change merely because a new guide revision was published. Draft-only edits have no effect.

## Rounding contract

| Quota type | Effective count | Example with study limit 5 |
| --- | --- | --- |
| Maximum | Round down, preserving “at most” | 50% → cap 2 |
| Minimum | Round up, preserving “at least” | 50% → target 3 |
| Exact | Require a whole-person result | 50% → invalid; 40% → exact 2 |

The server converts percentages to integer basis points and calculates using integer products, avoiding floating-point threshold drift. Maximums can resolve to zero in small studies; the rule then rejects all matching arrivals rather than silently disabling itself. Exact percentages are not rounded or distributed by a largest-remainder scheme. Use a compatible study limit, another percentage, or an explicit count when the exact result is fractional.

Independent rounding can make a configuration impossible. Two minimums of 50% in a three-person study each require two people and are rejected. Minimum/exact configurations retain the existing disjoint-partition restriction: one condition per enabled group, one tag or one single-choice screener, distinct values. Maximum-only groups retain their flexible overlap/multiple-choice behavior.

## Publication and review states

A publication recalculates percentage amounts without rewriting source assignments or converting stored percentages into counts. Count-unit rules retain their numbers. The quota read returns current settings, counts, source occupancy and published basis from one transaction.

- A larger limit can reopen a maximum group or increase protected minimum/exact places.
- A smaller limit can close a maximum group below its existing occupancy. Already qualified sources are retained and may finish; new matching candidates are blocked.
- A fractional exact result, an exact count below existing reservations, or infeasible rounded lower bounds puts saved quotas into a visible **needs review** state. New admissions stop under the normal total-limit or quota-target review check.
- If an enabled percentage configuration is invalid when a pending screener reaches its boundary, the answer commit returns a retryable review error. The final answer, source version and quota decision remain uncommitted. Earlier saved answers remain intact. Correcting the percentage/unit or publishing a compatible limit lets the same request commit once; retries do not duplicate the answer.
- Already passed/bypassed screenings and ordinary qualified tag sources are not re-evaluated. Their remaining guide questions may be answered while settings are being repaired.

Researchers can correct counts/percentages or disable rules without changing a used group's frozen matching definition. New admissions still validate current guide references. Old source plans retain their original question/option IDs while using current live amounts. No automatic fielding closure, participant eviction, arbitrary exact rounding or balance optimization is introduced.

## Counts, recovery and privacy

Tag quotas still check in the admission transaction; rejected admissions consume no invitation or handoff ID. Screener quotas still classify at their frozen boundary and save full-group or target-protection screen-outs when the configuration is valid. Invalid settings request review rather than falsely recording a quota rejection. Pending screeners remain unclassified for lower-bound feasibility while occupying the physical study limit.

Active reservations and completed interviews remain distinct. Completed sources excluded from analysis retain their places; withdrawal, screen-out, deletion and retention expiry release places under the existing counting policy. The percentage denominator remains the published study limit. Targets cannot guarantee respondents, completions, identity or representative sampling.

Proven survey-handoff recovery runs before the new admission checks, including during a review state. Existing approved screened-out return destinations, explicit return buttons, matching rosters and deletion redaction continue unchanged. Participants receive existing localized generic quota/review messages; detailed percentages and configuration errors remain workspace-authorized. External API/MCP projections and authority are unchanged. No provider/domain/environment-variable setup is required.

## Internal API additions

A rule can include `unit:"count"|"percent"`. Omission means count. The existing `limit` field stores the raw count or percentage; counts must be whole numbers from 1–1,000, percentages must be above 0 through 100 with two-decimal precision.

Private quota GET adds `basisRevisionId`, `configurationError` and per-group `resolvedCount`/`resolutionError`. An unrepresentable exact percentage has a null resolved count and an explicit error; progress remains readable so settings can be repaired. `targetCapacity.feasible` is false when the configuration is invalid. Effective caps, deficits, completed-target progress and admission decisions all use current published capacity, not the raw percentage number.

## Verification and next item

131 automated tests include rational rounding checks across small study sizes and decimal percentages, exact divisibility, precision bounds, zero-effective maximums, mixed units, rounded infeasibility, simultaneous admissions, draft/published differences, limit shrinkage, source continuity, review states and identical pending-answer recovery. All twelve count/tag/screener/percentage lifecycle tests pass against the compiled production server. Strict TypeScript, production compilation, desktop/mobile percentage controls, repair behavior and earlier quota/invitation/Decipher browser regressions pass.

Hosted synthetic checks cover percentage flooring and zero caps, live rescaling, qualified-source completion, exclusion/deletion/recovery, rounded minimum protection, count-unit compatibility, invalid exact publication, uncommitted pending answers, corrected retry and saved screen-out returns/redaction. Synthetic settings/plans/sources/sessions and temporary production credentials are removed; existing owners and the paused pilot are preserved. Real human/vendor study tests and Resend/domain/live-email setup remain deferred.

Prototype links and tasks are implemented; see [prototype contract](prototype-concepts.md). Private video concepts are implemented; see [video rules](concept-videos.md). Next proposed build for approval: **timed concept presentation (F11)**. [Private concept images](concept-images.md) are implemented. [Participant branding](participant-branding.md) is implemented.

Source: [Listen Labs quota documentation](https://docs.listenlabs.com/setup-to-launch/quotas), reviewed October 20, 2026. Echo Lab's explicit rounding and review behavior are its own implementation contract; vendor-identical rounding is not claimed.
