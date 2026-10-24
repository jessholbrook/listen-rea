# Study media watermarks

Uploaded concept images/videos and image answer options can now use a separate private copy with a visible **ECHO LAB CONFIDENTIAL** mark. Open the upload controls in Study design and choose **Watermark this image** or **Watermark this video**. Preparation finishes before the marked copy is attached to the draft. Save, review translations and publish to apply it to new interviews. Turn the checkbox off to select the original again.

The fixed, translucent vector label appears in three separated bands. It is baked into PNG pixels and video frames, including full-size images and native video fullscreen; it is not a removable page overlay. It is intentionally the same English label in every language. Custom text, participant names/IDs, organization-specific marks and forensic tracking are outside this stage. Text alternatives and descriptions keep their existing reviewed translation workflow.

## Versions and storage

Marking creates an immutable asset with a new ID and retains its original. Concurrent/repeated requests reuse the prepared copy. Turning marking off restores the original reference and does not rewrite the marked file. Existing interviews, previews, history, copies and tracker baselines retain their saved asset IDs when a later draft/publication turns a mark on or off. Changing a media reference also changes the guide translation fingerprint; review translations before offering the new publication in another language.

Original and marked files use the existing private Blob store and image/video endpoints. Participant tokens can read only the saved current concept, ranking/choice options or current MaxDiff task's asset IDs; knowing an original ID does not authorize its bytes. Existing timing, source revocation, byte-range and no-store rules apply to both copies. Researchers with workspace access can inspect originals; preparation requires edit access.

A marked copy counts as an additional upload under the existing per-study limit of 100 images or 100 videos. Image inputs remain bounded to 2 MB and prepared PNGs to 3 MB; video inputs remain bounded to 3 MB/60 seconds and prepared MP4s to 8 MB. Marking operates on normalized private uploads, preserves dimensions and copies the existing video audio stream. Bounded processing/size failures leave the draft's current asset unchanged and offer an error. External image URLs, prototype pages, participant recordings and report/reel exports are outside this stage.

Saved guides/history/sources/trackers protect retained copies from deletion. A marked asset record also protects its original so the researcher can turn the mark off later. In **Uploaded images/videos**, remove unused marked copies before their originals. Original cache pointers do not retain a deleted marked copy; marking again after an unused copy is deleted creates a fresh ID. Both files follow their existing private deletion jobs independently. No new provider, domain, environment variable or dependency is required.

## Limits and verification

A watermark discourages casual sharing. It does not prevent screenshots, recording, cropping, editing or copying, and it is not an NDA or access-control replacement. Marks may affect stimulus appearance; preview the marked material before a real study. Very small media has limited room for a readable mark.

Pixel tests verify visible changes in three image bands while preserving original bytes and outside pixels. Independently decoded video frames at two playback times retain the marks, dimensions/duration stay consistent and decoded audio matches the original. HTTP tests cover concurrent/repeated preparation, cache reuse, original restoration, private/workspace controls, publication/reload isolation, timed access, range delivery, protected deletion and fresh IDs after unused-copy removal. Browser checks cover both toggles, native playback, actual private pixels, frozen-session resume and mobile/dark layout.

All 165 automated tests, strict TypeScript, production compilation, two compiled-server watermark lifecycle checks and watermark/concept-image/concept-video/image-answer/ranking-MaxDiff/timed-concept browser checks pass. Hosted verification confirms baked private media, cache reuse, original restoration, immutable session references and protected deletion. Synthetic copies/originals, workspace and sessions were removed; existing owners and the paused pilot were preserved. See [deployment evidence](vercel-deployment.md).

Source: [Listen Labs watermark study images and videos](https://listenlabs.com/whatsnew/watermark-your-study-images-and-videos), reviewed October 20, 2026. It announces a toggle on uploaded study images/video. Echo Lab's separate-copy lifecycle, fixed label, processing limits and privacy rules are its own contract.

[One-time concept video viewing](one-time-video.md) is implemented. Next proposed build for approval: **participant confidentiality acknowledgements (F11)**.
