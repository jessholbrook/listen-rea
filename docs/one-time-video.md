# One-time concept video viewing

In Study design, attach a private video and set **Presentation mode → Watch video once, then answer**. Save, review translations and publish for new interviews. Ordinary self-paced playback remains the default. One-time viewing and timed concept presentation are mutually exclusive; each controls a different presentation flow. Images, text, external prototype tasks and the video's required text alternative remain available under their normal rules.

## Participant flow

The participant explicitly chooses **Start single video view**. It opens one server-recorded viewing window for that assigned concept, lasting the normalized video length plus two minutes. Loading and pauses count toward this wall-clock window. The video does not autoplay. The player offers play/pause, volume and fullscreen where supported, with no rewind, seek or replay controls. Backgrounding pauses playback; returning checks the server state. Repeated questions for the same concept share its original used window. Each new assigned concept has its own start.

A natural browser `ended` event closes the player and saves a completion signal. The server then opens the answer controls. Expiry also closes the window and allows answers. Questions and answer-image references/bytes remain gated while the window is ready or playing. Images outside the answer controls, concept text and the required video text alternative remain available; this is a video presentation condition rather than a ban on reading accessible material.

Reloading or opening another tab does not give another start or recover the in-memory player grant. An interrupted participant can choose **Continue without video**, which records a skip/interruption and opens questions, or **Use replayable video**, which records a persistent exception and restores the ordinary native player. That exception is available before, during and after a single view and applies to the remaining questions for that concept. It survives reloads. The original start/close/skip data is retained alongside it. Participants may still stop or withdraw.

English, Spanish and French cover start, play/pause, volume, fullscreen, recovery, skip and replayable controls. The standard reviewed translation workflow covers concept content and text alternatives. Playback failures offer a loading retry only before playback begins; an interrupted playing window can be skipped or changed to replayable viewing. These choices are visible to researchers and do not automatically exclude a response.

## Persistence and private access

The interview saves one current concept's start/deadline, close/skip/replayable timestamps and an increasing presentation revision. Presentation writes do not consume an answer version. Initial actions require the current interview version and concept. Identical start-request retries recover the same private player grant and deadline; a different request cannot restart the window. Client state rejects older answer versions and presentation revisions so late responses cannot reopen it.

The player grant is bound to the interview token, concept and a private random nonce. It is returned only for the initial start or an identical retry, held in page memory, and sent in a header alongside the interview token. It is not placed in a URL, local storage or ordinary interview responses. Participant projections omit all internal/future view records. Researcher projections retain audit decisions and timestamps while removing nonces and start-request IDs.

Private video byte/range requests require the current saved video, an active source and the valid unexpired player grant. A replayable exception permits the usual token-authorized current-video path. Previous/future concepts, used windows, stopped/deleted sources and original files behind a watermarked copy do not get new byte access. Published/preview snapshots retain their settings, assigned videos and view history when a later draft/publication changes modes. Existing watermark copies work without changing their original/copy lifecycle. Source retention/deletion removes view records with the interview.

## Measurement limits

This is controlled application playback, not DRM or a verified attention/watch-time measure. An authorized client receives video bytes; it can retain, copy or deliberately replay them outside these controls. Browser completion events can be reported early or fail to arrive. Reloads, loading delays, pauses and interruptions can consume a view without a complete watch; expiry is not classified as verified completion. Network/browser scheduling can affect actual visible time. The text alternative can be reviewed separately. Review exceptions and interruptions before comparing conditions; this stage adds no automatic exclusions, attention scores or watch-time analysis filters.

## Verification and next item

Tests cover configuration/translation identity, exact clock states, private projections, concurrent starts, identical-request grant recovery, early-answer rollback, current-only byte/range access, used-grant denial, repeated/next concepts, skip/replayable persistence, frozen publication, withdrawal/deletion and answer-image gating. Browser checks exercise a lost start reply, explicit play/pause, natural ending, reload interruption/skip, persistent replayable viewing, researcher audit, all three languages and mobile/dark layout. Hosted completion checks use synthetic API close signals; natural playback is verified in the browser.

All 169 automated tests, strict TypeScript, production compilation, two compiled-server single-view lifecycle checks (including answer-image gating), and single-view/concept-video/watermark/timed-concept/localization browser checks pass. Hosted verification and cleanup passed; existing owners and the paused pilot were preserved. See [deployment evidence](vercel-deployment.md).

Source: [Listen Labs show your video once](https://listenlabs.com/whatsnew/show-your-video-once), reviewed October 20, 2026. Echo Lab's bounded window, reload handling, private player grant, skip and recorded accessibility exception are its own contract. No dependency, provider, domain or environment variable is required.

Next proposed build for approval: **participant confidentiality acknowledgements (F11)** — versioned confidentiality text and a saved participant confirmation before interviews. This initial scope does not claim a legally reviewed NDA or third-party e-signature service.
