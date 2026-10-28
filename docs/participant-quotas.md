# Participant quotas: maximum counts by admission tags

Echo Lab's initial quota stage caps participant groups defined by exact participant-tag matches. It shows completed interviews, in-progress reservations and available places in **Study → Fielding → Participant quotas**. Researchers and admins can configure quotas; collaborators can read progress. Existing consent, invitation, survey-handoff and total-study capacity rules still apply.

## Set up a group

1. Add a quota group, name it and set its maximum participant count (1–1,000).
2. Enter one to four tag names/values. All conditions must match exactly, including capitalization. For example, `segment=customer` and `plan=paid` define paid customers. Each group can use a tag only once; up to 20 groups are supported.
3. Choose whether arrivals must match an enabled group. With **Only admit participants matching an enabled group**, missing/unknown tags are rejected. With it off, unmatched participants may enter under the ordinary study limit.
4. Enable quotas and save. At least one group must be enabled. Progress refresh reads the saved configuration; unsaved cap edits show an estimate until saved. A stale save is rejected; refresh before trying again.
5. Set matching tags in individual invitation presets, or append query fields to the ordinary participant link, such as `?segment=customer`. Invitation presets take priority over client-supplied values. URL tags are self-reported, so use invitation-only admission and preset tags for controlled assignments. Quotas do not verify identity or sampling validity.

Groups can overlap. Someone matching several enabled groups must have space in every one and occupies one place in each. Summing group counts can therefore exceed the number of distinct participants. The independent total-study limit still applies even if group capacities are higher.

## Counting and source lifecycle

Counts begin with new native interviews admitted **while quotas are enabled**. Earlier interviews, imports and previews are not assigned retrospectively. Interviews admitted while quotas are disabled also stay unassigned after re-enabling. New groups apply to new arrivals; they do not reclassify an existing sample.

A successful admission saves internal group IDs and the quota configuration version on the native interview. Those assignments remain fixed across quota changes, guide revisions and later research-tag appends. Completed interviews keep their places, including responses excluded from analysis. In-progress interviews reserve places to prevent simultaneous arrivals from exceeding a cap. A stopped, screened-out or deleted interview frees its place; retention expiry uses the same source deletion path. A stopped or screened-out source remains linked for matching-rule edit protection while retained. An abandoned active interview continues to reserve a place until stopped or deleted; no automatic timeout/replacement is claimed.

A used group's matching conditions cannot change and it cannot be removed while any retained native interview references it. Disable that group and add another when the audience definition changes. Names, caps and enabled states remain editable. Lowering a cap below its current count blocks new matching arrivals without removing existing interviews. Disabling quotas or an individual group does not relabel past sources or evict participants. Re-enabling resumes the existing assigned counts.

Assignment checks, source creation and invitation/handoff claims share the same database write transaction. Rejected admissions create no interview and consume no invitation or handoff ID. They return a localized “no available place” message, not a saved screened-out source or a vendor callback. Group names, configured tag values, progress and internal matched group IDs are not disclosed to participants. Normal attributes retain their existing visibility; internal quota assignments/versions are stripped from interview projections.

A proven survey-handoff recovery runs before quota checks, so retrying an existing consented admission does not consume another place and still works when the cap is full. Ordinary saved participant sessions keep working. Quotas cannot be bypassed by supplying internal group IDs in a public request.

## Initial scope and next stage

This release supports **maximum absolute counts by admission tags**. Listen also documents minimum/exact counts, percentages and screener-answer quotas. Screener-answer quotas now have a separate implemented stage; minimum/exact counts now have a disjoint-partition stage, while percentage support is now described in [relative quotas](quota-percentages.md); see [target contract](quota-targets.md). No automatic balancing, paused-study heuristics, rejected-attempt roster, panel recruitment or payments are added. Answering a screener later does not change a frozen tag-group assignment. A separately configured screener group can add its own reservation at the screening boundary; see [screener quotas](screener-quotas.md).

Screener-answer quota groups are now implemented with an explicit boundary and transactional reservations; see [screening rules and limits](screener-quotas.md). Minimum/exact targets are now implemented; see [target contract](quota-targets.md). Percentage quotas are now implemented; see [relative quota rules](quota-percentages.md). Participant branding is implemented; see [logo, colors and snapshots](participant-branding.md). Private concept images are implemented; see [image contract](concept-images.md). Prototype links and tasks are implemented; see [prototype contract](prototype-concepts.md). Private video concepts are implemented; see [video rules](concept-videos.md). Next proposed build for approval: **timed concept presentation (F11)**.

Resend/domain setup, live email, human pilot testing and real survey-provider testing remain deferred. No real participant has been recruited or contacted.

## Internal API

`GET /api/studies/:id/quotas` requires workspace/study access and returns settings, per-group progress and `canManage`. `PUT` requires researcher/admin authority and a strict versioned body:

```json
{
  "version": 0,
  "enabled": true,
  "requireMatch": true,
  "rules": [{
    "id": "7e3e6cdc-0bc1-4655-87ac-3fb37dc733d2",
    "label": "Paid customers",
    "enabled": true,
    "limit": 10,
    "conditions": [{"key": "segment", "value": "customer"}, {"key": "plan", "value": "paid"}]
  }]
}
```

Tag names use ASCII letters followed by letters, digits, hyphens or underscores (maximum 64 characters); configured values are nonempty, trimmed and bounded to 128 characters. Credential, invitation and survey-handoff identifier keys are unavailable for quota matching. Internal source fields `quotaRuleIds` and `quotaVersion` are server-generated; no new public write authority or external API/MCP projection is added. Read progress refresh also applies the existing retention policy.

## Verification

114 automated tests include quota reference counts, all-condition/overlap behavior, schema bounds, role/workspace/version controls, concurrent last-place admission, non-retroactive assignment, frozen matching rules, preview bypass, completion/exclusion/deletion, disable/re-enable, trusted invitation tags and rejection without consuming a link. They also verify stopped/screened-out capacity release and survey-handoff recovery at a full quota. The lifecycle suite runs against the compiled production server. The browser checks reviewed setup, mobile layout, live reservation/completion progress, full-group rejection in a separate session, cap increases, immutable matching controls, stale saves and disabling quotas.

Production verification uses only disposable synthetic accounts/sources; it checks the same admission and source lifecycle boundaries, then removes synthetic settings, sources, invitations, handoff claims and sessions. Existing owners and the paused pilot are preserved.

Source reviewed October 20, 2026: [Listen Labs quota documentation](https://docs.listenlabs.com/setup-to-launch/quotas). Echo Lab's intentionally narrower initial contract, counting policy and limits are described above; no parity claim is made.
