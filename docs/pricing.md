# Gabor–Granger pricing

October 19, 2026 · Internal research module

In **Study design**, choose **Gabor–Granger pricing** as a question type. Describe one product or offer in the question wording, set 3–12 increasing prices, a currency (USD, EUR or GBP) and a price unit such as “per month”. Prices accept at most two decimal places and are stored as integer minor units. Invalid price edits must be fixed before saving. Save and publish a revision, then open fielding as usual.

## Interview protocol

Admission uses the existing published screeners, routing, fielding controls and capacity rules. No purchase-interest prefilter automatically removes nonbuyers.

Each participant starts at a uniformly random price from the configured ladder. The starting price and every subsequent decision are saved server-side. A yes moves to the next higher price; a no moves to the next lower price. The ladder stops at an adjacent accepted/rejected boundary, rejection of the lowest price, or acceptance of the highest price. It then repeats the starting price once as an explicitly labeled consistency check. A changed answer or a yes above a rejected lower price flags the outcome as inconsistent. Such answers are not repaired, recoded or silently included in curves.

The optional final written reason accepts “skip”; it uses one fixed question rather than adaptive AI probing. Existing qualitative coding and cited analysis can use the saved reasons. Structured price/check events are labeled separately for analysis, and qualitative AI is instructed not to reconstruct curves from sparse answers. Future adaptive probing or automated reason categorization requires further implementation and review.

Only the current price is exposed to the participant; unpublished/unasked price configurations and internal ladder state are removed from participant payloads. Existing interview tokens, version checks and request-ID retries apply to every price, check and reason. Reload resumes the current price. The published guide, currency, unit and prices remain frozen for an existing interview when the draft changes. Concept repeats have independent ladders. English, Spanish and French have price/check/reason controls; the offer text and price unit use the existing reviewed guide translations.

## Results and denominator

Open the study’s **Pricing** tab. Results are separated by published revision, question and concept. Exact participant-attribute filters produce segment-specific curves and exports.

- **Included:** completed, nonpreview, nonexcluded native interviews with a finished ladder/check/reason phase and consistent answers. A participant who rejects every tested price stays in this denominator with zero demand at every price.
- **Inconsistent:** completed interviews whose consistency check or observed price ordering conflicts. Reported separately and excluded from the curve denominator.
- **Incomplete:** an exposed ladder in an unfinished interview, or a ladder/reason that was not finished. Excluded, with an explicit count. Completing the ladder while abandoning a later interview question still counts as incomplete for this release.
- **Not asked:** the interview never reached this pricing question, including routed-away questions. Excluded, with an explicit count.
- Preview, excluded/withdrawn and externally imported interviews do not enter pricing results. Exclusion, response deletion and retention use canonical interview data; there is no separately persisted pricing-results copy.

For tested price `p`, let `N` be the included denominator and `B(p)` the number whose highest accepted tested price is at least `p`. Demand is `B(p)/N`. Expected gross revenue per included respondent is `p × B(p)/N`. The curves and table separate directly observed yes/no answers from monotonic inferences at unasked prices. The repeated check does not add a respondent or another observed-price count.

The revenue-maximizing tested prices include every exact tie; comparisons use integer `price × buyers` products, before display rounding. With no positive stated demand, no maximizing price is suggested. With no included respondents, demand/revenue are missing, not zero. Accepting the top price is labeled as reaching the top of the tested range: it does not establish an exact maximum willingness to pay above that price. Lines connect tested prices for readability; no between-price or out-of-range estimate is calculated.

Demand reflects stated intentions under the assumption that willingness does not increase with price. It is not a purchase/conversion forecast. Revenue excludes costs, margins, competitors, market size and price signaling. The repeated-anchor check can identify instability but cannot establish that other answers are truthful or reliable. Small segment samples and inconsistent respondents require researcher interpretation.

## Traceability and export

Each outcome exposes its status, tested price events, reason and response/turn IDs. **Inspect pricing source** opens original question, price/check and reason turns. Curves CSV records minor-unit prices, counts, denominator, demand fractions, revenue per respondent, observed/inferred counts and segment metadata. Responses CSV records each status and its source events, reason and turn IDs; inconsistent and incomplete outcomes do not receive a valid price-boundary estimate. Workspace authentication, current source availability and the existing spreadsheet-formula escaping apply.

## Method comparison and validation

The public [Listen Labs pricing page](https://listenlabs.com/features/gabor-granger) describes higher/lower price questions, explanations, demand/revenue curves, retained nonbuyers, separate inconsistent answers and discarded incomplete ladders. Echo Lab implements that initial deterministic workflow with a single optional written reason.

[QuestionPro’s published implementation](https://www.questionpro.com/help/gabor-granger.html) likewise describes moving to higher/lower prices to find the highest accepted tested price and combining stated willingness with price for a revenue curve. Its default starting point is the median and it also offers randomized movement. Echo Lab uses a saved uniform random start followed by adjacent steps and an extra repeated-anchor check. This is a comparison against the published algorithm, not a claim that a third-party executable or proprietary implementation was tested.

The independent four-person reference matrix is `[N,N,N]`, `[Y,N,N]`, `[Y,Y,N]`, `[Y,Y,Y]` for prices $10/$20/$30. Hand calculations give demand 75%/50%/25%, revenue per respondent $7.50/$10/$7.50, and a $20 maximum. Adding one inconsistent and one incomplete case leaves those four denominators unchanged. Two people with boundaries $10 and $20 produce a $10/$20 revenue tie. All nonbuyers produce zero demand; an empty eligible sample produces missing values.

Automated checks cover every starting price and willingness boundary for both 3- and 12-price ladders, saved resume, inconsistent checks, retained nonbuyers, missing/tied curves, reserved IDs, separate concepts/revisions, translated units, workspace/token isolation, duplicate and stale requests, hidden future prices, segment filters, exclusions, deletion and exports. Browser checks exercise configuration, mobile answering/reload, reasons, plots, source inspection and responsive layout. Hosted checks repeat a synthetic pricing study against the deployed database. These demonstrate implementation behavior; human method review, interview quality and real-world pricing validity remain deferred.
