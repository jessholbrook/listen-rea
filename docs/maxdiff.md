# MaxDiff preferences

October 19, 2026 · P5 initial pooled-model implementation

Add a **MaxDiff best / worst** question in Study design. Enter a comparison prompt and 4–12 distinct items with stable IDs. Choose 3–5 items per task (fewer than the full list) and one or two design cycles. Save and publish a revision, then use the existing fielding, admission and screener controls. Each cycle has one task per item, so a 7-item design with 3 items per task has 7 tasks and 3 appearances per item. Two cycles repeat the design with saved randomized ordering.

## Design and participant protocol

The versioned `cyclic-balanced-v1` generator searches cyclic block seeds and minimizes squared pair co-occurrence counts, subject to connected comparisons. Each seed generates all cyclic rotations. Item exposures are exactly balanced. Pair frequencies can be unequal, and some pairs may never appear together; connectivity permits indirect comparison. The results show the template’s pair range rather than claiming perfect pair balance. The 4-item/3-per-task design has each pair twice; the 7-item/3-per-task design recovers the seven-block Fano design with every pair once.

For each interview, the item-to-design mapping, task order and within-task positions are randomized and saved. Each task requires distinct best and worst choices from the shown set. The server constructs the answer text and records task number, shown item IDs, best/worst IDs and original turn ID. It rejects unshown items, duplicate best/worst choices and stale versions. Duplicate request IDs preserve the saved answer. Reload resumes the current task and ordering. AI does not alter the choice tasks.

Participant responses expose only the current choice set; full item configurations, assignments and internal state are omitted. Original published text, item IDs and design stay frozen when drafts change. Repeated concepts have independent assignments and result scopes. The task labels support English, Spanish and French; item and prompt translations use the existing reviewed guide translation workflow.

## Descriptive counts and inclusion

The **MaxDiff** study tab reports each published revision, question and concept separately. Participant-attribute filters use exact name/value matches. Complete, included native interviews whose MaxDiff tasks all finished enter counts and fitting. Incomplete tasks or an unfinished later interview question exclude the whole respondent from this module’s counts/model. Not-reached questions and malformed/unsupported assignment records have separate counts. Preview, excluded/withdrawn and external-import interviews do not enter results.

Each item reports actual exposures, best count, worst count, net best-minus-worst count, and net count divided by exposure. Counts are descriptive; they are not utilities, population estimates or Hierarchical Bayes scores. Repeated tasks remain choices by one respondent, not additional respondents.

## Pooled model

**Fit pooled model** estimates a regularized joint best–worst multinomial logit for the selected result scope. For a shown set `S` and distinct chosen items `b,w`,

`P(best=b, worst=w | S,u) = exp(u[b]-u[w]) / Σ(i≠j in S) exp(u[i]-u[j])`.

The objective is negative log likelihood plus `0.5 × Σ(u²)` (fixed ridge strength 1). A Newton solver with analytic gradient/Hessian and backtracking stops on its gradient tolerance. Scores are withheld if fitting does not converge. The penalty identifies the otherwise arbitrary utility location and shrinks sparse estimates. This is one pooled utility vector; individual utilities, respondent heterogeneity distributions and hierarchical hyperparameters are not estimated.

The displayed **relative preference score** is `100 × exp(u[item]) / Σ exp(u)`, summing to 100 across this configured list. It is a utility transformation, not the probability of selecting the item best under the joint best–worst model, a market share, or a purchase probability. Scores cannot be compared directly across different lists/revisions or against Listen’s HB index.

The [Listen Labs documentation](https://docs.listenlabs.com/insights-and-reports/max-diff-questions) describes respondent-level Hierarchical Bayes utilities and an index whose average item equals 100. Echo Lab’s pooled fit and sum-to-100 transformation deliberately use different labels. **HB estimation, individual-level preferences and portfolio optimization remain later work.**

## Uncertainty and reproducibility

With at least 10 complete respondents and 3 distinct observed response patterns, 100 bootstrap samples resample whole respondents, retaining their task clusters. Each sample refits the same penalized pooled model. Interpolated 2.5th/97.5th percentiles form the displayed 95% respondent-bootstrap ranges. At least 95% of fits must converge; otherwise ranges are withheld. Small samples show the reason ranges are unavailable.

These ranges describe resampling variation in this sample under this pooled model. They are not HB posterior intervals, individual-level uncertainty, evidence of population representativeness or a guarantee of nominal coverage. Narrow/zero ranges can reflect limited observed variation. Overlap does not establish a ranking difference; separate segment fits do not provide a formal test between segments. The model assumes one shared utility scale and a joint logit choice process.

Fitting is explicit and bounded to one result scope, at most 500 respondents/12,000 tasks and four fit requests per workspace per minute using the existing instance-local rate limiter. Method version, penalty, source fingerprint, seed, fit convergence, bootstrap completion and computation time accompany results. The bootstrap seed derives deterministically from the current source fingerprint. Export recomputes against current sources. Fitted scores are not saved as independent database records; refresh/reload can require refitting. Source changes during a fit reject its output.

## Evidence, export and privacy

Item buttons on the fitted score display filter source outcomes to respondents who selected that item best or worst. **Inspect MaxDiff source** shows the original task prompt, shown labels and saved answer turns. Counts CSV preserves item IDs/exposures and denominator metadata. Task CSV includes planned tasks, reached/answered flags, best/worst IDs, original turn IDs and design version. Reached does not mean answered. Model CSV includes utilities, transformed scores, available bootstrap ranges and reproducibility metadata. All CSVs use the existing spreadsheet escaping.

Workspace authentication applies to results, fits, exports and source inspection. Exclusion and deletion immediately change canonical result eligibility. Retention/response deletion remove assignments and choices with the interview. No persisted model copy remains to purge. Files already downloaded are outside the application’s deletion scope.

## Validation

`npm run test:maxdiff` exercises setup, mobile best/worst exclusivity, saved resume, fitting/model CSV, source inspection, segment filtering and responsive layout. Domain/HTTP checks cover every supported design shape, exact exposure balance, connectivity, known block designs, schema/choice validation, reserved IDs, translated items, scope, hidden future items, tokens, duplicate/stale requests, frozen revisions, exclusion and deletion.

`npm run evaluate:maxdiff` uses independently sampled ordered pairs from the stated joint model. Finite-difference checks verify the solver’s analytic gradient and Hessian. Exhaustive uniform pair data produce equal utilities and scores. Recovery tests use known utilities and verify shrinking bootstrap ranges at larger samples. In 20 seeded, model-matched datasets (80 respondents × 7 tasks), utility RMSE averaged 0.079; 129/140 item ranges covered their known transformed scores (92.1%). On a separate held-out simulation, mean pair log loss was 1.392 versus 1.792 for uniform choice. The maximum supported 500-person/12,000-task workload also converged with all 100 bootstrap fits in the development container; timing is not a hosted latency guarantee.

These controlled examples validate implementation and limited model-matched recovery. They do not establish calibration under heterogeneous or misspecified populations, real participant comprehension, fatigue, response validity, HB equivalence or research-quality performance. Human review remains deferred at Jess’s request.

Private images and required translated descriptions are now available on MaxDiff items, with full-size viewing and current-task-only delivery. The design and scoring methods above are unchanged. See [ranking and MaxDiff image answers](ranking-maxdiff-images.md).
