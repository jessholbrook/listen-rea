# Reports, presentations and media

This module adds independent report editions, reusable presentation styles, editable PowerPoint export, reviewed clips and reels, captions, private MP4 rendering and expiring share links. Human research-quality and media-review acceptance remains deferred.

## Report editions

Open **Reports & media → Report editions**. Create an edition from a current shared-question or concept/revision analysis. The edition copies the analysis summary, findings, exact citations and limitations. It records the source analysis/version, response-set version, included sample size and concept scope. The original analysis memo is retained.

Edit the title, block headings and narrative, reorder or remove blocks, hide blocks from export, and add exact citations from included participant answers. Hidden blocks stay in saved history but are omitted from exported slides and shared report text. Narrative is researcher-written; exact-citation validation does not establish a correct interpretation. Each save creates a version snapshot. Restoring a snapshot creates another version and clears review, rather than overwriting history.

The review checkbox applies to the current saved edition. Editing content or style clears local review until explicitly checked again. Review is required for PowerPoint export and share links. Optimistic version checks reject conflicting saves. Source quotes must still match completed, included, non-preview responses in the edition’s original analysis scope.

When the response set changes, exports and shares stop working. Correct/remove any invalid citations and save edits, then **Rebase to current responses** and review again. Rebase validates retained citations and updates the included sample count and response-set version; it does not regenerate narrative or silently replace the source analysis. A concept edition cannot acquire citations from another concept or revision.

## Editable presentation export

Admins can create workspace presentation styles with a name, brand text, accent color, footer and Arial/Georgia font. Other editors can use a saved style or customize an edition’s copied style. Styles are copied, so changing or removing a workspace style does not alter existing editions.

**Export editable PowerPoint** produces a `.pptx` with editable text, visible report blocks, exact source quotes, participant/turn IDs, provenance and review information. Long blocks/quotes continue across slides; citations are retained in visible source slides and slide notes. Hidden blocks are excluded. Exports have a 3 MiB response limit. Rendering is deterministic document generation, not an AI layout agent. Arbitrary PowerPoint layout uploads, logos, chart generation, embedded reels, PDF generation and AI report rewriting remain later work.

## Clips and captions

In **Clips & reels**, choose a saved voice or screen recording from a completed, included response. Select a range of 0.1–30 seconds inside that recording, copy an exact quote from its linked participant answer, and enter an optional researcher caption of up to 180 characters. Preview the selected range and explicitly review the timing, quote and caption before including the clip in a rendered reel.

Audio evidence is linked to its saved answer. Screen evidence is linked to the task’s written reflection; the screen narration is not automatically transcribed. A quote’s presence in an answer does not establish when it was spoken in the recording. Timing and interpretation need manual review. There are no automatic word timestamps, AI-selected clips, visual observations or task-success metrics in this module.

The caption is researcher-authored context shown for the whole selected clip, not automatically aligned speech subtitles. Clip captions can be downloaded as WebVTT. Caption markup is escaped and newlines normalized. The renderer burns the reviewed caption into the video. Reel WebVTT uses measured rendered segment boundaries, including encoding duration adjustments, so later captions retain the rendered order/timing. Timing is limited by video/audio frame resolution.

## Reels and render jobs

Choose up to six reviewed clips, totaling no more than 60 seconds. Reorder or remove clips and review the reel’s selection, order and context. A clip can occur once per reel. Reels are restricted to one study; cross-study reels are later work.

**Create render job** persists a queued job with the reel version, clip versions and response-set version. **Render now** claims a workspace lease and renders inside that request. This is a bounded request-driven queue, not an independently scheduled background worker. Only one render can run per workspace. A failed or interrupted job remains visible and can be retried; a stranded running job becomes retryable after its 150-second lease expires. Completed-job retries reuse the output instead of duplicating it. Closing the browser is not a promise of background completion.

FFmpeg reads only authenticated, stored source files. It trims clips, normalizes them to 854×480 at 12 fps, combines screen video/narration, uses a caption card for voice-only clips, burns captions, and assembles an H.264/AAC MP4. Encoding is bounded by a 120-second job deadline, with a 3 MiB output limit. Shorten a reel if it exceeds the download limit. Actual durations are checked against selected ranges; invalid or undecodable source material produces a failed job, with no downloadable partial output. Quality and duration can differ slightly from the original due to frame boundaries and compression. Original recordings remain available for source review.

Jobs reserve their output IDs before writing to private storage. Retries/deletion can therefore clean up objects left by a lost acknowledgement or process interruption. Before completing or serving a job, the app rechecks source access, review state, versions and the response set. Edits to a clip/reel invalidate and remove its derived jobs/outputs. Removing a clip also removes it from reels and clears affected reel review. Workspace presentation styles are not media render templates.

## Sharing, access and deletion

Reviewed editions and completed reviewed reels can receive a seven-day view-only link. Edition links include text, citations and PowerPoint download; reel links include MP4 playback/download, source quote context and WebVTT download. Anyone with a valid link can access those resources at the application layer; this deployment also retains Vercel Deployment Protection. A link permits reading/downloading, not editing source research.

**Revoke all study share links** also revokes the original memo’s links. Editing/regenerating analysis, editing an edition, or invalidating derived media can revoke study-wide links conservatively. Source-set changes block existing links. A link does not bypass the app’s review, version, scope or source checks. Raw source recordings remain workspace/interview-token protected; rendered outputs are not exposed through the generic recording-ID route. Direct private Blob URLs do not grant anonymous access.

Deleting a response or applying retention conservatively clears all report editions/history, clips, reels and render jobs for that study, as well as derived video objects, through retryable private-media cleanup. This prevents participant quotes surviving in old snapshots or rendered captions. Exclusion marks outputs stale without deleting the source recording. Downloaded files cannot be recalled; server revocation affects future access.

## Verification and limits

Automated checks cover exact citations, hidden-block omission, editable slide text/provenance, caption timing/escaping, clip bounds/order, decoded audio/screen rendering, failed-job persistence/retry, conflicting edits, source scope, stale exports, original-memo preservation, template copies, sharing/revocation and response/media deletion. `npm run test:reporting` covers the browser workflow and mobile layout. All browser suites and the default HTTP suite share port 3101 and must run sequentially.

Use `npm ci` with Node 24 to install the locked dependencies. The application uses the package-provided FFmpeg binary and bundled DejaVu caption font; production file tracing includes both. No system FFmpeg install is needed by the renderer. The font license is in `assets/DejaVuSans.LICENSE`. Uploaded recordings and test render sources are synthetic in automated checks. These checks do not establish research quality or long-running production reliability.

Next.js bundles PptxGenJS because its ESM entry uses a `.js` extension without declaring ESM in its package metadata. Keep it out of `serverExternalPackages`. After building, run `RESEARCH_TEST_PRODUCTION=1 node --import tsx --test tests/reporting-http.test.ts` to exercise the compiled server, including PowerPoint export and private rendering. The lockfile overrides PptxGenJS’s transitive `image-size` dependency to patched version 2.0.4; the production dependency audit reports no known vulnerabilities.

Sources reviewed October 19, 2026: [Listen Labs clips/reels](https://docs.listenlabs.com/insights-and-reports/clips), [workspace presentation templates](https://docs.listenlabs.com/insights-and-reports/presentation-templates), and the previously inventoried [report editing/editions announcement](https://listenlabs.com/whatsnew/report-editing-and-editions). The announcement currently resolves to the public marketing shell. Echo Lab’s saved style presets, manual caption review and bounded renderer are implementation choices; arbitrary-template analysis and AI reel selection are not claimed as parity.


## Background processing — October 28, 2026

The original **Render now** control remains request-driven. Reviewed native render jobs can also be queued through [background jobs](background-processing.md), with progress, cancellation, bounded recovery, current-source validation and delayed private-output guards. Native workers continue after the producer response and browser close.
