# Remaining work after the core build

Updated October 29, 2026 (UTC). The internal study-to-interview-to-evidence-to-handoff/planning workflow is built and deployed. Synthetic demo-readiness checks passed. Human quality validation remains uncompleted and is deferred again at Jess's request. Pilot admissions are paused; existing interviews and published content are preserved.

These are remaining capabilities and recommended bundles, not newly approved implementation work. The original scope and evidence are in [the build plan](build-plan.md) and [feature inventory](listen-labs-feature-inventory.md).

| Bundle                                               | Remaining scope                                                                                                                                                      | Current boundary                                                                                                                                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. External recruitment and remaining automation** | Panel-provider integration, actual incentive payouts, direct delegated execution beyond reviewed requests and deeper partner synchronization where a study needs it. | Invitations, payment tracking, read-only API/MCP/OAuth and survey handoffs exist. Provider accounts and explicit spending/launch controls are needed for corresponding expansion. |

Completed: [Reporting and media expansion](reporting-media-expansion.md) — AI-assisted exact-quote clip suggestions with independent word alignment and human editing/review, source-labelled cross-study reels and private static PPTX imports with reviewed report composition. Presentation imports have explicit format/size limits; arbitrary formats and native Office rendering fidelity remain further work.

Optional separately scoped projects remain: native iOS capture; participant Twins with held-out prediction/abstention evaluation; broader language coverage beyond English/Spanish/French; customer billing/wallets and enterprise/regional hosting if this becomes a SaaS product. Inferred emotion is an optional research experiment; self-reported feelings already work.

Deferred by preference: the two-person human pilot and later 5–10 person workflow study; Resend/domain-dependent live email. They remain available to revisit and do not need to block the next engineering bundle. Human interpretation, microphone quality and actual pilot costs remain unvalidated until real sessions are reviewed.

Completed: [Reliable background processing](background-processing.md) — native Vercel Queues, database job state, progress, cancellation, bounded retry/recovery, fenced output publication, source erasure and daily maintenance are built and live. Uploads still need an open page until complete.

Completed: [Advanced research methods](advanced-research-methods.md) — experimental respondent-level hierarchical MaxDiff/portfolio comparisons, open/hybrid card sorting and recurring Pulse draft scheduling. Independent synthetic checks support implementation behavior; real-study method quality remains unvalidated.

Completed: [Richer interviewing and task measures](richer-interviewing.md) — opt-in streaming voice with interruption, participant-requested screen-aware guidance and refocusing, reviewed task timers/outcomes and provenance exports. End-to-end human audio/guidance quality remains unvalidated. Continuous automatic visual moderation, automatic off-task classification and independently verified external-site actions/success remain further work requiring specific instrumentation and validation.

Completed: [Reviewed study automation](study-automation.md) — separately enabled static-key draft reads and REST/MCP change requests, admin inspection/application, create/edit/publish/fielding lifecycle, actor attribution, freshness checks and erasure-safe retry receipts. Jess confirmed no provider accounts yet and chose automation first.

Completed planning: [Recruitment and payout provider comparison](provider-integration-plan.md) recommends Prolific first for general-audience recruitment with vendor-managed compensation, then Tremendous reward links for our own invitees. It compares specialist alternatives, costs, access requirements and concrete build/acceptance criteria. No provider account or live recruitment/payout was created.

Recommended next approval: **Prolific recruitment connector** — participant handoff, reviewed provider drafts, budget/launch controls and submission reconciliation, with paid launch disabled by default. Local contract fixtures can be built before account setup; actual provider testing requires credentials and confirmation of no-credit test access. Tremendous payouts follow as a separate milestone.
