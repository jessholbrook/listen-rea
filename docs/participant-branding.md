# Participant branding

In **Study → Fielding → Participant branding**, researchers and admins can set a study brand name, upload a logo and choose button, background and text colors. Collaborators can review saved settings and preview them. Nothing needs a new domain, external provider or environment variable.

## Save and preview

1. Enable **Use custom participant branding**. Leave it disabled for neutral Echo Lab styling.
2. Set a name and/or upload a PNG, JPEG or WebP image up to 2 MB. The browser prepares a static image fitting 640 × 160 pixels. The server verifies and re-encodes it as PNG, with a 128 KB output limit, removing metadata. Logos need an accessible description. SVGs and external image addresses are not accepted.
3. Choose button, background and text colors. Text/background contrast must be at least 4.5:1. Button text automatically uses black or white. Highlights and keyboard focus use a contrasting color when the accent would be unreadable against the background. The same rules support light and dark palettes.
4. Review the inline preview and save. Preview choices are unsaved until **Save participant branding** succeeds. **Refresh participant branding** discards local edits and reads saved settings. Concurrent edits require a refresh rather than overwriting another save.
5. Open a new participant session or study preview to see the saved appearance. **Remove logo** clears the current image; **Reset to Echo Lab defaults** clears the custom choices when saved.

Branding affects the participant header and colors on consent, interview and terminal screens. Echo Lab remains attributed in the footer. Text, recording consent and participant controls keep their normal meaning. There is no custom CSS/HTML, arbitrary external logo fetch, tracking image or white-label setting. Researcher pages, exported report styles, email templates and workspace research guidelines are separate.

## Lifecycle and privacy

Branding has its own versioned settings document, independent of guide drafts and publication. Saving changes immediately updates the public consent view and the appearance copied into new interviews and new draft previews; no guide republish is required. An interview takes the current saved snapshot at admission. An already-open consent page may therefore receive newer styling when admitted after a researcher saves a change.

Existing interviews—including completed interviews and resumed handoff/invitation sessions—keep the name, image and colors they started with. Disabled branding produces neutral styling for new sessions; it does not rewrite historical snapshots. Removing a logo from settings stops its use in new sessions, while original interview snapshots retain it until those sources are deleted or expire. Earlier interviews without a branding field use Echo Lab's existing default appearance.

Logo pixels are stored with the settings and admitted interview snapshot in the existing database, not at a public asset URL. They are deliberately visible in the participant payload for that study/session, as is the study brand name. Settings metadata (workspace, editor and update information) stays workspace-authorized. Existing response deletion/retention removes the embedded snapshot with the response; no separate asset or cleanup queue is required. Public consent access still respects the existing invitation controls. External read-only API/MCP projections do not gain branding data or write authority.

Logos are display assets. They are not passed to the moderator as evidence or used to generate analysis. Use neutral styling when naming the organization might bias a brand-perception study.

## Verification

Automated coverage checks color/contrast boundaries, field limits and private projections, raster decoding/resizing, malformed and oversized uploads, concurrent edits, workspace isolation, collaborator permissions, independent guide versions, previews, admission snapshots, reset/disable and continued completion with an original snapshot. Browser checks exercise logo upload/removal, dark styling, responsive consent and completion, frozen reloads, new-session updates, contrast repair and reset.

All 136 automated tests, strict TypeScript, production compilation, three compiled-server branding lifecycle tests and branding/localization/invitation/Decipher/mixed-question browser checks pass. Hosted synthetic checks confirm image processing, snapshots, validation and concurrent saves, neutral reset, original-brand handoff recovery while paused and deletion. Temporary data and credentials were removed; existing owners and the paused pilot were preserved. Human/vendor acceptance checks and Resend/domain/live-email setup remain deferred.

Source: [Listen Labs look-and-feel documentation](https://docs.listenlabs.com/setup-to-launch/detailed-topic-guide-settings), reviewed October 20, 2026. It documents logo and button/text/background colors. Echo Lab's image limits, contrast safeguards and snapshot behavior are its own implementation contract. Custom study-link paths and rich-text formatting remain separate.

Prototype links and tasks are implemented; see [prototype contract](prototype-concepts.md). Private video concepts are implemented; see [video rules](concept-videos.md). Next proposed build for approval: **timed concept presentation (F11)**. [Private concept images](concept-images.md) are implemented.
