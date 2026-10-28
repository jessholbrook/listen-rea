# Corrections to verified OCR text

In **Responses → transcript → PDF text and verified passages → selected OCR page**, choose **Correct verified OCR text**. Compare the original PDF page, edit the transcription, give a reason and explicitly attest to the replacement. Text or reason edits reset attestation. Cancel discards the edit. Corrections are manual within Echo Lab and make no rendering or AI/provider request.

The original AI draft, permission receipt and first accepted transcription stay immutable. Each correction appends a private revision with corrected text, reason, reviewer/time, version and before/after whole-PDF text digests. Existing OCR records without a correction array remain compatible; the UI uses their original accepted transcription until corrected. Original file bytes, interview answers and native extracted text are unchanged.

## Evidence invalidation

Saving a correction updates only that accepted OCR page and its overall text digest. All selected passages on that page are removed, including quotations whose characters happen to remain unchanged; the researcher must select and verify them again against the corrected text. Other pages' selections remain in the latest private selection, but inclusion for the entire PDF is reset. Earlier verification selections and OCR text versions stay in private history.

The same transaction removes study analyses, including saved PDF-answer originals/history, report editions/snapshots and share links, and advances the study data version. New analysis contains no PDF evidence until a researcher separately verifies and explicitly includes a current selection. New evidence and any later explicit synthesis/Q&A use the corrected text, exact updated offsets and new verification/digest. Previously copied files cannot be recalled; live links and future exports are invalidated. PDF page numbers and researcher-verified OCR labels remain intact.

## Validation and bounds

Corrections use the existing editor-only `PUT /api/studies/:study/participant-pdfs/:pdf/ocr` endpoint with `{source,digest,page,draftId,text,attested:true,version,correctionVersion,reason}`. Initial acceptance still uses the prior body, and supplying correction fields before initial verification is rejected. A correction requires an exact current source/text digest, latest passage-history and correction versions, the accepted draft's matching physical page, and current page text equal to its latest accepted/corrected text. Native pages, unverified drafts, stale/conflicting writes and client provenance fields cannot be used to replace text. Repeating an old request after any revision fails; no-op normalized text is rejected without invalidation.

Text stays within 1–12,000 characters per OCR page and 200,000 total PDF characters, accounting for replacement rather than adding old and new lengths. Reasons are 3–1,000 characters. Limits are 20 corrections per page, 250,000 serialized characters across correction records per PDF and the existing 50 total passage-verification events per PDF. Rejected writes leave text, history and report access intact.

Correction histories/reasons are private in `participantPDFText`; they do not enter participant, external API/MCP or report projections. PDF/context/response erasure removes all original and corrected OCR through the existing document cleanup. No new credentials or provider permission are required for this manual step.

## Verification and next

HTTP checks cover immutable originals/history, affected-page removal with other selections preserved, no-op preservation, concurrent edits, exact revised offsets, explicit re-inclusion, saved-answer/analysis/report invalidation, editor/viewer/participant/workspace/source/version/metadata/size/history gates and whole-response erasure. Mobile checks cover original-page comparison, reason/text attestation reset, correction/reload/history, removed selections and cancellation. The deployment log records a separate hosted workflow with real original OCR and saved PDF-answer evidence, manual corrections and cleanup.

[Private DOCX participant uploads and researcher review](participant-docx.md) are implemented. [Verified DOCX text selections with paragraph citations](docx-text.md) are implemented. [Verified DOCX passages in analysis and report appendices](docx-evidence.md) are implemented. [AI synthesis of included verified DOCX passages](docx-synthesis.md) is implemented. [Researcher Q&A over included verified DOCX passages](docx-qa.md) is implemented. [Saved and reviewed DOCX Q&A report appendices](docx-answer-reviews.md) are implemented. [Optional DOCX-aware AI interview follow-ups](participant-docx-ai.md) are implemented. Next for approval: **researcher DOCX follow-up grounding reviews and correction history (F12)**. Human research-quality/pilot review remains deferred.
