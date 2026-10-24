# Desktop usability

Deployed at https://echo-lab-psi.vercel.app on October 19, 2026. This module adds usability task prompts, optional browser screen/microphone capture, recoverable private clips and researcher playback. Human evaluation remains deferred while the build continues.

## Configure tasks

In **Study design**, select an open-ended question and enable **Usability task with optional screen recording**. The question wording becomes the task prompt. Add an optional HTTPS destination without embedded credentials and choose a recording limit of 30–600 seconds per sharing session. Follow-ups are disabled for tasks. Save, preview and publish as usual; publishing does not open fielding.

Screen tasks use the guide’s existing routing and immutable interview snapshots. Restoring history retains task settings. Applying a conversational AI guide replaces task settings after review, so configure tasks again before saving. Screen tasks may also be repeated for assigned concepts. They do not navigate or inspect the destination on the server, inject code into it, verify success, log clicks or generate visual observations.

## Participant capture and consent

Participants first consent to the study, then separately consent to recording their chosen screen/window/tab and microphone. **Share screen and microphone** invokes the browser’s sharing chooser and microphone permission. Permissions are requested for every new sharing session. Recording does not start automatically, on refresh or on arrival at a task. Camera and system/tab audio are not requested. The participant can open the task website in a separate tab, narrate their actions, stop sharing at any time and provide a written reflection.

Capture requires a secure context, desktop display capture, microphone access, MediaRecorder and WebM support. Chrome/Edge desktop are the intended initial browsers. Mobile/native app capture is not included. Unsupported devices and declined permissions have an explicit written-response fallback. This is optional capture, so a complete written response is not evidence of a recorded task or observed success.

A visible sharing indicator, elapsed time and **Stop sharing and save** control remain available while recording. Ending browser sharing or losing the microphone also stops the session. The recording limit stops capture automatically. Task progression waits for recording to stop and saved clips to upload; a server check prevents advancing while a sharing session is unclosed. Voice-answer recording is hidden on tasks to avoid concurrent microphone workflows. Narration is saved with the screen video and is not automatically transcribed. Existing AI synthesis uses the written reflection, not screen behavior or narration.

## Clips, recovery and timing

Video and microphone audio are muxed into the same WebM recording, using the browser’s common media clock. Recording rotates into independent, playable clips roughly every 12 seconds. Each private upload is limited to 3 MiB and 20 seconds. Browser monotonic offsets and durations are stored with the clip, task/question ID, interview version and consented sharing session. The server validates ordering, time bounds and scope; byte digests and stable clip IDs make exact retries idempotent and reject changed payloads under an existing ID. A retry can also recover an identical object whose storage acknowledgement or database commit was lost.

Completed clips are saved in IndexedDB before upload and removed after acknowledgement. Interrupted uploads can be retried from the same browser. On refresh, the participant can **Retry saved clips and close previous session**, then explicitly consent and share again as a new session. Existing clips and their original offsets remain fixed. Refresh/navigation can lose the current, unfinished clip; the app warns before leaving during capture. Separate sessions and gaps are preserved rather than presented as a continuous recording. Browser-reported timestamps are not independently verified behavioral metrics.

When uploads cannot keep up, sharing stops after five pending clips. Browser/storage/size failures are visible. Participants can retry, or explicitly discard unsaved local clips and continue with a written response; already uploaded clips remain with the response. Local pending clips expire after 24 hours and are removed on the next access to this local store, not by a background deletion service. The team’s server deletion cannot remotely erase browser-local pending data. Use the explicit discard control when leaving a shared computer. An in-memory clip cannot be recovered if local storage fails before it is saved.

There are at most ten sharing sessions per task turn and sixty clips per session. Browser bitrate and resolution requests are targets, not guarantees; unusually large clips can require discarding the unsaved clip. Native picker behavior, real microphone quality, background-tab timing, browser crashes and long-session reliability still need human verification.

## Review and deletion

Open a response transcript to see **Task screen recordings**, choose a task/session and play a clip. Screen and narration play together; a session timeline and clip buttons seek by recorded offset. Gaps show that no saved recording exists at that time. Sessions are listed separately, with their task prompt and consent time. An unclosed session does not establish that a participant is still actively sharing. The player does not automatically skip gaps or concatenate recordings. Task-related source drill-down also shows the relevant recordings.

Written reflections are associated with the task, not word-level narration timestamps. Review recordings manually before inferring task success, hesitation or other behavior. Automatic transcripts, click metrics, visual AI, clips/reels and exports are later work.

The existing private media adapter stores clips locally in development and in private Vercel Blob in production. Participant access requires the original interview token; researcher access requires the response’s workspace session. Neither a recording ID nor a direct Blob URL grants public access. Playback supports authenticated byte-range requests for seeking. Deleting a response or applying retention removes capture manifests, media rows, derived analysis and clip objects through the existing retryable cleanup path. Exclusion alone does not delete source media. The additive database migration keeps old recordings as audio and adds a separate screen-media kind.

## Verification

`npm test` covers task/link validation, consent, turn binding, stale versions, clip ordering/gaps/time limits, byte-identical retry, cross-session/workspace denial, media-kind separation and response deletion. The database test checks legacy audio migration. `npm run test:screen` covers configuration, permission denial, explicit consent, recording, local upload recovery across refresh, fresh sharing sessions, playable screen/audio, seeking, mobile layout and unsupported-device fallback. Automated display and microphone sources are synthetic; these checks do not replace a human screen-sharing session. Browser suites share port 3101 and must run sequentially.

Sources reviewed October 19, 2026: [Listen Labs screen-sharing documentation](https://docs.listenlabs.com/setup-to-launch/desktop-and-mobile-screensharing). Echo Lab’s per-task optional capture and chunk/recovery behavior are implementation choices; no full Listen Labs parity is claimed.

Production build/type checking, 29 automated tests and all seven browser suites passed. The synthetic screen fixture decoded successfully with VP8 video and Opus narration tracks. Hosted checks confirmed a real private WebM upload, exact retry reuse, byte-exact playback/ranges, denied anonymous/direct Blob access, separate reconnect sessions, task progression and response deletion. Temporary production workspaces, recordings and sessions were removed. Native screen-picker behavior and human narration quality remain unverified.
