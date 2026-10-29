# Advanced research methods

This bundle adds experimental respondent-level MaxDiff estimation and portfolio comparisons, open/hybrid card sorting, and recurring Pulse draft creation. Existing pooled MaxDiff results and closed sorts remain available.

## Hierarchical MaxDiff

Open **MaxDiff → Hierarchical Bayesian model** after collecting 10–100 included complete responses with 4–8 items and at most 1,600 choice tasks. Choose a portfolio size (up to four) and a top-preference threshold (up to three), both below the item count. Fit, inspect diagnostics and original responses, and explicitly review the assumptions before downloading summary, respondent or portfolio CSVs.

`hierarchical-isotropic-joint-bw-v1` uses the joint ordered best/worst likelihood: each distinct ordered pair has probability proportional to `exp(u_best − u_worst)` over the displayed set. An orthonormal Helmert basis enforces sum-zero utilities. Respondent coefficients have an isotropic normal hierarchy: βr | μ,τ² ~ N(μ,τ²I), μ | τ² ~ N(0,τ²/0.1 I), τ² ~ inverse-gamma(2,1). This uses one shared variance, not an unrestricted covariance matrix.

Four independently seeded Metropolis-within-Gibbs chains each discard 1,000 warmup iterations and retain 2,000 draws. Respondent proposals adapt only during warmup; hierarchy parameters use normal/inverse-gamma conditional draws. Raw split/folded R-hat must be ≤1.10, raw effective sample sizes ≥50, and estimated autocorrelation must resolve within the available window (up to 1,000 lags). These are implementation-specific diagnostics, not Stan's rank-normalized diagnostics. Failed diagnostics withhold all estimates and portfolios; the bounded 45-second sampling/diagnostic budget also withholds results on timeout. Supported input size does not guarantee convergence.

Preference scores sum to 100 within the item list. Group results average respondent scores in this sample. Posterior ranges describe model uncertainty; they do not establish population representativeness. Portfolios exhaustively compare every supported combination by the posterior expected percentage of current respondents whose top preferences include at least one selected item. This is sample preference coverage, not market reach, purchase probability or proof that one portfolio outranks another.

Sampling seeds derive from method, prior, item count and ordered response choices, so random study/source IDs do not alter numerical fits. Fits are deterministic for unchanged sources/settings. Exports recompute from current eligible responses and bind member access, source fingerprint, method, prior and portfolio settings to the reviewed preview. Changed sources/access revoke exports. No model snapshots or respondent estimates persist separately from source interviews; downloaded files cannot be recalled.

Independent checks cover orthonormal contrasts, ordered-pair probabilities, normal/gamma and hierarchy conditional moments, portfolio arithmetic, reproducibility and diagnostic withholding. Five heterogeneous model-matched references (30 respondents, four items, 16 training/eight held-out tasks per person) all passed diagnostics. Mean held-out log loss using individual posterior-mean utilities was 1.348 versus 1.744 for pooled utilities. Five simulations do not establish real-study accuracy, interval calibration or equivalence to Listen Labs' model. A maximum-size reference (100 respondents, eight items, 1,600 tasks) completed in about eight seconds locally and correctly withheld estimates for unresolved autocorrelation. Hosted latency and convergence can differ.

## Open and hybrid card sorting

Choose **Open** for no predefined categories, **Hybrid** for predefined categories plus participant-created ones, or **Closed** for the existing fixed-category workflow. Participants can add, rename and remove up to ten personal categories before confirmation. The server owns category IDs and validates names and placements. Group edits save the current board atomically. Removing a group unassigns its cards; it does not mark them uncertain. Saved drafts survive reload. Confirmed sorts are immutable.

Category controls support English, Spanish and French. Original participant category labels remain linked to their own responses. Matching names across people are not automatically merged. Aggregate tables distinguish predefined categories, participant-created categories and explicit uncertainty. Co-sort percentages compare actual assignments within each respondent; uncertain placements stay outside pair denominators. Assignment CSVs retain original labels and source IDs, with spreadsheet-formula escaping. Source exclusion/erasure changes current aggregates without a separate saved result copy.

## Recurring Pulse drafts

In **Pulse → Automatic draft-wave schedule**, review the first date, time zone, calendar-day interval, label prefix and cycle length (up to 12 drafts). Only admins/researchers can schedule. A workspace supports 20 active schedules and a tracker at most 100 total waves.

Existing daily maintenance at 05:00 UTC creates at most one due draft per schedule per invocation. Date comparisons use the saved IANA time zone; intervals are calendar days. Overdue schedules catch up one wave at a time. **Run due Pulse schedule now** uses the same worker for that tracker, with explicit review and idempotent request/version checks. Future dates never run early. Pause/resume and reviewed replacement cycles remain available.

Each occurrence atomically creates an unpublished, unfielded copy of the immutable baseline, adds tracker membership/history and records a deduplication receipt. Revoked creator access, missing/changed baselines, changed wave chronology and capacity limits block processing. Every draft still needs design and stimulus review, publication and fielding. Study-bound private media may need replacement during that review. No recruitment, invitations, provider calls or spending starts automatically.

## Next milestone

[Richer interviewing and task measures](richer-interviewing.md) are implemented as the subsequent bundle: opt-in streaming voice, requested screen guidance/refocusing, explicit task timers and participant-reported outcomes. Reporting/media expansion is the next proposed bundle. Human pilot validation and domain-dependent email remain deferred.

## Release validation

Production build and TypeScript checks pass, together with 589 compiled automated tests. Four browser suites cover the new bundle plus the existing closed-sort, pooled MaxDiff and Pulse workflows. The new workflow checks reviewed model downloads and source inspection, setting invalidation, mobile category add/rename/remove, saved-board recovery and confirmation, editor mode changes, and reviewed Pulse draft creation/pause. Statistical references run separately with `npm run evaluate:hierarchical`.

Released October 29, 2026 (UTC) as `dpl_3GC55LwdHZaZnWZfToQ28tZiRkcB` at [Echo Lab](https://echo-lab-psi.vercel.app). Seven hosted verification groups passed on the immutable candidate before promotion, including model diagnostics/reviewed exports, access/source-erasure checks, open/hybrid categories, authorized due Pulse draft creation and complete synthetic cleanup. No hosted AI/provider calls occurred. Existing account count and the complete paused pilot were preserved; private recording storage independently reports zero files/zero bytes. Vercel confirms `0 5 * * *` maintenance enabled for this deployment. The Pulse worker was exercised through its authenticated, tracker-scoped due-run control; a future automatic timer invocation has not yet been observed.
