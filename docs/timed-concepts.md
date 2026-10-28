# Timed concept presentation

In **Study design → Concept testing**, set a concept's **Presentation mode → Timed review, then answer** and choose **Exposure seconds** (1–300). Self-paced remains the default for existing and new concepts. Save and publish to apply timing to new interviews. Saved draft previews use their saved timing settings.

## Participant flow

The participant explicitly chooses **Start timed view**. The server records one start/deadline for that assigned concept. While the window is open, the stimulus is visible and answers wait. At expiration, the concept headline, description, images, video, video text alternative and task instructions hide; the questions become available. Repeated questions and follow-ups for the same concept use the original expired window rather than starting another window. The next assigned concept has its own start action.

Reloads do not reset a deadline. Background tabs consume the same wall-clock window; the browser checks server timing again on return before showing the stimulus. The local countdown uses a monotonic browser clock relative to the server response. Network delay, media loading and browser scheduling affect actual visible time. **Loading and background time count toward the window.** This is controlled presentation, not a verified measure of attention, reading time, viewing duration or exact physical exposure. Keep enough time for the actual media and test representative devices before a live study.

Participants can choose **Use untimed view** before, during or after the window. It opens the concept for the remaining questions and persists across reloads. The original timing record and the participant's override are saved, and the researcher response transcript labels the choice. This gives people who need more time an alternative; it is not a silently extended or restarted timer. Responses remain eligible under the existing analysis rules; compare timing conditions only after reviewing these exceptions.

The start, countdown, expiration, retry and untimed-view controls support English, Spanish and French. Concept text/translations and accessible video text alternatives retain their existing reviewed guide workflow. Participants may still stop/withdraw while a timed view is pending or active.

## Versions, authorization and limits

Timing belongs to each concept in the immutable published/preview guide. Draft-only changes affect saved previews; later publication does not rewrite an admitted interview's durations or deadlines. Start and override writes serialize with other interview operations. Concurrent/repeated starts return the original deadline without consuming an answer version or duplicating turns. Early answer requests are denied without committing an answer. Successful answer retries keep their existing idempotency behavior. An override has its own increasing presentation revision so stale browser responses do not replace newer timing decisions.

Participant API projections contain only the current concept's timing state. Stimulus fields are omitted before start and after expiration; internal/future exposure records remain researcher-authorized. Private image/video endpoints also deny new byte requests outside an active window, unless the participant chose untimed viewing. Expiration removes the rendered media and stops/releases private video playback. Researcher review is independent of participant windows. Source deletion/retention removes the timing record with its interview.

External prototype links require **Self-paced** presentation because Echo Lab cannot time or hide a separate site. Timing applies to the concept stimulus, not the external content of a question's separate usability task. It does not provide DRM, screenshot prevention, deletion of previously received bytes, or verified one-time viewing. Already authorized content can be copied. Closing/reloading after expiration does not reopen it; choosing the recorded untimed alternative does.

The researcher transcript shows started windows and untimed choices. This stage does not add timing-based analysis filters, watch-time statistics or automatic exclusions. External read-only API/MCP projections and authority are unchanged. No new provider, domain or environment variable is required; live email setup remains deferred.

## Verification and next item

Coverage includes duration bounds/prototype incompatibility, exact server-clock boundaries, current-only redaction, private media gates, concurrent start/retry, early-answer rollback, persisted deadline across questions/reload, publication isolation, future/stale requests, overrides/revisions, researcher audit and source deletion. Browser checks cover explicit start, reload/background expiry, hidden stimuli and answer controls, repeated questions, untimed resume, all three languages and mobile/dark styling.

All 153 automated tests, strict TypeScript, production compilation, two compiled-server timing checks and timed/concept/image/video/prototype/localization browser suites pass. Hosted synthetic verification and cleanup passed; existing owners and the paused pilot were preserved. Hosted expiry uses a synthetic expired deadline; actual elapsed expiry is covered locally. See [deployment evidence](vercel-deployment.md#timed-concept-presentation--october-20-2026).

Sources: [Listen Labs timed concept tests](https://listenlabs.com/whatsnew/timed-concept-tests) and [concept testing](https://docs.listenlabs.com/setup-to-launch/concept-testing). Echo Lab's explicit start, server deadline, background/loading behavior and persistent accessibility alternative are its own contract.

[Single-/multiple-choice image answers](answer-images.md) are implemented. [Ranking and MaxDiff image answers](ranking-maxdiff-images.md) are implemented. [Study media watermarks](media-watermarks.md) are implemented. [One-time concept video viewing](one-time-video.md) is implemented. Next proposed build for approval: **participant confidentiality acknowledgements (F11)**.
