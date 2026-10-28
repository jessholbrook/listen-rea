# Uploaded concept images

Concept tests now support privately uploaded images alongside the existing text and HTTPS-linked image stimuli.

## Use

1. In **Study design → Concept testing**, choose **Upload concept image** within a concept. PNG, JPEG and WebP files up to 2 MB are supported. Static images are decoded, rotated, resized to fit 1600 × 1600 pixels and re-encoded as PNG with metadata removed; prepared output must fit 3 MB. SVGs, animation, mismatched types, malformed images and inputs above 16 million pixels are rejected.
2. Review the image and its accessible description. An upload replaces the concept's linked image URL. A concept uses one image source at a time.
3. **Save changes**, then **Publish revision** to use the image in new interviews. Uploading alone does not modify a guide or publish anything. Draft previews use saved draft references. Lost-response uploads can be retried with the same request ID, preserving the original asset and avoiding duplicates.
4. **Remove uploaded image from concept** detaches it from the local draft. Save and publish that change to stop showing it in new interviews. Existing interviews keep their original image reference and bytes.
5. Open **Uploaded images** to delete an unused upload. Files retained by a saved draft, history entry, revision, interview or Pulse baseline are protected from deletion. The original study's upload list owns deletion; copied guides in the same workspace can retain the same immutable image.

Researchers and collaborators with the existing guide-edit permission can upload/remove images; workspace membership is required to review them. Upload limits are 100 assets per study and 60 upload requests per workspace per process/minute. Changing an image creates a new immutable asset rather than overwriting an old image. Image descriptions remain translatable through the existing English, Spanish and French guide workflow.

## Private delivery and lifecycle

Images use the existing private recording storage adapter: local files in development and private Vercel Blob in production. They are research stimuli, not participant recordings, and have separate metadata documents. No new domain, service or environment variable is required. Image pixels, original filenames and storage addresses are not embedded in public study metadata or read-only API/MCP projections.

The researcher editor fetches pixels through an authenticated study endpoint. Participants fetch through an interview-token endpoint that checks the current concept against their frozen assigned guide. Unassigned, future, previous and unrelated image requests are denied. Public consent does not disclose concept assets. Current-concept projections retain only the shown image reference; the browser displays a temporary object URL and revokes it when the concept changes. Image load failures show a retry message in English, Spanish or French. Authorized participants can still save or screenshot images they see; this is not a one-time viewing or watermarking feature.

Saving and publishing validate that each referenced image exists in the workspace. Guide restore and new admissions validate references too. Copied guides, including Pulse baseline waves in the same workspace, can retain the same immutable references. Concurrent save/delete operations serialize so a saved reference cannot point to an image deleted in the competing request. References in history/revisions remain retained even after a concept is removed from the current guide. Source deletion or retention expiry removes that interview's access, while a stimulus shared with retained study versions remains available to those versions.

Deleting a genuinely unused asset immediately removes authorized access and records a content-free storage cleanup job. Successful deletion removes the bytes; failures remain queued for the existing deletion worker to retry. Deleted upload IDs cannot be reused, preventing delayed cleanup from deleting a later upload at the same path. Unused uploads are listed for manual deletion; this stage does not automatically expire saved study stimuli or prune revision history.

Images are shown to the participant. The moderator and analysis still use the concept text and participant evidence; no visual interpretation by AI is claimed.

## Verification

Meaningful checks cover raster normalization, identical/concurrent upload retries, schema/source/description validation, workspace isolation, token and current-concept boundaries, byte ranges, frozen reloads, replacement/removal, guide restore/copy, reference protection, save/delete races, unused-file deletion and deleted-ID rejection. Browser checks cover a lost upload response, editor/participant pixels, mobile layout, save/publication and retained original-image resume.

All 140 automated tests, strict TypeScript, production compilation, three compiled-server image lifecycle tests and concept-image/concept/branding/localization/Pulse browser checks pass. Hosted checks confirm private Blob upload/retry, normalized byte delivery, anonymous/direct denial, current-concept boundaries/ranges, frozen revisions, history restore, unused-file deletion and source access revocation. Synthetic Blobs and database/session records were removed; existing owners and the paused pilot were preserved. Human/vendor acceptance and Resend/domain/live-email setup remain deferred.

Source: [Listen Labs concept testing](https://docs.listenlabs.com/setup-to-launch/concept-testing). Image limits and authorization/retention behavior above are Echo Lab's implementation contract. Video stimuli, prototype embedding, timed presentation, watermarking and signed NDAs remain separate features.

Prototype links and tasks are implemented; see [prototype contract](prototype-concepts.md). Private video concepts are implemented; see [video rules](concept-videos.md). Next proposed build for approval: **timed concept presentation (F11)**.
