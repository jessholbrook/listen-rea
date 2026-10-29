# Visual Insights: reviewed screen observations

October 19, 2026 · P5 initial review stage

Open a study’s **Visual Insights** tab to annotate private screen recordings or permission-confirmed imported videos from completed, included responses. Manual notes work without an AI key. Each note separates visible content, researcher interpretation and uncertainty. Confirming a note requires a review attestation; pending and rejected notes stay out of Q&A and CSV exports.

## Sampled-frame proposals

Choose a 0.5–30 second range and 3–6 frames, then explicitly permit sending these screen images to the configured AI provider. The server decodes frames using the packaged FFmpeg binary, limits images to 960 pixels wide and attaches actual decoded timestamps and SHA-256 digests. Screen recordings retain independent capture offsets; a clip timestamp is not elapsed study time. Imported videos have no inferred session clock.

The model receives the task prompt and sampled images, without audio or the participant account. It proposes visible descriptions, tentative interpretations and uncertainty. Every proposal starts pending. References must identify supplied frames; a visible-change claim requires at least two frames. Proposal timestamps derive from the latest referenced frame. Researchers can edit descriptions but cannot move an AI proposal away from its source frames; create a manual note for another timestamp.

Run records retain model, prompt version, reporting language, source fingerprint, requested and decoded times, frame digests and attempt count. JPEGs are transient: extraction files are removed in a finally block and private frame previews are decoded again and verified against saved digests. Original source files retain the existing private 3 MiB limit. One analysis runs per workspace; a 120-second deadline and 150-second lease bound execution. Failed runs can retry with the same request ID. Completed retries return the saved run and preserve researcher edits instead of generating duplicate notes.

## Review and evidence

Play or seek the original recording before confirming a proposal. Versioned history retains the original AI wording and subsequent researcher changes. Optional account comparisons require an exact quote from the linked written answer or imported transcript plus a researcher explanation. A written post-task reflection is not a spoken transcript. A comparison is an interpretation, not a verified contradiction.

Q&A uses only confirmed, reviewed observations and verifies citation quotes against saved descriptions. Unsupported answers abstain. Explicit requests for click counts, task success/duration and mental-state metrics are declined before model generation; this is a conservative screen-state-only question boundary, not a behavioral classifier. It rechecks the evidence after generation and rejects stale results. CSV includes recording/turn/revision identifiers, video and applicable capture time, provenance, model/frame metadata and review information.

Workspace access checks apply to recordings, frames, notes, history, runs, Q&A and exports. Excluded, incomplete and preview responses are unavailable. Deleting a response or retention purging it removes its visual notes, histories and runs along with source media. Deleting an individual note removes its history; deleting a run removes its associated notes and histories. A content-free concurrency lease expires if execution is interrupted.

## Validation and limits

The annotated 12 fps synthetic fixture in `tests/fixtures/visual-events.json` defines a four-second video with a HOME/HELP screen followed by SUPPORT/CONTACT. Tests compare decoded timestamps and header colors against this independent timeline, check repeatable frame digests, review gates, exact-account quotes, version conflicts, workspace isolation, exclusion, deletion and retry behavior. All three sampled frame times and header colors match the fixture timeline; repeated extraction produces matching digests. Browser checks cover manual review/history, playback seeking, export and mobile layout. Hosted synthetic checks exercise the actual configured vision model and private storage.

This validates software plumbing and a controlled screen-state example. It does not establish accuracy on real participant recordings, action recall, behavioral metrics or human research quality. Sparse frames cannot establish click counts, input method, task success, intent, emotions or actions between frames. [Participant-requested live screen guidance and refocusing](richer-interviewing.md) are now implemented, together with explicit task timer/outcome controls. Continuous automatic visual moderation, automatic off-task classification and automated say/do measurement remain further work; sampled-frame review does not acquire those capabilities. Human review remains deferred at Jess’s request.
