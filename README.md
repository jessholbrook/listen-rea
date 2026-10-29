# Echo Lab

A private research workspace inspired by Listen Labs' documented workflows. Design a study, invite participants, review conversations, and build a memo with exact supporting quotes.

## Run locally

Requires Node 24.19+ (see `.nvmrc`) and npm.

```sh
npm ci
npm run dev
```

Open the development server in your local browser and choose **Create your workspace**. There are no default passwords, seeded participant responses, or automatically launched studies. An exploratory interview template is available when you create a study. Invite colleagues from **Team & settings**; a collaborator can edit but cannot publish or open fielding.

For a production build:

```sh
npm run build
npm start
```

Use HTTPS for remote access and microphone support. Production cookies are secure by default. This is an internal pilot implementation. See [Vercel deployment](docs/vercel-deployment.md) for the hosted walkthrough and full workspace setup.

## Try the workflow

1. Create a study. Edit the objective, audience, questions, screen-out options and simple branches.
2. Save the draft. Preview it; preview interviews never enter the study results.
3. Publish a revision, then separately open fielding and copy the participant link.
4. Complete an interview in another browser context. Refresh to test resume. Optional audio requires its own consent; type an answer if transcription is unavailable.
5. Open **Responses** to inspect transcripts and audio, exclude/restore a response with a reason, or delete it permanently.
6. Open **Analysis & report**. Create a manual evidence memo or use AI when configured. Add themes using exact source quotes, compare basic choice-based segments and inspect source answers.
7. Edit the memo, check its evidence and mark it reviewed. Save before generating a view-only link. Links expire after seven days and can be revoked. Changing data or editing the memo invalidates old sharing.

## AI and speech

Configure `RESEARCH_AI_KEY` securely in cloud environment settings, or in a private `.env.local` for local development. Restart the server after environment changes. `.env.example` lists optional model and storage settings. Never commit credentials.

The adapter uses OpenAI's chat-completions, transcription and speech endpoints over the inherited HTTPS proxy and CA trust. Models are configurable. Live synthetic evaluations pass for guide drafting, bounded probing, source-linked synthesis, unsupported-question abstention, speech synthesis and transcription. See [implementation status](docs/implementation-status.md) for observed timings and limits. Human microphone quality, accents/noise, end-to-end interview latency and pilot costs still need evaluation.

Without a key, the app supports guide templates/manual editing, text interviews, consented voice recording, manual coding, source-linked memos and sharing. Short answers may receive one clearly labeled **scripted clarification**. It does not simulate AI synthesis. Read-aloud can use the browser's own speech engine; availability depends on the device.

Recording supports manual turns (record, review/edit, continue) and opt-in hands-free turns. Hands-free mode reads the question, records the answer and submits after sustained speech followed by a pause. **Interrupt & answer** stops playback and starts recording; **Pause conversation** retains a spoken draft. This is turn-based conversation; simultaneous speech and automatic barge-in are not implemented. Recordings are limited to 3 MiB/five minutes. Pending drafts can recover on the same device for 24 hours, and upload/transcription retries reuse saved results. Browser storage availability affects recovery.

Provider usage records contain operation, model, text tokens when supplied, and recorded audio duration. They are not a verified billing ledger or a dollar-cost estimate.

## Storage and data behavior

SQLite WAL and private audio files live in `.data/` by default; both are ignored by Git. Auth uses scrypt password hashes and opaque, hashed session tokens with HttpOnly cookies. Database documents are scoped to a workspace; participant tokens are scoped to one interview. Back up the database and media together if you want to keep studies. Hosted mode uses a remote libSQL database and private Vercel Blob storage. Production now uses Turso Starter and private Vercel Blob with OIDC; synthetic workflow and redeploy-persistence checks pass. Vercel refuses research writes without durable storage; it shows the fictional walkthrough at the root until a database is configured. Hosted account creation requires a first-owner setup code, then one-use team invitations. Managed identity remains deferred.

Publishing stores an immutable guide revision. New sessions use the latest published revision; admitted sessions keep their original. Pausing/closing prevents new admissions and lets admitted participants finish. Active and completed interviews reserve admission slots. Screen-outs and withdrawn sessions release them. A participant can stop an interview; saved answers are retained but excluded from analysis.

Analysis uses completed, included, non-preview interviews only. Counts deduplicate participants; multiple themes can include the same person. Every saved citation must match an exact source-answer substring. This check validates provenance, not interpretation. Researchers must check summaries and contrary evidence. Grounded Q&A currently searches coded quotes, not every uncoded interview. Analysis input is limited to 150,000 serialized characters; larger studies can use manual coding.

Changing the response set marks analysis stale. Deleting a response removes its recordings and all generated analyses/share links for the study to avoid retaining derived quotes. Failed file cleanup retains a content-free retry job. Retention defaults to 90 days and runs on application requests, at most once per minute; it is not an independent background scheduler. Apply the same retention policy to external backups and any provider-side data separately.

## Checks

```sh
npm run typecheck
npm test
npm run test:browser
npm run test:voice
npm run test:preview
npm run test:mixed
npm run test:concepts
npm run test:workflow
npm run test:screen
npm run test:reporting
npm run test:library
npm run test:localization
npm run test:visual
npm run test:pricing
npm run test:maxdiff
npm run test:cardsort
npm run test:oauth
npm run test:handoff
npm run test:rally
npm run build
```

Browser checks require Chromium (`/usr/bin/chromium` by default; override `CHROMIUM_PATH`). The cloud container requires `--no-sandbox`; tests use a dedicated browser and a synthetic microphone. Integration and browser checks create temporary data directories and use port 3101, then clean up. They do not pollute your workspace with test accounts. Run the integration and browser suites sequentially because they share the default test port/build directory. `test:voice` exercises hands-free turns and recovery with mocked speech; `test:preview` checks the hosted walkthrough and missing-storage protection. Optional `evaluate:ai` and `evaluate:speech` use a real key, make billable provider calls and write ignored evaluation results.

Screenshots are generated in ignored `test-results/`. The browser journey covers signup, guide publication, preview, fielding, mobile recording/resume, an interview, transcript/audio review, manual coding, citation drill-down, reviewed sharing and responsive layouts. Synthetic recordings do not establish human audio or model performance.

## Plan and current status

- [Build plan](docs/build-plan.md)
- [Mixed-method study design and results](docs/mixed-methods.md)
- [Concept testing](docs/concept-testing.md)
- [Researcher workflow](docs/researcher-workflow.md)
- [Desktop usability](docs/desktop-usability.md)
- [Reports and media](docs/reporting-media.md)
- [Research Library](docs/research-library.md)
- [Languages and translations](docs/localization.md)
- [Visual Insights](docs/visual-insights.md)
- [Gabor–Granger pricing](docs/pricing.md)
- [MaxDiff preferences](docs/maxdiff.md)
- [Pulse recurring waves and shared coding](docs/pulse.md)
- [Optional self-reported feelings](docs/self-reported-feelings.md)
- [Closed card sort](docs/card-sort.md)
- [Public feature inventory](docs/listen-labs-feature-inventory.md)
- [First study and design decisions](docs/first-study.md)
- [Implementation status](docs/implementation-status.md)
- [Internal pilot checklist](docs/internal-pilot.md)

The first workflow and synthetic live voice/AI evaluations are complete. Human voice checks and a real participant pilot remain pending. Mixed-method question types, saved randomization, carry-forward, section conditions and computed results are implemented. Concept testing with text/linked images and per-concept analysis is implemented. Draft history/restore, saved audiences, folders, workspace defaults and a rule-based study advisor are implemented. Desktop usability adds optional screen/microphone capture, recoverable private clips and task-linked playback. Report editions/history, copied presentation styles, editable PowerPoint export, reviewed clips/reels, captions and private retryable MP4 jobs are implemented. Research Library adds reviewed external transcript/media imports, previewed CSV attributes and cross-study search/cited Q&A. Localization adds reviewed English/Spanish/French guide versions, participant controls, separate response translations and independent reporting language. Visual Insights adds sampled-frame proposals, manual timestamped notes, versioned review, confirmed-evidence Q&A and CSV export. Gabor–Granger pricing adds frozen adaptive ladders, consistency checks, reasons, revision/segment curves and traceable CSV exports. MaxDiff adds balanced saved best/worst tasks, descriptive counts, a separate pooled logit model with respondent-bootstrap ranges, source inspection and exports. Closed card sorting adds saved/revisable drafts, confirmed placements, written reasoning, assignment/co-sort summaries and traceable CSV exports. Pulse adds recurring baseline copies, design/recruitment flags, current-revision KPI comparisons, versioned shared coding and original-evidence exports. Optional feeling check-ins add participant-selected feelings, ordinal intensity and notes, explicit declines, revision/concept/language scopes and source-linked exports. Inferred emotional signals and predictive research remain separate proposals. Recruitment integrations and specialist methods remain in the phased plan. Human testing is deferred at Jess’s request.

Participant invitations are available in **Study → Fielding**: generate and manually share one-use links, require individual invitations, track responses and export the roster. See [invitation rules and privacy](docs/participant-invitations.md). Email invitations/manual reminders are implemented; provider/sender setup is required for live sending.

**Study → Fielding → Participant incentives** supports eligibility reviews, frozen approval amounts, manual payment records, void/history and currency-separated exports. It does not send money. See [incentive rules and privacy](docs/participant-incentives.md).

**Fielding → Email invitations and reminders** supports encrypted reviewed drafts, deliberate sends, manual reminders, provider delivery checks and address stops. Sending stays disabled until a verified Resend sender is connected. See [email setup and privacy](docs/participant-email.md).

Admins can issue **read-only API keys** in **Team & settings**. Keys allow selected-study reads through `/api/v1`, with separate metadata/response/analysis permissions, expiry, revocation, pagination and rate limits. See the [API contract and Vercel access requirements](docs/read-api.md). Resend/domain setup is deferred; manual invitation sharing remains available.

Compatible MCP clients can read the same permitted data at `/api/mcp`. Open **Team & settings → Read-only API keys → Connect an MCP client** for the URL and header template. Compatible clients can instead use OAuth sign-in and approve studies/permissions in Echo Lab. Manage grants under **Team & settings → MCP connections**. Vercel access protection remains enabled. See [MCP connection and limits](docs/mcp.md).

[OAuth connection details](docs/oauth.md) cover PKCE, consent, rotating tokens and revocation. The sign-in/consent browser check is `npm run test:oauth`.

**Study → Fielding → Qualtrics survey handoff** provides reviewed ResponseID matching, a Qualtrics redirect template, a private roster/CSV and optional participant-chosen destinations. See [handoff setup and limits](docs/survey-handoff.md). Real Qualtrics survey validation remains pending; no vendor account or domain is required for the Echo Lab build.

**Study → Fielding → Rally study handoff** supports Rally custom-test URLs, reviewed return templates, private pid/studyID matching and CSV. See [Rally setup and limits](docs/rally-handoff.md). Real Rally account/status verification remains pending; this does not use Listen’s native partner integration.

Decipher (Forsta) handoff: configure it in Study → Fielding; see [setup and limits](docs/forsta-handoff.md). Standard `rid` matching and approved survey returns are supported; real vendor testing remains pending.

Participant quota caps are available in Study → Fielding: [setup and counting rules](docs/participant-quotas.md). Maximum counts use frozen admission-tag groups; screener-answer groups are now supported with [explicit screening/reservation rules](docs/screener-quotas.md).

Minimum/exact count quotas are available for disjoint tag or single-choice groups: [setup, feasibility and limits](docs/quota-targets.md). Percentage targets are now available with [explicit rounding and publication rules](docs/quota-percentages.md). Participant branding is available with [logo/colors and frozen session snapshots](docs/participant-branding.md). Private uploads are available with [concept images](docs/concept-images.md). Prototype links and tasks are available with [setup and limits](docs/prototype-concepts.md). Private video stimuli are available with [limits and text alternatives](docs/concept-videos.md). [Timed concept presentation](docs/timed-concepts.md) is available with persistent deadlines and an untimed accessibility option. [Private image answers](docs/answer-images.md) are available for single and multiple choice. [Ranking and MaxDiff image answers](docs/ranking-maxdiff-images.md) are available. [Study media watermarks](docs/media-watermarks.md) are available. [One-time concept video viewing](docs/one-time-video.md) is available. [Participant confidentiality acknowledgements](docs/confidentiality-acknowledgements.md) are available. [Private participant image uploads](docs/participant-image-uploads.md) are available. [Optional image-aware AI follow-ups](docs/participant-image-ai.md) are implemented with separate permission and provenance. [Researcher image reviews and correction history](docs/participant-image-review.md) are implemented. [Reviewed attachment evidence in analysis and reports](docs/attachment-evidence.md) is implemented. [AI synthesis of included researcher observations](docs/attachment-synthesis.md) is implemented. [Private PDF participant uploads and researcher review](docs/participant-pdfs.md) are implemented. [PDF text extraction with page citations and researcher verification](docs/pdf-text.md) is implemented. [Verified PDF passages in analysis and reports](docs/pdf-evidence.md) are implemented. [AI synthesis of verified PDF passages](docs/pdf-synthesis.md) is implemented. [Optional PDF-aware interview follow-ups](docs/participant-pdf-ai.md) are implemented. [Researcher-triggered OCR for scanned PDF pages](docs/pdf-ocr.md) is implemented. [Q&A over verified PDF passages, including reviewed OCR](docs/pdf-qa.md) is implemented. [Saved and reviewed PDF-passage Q&A report appendices](docs/pdf-answer-reviews.md) are implemented. [Correction revisions for verified OCR text](docs/pdf-ocr-corrections.md) are implemented. [Private DOCX participant uploads and researcher review](docs/participant-docx.md) are implemented. [Verified DOCX text selections with paragraph citations](docs/docx-text.md) are implemented. [Verified DOCX passages in analysis and report appendices](docs/docx-evidence.md) are implemented. [AI synthesis of included verified DOCX passages](docs/docx-synthesis.md) is implemented. [Researcher Q&A over included verified DOCX passages](docs/docx-qa.md) is implemented. [Saved and reviewed DOCX Q&A report appendices](docs/docx-answer-reviews.md) are implemented. [Optional DOCX-aware AI interview follow-ups](docs/participant-docx-ai.md) are implemented. [DOCX grounding reviews, correction history and opt-in report appendices](docs/docx-review-workflow.md) are implemented as one milestone. [AI analysis of DOCX researcher observations](docs/docx-observation-analysis.md) is implemented as one milestone: synthesis, Q&A and saved/reviewed report answers. [PPTX upload-to-report support](docs/participant-pptx.md) is implemented: private uploads, verified slide citations and opt-in report evidence. [PPTX evidence AI analysis](docs/pptx-evidence-analysis.md) is implemented as one milestone: synthesis, source-linked Q&A and saved/reviewed report answers over included slide excerpts. [PPTX interview follow-ups and researcher review](docs/pptx-followup-review.md) are implemented as one milestone: optional participant permission, slide-aware questions, grounding judgments, correction history and opt-in observation report appendices. [AI analysis of PPTX researcher observations](docs/pptx-observation-analysis.md) is implemented as one milestone: synthesis, source-linked Q&A and saved/reviewed report answers over explicitly included notes and corrections. [Research Library attachment evidence](docs/library-attachment-evidence.md) is implemented as one milestone: cross-study search and cited Q&A over explicitly included verified excerpts and researcher observations, study/attribute/type filters, current-source drill-down and withdrawal/erasure controls. [Saved and reviewed Research Library answers](docs/library-saved-answers.md) are implemented as one workflow: server-generated drafts, immutable originals/history, source-aware review, explicit latest-only text/CSV exports and source withdrawal/erasure. [Meaning-based Research Library retrieval](docs/library-semantic-retrieval.md) is implemented: explicit private indexing, hybrid transcript/attachment search and cited Q&A, saved-answer provenance, current-source revalidation and physical vector erasure. [Cross-study research briefs](docs/library-research-briefs.md) are implemented: private editable briefs from pinned approved saved answers, exact source links, combined reviewed exports, revision/approval checks and complete dependent-brief erasure. [Reviewed transcript answers](docs/library-transcript-answers.md) are implemented: server-generated cited drafts, immutable originals/review history, approved exports, mixed-source briefs and source-lifecycle erasure. [External recording transcription](docs/library-recording-transcription.md) is implemented: bounded private audio/video upload, explicit audio-only transcription, draft review and approved import with provenance, retry and erasure controls. Larger recording imports are implemented: resumable private parts up to 60 MiB/60 minutes, saved five-minute transcription checkpoints, progress/recovery, complete reviewed text and physical erasure. Processing continues while the page is open and resumes explicitly later. [Speaker-aware transcript review](docs/speaker-transcript-review.md) is implemented: editable section boundaries, researcher-reviewed labels/timing, authenticated range playback, source-aware citations and approved exports. [Imported recording revisions](docs/imported-recording-revisions.md) are implemented: private correction drafts, reviewed publication, version history/restoration, original-media preservation and dependent-research invalidation. [Batch recording intake](docs/batch-recording-intake.md) is implemented: multiple-file uploads, durable per-interview progress, pause/recovery, explicit batch transcription and separate source review/import. [Research Library collections](docs/library-collections.md) are implemented: interview/brief organization, scoped transcript/attachment retrieval and Q&A, current membership, source-removal controls and dependent-answer invalidation. [Collection review dashboards](docs/collection-review-dashboard.md) are implemented: current approved-citation coverage, answer/brief review queues, explicit source checkpoints, change visibility and erasure-safe comparison state. [Collection follow-up plans](docs/collection-followup-plans.md) are implemented: internal assigned tasks, calendar due dates, completion/reopening, current research links and source-removal cleanup. [Workspace research action center](docs/research-action-center.md) is implemented: a current cross-collection queue, assignment/status/date filters, in-place task edits and direct review navigation. [Collection handoff packets](docs/collection-handoff-packets.md) are implemented: authored summaries, selected approved findings and unfinished follow-ups, current preview/review, text/CSV exports and whole-packet source-removal cleanup. [Internal handoff review](docs/internal-handoff-review.md) is implemented: named reviewers, current-content decisions, private comments, resolution/reopening, explicit final export approval and dependent-review erasure. [Team review inbox](docs/team-review-inbox.md) is implemented: current cross-collection requests, personal/team filters, readiness and comment counts, direct packet/dashboard review, pagination and source-removal refresh. [Review planning and deadlines](docs/review-planning-deadlines.md) are implemented: optional reviewer dates, local-calendar overdue filters, matching-request deadline priorities, approval-preserving scheduling and erasure with the owning review. [Team review workload planning](docs/team-review-workload.md) is implemented: current per-person load and deadline counts, scoped pending requests, explicit version-checked reassignment, due-date transfer and approval reset. [Reusable review plans](docs/reusable-review-plans.md) are implemented: private reviewer templates, calendar-day deadline patterns, versioned edits, explicit application previews and atomic assignment/approval reset. [Batch review planning](docs/batch-review-planning.md) is implemented: bounded multi-packet selection, current coordination previews, explicit confirmation, independent commits, per-packet results and conflict/interruption recovery. [Review activity history](docs/review-activity-history.md) is implemented: transactional actor attribution, coordination changes and resets, current-name projection, bounded recent history, local-date filters and source-aware erasure. [Saved team review views](docs/saved-team-review-views.md) are implemented: private/shared filter presets for inbox, workload and activity, current-version application, creator/admin permissions, reader copies, cross-session persistence and unavailable-scope retention. [Research operations home](docs/research-operations-home.md) is implemented: current overdue follow-ups, review blockers, personal requests, recent activity and saved views, with direct filtered navigation and full-load error recovery. [Operations triage](docs/operations-triage.md) is implemented: explicit multi-task selection, assignment/date previews, independent version-checked changes, per-task results and interrupted-request recovery. [Follow-up activity history](docs/follow-up-activity-history.md) is implemented: transactional actor attribution for creation, individual/triage edits and automatic unassignment, current before/after projections, bounded retention, filters, task navigation and source-aware erasure. [Saved follow-up views](docs/saved-follow-up-views.md) are implemented: private and workspace-shared queue/history presets, session persistence, version checks and current-result navigation. [Follow-up workload dashboard](docs/follow-up-workload.md) is implemented: scoped team/unassigned totals, local-date windows, exact filtered queue navigation and current-source refresh. [Operations reporting](docs/operations-reporting.md) is implemented: scoped workload/activity previews, reviewed CSV/text downloads, current-data validation and source-erasure protection. [Saved reporting views](docs/saved-reporting-views.md) are implemented: private/shared report settings, exact language/time-zone restoration, direct reopening and fresh-preview checks. [Operations workspace home](docs/operations-workspace-home.md) is implemented: ordered personal/team pins, current-view navigation, quick report settings and live priority queues. [Follow-up planning calendar](docs/follow-up-calendar.md) is implemented: month/day agendas, unfinished priorities, intersecting scopes and reviewed date-only bulk rescheduling. [Saved planning views and deadline reports](docs/saved-planning-views.md) are implemented: private/shared calendar settings, pinned navigation and fresh reviewed CSV/text deadline exports. [Unified research planning](docs/unified-research-planning.md) is implemented: one request-level task/review calendar, exact scoped queues and original reviewed scheduling workflows. [Unified planning views and reports](docs/unified-planning-views-reports.md) are implemented: private/shared combined settings, exact pinned navigation and fresh reviewed task/request exports. [End-to-end demo readiness](docs/demo-readiness.md) is complete, with a walkthrough and documented validation limits. The [small internal pilot](docs/internal-pilot.md) is deferred again at Jess’s request; admissions are paused and existing research is preserved. See the remaining-work roadmap for expansion options.


Researcher PDF grounding review and correction history are available in Responses; see [review rules](docs/participant-pdf-review.md). Original questions and page citations remain intact.

Researcher PDF notes and corrections can be explicitly included in separate analysis/report appendices; see [inclusion and withdrawal rules](docs/pdf-observations.md).

Included researcher PDF notes/corrections support [explicit AI synthesis with exact field/review citations and human review](docs/pdf-observation-synthesis.md).

Researchers can [ask questions over included PDF notes/corrections](docs/pdf-observation-qa.md), with exact field/review citations and ordinary answers kept separate from participant evidence and reports.

PDF-observation answers support [private drafts, review history and explicit report inclusion](docs/pdf-observation-answer-reviews.md).

Remaining engineering bundles and deferred validation are summarized in [remaining work](docs/remaining-work.md).

[Background processing](docs/background-processing.md) is live: native transcription/render workers, progress, cancellation, retry/recovery and daily retention cleanup. Uploads must finish before closing the page. [Advanced research methods](docs/advanced-research-methods.md) add experimental hierarchical MaxDiff/portfolios, open/hybrid card sorting and reviewed recurring Pulse drafts. [Richer interviewing](docs/richer-interviewing.md) adds opt-in streaming voice, participant-requested screen guidance, return-to-task reminders and explicit task timers/reported outcomes. The next proposed milestone is reporting and media expansion.

[Reporting and media expansion](docs/reporting-media-expansion.md) adds reviewed AI clip suggestions, source-labelled cross-study reels and private static PPTX imports with appended reviewed report slides. See the contract for supported formats, review steps and validation limits.
