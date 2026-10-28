# Ranking and MaxDiff image answers

Ranking options and MaxDiff items now support the same private image uploads, required text descriptions, reviewed translations and full-size image dialog as single/multiple choice. Images are optional; every item still needs a visible text label. Storage limits and asset lifecycle follow the [answer image rules](answer-images.md).

In Study design, select a ranking question and open **Answer image for option …**, or a MaxDiff question and open **Answer image for MaxDiff item …**. Upload a static PNG, JPEG or WebP up to 2 MB and enter a description of the visual information needed to compare items. Save, review translations and publish. Pending uploads block saving/publishing; completion attaches the image to the original question/item even if the researcher changes the selected question meanwhile.

## Participant flow

Ranking displays uncropped image cards with **Add the next item** buttons. The ordinary select remains available as a compact keyboard alternative. A selected item's button shows its current rank; the saved-order list retains move-up, move-down and remove controls. Images stay visible while participants adjust their ranking. Single-/multiple-choice carry-forward retains each surviving option's image in a ranking question; matrix carry-forward continues to use text only.

MaxDiff displays images alongside the three to five items in the current saved task. Best/worst controls and their validation retain the existing protocol. Reloads recover the same task, item order and original images. An item absent from the current task cannot fetch new image bytes. When an item reappears in a later task it becomes available again. Participant projections contain only current task image references; the full MaxDiff configuration and future task schedule remain private.

Both flows support full-size viewing, keyboard focus and Escape dismissal, localized loading/retry controls, reviewed English/Spanish/French labels/descriptions, and mobile/dark presentation. Text inside image pixels is not translated. Image failures leave labels and retry controls available; they do not silently change an assignment or exclude an answer.

## Versions, access and measurement

Images remain bound to immutable guide versions and saved option/item IDs. Existing sessions retain their references when a draft or later publication changes them. Randomized ranking order, MaxDiff item mapping, task order and within-task positions keep their existing assignments. Answer retries retain their existing idempotency behavior.

The interview-token image endpoint authorizes only an active source's current ranking options or current MaxDiff task items. Future/previous question assets, out-of-task MaxDiff assets and stopped/completed/deleted sources cannot fetch new bytes. For timed concepts, answer images remain hidden until the presentation window expires or the participant chooses untimed viewing; repeated questions/tasks share the original concept window. Received bytes can be retained; this does not prevent screenshots or copying.

MaxDiff configuration validates asset IDs and required descriptions, and workspace validation rejects unavailable/foreign images. Images and descriptions participate in translation fingerprints. Drafts, revisions, history, saved sources, study copies and trackers protect retained references from deletion. The existing image library now includes MaxDiff references when showing which uploads are in the draft.

Ranking answers remain ordered option IDs and labels. MaxDiff retains the same cyclic design, best/worst choices, exposure counts, pooled model and bootstrap method. Result tables/exports remain text/ID based; image metadata does not add a score or image-recognition step. Visual differences may affect participant preferences; researchers still need an appropriate design and accessible descriptions.

## Verification and next item

Coverage includes direct/carried ranking image identity, MaxDiff description/asset validation, translation identity/fingerprint changes, task membership, identical seeded designs and recorded choices versus text-only guides, current-only projections and bytes, timed gates, workspace denial, publication/reload isolation, retries, protected deletion and source revocation. Browser checks cover researcher uploads, rank add/reorder, full-size keyboard viewing, task resume, all MaxDiff tasks, English/Spanish/French and mobile/dark layouts.

All 161 automated tests, strict TypeScript, production compilation, two compiled-server ranking/MaxDiff image lifecycle checks and the EN/ES/FR image browser pass. Hosted and regression results are recorded in the [deployment notes](vercel-deployment.md).

Source: [Listen Labs image answers to quant questions](https://listenlabs.com/whatsnew/image-answers-to-quant-questions), reviewed October 20, 2026. Its announcement includes multiple choice, ranking, MaxDiff and full-size viewing. Echo Lab's access, lifecycle and accessibility rules are its own contract.

[Study media watermarks](media-watermarks.md) are implemented. [One-time concept video viewing](one-time-video.md) is implemented. Next proposed build for approval: **participant confidentiality acknowledgements (F11)**.
