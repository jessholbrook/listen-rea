# Remaining work after the core build

Updated October 29, 2026 (America/Los_Angeles). The internal study-to-interview-to-evidence-to-handoff/planning workflow is built and deployed. Synthetic demo-readiness checks passed. Human quality validation remains uncompleted and is deferred again at Jess's request. Pilot admissions are paused; existing interviews and published content are preserved.

These are remaining capabilities and recommended bundles, not newly approved implementation work. The original scope and evidence are in [the build plan](build-plan.md) and [feature inventory](listen-labs-feature-inventory.md).

| Bundle                                               | Remaining scope                                                                                                                                                      | Current boundary                                                                                                                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. External recruitment and remaining automation** | Real provider connection/validation, actual incentive payouts, deeper partner synchronization and any separately scoped automation beyond private drafts. | Invitations, payment tracking, API/MCP/OAuth, reviewed requests, delegated drafts and survey handoffs exist. Provider accounts and explicit spending controls are needed for provider expansion. |

Completed: [Reporting and media expansion](reporting-media-expansion.md) — AI-assisted exact-quote clip suggestions with independent word alignment and human editing/review, source-labelled cross-study reels and private static PPTX imports with reviewed report composition. Presentation imports have explicit format/size limits; arbitrary formats and native Office rendering fidelity remain further work.

Optional separately scoped projects remain: native iOS capture; participant Twins with held-out prediction/abstention evaluation; broader language coverage beyond English/Spanish/French; customer billing/wallets and enterprise/regional hosting if this becomes a SaaS product. Inferred emotion is an optional research experiment; self-reported feelings already work.

Deferred by preference: Prolific/Tremendous account connection and real-provider validation (Jess does not want to use a work email yet); the two-person human pilot and later 5–10 person workflow study; Resend/domain-dependent live email. They remain available to revisit and do not need to block the next engineering bundle. Human interpretation, microphone quality and actual pilot costs remain unvalidated until real sessions are reviewed.

Completed: [Reliable background processing](background-processing.md) — native Vercel Queues, database job state, progress, cancellation, bounded retry/recovery, fenced output publication, source erasure and daily maintenance are built and live. Uploads still need an open page until complete.

Completed: [Advanced research methods](advanced-research-methods.md) — experimental respondent-level hierarchical MaxDiff/portfolio comparisons, open/hybrid card sorting and recurring Pulse draft scheduling. Independent synthetic checks support implementation behavior; real-study method quality remains unvalidated.

Completed: [Richer interviewing and task measures](richer-interviewing.md) — opt-in streaming voice with interruption, participant-requested screen-aware guidance and refocusing, reviewed task timers/outcomes and provenance exports. End-to-end human audio/guidance quality remains unvalidated. Continuous automatic visual moderation, automatic off-task classification and independently verified external-site actions/success remain further work requiring specific instrumentation and validation.

Completed: [Reviewed study automation](study-automation.md) — separately enabled static-key draft reads and REST/MCP change requests, admin inspection/application, create/edit/publish/fielding lifecycle, actor attribution, freshness checks and erasure-safe retry receipts. Jess confirmed no provider accounts yet and chose automation first.

Completed planning: [Recruitment and payout provider comparison](provider-integration-plan.md) recommends Prolific first for general-audience recruitment with vendor-managed compensation, then Tremendous reward links for our own invitees. It compares specialist alternatives, costs, access requirements and concrete build/acceptance criteria. No provider account or live recruitment/payout was created.

Completed engineering: [Prolific recruitment connector](prolific-recruitment.md) — reviewed plans/provider drafts, separate no-credit/paid launch gates, native identifier/recovery/return handling, local cohort capacity, source-aware read-only reconciliation, deadline warnings and signed/queued webhook refresh. Production is unconnected and paid launch remains disabled. Actual Prolific account/API/no-credit validation is still outstanding; no live recruitment or compensation occurred.

Completed engineering: [Tremendous sandbox reward links](tremendous-sandbox.md) — reviewed plans and explicit simulated orders for approved own-invitation incentives, participant-token link claims, stable obligation references/retries, private reconciliation, signed/queued events and erasure-safe spent hashes. Deployment remains unconnected. Real Tremendous sandbox compatibility and production compensation remain unvalidated/unimplemented.

Provider connection readiness and guided sandbox/no-credit validation are deferred at Jess’s request. Both connectors remain implemented and unconnected; Prolific paid launch stays disabled and Tremendous live payouts remain unavailable. Existing setup documentation is ready for later account creation. Production compensation also needs a separate financial-retention/earned-obligation decision.

Completed engineering: [Delegated draft automation](delegated-draft-automation.md) — separate admin opt-in for trusted static keys to execute private draft creation/editing through REST/MCP, selected-study/operation boundaries, rolling limits, fresh role/permission/source checks, attributed execution/permission history, exact retry receipts and immediate disable. Publication, fielding and provider actions retain their existing review requirements.

Completed engineering: [Signed integration notifications](integration-notifications.md) — scoped metadata events, disabled-by-default verified destinations, encrypted signing keys, durable transactional outbox, native queue retries, delivery logs, immediate revocation and source-erasure controls. No real external destination is enabled by default.

Recommended next approval: **Integration reconciliation and catch-up tooling** for missed notifications, bounded-history gaps and sources that have become unavailable, with current selected-study permissions. This is a proposed deeper-synchronization bundle and does not require a new provider account.
