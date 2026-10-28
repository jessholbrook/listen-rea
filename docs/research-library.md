# Research Library

Research Library is a workspace view of completed, included responses, including reviewed external interviews. It provides keyword and optional meaning-based retrieval, source drill-down, optional cited AI answers and CSV participant attributes. Human research-quality evaluation remains deferred.

## Search and ask

Open **Research library** in the workspace navigation. The existing folders, saved audiences and workspace defaults remain under **Study resources**. Library links preserve `?library=1` across reloads.

Search all studies in the signed-in workspace, or select individual studies. An exact attribute name/value filter applies to both search and Q&A. Preview, excluded, active, screened-out and withdrawn responses are omitted. Search is keyword retrieval over original answer text, question prompts, study titles and import titles, in the default keyword mode. Optional [meaning-based retrieval](library-semantic-retrieval.md) uses an explicitly built private index and preserves source filtering and exact citations. Results show study, respondent, turn, guide revision and concept IDs. Open the full source to review speaker labels, attributes and authenticated media, or open the study’s responses.

AI Q&A retrieves up to 30 matching excerpts within 50,000 source-text characters. Every returned citation must be an exact substring of a supplied excerpt with the matching study/response/turn IDs. The server rechecks the selected response set after generation and rejects results if it changed. No citations means an explicit insufficient-evidence answer. Citation validation establishes source matching, not valid interpretation or coverage. Review the answer and its sources; keyword retrieval can miss relevant evidence. Cross-study context is retained; the system does not establish longitudinal change, population estimates or comparable samples.

Search and source access work without an AI key. Q&A requires the existing provider configuration. Answers are transient and are not saved into a separate index or chat history. Refreshing the library clears displayed search/answer state. A previously displayed or downloaded quote cannot be recalled from another person’s browser.

## Attachment evidence

The separate **Attachment evidence** tab searches explicitly included verified PDF/DOCX/PPTX excerpts and researcher image/PDF/DOCX/PPTX observations across studies. It provides typed citations, current-source drill-down, study/attribute/file/evidence filters and cited Q&A with source revalidation. [Explicit saved drafts and reviewed exports](library-saved-answers.md) extend attachment Q&A while ordinary Ask remains temporary. See [the complete contract and limits](library-attachment-evidence.md).

## External interview and media imports

Choose a destination study, then add reviewed `.txt` transcripts and optional media. Up to ten interviews can be queued. Pair files by filename stem, for example `alex.txt` and `alex.mp4`; each transcript supports 12,000 characters. Alternatively paste a transcript manually. Keep one interview per import and retain explicit speaker labels. Automatic transcription, diarization and timestamp alignment are not provided by this importer.

Review each source title, external identifier, transcript and matching recording, and attest that you have permission to store/analyze the material. These are researcher attestations, not proof of participant consent. A completed external response records the importer, import time, external ID, frozen question/guide context and review attestations. The import time is not the interview’s original date. External IDs are unique within a study. Repeating the same request reuses its response; reusing a request ID with changed content is rejected. Imports do not consume the live recruited-participant admission limit.

Supported optional media: WAV, Ogg, audio MP4/WebM, video MP4/WebM, up to 3 MiB and ten minutes. Video must contain an audio track. The server decodes media with the bundled FFmpeg, measures duration and rejects undecodable or out-of-bounds files. Files stay in private storage. Each import supports one recording. Identical attachment retries reuse the saved recording; changed bytes are rejected. To replace a saved transcript/recording, delete its response and reimport.

Each queue item reports success or failure separately. If a transcript saves but media fails, the response remains in the study and library; retry attaches the original queued file. Removing an item from the queue does not delete its saved response. Keep the page open until uploads finish; local queue files are not persisted across reloads.

Imported responses participate in existing study analysis, exact-quote coding, reports and clips. Memos distinguish external evidence from the self-recruited workflow. Response/source views label external transcripts and prompt speaker review. Imported videos appear as imported video in the clip selector; their renderer uses the existing video normalization path. Captions and clip timing still require manual review. Imported text can include interviewer speech; exact matching alone cannot identify its speaker. Concept/revision-scoped analyses do not silently treat an import as an assigned concept interview.

## Participant attribute CSV

Download the selected study’s response-ID template, or prepare a CSV whose first header is `response_id` or `external_id`. External IDs match imported responses only. Add 1–20 unique attribute columns and at most 200 data rows. Names begin with a letter and allow letters, digits, spaces, hyphens and underscores (60 characters maximum). Values support quoted commas/newlines and up to 500 characters; a response supports up to 30 attributes in total.

Preview before applying. The preview shows exact matched IDs, existing values, replacements and every unmatched, repeated, malformed or ambiguous row. Matching is case-sensitive and confined to the selected study; names/emails are not guessed. Fix every error before applying: the update is atomic. A fingerprint rejects apply requests after response/attribute changes. Blank cells explicitly replace values with empty strings; attributes not listed remain intact. Updates preserve the participant turn counter and invalidate existing analysis/report versions for fresh review.

## Access, deletion and recovery

The current permission model grants invited workspace members access to their workspace’s studies. Every library/import/CSV/source request enforces that boundary; passing another workspace’s study/source ID does not grant access. Public participant tokens do not grant library access. Media uses existing authenticated byte-range routes and private Blob storage.

Imports are response documents, so existing exclusion, source deletion and request-driven retention apply. Deletion removes transcript, attributes, provenance, media and study-derived analysis/report/clip/reel data through the existing retryable media cleanup. The frozen import context is stored only inside the response, rather than leaving transcript-related context in separate revision history. Library retrieval reads current responses directly and retains no independent copy of deleted evidence.

Media attachments reserve a content-free cleanup record before writing. An interrupted write is eligible for cleanup after five minutes; successful attachment removes the record atomically with metadata commit. Retention/cleanup runs on application requests, not an independent scheduler. No new service or environment variable is required. Existing deployment protection, Turso, private Blob, provider key, FFmpeg and caption font configuration continue to apply.

## Verification and scope

`npm test` includes CSV parsing, exact citation validation, retrieval/provenance, cross-workspace access, idempotent imports, matching errors, stale previews, native active-interview compatibility, real audio/video decode/attachment, imported clips, exclusion and deletion checks. `npm run test:library` covers paired batch import, CSV preview/apply, filtered search, source playback, deletion, reload and mobile layout. Run browser suites sequentially because they share port 3101.

After `npm run build`, run `RESEARCH_TEST_PRODUCTION=1 node --import tsx --test tests/library-http.test.ts` to check the compiled server, including private media inspection. Large-file resumable uploads, large resumable imports and persistent cross-study chat remain later work.

Public sources reviewed October 19, 2026: [Listen Labs Research Library](https://docs.listenlabs.com/insights-and-reports/research-library), [thematic analysis/external data](https://docs.listenlabs.com/insights-and-reports/thematic-analysis), and the previously inventoried [video imports announcement](https://listenlabs.com/whatsnew/introducing-video-imports). Echo Lab’s reviewed transcript pairing, limits and keyword retrieval are implementation choices rather than a full-parity claim.

[Reviewed transcript answers](library-transcript-answers.md) add server-generated saved drafts, immutable originals/review history, approved exact-citation exports and mixed transcript/attachment briefs. Original speaker context and turn offsets remain distinct from document evidence. Source withdrawal, uncited input erasure and retention remove complete dependent copies.
