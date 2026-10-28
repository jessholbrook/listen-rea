# Private video concept stimuli

**Study design → Concept testing → Upload concept video** accepts MP4 or WebM clips up to **3 MB and 60 seconds**. The researcher supplies a text alternative covering speech and important visual content before saving. It supports up to 6,000 characters and participates in the existing reviewed English, Spanish and French guide translations.

## Use

1. Upload a short clip within a concept. The server decodes and normalizes its first video track and optional first audio track into MP4 (H.264/AAC), up to 1280 × 720 at 24 fps. Metadata, chapters and extra tracks are removed. Prepared output must fit 8 MB. Malformed/mismatched files, excessive duration, frames above 16 million pixels and processing timeouts are rejected. Inputs remain below the hosted request-size limit.
2. Write the **Video text alternative (speech and important visuals)**. Describe what a participant needs to understand, including dialogue and important visual changes. This text appears alongside the video under **Video text alternative**. Review translated text before enabling a language. Captions are not generated automatically and this stage does not add timed caption tracks or audio description.
3. Review the editor player, then save and publish the guide. Uploading does not modify or publish a guide. Saved draft previews use saved draft references; real interviews use the published version. Videos can accompany text, images, prototype links and task instructions.
4. Participants choose when to play, pause, seek, change volume or use fullscreen through native controls. There is no autoplay or mandatory playback gate. The browser stops/releases a clip when its concept changes. Text alternatives and load/retry messages support English, Spanish and French.
5. **Remove uploaded video from concept** clears its local video reference and text alternative. Save/publish to apply this to new interviews. Existing interviews retain their original video and text. **Uploaded videos** lists files and lets editors delete unused uploads.

The fixture used for testing is a synthetic colored screen with a short tone; it does not establish the quality of real research stimuli or translations. Review the actual clip and text before a live study.

## Private storage and versions

Videos reuse the existing private storage adapter and deletion worker. There is no public asset URL, new provider, domain or environment variable. Guide editors can upload and review video pixels; workspace access is required. A participant's interview token authorizes only the current concept's video from their frozen assigned guide. Future, previous, unassigned and unrelated requests are denied. Public consent and external read-only API/MCP projections do not gain video metadata or pixels.

The browser fetches authorized bytes into a temporary object URL, then uses native video playback. Object URLs are revoked and playback stopped on transition/unmount. Server endpoints support authorized byte ranges, while browser playback uses the fetched local blob. Clips are small and fetched in full before playback; this is not an adaptive streaming service. Authorized participants can save or record material they see; no DRM or one-time viewing is claimed.

A retry with the same upload ID and bytes reuses the original immutable asset. Different content at the same ID is rejected. Image/video/recording IDs and deletion tombstones cannot be reused across media types. There are at most 100 video assets per study, and image/video uploads share the existing per-process workspace rate cap of 60 requests per minute.

Saving, publication, restore and admission validate video references. Existing interviews, history/revisions and copied guides/Pulse baselines in the same workspace retain original bytes and descriptions. A saved reference or concurrent save protects a video from deletion. Unused deletion immediately revokes access and deletes the private bytes; a content-free cleanup job remains for retry if storage removal fails. Deleted IDs cannot be reused. Participant response deletion/retention removes that source's access but does not delete a stimulus still retained by study versions. Unused uploads are managed manually; there is no automatic pruning of revision history.

Video is participant context. The moderator/analysis use concept text and participant evidence; this feature does not add AI video interpretation, watch-time tracking or task-success measurement.

## Verification and next item

Checks cover decodable MP4/WebM normalization, preserved sample color/audio, duration/type/size limits, required and translated text, private/current-concept delivery, ranges, concurrent retries, immutable versions, history/copy, save/delete races, cross-media ID protection, deletion and revoked source access. Browser checks cover a lost upload response, actual native playback/seeking, no autoplay, text alternatives in all three languages, dark/mobile layout, frozen resume and stopping playback on progression.

All 149 automated tests, strict TypeScript, production compilation, three compiled-server video lifecycle tests and video/image/prototype/localization/Pulse/branding browser checks pass. Independent decoding verifies sample color and tone frequency/energy. Hosted checks confirm private Blob processing, decodable MP4, byte delivery/ranges, anonymous/direct denial, frozen video/text, history restore, deletion and source access revocation. Synthetic Blobs, database records and sessions were removed; existing owners and the paused pilot were preserved. Human/vendor acceptance and Resend/domain/live-email setup remain deferred.

Source: [Listen Labs concept testing](https://docs.listenlabs.com/setup-to-launch/concept-testing). Echo Lab's limits, text-alternative requirements, normalization and lifecycle are its own implementation contract.

[Timed concept presentation](timed-concepts.md) is implemented. [Single-/multiple-choice image answers](answer-images.md) are implemented. [Ranking and MaxDiff image answers](ranking-maxdiff-images.md) are implemented. [Study media watermarks](media-watermarks.md) are implemented. [One-time concept video viewing](one-time-video.md) is implemented. Next proposed build for approval: **participant confidentiality acknowledgements (F11)**.
