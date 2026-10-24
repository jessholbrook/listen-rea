# Optional self-reported feelings

Add a **Feeling check-in (optional self-report)** question in Study design. Place it after a task, stimulus or question whose response you want to discuss, or mark it as a repeated concept question. Save, publish and launch through the existing controls. This method is an initial alternative for the F33 emotional-signals experiment: it records explicit participant reports. It does not implement Listen Labs' multimodal inference or claim the same scientific validity.

## Capture and language

The participant chooses one label: happy, calm, confident, curious, uncertain, frustrated, disappointed, overwhelmed, neutral, mixed feelings or other. They may always choose **Prefer not to answer**. Choosing a non-neutral feeling enables optional intensity (slightly, moderately, strongly) and an optional note in their own words. Neutral has no intensity. Declining clears any unsent intensity/note and saves only the decline. A participant need not explain a feeling or a decline.

The fixed controls are translated into English, Spanish and French, using the interview's frozen response language. The researcher writes and reviews the question wording using the existing guide/localization workflow. Label translations and this small descriptive vocabulary have not been validated as equivalent across languages/cultures. “Other” and “Mixed feelings” are genuine choices; notes are not automatically reclassified. Self-reports can be affected by question framing, timing, social desirability and the supplied labels.

There is no AI follow-up, emotion inference, vocal/facial processing, sentiment score or clinical assessment. No microphone or camera is requested for a check-in. Ordinary participant-selected read-aloud can still read its question. The server validates fixed labels, optional ordinal intensity and note limits, and generates the saved answer text from that explicit selection. Arbitrary submitted answer text cannot replace it. Notes retain their original language. Submitted answers survive resume and idempotent retries; unsent form selections/notes are not server-saved drafts.

Vocabulary or translation changes require an explicit method-version/migration decision; existing source turns must not be silently rewritten. The method is stored on the original answer turn as `self-report-v1` with the selected label, nullable ordinal intensity and note. The normal response version, question/concept IDs, original prompt and saved timestamp remain attached. Declines cannot screen people out, trigger AI probes, or serve as branch options.

## Results and denominators

Open the **Feelings** study tab. Every revision, template question and assigned concept has a separate summary. Exact attribute/value filters and an optional response-language filter apply to counts and both exports. The unit is a completed interview within that scope, not a unique person matched across sessions.

Only completed, included native interviews with a valid explicit report enter the feeling distribution. Preview, withdrawn, excluded and externally imported responses are omitted. Declined check-ins, not-asked questions, shown-but-unanswered questions and invalid answer records stay separate. Unfinished and screened-out interviews remain outside the completed denominator even if they already saved an earlier check-in. Missing reports are never treated as neutral. An all-declined or empty selection has missing percentages, not zero-filled estimates.

Each feeling percentage is `count / valid reported answers`, excluding declines. The completed sample, report count and declines are shown together so that selective nonresponse stays visible. Intensity is a distribution of the three ordinal choices within the selected feeling, with unspecified intensity separate. Neutral intensity is **not applicable**, rather than zero or an unspecified rating. There is no intensity mean, summed emotional score, positive/negative classification, ranking of concepts by “authenticity,” population inference or significance claim.

Multiple check-ins in one interview are separate snapshots, not additional people. Comparing concepts/questions does not establish causality or an emotional trajectory between observations. Source inspection lists the original check-ins in saved answer order. Timestamps indicate answer saving, not the onset/duration of a feeling, continuous measurement or a time offset in a recording.

## Evidence and lifecycle

Select a feeling to filter its source outcomes, then inspect the original response. The source view fetches current eligible originals and includes the original prompts, canonical answer text, method, response/turn IDs, concept metadata and saved timestamps. A person's own note is evidence of what they reported, not an inferred mental state. General analysis receives this method metadata and instructions to preserve that distinction.

Two authenticated CSVs are available:

- **Summary:** study/revision/question/concept, method, canonical feeling ID and English display label, report count/denominator/percentage, ordinal-intensity counts, unspecified/not-applicable intensity, all completion/nonresponse counts and exact filter metadata.
- **Sources:** response/turn IDs, answer sequence and saved timestamp, response language, inclusion/completion status, selected label, ordinal intensity, original note/prompt/answer and exact filters. Declined and unfinished sources are explicitly labeled; they do not enter the distribution.

Both use spreadsheet-formula escaping. Results are computed from live source turns; no separately stored emotional profile or aggregate survives deletion. Exclusion, withdrawal, deletion and retention affect fresh results/exports through the existing source lifecycle. Previously downloaded exports cannot be recalled.

## Validation and remaining work

The hand-calculated reference has one frustrated response with moderate intensity, one neutral response and one decline: frustrated and neutral each have count 1, reported denominator 2 and 50%. The decline remains outside that denominator. Neutral intensity is not applicable. A completed invalid/missing response and an unfinished happy response remain separate.

Domain/API checks cover strict inputs, decline-with-note rejection, optional intensity, incompatible guide settings, canonical source text, duplicate/stale request behavior, token/workspace boundaries, revision/concept/language/segment scopes, nonresponse denominators, original evidence/CSV escaping, frozen publication, exclusion/deletion and source-derived recomputation. Browser checks exercise editor selection, mobile participant controls, optional notes/intensity, changing a draft to decline, source chronology, filters, exports and English/Spanish/French controls. Production build/runtime and hosted synthetic checks verify packaging and durable storage behavior.

Human label comprehension, study framing, cultural/language equivalence, response bias and researcher interpretation remain unverified; human testing is deferred at Jess's request. Inferring emotion from text, voice or faces requires a separate research proposal, evaluation and review. It is not enabled by this question type.

Public reference reviewed October 19, 2026: [Listen Labs Emotional Intelligence](https://docs.listenlabs.com/insights-and-reports/emotional-intelligence). Its documented vocal/verbal/facial signals, inferred timelines and benchmark claims are external product claims, not implemented or validated Echo Lab capabilities.
