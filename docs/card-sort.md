# Closed card sort

October 19, 2026 · P5 initial implementation

In **Study design**, add a **Closed card sort** question. Enter a neutral prompt, 3–30 distinct cards and 2–10 researcher-defined groups. Cards and groups have stable IDs; editing labels preserves those IDs. Choose whether to randomize card/group order, allow explicit uncertainty, and ask for a written explanation. Save and publish a revision before opening fielding.

The [public Listen Labs announcement](https://listenlabs.com/whatsnew/introducing-card-sort) describes adding cards/groups to a discussion guide, collecting placements and reasoning, and supporting desktop/mobile. Echo Lab implements accessible selection controls for closed sorts and now [open/hybrid sorts with participant-created categories](advanced-research-methods.md). Drag-and-drop, automated clustering and an inferred taxonomy remain later work.

## Participant flow and draft recovery

Each card receives exactly one real group or, when enabled, **Not sure / doesn’t fit**. Every card needs an explicit placement before confirmation. Groups can remain empty; there is no category-capacity constraint. The participant can revise placements before confirming.

Card/group order is randomized once according to the published settings, saved server-side and preserved on reload. **Save sort draft** stores the current partial board without creating an answer turn or including it in aggregate results. Saving a draft replaces its prior placements, including removal or reassignment. Draft saves and final answers use the existing interview token, version and request-ID protocol. Duplicate requests preserve the saved result; stale edits must reload. The UI identifies saved drafts. Edits after the last save are not automatically persisted; use Save sort draft or Continue before leaving.

**Continue** confirms the full sort. The server validates known card/group IDs, unique card assignments, completeness and allowed uncertainty, then constructs canonical answer text and records the assignment array on one source turn. Client-supplied answer text cannot replace that mapping. Confirmed sorts cannot be changed through the draft endpoint. If enabled, a second step asks one fixed written explanation about grouping and difficult placements; participants may type “skip”. Existing qualitative coding/analysis can use this exact source text. Adaptive AI debriefing is not implemented in this stage.

The participant sees only the current question’s cards/groups and their own saved placements; other card-sort configurations and internal state are removed from participant payloads. Existing interviews retain published labels, IDs and ordering after draft changes. Concept repeats have separate state and result scopes. English, Spanish and French controls are built in; prompts, card labels and group labels use reviewed guide translations.

## Inclusion and denominators

The **Card sort** study tab reports each published revision, question and concept separately. Exact participant-attribute filters produce segment-specific results.

- **Included:** complete, native, nonpreview, nonexcluded interviews whose sort and optional reason are finished and structurally valid.
- **Incomplete:** an exposed sort in an unfinished interview, including unconfirmed drafts, a pending reason, or an unfinished later interview question. Drafts and incomplete interviews do not contribute to aggregates.
- **Not asked:** the interview did not reach this question, including routed-away questions.
- **Invalid:** unsupported state versions or malformed stored assignments. These do not enter summaries.

Excluded/withdrawn, preview and external-import interviews are omitted. Uncertainty is a valid explicit response and is not equivalent to a missing card.

## Assignment and co-sort tables

The card-to-group table reports `count / included respondents` and the corresponding percentage for every card/group. An explicit uncertain column retains uncertain responses in that card’s denominator. Real group counts plus uncertain count equal the included denominator for each card. With no included respondents, percentages are missing rather than zero.

The co-sorting matrix reports how often two cards share a **real** group. Its pair-specific denominator contains only included people who placed both cards in real groups. If either card is uncertain, that person does not enter that pair’s denominator. Two uncertain responses do not establish that the cards belong together. If no one assigned both cards, the pair percentage is missing. Diagonal cells describe the card’s own certain placements.

These are descriptive associations under the supplied categories. They do not establish a correct navigation structure, task success, population representativeness, an emergent taxonomy or an optimal cluster solution. Group labels and the decision to allow uncertainty affect the observations. Small segment denominators require researcher interpretation.

Selecting an assignment cell filters the source outcomes to included people with that placement. Selecting a co-sort cell shows people who grouped the pair together. Source inspection opens the original confirmed sort/reason turns. A saved but unconfirmed draft has no answer-turn evidence.

## CSV and source lifecycle

Three authenticated CSV exports retain study, revision, question and concept scope:

- **Summary:** card/group IDs and labels, counts, included denominator, uncertainty and percentages, missing/invalid counts and segment metadata.
- **Assignments:** one row per saved placement, response status, confirmed flag, source turn IDs and written reason. Unconfirmed drafts and incomplete but confirmed sorts are labeled; they remain excluded from the summary. Not-asked interviews have no placement rows.
- **Pairs:** card IDs, same-real-group count, both-assigned denominator and percentage, plus segment metadata.

The existing spreadsheet-formula escaping applies. Source exclusions change current eligibility; deletion and retention remove assignments and draft/reason state with the interview. There is no separately persisted aggregate copy. Previously downloaded files cannot be recalled by deleting a source.

## Validation

The independent three-person reference has placements for cards A/B/C of `[team,team,research]`, `[team,research,uncertain]`, and `[uncertain,uncertain,research]`. The card table has counts `[2,0,1]`, `[1,1,1]`, `[0,2,1]` for team/research/uncertain with denominator 3. A/B are together for 1 of 2 people who assigned both to real groups, so co-sorting is 50%, not 2 of 3. All-uncertain and empty samples produce missing co-sort percentages, not false agreement or zero-filled data.

Domain/API checks cover schema limits, unknown/duplicate/missing assignments, uncertainty disabled, saved order/drafts, arbitrary IDs, immutable confirmation, translated labels, repeated concepts, revision and exact-segment scopes, role/token isolation, duplicate and stale writes, draft exclusion, CSV provenance/escaping and source exclusion/deletion. `npm run test:cardsort` exercises editor configuration, mobile draft/save/reload, revising a saved placement, uncertainty, confirmation/reason, interactive matrices, source quotes, exports and responsive layout. A synthetic hosted study verifies the same hand-calculated denominators against production storage.

These checks establish software behavior on controlled examples. Real participant comprehension, category quality, interview reasoning quality and information-architecture validity remain unverified. Human review remains deferred at Jess’s request.
