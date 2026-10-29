# Pulse recurring research

Open **Pulse** in a published study to create a tracker. Its published guide, revision ID, audience text, moderation guidelines and declared recruitment protocol become an immutable baseline. The initial study is wave one. **Create next wave** copies the baseline into a separate, unpublished draft study. Review, publish and open fielding through the normal controls. Collaborators may edit/copy designs and review coding; only researchers/admins may launch fielding.

Wave labels, dates and recruitment protocols can be edited with stale-write protection. Dates stay in wave order; they are planning metadata. [Automatic draft-wave scheduling](advanced-research-methods.md) now uses reviewed calendar dates and the existing daily maintenance worker. Publication, fielding and recruitment remain manual. Recurring wave management, descriptive comparisons and a reviewed shared codebook remain unchanged. External tracker integration, prediction, automatic theme discovery and latent/emotional inference remain outside this implementation.

## Comparability

Every baseline question recurs with the same stable ID, wording, order, scale/options, routing/screening and follow-up settings. Timely questions may be appended after the recurring block. They are shown separately and excluded from recurring measures and coding. Inserting them before recurring questions, changing section conditions or adding a timely question that can screen out participants produces a comparison flag.

The comparison checks audience text, goal/introduction, complete recurring question settings/order, concept exposure, section routing, language/translation settings, moderation guidelines and declared recruitment protocol. Guide title and sample cap may vary. The newly copied draft initially keeps the baseline's participant title and localization fingerprints; the wave label identifies the wave separately. Review any title change and translation availability before fielding. Timely questions can still affect completion/attrition even when appended; review the sample and unfinished/screened-out counts.

Each wave reports the **current published revision**. Completed interviews from other revisions are counted separately and trigger a flag; they are never blended into the displayed KPI/coding denominator. Each participant retains the original frozen interview. Unpublished waves display a missing-design flag. Translated/compiled participant designs and responses in another language conservatively flag the comparison: linguistic or concept equivalence has not been validated by this module. Matching settings alone never prove a stable recruited population.

Deltas against the immediately previous wave appear only when **both** waves have included completed sources and pass all checks, including complete coding under the current codebook when codes are defined. Otherwise the UI shows “Not compared” and the reasons. Values remain available side by side with warnings; no line joins incompatible designs. Small samples have no automatic significance claim, weighting or uncertainty estimate. There is no claim that a change in a theme causes or predicts a KPI change, and no assumption that the same people participated twice. The unit is a completed interview; this stage does not match identities or deduplicate people across waves.

## Measures and coding

Initial recurring quantitative measures are **rating means** and **single-choice percentages**, including answer counts and missing/not-asked counts. The denominator is valid answers among completed, included native interviews in the current revision and exact optional attribute/value segment. Other mixed/specialist question types remain available in their own result tabs. Preview, withdrawn, excluded and imported responses do not enter Pulse. Active and screened-out interviews remain separate. A missing result is not displayed as zero.

The shared codebook has stable code IDs, names and explicit inclusion/exclusion definitions. Every save creates a new immutable version; earlier definitions are retained. A researcher reviews a participant's available recurring turns and assigns codes to exact source turns. Saving an empty review explicitly records that none of the defined codes matched the available recurring answers. This measures observed mentions, not the absence of an underlying attitude. Denominators are reviewed included participants, not mentions or all collected participants. Multiple mentions of a code count once per person. Conditional questions can leave different opportunities to mention a theme; interpret these denominators with the design and source answers.

Unreviewed participants stay separate. Updating definitions requires reviewing all relevant responses under that version; different versions are never mixed. Reviews are also bound to the interview version, so a changed source invalidates its review. Timely answers cannot be assigned a recurring code. This stage uses manual review rather than automatically importing separately generated wave themes, whose definitions could drift.

## Sources, exports and lifecycle

The wave view exposes original recurring prompts/answers with response and turn IDs for coding and inspection. Theme evidence is reconstructed from currently eligible original turns; review documents save references only, with researcher/time provenance. No copied transcript is persisted in the tracker.

Authenticated CSV exports include:

- **Wave comparison:** study/revision/wave, comparability flags, current codebook version, sample size, quantitative values and denominators, coded participant percentages and unreviewed counts, and exact segment metadata.
- **Recurring evidence:** original prompts/answers and source IDs, current code assignments/definitions, reviewer/time and wave comparability warnings. Unreviewed sources have no current reviewer/code assignment. An empty reviewed response has reviewer/time and no code.

Both exports use spreadsheet-formula escaping. Exclusion, withdrawal, deletion and retention immediately affect fresh results/exports. Source deletion also removes its review references through the shared purge path. Previously downloaded exports cannot be recalled.

## Validation

The controlled three-person reference has ratings 8 and 4 plus one missing rating: mean 6, valid denominator 2, missing 1. Two of three choose Yes. One of two reviewed participants mentions a cost concern, so the theme is 1/2 (50%), with one unreviewed; repeated cost citations from one participant still count once. An empty segment has missing values, not zero-filled results.

Domain/HTTP checks cover fixed baselines, trailing timely questions, design/recruitment/language drift, version conflicts, source and workspace isolation, codebook changes/recoding, exact segments, current-revision separation, permissions, CSV provenance/escaping and source exclusion/deletion. `npm run test:pulse` covers tracker creation, codebook editing, positive/empty reviews, denominators, segment reset, evidence export, new draft waves, a visible design break and mobile layout. Compiled-server and synthetic hosted checks verify storage/runtime behavior. These checks do not substitute for human study-design, recruitment or coding-quality review; that review remains deferred at Jess's request.

Public reference reviewed October 19, 2026: [Listen Labs Pulse](https://listenlabs.com/features/pulse). The public page describes stable repeated designs/audiences/screening, timely questions, mixed qualitative/quantitative tracking and themes. Echo Lab's implementation and narrower limits are specified above; predictive marketing claims are not treated as validated behavior.
