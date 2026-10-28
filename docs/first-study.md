# First study and design decisions

Implementation baseline, October 19, 2026. Jess authorized building the phases in order. These are reversible defaults for an internal team tool.

**Decision:** Where should we improve the way our team collects, interprets and acts on customer feedback?

**Audience:** People who have used customer feedback to make a product decision in the last three months. Self-recruited, English, 10–15 minute interview. No recruitment or payment is triggered by this app.

**Guide:** A qualifying screener, recent decision, how evidence was gathered, how conflicting signals were handled, bottlenecks, sharing findings, what would help, closing. Probes must be neutral, tied to the answer, optional and capped per question. The generated starting guide is a template until a model is configured and a researcher approves a generated alternative.

**Screens:** study list → two-column guide/editor and preview → publish a fixed revision → open fielding → participant consent and screener → interview → responses → source-linked analysis → editable memo.

**State:** Publishing never opens recruitment automatically. Pausing stops new sessions; already admitted participants can finish. Admission limits count non-preview active plus completed sessions, reserving capacity before an interview begins. Screen-outs release capacity. Every session retains its original guide revision.

**Storage:** Use SQLite WAL locally for the first internal build. This replaces the plan's proposed PostgreSQL prerequisite so development needs no database service. Media stays in private local storage during local development. Hosted Echo Lab now uses Turso and private Vercel Blob, verified across redeploy. Database access stays in a server module.

**Providers:** Server-side OpenAI-compatible text generation plus OpenAI transcription/speech endpoints. Models are configurable. No credential, paid provider or budget is assumed. Provider-free mode supports manual study creation and interviewing with explicitly labeled scripted clarification; it does not claim AI analysis. Real provider calls require RESEARCH_AI_KEY configured securely. Voice recordings remain useful without transcription, alongside a manually entered answer.

**Release gates:** verify text lifecycle first, then recording/provider integration and grounded analysis. No claim of pilot readiness until real voice latency, cost and researcher review are completed. Later parity modules stay in the documented backlog.
