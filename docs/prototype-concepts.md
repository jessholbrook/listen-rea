# Prototype-link concept stimuli

In **Study design → Concept testing**, each concept can include a **Prototype URL (optional)** and **Task instructions**. Links require task instructions; tasks can also accompany text or images without a link. Existing private-uploaded and HTTPS-linked images can remain alongside the prototype.

## Set up and publish

1. Paste an explicit HTTPS prototype address. Credential-bearing URLs, whitespace/control characters, backslashes and other URL schemes are rejected. Static query parameters and fragments are preserved. Echo Lab appends no participant IDs, invitation codes, interview tokens or tracking parameters.
2. Write a concrete task. Instructions are plain text, limited to 4,000 characters, with line breaks preserved. They are researcher-provided context, not generated claims about prototype functionality.
3. Save the draft and publish. Check the prototype's own sharing/access permissions before using it with participants. **Remove prototype and task** clears both fields in the local draft; save/publish to apply that change to future interviews.
4. Participants see the current concept's instructions, destination origin and an **Open prototype** link. It opens a new tab without a window-opener reference or Echo Lab referrer. The participant returns to the interview to answer. Echo Lab does not prefetch, embed or proxy the prototype.

Task headings, open-link controls and external-site notices support English, Spanish and French. Task instructions participate in the existing reviewed guide translations, retaining the same prototype URL and concept ID. Changing the source task or URL invalidates old translation fingerprints for new admissions. Prior translated sessions keep their original guide.

## Versions and access

Links and tasks follow the guide's existing immutable publication and interview snapshots. Draft-only edits affect saved draft previews; new real interviews use the current published revision. Publishing or removing a link does not rewrite an interview already admitted. Resume and repeated-concept progression expose only the current concept's frozen link/task. Unassigned/future concepts are omitted from participant projections, and public consent does not disclose prototype addresses. Workspace access, source deletion, read-only API/MCP projections and private-image access rules remain unchanged.

External prototypes have their own access/privacy rules and can change outside Echo Lab. Snapshotting the address does not freeze the external site's content. Echo Lab does not measure prototype actions, completion, success or time on task, and opening a link is not recorded as a completed task. Browser screen sharing remains a separate, explicit-consent feature. Destination permissions and real prototype usability require later human/vendor checks.

No new account, provider, domain or environment variable is required. Email/domain setup remains deferred.

## Verification

Tests cover allowed/invalid URLs, required/bounded tasks, plain-text storage, immutable assignments, translation fields/fingerprints and stable URL bytes. HTTP lifecycle checks exercise current-only visibility, publication boundaries, previews, unchanged existing sessions, restore, validation, workspace isolation and deletion. Desktop/mobile browser checks cover editing, English/Spanish/French task controls, explicit new-tab opening, no prefetch/referrer/opener, dark styling and frozen resume/progression.

All 144 automated tests, strict TypeScript, production compilation, two compiled-server prototype lifecycle tests and prototype/concept/private-image/localization/branding browser checks pass. Hosted checks confirm revision boundaries, current-only links/tasks, frozen resume, restore, reviewed Spanish/French instructions, invalid-save denial and deletion. Synthetic records and temporary credentials were removed; existing owners and the paused pilot were preserved. Human/vendor prototype acceptance and Resend/domain/live-email setup remain deferred.

Source: [Listen Labs concept testing](https://docs.listenlabs.com/setup-to-launch/concept-testing), which documents URL/media concepts. This stage supports external links; iframe embedding and behavioral measurement are separate.

Private video concepts are implemented; see [video rules](concept-videos.md). [Timed concept presentation](timed-concepts.md) is implemented. [Single-/multiple-choice image answers](answer-images.md) are implemented. [Ranking and MaxDiff image answers](ranking-maxdiff-images.md) are implemented. [Study media watermarks](media-watermarks.md) are implemented. [One-time concept video viewing](one-time-video.md) is implemented. Next proposed build for approval: **participant confidentiality acknowledgements (F11)**.

Optional [task timer and reported-outcome controls](richer-interviewing.md) are available on screen-recording task questions. They measure explicit controls in Echo Lab and participant reports; they do not instrument external prototype actions or verify success.
