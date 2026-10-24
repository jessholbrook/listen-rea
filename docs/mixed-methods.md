# Mixed-method studies

Echo Lab now supports open text, single select, multiple select, integer rating scales, full rankings, rating matrices and statements in one guide.

## Design a study

AI drafting continues to propose conversational open/choice/statement guides. Add and configure the new mixed-method questions explicitly in the guide editor. Choose a question type in the guide editor. Configure item labels for selections/rankings or row labels for matrices. Rating scales support up to eleven consecutive integer points, including zero; define the endpoints and their labels. Multiple-select questions can constrain minimum and maximum choices. Single-select options can screen out respondents.

For option-based questions, **Randomize item order per participant** assigns an order when the question is first reached. The assignment is saved with the interview. Refreshes, retries and later guide edits do not reshuffle it. Ranking requires participants to explicitly choose every item and supports moving items up/down. There is no preselected ranking.

**Carry forward options** uses selected or unselected items from an earlier fixed single/multiple-select question. Source IDs and labels are preserved. Carry-forward applies to single/multiple select, ranking and matrix rows. If the source was skipped, no items remain, or too few items remain for the required selection minimum, the target question is skipped. Chained carry-forward is not supported.

**Show section when** applies an earlier selection condition to every question with that section name. The source must come before the first question in the section. Question conditions and section conditions both need to match. Conditions can reference multiple-select membership as well as single selections. Broken, forward and cyclic references are rejected when saving.

Publishing still saves an immutable guide revision. Existing interviews retain their original guide, scale, labels and assignments. Preview interviews use the same runtime but remain outside results.

## Read results

The **Analysis & report** page includes **Ratings, rankings & selections**, independently of the AI evidence memo. It uses completed, included, non-preview interviews and reports each published revision separately.

- Ratings: mean, integer-value distribution and answered N.
- Rankings: mean rank (1 is highest priority), with the number of participants who ranked each item.
- Matrices: row mean and answered N.
- Selections: selected count / participants shown that item and percentage of shown. This denominator accounts for carry-forward exposure; multi-select percentages need not sum to 100%.
- Every question shows answered, missing after being shown, not asked and eligible counts. Exclusion/restoration changes computed results.

CSV exports include revision IDs and canonical structured values alongside readable answer text. These are descriptive sample statistics; advanced significance testing and population estimates are outside this module.

## Verification

`npm test` includes routing/validation/scoring and HTTP fixtures. `npm run test:mixed` exercises the researcher editor and a mobile participant completing a mixed guide, including refresh/reorder behavior, then checks computed results and responsive layouts. Test data is isolated from production. Browser suites and the default HTTP suite share port 3101 and must run sequentially.

Jess requested continuing implementation before human testing on October 19, 2026. The human voice/pilot checks are deferred and remain separate from automated verification. The next planned module is concept testing.

Production verification on October 19, 2026 passed: hosted conversational AI drafting against the expanded guide validator, publication of a mixed guide, completion of a synthetic interview, zero-valued rating scoring and exact ranking results. The temporary production workspace was cleaned up. Production build, type checking, all 17 automated tests and all four browser suites passed.
