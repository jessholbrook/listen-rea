# Concept testing

Deployed at https://echo-lab-psi.vercel.app. Production build/type checking, 22 automated tests and all five browser suites pass. Hosted synthetic checks passed for saved assignments, repeated interviews, separate concept scores, concept-scoped AI synthesis and Q&A abstention on another concept. Temporary production data and sessions were removed.

Concept studies reuse the same marked question block for a randomized subset of ideas. Shared screeners and context questions can come before the block, and shared closing questions can follow it.

## Configure a study

Enable **Concept testing** in the guide editor. Add 2–10 concepts with a researcher label, participant headline and self-contained description. An optional HTTPS image link needs an image description and must be accessible to participants. This release supports text and linked images; video, interactive prototypes and uploaded stimulus assets remain later work.

Choose 1–5 concepts per participant, up to the number available. Concepts are sampled uniformly without replacement when an interview is admitted. For multiple concepts, presentation order can be randomized or follow the configured pool order within the sampled subset. This is random assignment, not enforced quota balancing.

Mark one consecutive block with **Repeat for each assigned concept**. The editor initially marks questions after the leading screener when enabling the feature; review those choices before saving. Keep screen-outs outside the repeated block. The same questions, scales and option labels apply to each assigned concept. Selection conditions, section conditions and carry-forward inside the block use that concept’s own answers. Shared questions after the block cannot depend on a repeated answer.

Save, preview and publish as usual. Preview uses the same assignment runtime and remains excluded from results. Publishing still does not open fielding automatically. AI guide drafting proposes conversational questions; configure concept assignments and the repeated block explicitly. Applying an AI draft replaces the current concept setup after the review step.

## Participant behavior and persistence

The interview saves the selected concept IDs, order and materialized question/stimulus snapshot. A refresh or a later guide edit does not reassign concepts, change their content or reset saved answers. The participant sees the current concept’s headline, description and optional image above each repeated question, including follow-ups. Future/unassigned stimulus content is omitted from participant payloads. Shared questions show no stimulus.

Answers have unique turn IDs and server-assigned concept/template-question IDs. Participant-supplied concept IDs cannot retag an answer. Option randomization and follow-up limits apply independently to each repeated question. Original studies without concept configuration keep their existing behavior.

## Compare results

**Analysis & report** offers an **Analysis scope** selector for shared questions or a particular concept and published revision. Concept assignment/completion counts omit previews and excluded interviews. Assigned and completed counts can differ because of admission, screen-out, withdrawal or skipped questions.

Each scope has its own coding, AI synthesis, grounded Q&A and reviewed memo. Concept analyses use completed, included interviews with answers for that concept. Exact-quote validation rejects citations from another concept or revision. Shared-question memos use only shared turns. Source review identifies the concept and original template question; recordings remain attached to individual turns.

Measured results group by revision, template question and concept. The same rating question can therefore show different distributions and means for different ideas without pooling them. Descriptive counts and denominators are computed in code. CSV exports retain concept IDs, template-question IDs, revision IDs and structured values. Manual interpretation and review are still required; random presentation does not establish representative sampling or statistical significance.

Sharing includes only the selected reviewed memo. Existing study-wide invalidation/revocation applies: changed response data, regenerated/edited analysis or response deletion can invalidate shared reports. Deletion clears derived analysis across all concepts to avoid retaining source quotes.

## Verification

`npm test` covers source-guide validation, assignment sampling, independent routing/carry-forward, refresh snapshots, participant payloads, per-concept scoring, source-scope rejection, sharing, deletion and workspace isolation. `npm run test:concepts` covers the editor, linked-image presentation, mobile interviews, refresh and switching between separate concept memos. All browser suites and the default HTTP suite must run sequentially because they share port 3101.

Human testing remains deferred at Jess’s request. [Researcher workflow](researcher-workflow.md) adds restore history, saved audiences, advisor recommendations, folders and workspace defaults.
