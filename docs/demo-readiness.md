# Echo Lab demo readiness

Open https://echo-lab-psi.vercel.app and sign in through Vercel protection and your existing Echo Lab account. The real workspace is connected to hosted storage and AI. `/demo` is an always-available fictional walkthrough; it saves no research and calls no provider.

## A short demo

Use a clearly named synthetic study and fictional responses. Keep a researcher window and a separate participant browser profile open. Finish the interview before presenting findings; previews do not count as research responses.

1. **Design:** choose **New study**, enter a focused learning goal, and open **Study design**. Save changes before **Draft with AI**. Review the proposed guide before applying it. For a short demo, retain one screener and one open question, with at most one follow-up.
2. **Publish:** choose **Publish revision**, then **Fielding → Open fielding**. Open the participant link in the separate profile. A participant who sees a closed study needs an active published revision.
3. **Interview:** consent, answer the screener and give a specific fictional example. Optionally consent to recording, record a short answer, review the transcript and continue. Text answers work without microphone permission. Finish the conversation.
4. **Inspect evidence:** open **Responses**, refresh, and choose **View transcript**. Show the original answer and recording. In **Analysis & report**, generate findings or create a manual evidence memo. Open a source citation and compare it with the original answer. Review the memo explicitly before sharing it.
5. **Follow through:** open **Research library → Collections**, create a collection containing the completed interview, then **Open review dashboard**. Add an assigned follow-up with a due date. Write a short handoff summary, select any eligible approved collection findings and unfinished follow-ups, complete requested reviews, then approve the current packet for export. Study analysis and approved collection answers have separate review workflows; reviewing one does not approve the other.
6. **Plan:** open **Research library → Research planning**. Filter to the collection and the month containing its due dates. Tasks and requested reviewers have separate rows. Save the view if useful. In **Operations report**, preview the current scope, review and acknowledge it, then download CSV or text.

Create tasks before final packet approval. Changing task content or dates afterward invalidates dependent handoff approval; refresh and review the current packet again. A reviewer deadline change alone preserves current-content approval. A packet without requested reviewers has no review-request calendar row.

## Recovery during a demo

Keep one reviewed synthetic example ready in your own workspace before presenting. The verification workspace is deleted after checks and is not demo seed data.

If AI is slow or unavailable, continue with the editable guide, text interview and manual evidence memo. Saved answers and recordings remain available. Check whether a write completed before repeating it. Failed report downloads require a fresh preview and acknowledgement. A copied download cannot be recalled after later source deletion.

For a presentation without account access or setup, open `/demo` and identify its examples as fictional. Email sending remains disabled: use participant links directly. No Resend account or domain is needed for this demo.

## Repeat the continuity check

After building, run `RESEARCH_TEST_PRODUCTION=1 npm run test:demo`. It creates a temporary local workspace through public application routes, completes a text interview, reviews a source-cited manual finding, creates a collection/task and authored handoff, approves/downloads the handoff, previews/downloads a planning report, and deletes the original response. It checks that the old packet and populated report become unavailable and the exact planning scope becomes empty. It uses no AI, hosted credentials, direct fixture inserts or existing research data.

The broader browser checks are `tests/browser.ts`, `tests/workflow-browser.ts`, `tests/reporting-browser.ts`, `tests/collection-handoff-browser.ts` and `tests/combined-planning-browser.ts`. Run each with `RESEARCH_TEST_PRODUCTION=1 npx tsx <file>` after a production build. Run them sequentially because several share a test port. They use synthetic media and provider fixtures where applicable.

## Verified result — October 23, 2026

No product blocker was found in the exercised paths. Production remains **`dpl_6QwucZeurSo4bbPvHdU9JRswdvrX`**, independently inspected Ready with working health. This milestone adds a regression check and documentation; no application code or production deployment changed.

Five compiled application browser suites passed: the core study/participant/findings journey; workspace defaults and guide workflow; reporting/media, actual MP4 generation and sharing; EN/ES/FR handoff review/export; and EN/ES/FR combined planning views/reports. The new end-to-end continuity test passes, as do standalone TypeScript and formatting checks. The preceding release's 568-test regression run remains its own baseline; it was not rerun for this documentation/test-only milestone.

Hosted verification completed **2026-10-23T23:23:40.515Z** with **14 passing groups and seven real provider calls**: guide generation, two bounded probes, synthesis, unsupported-question answering, transcription and read-aloud. No interpretation, transcription or embedding fixture replaced these calls. Both contrasting synthetic participants remained in the source-validated synthesis. A repeated transcription used the cached result and produced one transcription usage row. The same completed interview and recording then backed collection tasks, authored handoff review, combined planning and reviewed exports; deletion removed its private bytes and revoked dependent work. The authored handoff in this hosted run selected tasks and a summary, while the separate browser suite covered selected approved collection findings.

Observed request durations, including Vercel CLI/network overhead, were 13.1 seconds for the guide, 3.6/3.8 seconds for probes, 7.0 seconds for synthesis, 3.6 seconds for unsupported-question answering, 4.7 seconds for transcription and 4.3 seconds for read-aloud. These are single synthetic observations, not latency guarantees or human conversation measurements. Usage rows report text tokens and recording duration; they do not establish dollar cost or complete provider billing.

All synthetic workspaces, users, sessions, source records and recording bytes were removed. Existing account count and the full paused pilot record were preserved. Independent private-store detail/list checks both show **zero files / zero bytes**. Temporary production credentials and verification state were removed. Evidence is in `test-results/hosted-demo-evaluation.json`, `test-results/demo-journey-test.log`, the five `demo-*-browser.log` files and `test-results/demo-blob-*.log`.

## Remaining product validation

The [small internal pilot](internal-pilot.md) was prepared, then deferred again at Jess’s request. Admissions are paused. See [remaining work](remaining-work.md) for engineering options. After they complete the study, review original evidence, missed/incorrect interpretations, microphone behavior, response time and actual provider costs. Synthetic checks establish workflow mechanics and bounded provider availability. They do not establish human audio quality, representative research findings or billing accuracy. Human interviews and interpretation review are pending; no real participant was enrolled during preparation. Panels, actual incentive payouts, broader integrations and domain-dependent email remain later work.
