# Reporting and media expansion

Echo Lab’s **Reports & media** now includes AI clip suggestions, reviewed reels spanning studies in one workspace, and private static PowerPoint imports. These are internal research workflows. Human audio quality, interpretation and native PowerPoint rendering still require review.

## AI clips

Choose **AI clips**, select a recording and explicitly allow OpenAI to receive its audio and linked answer. The server decodes audio before contacting a provider and checks the actual duration against saved metadata. Limits are 3 MB and five minutes; video frames are not sent. One suggestion request can run per workspace at a time, with six attempts per minute.

The quote model proposes up to three exact answer passages and neutral captions. A separate `whisper-1` transcription provides word timestamps. Only unique contiguous word matches of at least three words become proposed ranges; missing, repeated, unsupported or overlong matches are omitted. Ranges use 150 ms before/200 ms after the aligned words, clamp to the recording and cannot exceed 30 seconds. Timing is an estimate, not verified speech segmentation.

Listen to the range, edit its name, exact quote, timing or caption, and explicitly mark it reviewed before saving. Changes reset review in the editor. Saved clips retain server-owned model, run ID, source digest and edit provenance; the suggestion run also records its alignment method. They can be edited and rendered through the existing manual clip workflow. An accepted clip does not automatically become a finding or a reel.

Request IDs prevent a completed generation or acceptance from creating duplicates. Failed, interrupted or expired generation requires an explicit new request; paid requests are not automatically retried. Source/goal changes invalidate old suggestions, and erasure removes drafts. Provider billing after an ambiguous failure is not guaranteed exactly once. Consent, the canonical answer, recorded speech and human review all matter: abstention is expected when typed text differs from audio.

API: `GET/POST /api/studies/:id/clip-suggestions`, `POST /api/studies/:id/clip-suggestions/:draftId/accept`. Generation requires `requestId`, `mediaId`, the current server fingerprint and `aiConsent:true`. Acceptance requires the current fingerprint, suggestion index, a new request ID and a reviewed manual-clip payload. Provider credentials stay server-side.

## Cross-study reels

Under **Clips & reels**, enable **Include reviewed clips from other studies in this workspace**. Choose eligible reviewed clips, check their order/context, review and save the reel. The catalog shows up to 500 recent eligible reviewed workspace clips. Existing same-study reels retain their original scope. A reel remains limited to 60 seconds.

Rendered captions identify each source by its current study title and ID prefix. The title is bounded to 60 characters, with whitespace normalized. Download the source manifest to retain full study/clip/media IDs, exact quotes and original/rendered timing. Source labels identify context; combining studies does not establish equivalent samples, prevalence or a pooled finding.

Every cross-study render binds the source studies’ data versions/titles and the reel/clip versions. Current source eligibility is checked before rendering and downloading/sharing. Clip edits remove dependent outputs across the workspace. Source erasure removes dependent reels, jobs, shares and private outputs, while unrelated reels remain. Native background rendering uses the existing Vercel Queue workflow.

API: the existing reporting reel input accepts optional `crossStudy:true`. `GET /api/studies/:id/reporting/jobs/:jobId/sources` returns the current authenticated source manifest.

## Import slides

Under **Import slides**, upload an existing presentation, confirm permission for private storage, download/review the original and mark it reviewed. Select a current reviewed report edition and confirm the combined export. The output keeps original slides first and appends editable cited report slides, using the original slide dimensions and letterboxing generated content when needed. Imported content stays user-supplied context; Echo Lab does not validate it as research evidence.

Supported: standard transitional, unencrypted static `.pptx`; up to 2 MB and 50 original slides, five imports per study, 100 combined slides and 3 MB output. Macros, embedded objects, SVG and external media are rejected. HTTPS hyperlinks are preserved. This is a bounded PPTX import workflow; arbitrary presentation formats and full Office fidelity are outside this milestone.

The package reader bounds entries, expanded bytes, XML size/depth and relationships, checks CRCs and rejects traversal/active content. Composition keeps original slide/theme/layout/notes/media part bytes and rebases copied report relationships/content types. Package and browser tests verify structure, byte preservation and citations. No native Office/LibreOffice renderer was available for a pixel-fidelity check; open and review the resulting deck in your presentation app before presenting it.

Source changes make an import stale; remove and import a current version to export again. Source erasure deletes private originals and metadata. Composed decks are generated on demand rather than retained. Downloaded copies cannot be revoked.

API: `GET/POST /api/studies/:id/presentation-imports`; upload a PPTX body with consent, request ID, encoded name and current source version headers. `PUT /:importId` reviews a version; `GET /:importId/file` downloads the private original; `POST /:importId/compose` binds reviewed import/report versions and final review; `DELETE /:importId` removes a versioned import.

## Verification

The focused package/HTTP suite covers independent alignment expectations, malformed/active packages, original-part preservation, real FFmpeg rendering, scope and review gates, retry deduplication, source invalidation, physical erasure and late-generation rejection. The browser workflow exercises consent, playback, edited clip acceptance, cross-study rendering/source downloads, imported-original review, composed exports and mobile layout. Browser quote/transcription providers are marked fixtures; hosted verification separately uses actual provider calls with synthetic speech. Human research validation remains deferred.

Next proposed milestone: **External recruitment and automation**. Provider accounts, chosen integrations and explicit spending/launch controls will define that scope.
