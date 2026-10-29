# Remaining work after the core build

Updated October 29, 2026 (UTC). The internal study-to-interview-to-evidence-to-handoff/planning workflow is built and deployed. Synthetic demo-readiness checks passed. Human quality validation remains uncompleted and is deferred again at Jess's request. Pilot admissions are paused; existing interviews and published content are preserved.

These are remaining capabilities and recommended bundles, not newly approved implementation work. The original scope and evidence are in [the build plan](build-plan.md) and [feature inventory](listen-labs-feature-inventory.md).

| Bundle                                               | Remaining scope                                                                                                                                                   | Current boundary                                                                                                                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Reporting and media expansion — next approval** | AI-assisted clip selection/editing, cross-study reels and arbitrary presentation imports.                                                                         | Current decks and private rendered reels are reviewed, deterministic outputs; reels are limited to one study. Participant PPTX evidence uploads already work and are separate from importing a report template. |
| **2. External recruitment and automation**           | Panel-provider integration, actual incentive payouts, selected API/MCP create/edit/launch capabilities and deeper partner synchronization where a study needs it. | Invitations, payment tracking, read-only API/MCP/OAuth and survey handoffs already exist. Provider accounts and explicit spending/launch controls are needed for the corresponding expansion.                   |

Optional separately scoped projects remain: native iOS capture; participant Twins with held-out prediction/abstention evaluation; broader language coverage beyond English/Spanish/French; customer billing/wallets and enterprise/regional hosting if this becomes a SaaS product. Inferred emotion is an optional research experiment; self-reported feelings already work.

Deferred by preference: the two-person human pilot and later 5–10 person workflow study; Resend/domain-dependent live email. They remain available to revisit and do not need to block the next engineering bundle. Human interpretation, microphone quality and actual pilot costs remain unvalidated until real sessions are reviewed.

Completed: [Reliable background processing](background-processing.md) — native Vercel Queues, database job state, progress, cancellation, bounded retry/recovery, fenced output publication, source erasure and daily maintenance are built and live. Uploads still need an open page until complete.

Completed: [Advanced research methods](advanced-research-methods.md) — experimental respondent-level hierarchical MaxDiff/portfolio comparisons, open/hybrid card sorting and recurring Pulse draft scheduling. Independent synthetic checks support implementation behavior; real-study method quality remains unvalidated.

Completed: [Richer interviewing and task measures](richer-interviewing.md) — opt-in streaming voice with interruption, participant-requested screen-aware guidance and refocusing, reviewed task timers/outcomes and provenance exports. End-to-end human audio/guidance quality remains unvalidated. Continuous automatic visual moderation, automatic off-task classification and independently verified external-site actions/success remain further work requiring specific instrumentation and validation.

Recommended next approval: **Reporting and media expansion**. This next bundle has not started.
