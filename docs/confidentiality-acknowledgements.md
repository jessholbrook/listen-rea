# Participant confidentiality acknowledgements

Echo Lab can require a separate acknowledgement before a participant starts an interview. In Guide, enable **Require acknowledgement**, enter your team’s approved title and text, save and publish. Text must contain 20–6,000 characters. This is a plain-text acknowledgement record; uploaded contracts, electronic signatures and legal enforceability are outside this implementation.

The participant landing page displays the full published text and a separate, initially unchecked acknowledgement box. General research consent remains independent. Both are required to begin. Someone who does not agree can leave without starting; no response, quota reservation or invitation claim is created. We do not record a refusal or mark it as a screened-out interview.

Each accepted record saves the exact localized title/text, language, published revision, SHA-256 version and server timestamp with the response. View it in **Responses → participant → Confidentiality acknowledgement**. No name, drawn signature, IP or user-agent collection is added. The record follows the response’s existing authorization, retention and deletion rules. Researcher previews bypass the participant gate and save no acknowledgement.

## Publication and recovery

Draft edits do not change public text. Every published revision produces a distinct version, including republication with unchanged wording. Admission checks the submitted version against the current published text and selected language before reserving quotas or claiming invitations/handoffs. Missing, forged or outdated versions fail. If publication changes while a participant is reading, reload the landing page and acknowledge the current text. A stale pending handoff request is cleared so reload can show the current landing page.

Admitted interviews retain the original acknowledgement through draft edits, publication changes and reloads. A lost handoff admission reply recovers the already admitted session and its original record, without consuming another place or requiring acceptance of later wording. Optional/older studies need no acknowledgement. Disabling the setting affects new admissions after publication; previous records remain intact.

Confidentiality title and text participate in the existing reviewed English/Spanish/French guide translation workflow. Changing the source invalidates translations. Language changes clear both checkboxes. Published fallback language and saved acknowledgement language must match.

## Validation

Three HTTP lifecycle tests cover admission bypass attempts, immutable text and timestamps, stale publications, legacy studies, preview behavior, reviewed translations, handoff recovery and source deletion. They run against development and compiled production Next servers. The browser check covers editor setup, independent consent, initially unchecked controls, mobile English/Spanish/French, a publication race, reload/resume and researcher audit. Hosted synthetic checks and deployment evidence are recorded in [deployment notes](vercel-deployment.md).

This validates the saved acknowledgement mechanism, not legal signing, whether a participant read/comprehended the text, identity or real participant acceptance. Domain/email setup and human pilot review remain deferred.

Next proposed stage: private participant image uploads attached to interview answers (F12), with source review and deletion. Listen Labs’ [July 9, 2026 announcement](https://listenlabs.com/whatsnew/participant-file-uploads-and-analysis), reviewed October 20, describes file-aware probing and response-quality assessment as well. Those broader capabilities need separate implementation and validation; they are not part of this acknowledgement stage.
