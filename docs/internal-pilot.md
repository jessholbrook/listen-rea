# Internal pilot: two colleagues, one complete research loop

Approved by Jess on October 23, 2026. **Deferred again by Jess on October 23; admissions are paused.** Preparation is retained for two participants. Resume fielding when the pilot is wanted; human interviews and findings review are pending. No colleagues have been contacted or enrolled by automation.

[Open the researcher workspace](https://echo-lab-psi.vercel.app/?study=dc5f6d5b-7d55-4f43-86f8-b9fee059bf73&tab=guide). [Open the participant interview](https://echo-lab-psi.vercel.app/s/dc5f6d5b-7d55-4f43-86f8-b9fee059bf73).

The goal is to identify where the team can improve how it collects, interprets and acts on customer feedback. Invite two colleagues who have used feedback to make a product decision within the last three months. Allow 10–15 minutes for each interview, followed by a short debrief. This is a workflow pilot, not a representative research sample.

## What is ready

The original published revision is unchanged. Its eight questions cover eligibility, a recent decision, gathering evidence, choosing what to act on, how the process worked, what happened afterward, possible improvements and anything missed. The questions avoid presuming a difficult process or a specific way of sharing feedback. Each open question has at most one adaptive follow-up; the closing question has none.

The published admission limit is two. Non-preview active and completed interviews reserve places; screen-outs release capacity. A preview is separate from a real interview and does not count toward findings. Pausing fielding stops new admissions while admitted participants can finish.

Consent is required, and audio recording requires separate consent. Participants can type instead. Vercel deployment protection remains enabled, so check that each colleague can open the link with their own authorized Vercel access. Do not share account credentials or a protection-bypass token. Use the link directly; email delivery, paid panels and incentives are not needed.

The latest [demo readiness checks](demo-readiness.md) passed, including seven real hosted AI calls. No additional provider call or participant admission was made while opening this pilot. Check the provider project's spending controls before the interviews and record actual pilot charges afterward; app usage rows alone cannot establish a dollar total.

## Invitation to copy

> Hey. Can you help me try Echo Lab? It's a 10–15 minute interview about a recent product decision you made using customer feedback. I'm looking for two people who've done that in the last three months.
>
> Here's the link: https://echo-lab-psi.vercel.app/s/dc5f6d5b-7d55-4f43-86f8-b9fee059bf73
>
> You'll need Vercel access. You can type or choose to record your answers, and you can stop at any time. Your answers and any recordings are stored in our research workspace; the configured AI provider processes interview text and any audio you submit for transcription. Please leave out customer names and confidential details.
>
> When you're done, LMK what felt confusing or got in the way. Thanks!

## Run the two interviews

Use desktop Chrome for the first session. Try a supported mobile browser for the second if available, and record the actual browser/device. Microphone participation is optional; a text-only completion is valid. If neither participant chooses audio, the voice-quality evaluation stays pending.

Ask participants to describe a real recent decision in their own words. Do not coach the answer or require a negative experience. Observe consent, microphone permission, question clarity, transcription corrections, waiting time, follow-up relevance and completion. One participant can try pause/recovery on the same device after saving an answer if comfortable. Do not deliberately disconnect a live interview to reproduce a failure; record naturally occurring problems and reproduce them separately with synthetic data.

Debrief each participant: What was confusing? Did any question or transcript change your meaning? Did you have to repeat yourself? Would typing or speaking have worked better? Keep observations in a private research location. Use P01/P02 in coordination notes and record study/question/turn identifiers when reporting an issue. Keep participant names, raw responses, recordings and identifying screenshots out of source control.

Use the blank [evaluation worksheet](pilot-evaluation-template.md) to structure private notes. Do not commit a completed worksheet.

## Review the findings together

After both interviews finish, pause fielding. In **Responses**, verify the real completed count and inspect original answers; previews, screen-outs, exclusions and unfinished sessions must remain distinguishable. Check any recording against its transcript, particularly names, negatives, qualifications and important details.

Generate an analysis, then read every theme against the complete interviews. Verify every citation's interview, turn and exact quote. Check evidence that the model omitted, including successful processes, disagreements and uncoded answers. With two participants, say “one of two” where appropriate; do not infer prevalence or generalize to the team.

Record unsupported statements, omitted or misleading evidence and the minutes spent correcting the memo. Correct the interpretation and mark the memo reviewed before sharing it. A valid source link establishes provenance, not the accuracy of the interpretation.

Create a collection with the completed interviews. Add one concrete follow-up with an owner and due date, then create a handoff summary and review the current packet. Study-analysis review and approval of saved collection findings are separate workflows. Complete task edits before final packet approval. In **Research planning**, verify the task and any requested reviewer appear in the intended scope, then preview and review a deadline report before downloading it. Completing a task does not approve research.

## Decision after the pilot

Ready for a wider 5–10 person workflow pilot means both colleagues can complete without lost or duplicated work, material transcript errors can be corrected, every retained finding is supported, contrary evidence is represented, and no critical access or recovery issue remains. Review observed duration, correction effort, participant feedback and actual provider charges. Record incomplete checks as pending, including voice checks without consented audio.

Fix blockers first. A wider pilot needs a separate scope and spending decision; opening this two-person study does not authorize paid recruitment, payouts, broader distribution or live email setup. Stop at the evidence review if the interview quality or findings require changes.

## Run record

| Gate                                                        | Status                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Hosted workflow, private storage and AI integration         | Synthetic checks passed; see demo-readiness evidence.                          |
| Internal pilot authorization                                | Approved October 23, 2026.                                                     |
| Published guide                                             | Original revision retained; eight questions, bounded probes, two-person limit. |
| Fielding                                                    | Paused again at Jess’s request; existing sessions may finish.                  |
| Real interviews at preparation                              | Zero; existing preview retained.                                               |
| Colleague access and participation                          | Pending; Jess shares the link directly.                                        |
| Human voice and usability review                            | Pending actual sessions and optional audio consent.                            |
| Finding/source review, correction effort and actual charges | Pending completed interviews.                                                  |
| Wider 5–10 person workflow pilot                            | Not approved or started.                                                       |

Preparation evidence: `test-results/pilot-preparation.json`. The authenticated application API opened fielding; all study properties except fielding, version and update time were verified unchanged, including the published revision and draft. The temporary preparation session and environment file were removed. Existing owner sessions and responses were retained. No application code or deployment change was required.

Admissions were subsequently paused through the authenticated application API. Published guide, admission limit and existing interviews were preserved. The temporary session and environment file were removed. Evidence: `test-results/pilot-pause.json`.
