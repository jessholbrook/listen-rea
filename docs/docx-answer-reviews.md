# Saved and reviewed DOCX-passage answers

In **Analysis & report → Ask about verified DOCX passages**, choose **Ask and save DOCX passage answer draft** to generate and save a private answer. Ordinary **Ask about DOCX passages** remains temporary. Saving is a separate, explicit generation with the same excerpt-only request, exact citation validation and source/language/analysis checks before and after generation. Creating a draft preserves memo review, editions and share links.

Each saved answer retains its immutable original question, answer, citations, model, prompt version and generation time, frozen cited evidence and attributed review revisions. Frozen evidence contains only explicitly included selected passages and source attribution, not full documents, unselected paragraphs, private notes or verification history. Review requests can edit the answer and citations within frozen evidence; they cannot replace the question, original or generation provenance.

## Review and report inclusion

Use **Compare saved answer DOCX paragraph** and **View prepared text** to inspect the exact selected quote in its authorized paragraph context. These references describe prepared text, not Word pages or a reconstruction of the original document. Editing the answer or removing a citation resets review and inclusion in the interface. Review and report inclusion are separate choices; inclusion requires explicit review and at least one complete exact selected paragraph/verification/character citation. An insufficiency answer without citations can remain internal but cannot enter reports.

Only the latest explicitly included review enters memo, report and editable deck appendices. Its projection contains the question, current answer and citations, frozen selected sources, reviewer/review time, answer revision, generation provenance and an edited indicator. The original answer object and private revision history are excluded. Report labels localize to English, Spanish and French; quotes retain source language. These are researcher interpretations of document excerpts, not participant statements or independently verified facts. They do not affect sample or theme counts. Valid references establish source identity; they do not establish interpretation quality.

Private-only edits advance the analysis version and preserve published material. Including, changing, withdrawing or deleting an included answer resets memo review and revokes report editions, snapshots and share links. Review the memo and create new reports after changes. Downloaded copies cannot be recalled.

## Protocol, bounds and erasure

`POST /api/studies/:id/docx-qa` accepts optional Boolean `saveDraft`, default false. The server supplies answer IDs, originals, frozen sources and draft attribution. `PUT` and `DELETE /api/studies/:id/docx-answers` require workspace edit authority, exact analysis/answer identities and versions and the current concept/revision scope. Review citations must match both live evidence and frozen source snapshots. Report creation, modification, sharing, public reads and deck export revalidate the latest included answer projection and live evidence. Client report fields cannot overwrite this projection.

Limits are 20 saved answers per analysis, 50 revisions per answer and 250,000 serialized code units across saved DOCX answers. Ordinary temporary Q&A remains available at the saved-record cap. Failed generation and rejected reviews do not partially save records or revoke reports. Generation has no automatic retry or idempotency key; reload after a lost save response before generating again.

Selection changes/withdrawal, file erasure, response deletion and retention remove derived analyses, including originals, frozen sources and review history, and revoke reports through the existing evidence lifecycle. Participant payloads, external API and MCP DTOs omit saved answers. Existing written interview answers survive file erasure. Email/domain setup and human research-quality/pilot review remain deferred.

## Validation and next

Unit and HTTP checks cover frozen source identity and exact paragraph references, immutable originals/history, review/inclusion gates, optimistic writes, attribution and localized exports, workspace/role/anonymous/strict metadata gates, private-edit preservation, no-citation and revision/record limits, provider failure, memo/report/deck projection, client attribution forgery and erasure. Mobile checks cover explicit save, reload, source comparison/highlighting, edit resets, review history, report/source links, withdrawal and deletion. Local generation uses marked fixtures. Real hosted generation and synthetic cleanup are recorded in the deployment log.

[Optional DOCX-aware AI interview follow-ups](participant-docx-ai.md) are implemented. Next for approval: **researcher DOCX follow-up grounding reviews and correction history (F12)**.
