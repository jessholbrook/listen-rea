# Languages and source-preserving translations

Echo Lab supports English (`en`), Spanish (`es`) and French (`fr`) for participant controls, reviewed guide versions, interview language hints and newly generated analysis/report labels. The researcher workspace remains in English. Fluent-speaker acceptance and human voice-quality evaluation remain deferred.

## Configure a study

Open the study’s **Languages** tab. **Source guide language** describes the text authored in Study design; changing the selector does not translate that text. **Reporting language** selects the language for new AI summaries, theme titles/descriptions, limitations and memo headings. Existing interviews, analyses and report editions retain their saved language. Save terminology, regional conventions and formality preferences in **Translation guidance** before proposing translations. No new service or environment variable is required.

## Review guide translations before publishing

Choose a target language and either edit the prefilled source fields or request an AI proposal. Proposals are not automatically saved. Every source field must be present exactly once and stay within its length limit. Translation changes text only: question and option IDs, routing, screen-out flags, assignments, carry-forward, numeric scales and task/media URLs are preserved. Section labels are rewritten consistently in questions and section conditions; distinct sections cannot collapse to the same translated name.

Save a draft, or attest that you reviewed its meaning, neutral wording, terminology and every field. Only reviewed translations matching the current source fingerprint can be previewed or offered to participants. Source edits, routing changes and translation-guidance changes make saved translations stale. Update every current field and review again. Changing the source-language setting removes draft translations in the UI. Removing a draft translation or changing a draft does not alter the published revision until you publish again.

Publish from **Study design**. The published revision freezes the source guide and reviewed translations. A participant can choose an available language before consent. A supported browser language is requested initially; `?language=es` or `?language=fr` requests a particular language. Regional codes such as `es-MX` select the base supported language. Unsupported or unpublished languages fall back to the source language on the landing page. Admission rejects a language that has become unavailable since the page loaded. Changing language before admission resets the consent checkbox.

Each interview freezes its chosen language, localized guide, consent version and option assignments. The language label records the selection rather than automatically detecting the language of every answer; review it if a participant responds in another language. Reload/resume retains that version even after new publication. Participant responses, prompts and structured values remain in their original language. Internal translation guidance and other language versions are excluded from participant responses, including versions containing unassigned concept text.

## Participant controls and voice

Consent, progress, answer controls, mixed-method labels, recording permissions, hands-free actions/recovery, task capture and completion text have English/Spanish/French copies. The participant container sets its language for assistive technology. Browser-managed media controls and screen-picker dialogs follow the browser/OS. Unmapped service errors receive a localized retry/contact-team message rather than an untranslated technical error.

AI follow-ups request the frozen interview language. Scripted clarification and the documented refusal phrases (`skip`, `omitir`, `passer`) have language-specific handling. Provider transcription receives the selected source-language hint without a translation instruction. Provider speech receives the original question plus a language instruction for supported GPT-4o TTS models; browser read-aloud receives the language tag. Availability does not establish pronunciation, accent coverage, transcription fidelity or conversational quality. Transcripts still require participant/researcher review.

## Preserve original responses

In **Original responses and translations**, select a completed, included turn and a different target language. Propose a translation or enter one manually, compare it with the original and save with an explicit review attestation. Saving never replaces the original response. The record retains source/target languages, original text, source fingerprint, translated text, reviewer and version. Concurrent edits and source/guidance changes reject stale saves. Guidance changes hide stale translations until updated/reviewed.

**Export reviewed translations CSV** includes exact originals and their reviewed translations with study/response/turn IDs, language codes and reviewer. Draft, stale, excluded, incomplete and preview responses are omitted. Formula-like CSV cells receive a leading apostrophe for spreadsheet safety; canonical stored source text is unchanged. A translation can be deleted independently. Source deletion and request-driven retention remove its translated copies along with existing media/derived-data cleanup. Translation histories or separate indexes are not retained.

Exact citations always reference original text. A translated sentence that is absent from the original cannot be submitted as an exact evidence quote. Valid translation structure and quote matching do not establish correct interpretation, fluent translation or speaker attribution.

## Reports and library

New analysis records retain their reporting language. AI narrative uses that language while citation quotes remain exactly in the original language. Memo headings, methodology/limitations labels, edition summary/limitation blocks and PowerPoint provenance labels follow the saved report language. User-written titles, original research objectives, brand/footer text and exact source quotes are retained. Editing an existing report does not automatically translate its narrative. Bilingual response translations are available separately in the authenticated CSV; they are not silently substituted into shared reports, captions or decks.

External imports can declare English, Spanish or French as their transcript language. Existing imports default to English unless they already carry a language setting. Research Library offers a separate **Answer language** for cited Q&A, preserving original quote text. Retrieval still searches original source keywords, not translated semantic matches: asking in a different language may miss evidence. Original response exports include a `response_language` column. Quantitative values and grouping use canonical IDs; some chart labels come from frozen participant guides rather than being retranslated into the reporting language.

## Verification matrix

| Language | Guide and participant text | Provider speech/transcription | Human acceptance |
| --- | --- | --- | --- |
| English | Legacy workflow, review/version/routing and browser regression checks pass. | Hosted synthetic speech, decoding, source-language transcription and cached retry passed. | Pending microphone, accent/noise and research-quality review. |
| Spanish | Reviewed guide, consent/language switching, interview/response handling and browser read-aloud tag checks pass. | Hosted synthetic speech, decoding, source-language transcription and cached retry passed. | Pending fluent review and human voice evaluation. |
| French | Reviewed guide, consent/interview controls, source/report separation and translated routing checks pass. | Hosted synthetic speech, decoding, source-language transcription and cached retry passed. | Pending fluent review and human voice evaluation. |

Automated checks exercise missing/duplicate/forged fields, unchanged concept/option IDs, section routing, screen-out, carry-forward, numeric zero, stale/unreviewed availability, fallback, frozen interviews, workspace access, separate translations, stale edits, bilingual CSV, rejection of translated citations and deletion. `npm run test:localization` exercises the reviewer/participant workflow and mobile layout. All browser suites share port 3101 and must run sequentially. After building, use `RESEARCH_TEST_PRODUCTION=1 node --import tsx --test tests/localization-http.test.ts` to test the compiled server. Hosted checks also passed for AI guide review gates, exact-original preservation in response translations/CSV, Spanish library answers, French analysis/decks, stale guide availability, frozen interview languages and deletion/cleanup. Synthetic voice checks do not replace fluent-speaker or human microphone evaluation.

Source reviewed October 19, 2026: [Listen Labs auto-translations](https://docs.listenlabs.com/setup-to-launch/auto-translations). Echo Lab’s limited language set, explicit review requirement and separate response translations are implementation choices, not a claim of Listen Labs’ full automatic-translation or voice coverage.
