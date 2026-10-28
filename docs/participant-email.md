# Email invitations and manual reminders

**Study → Fielding → Email invitations and reminders** adds reviewed, plain-text email through Resend. Every message needs a separate deliberate send action. No automatic schedule, bulk campaign or background retry runs. Individual invitation links remain available without email.

## Operator workflow

1. Create an individual participant invitation and save its private link. Choose that unused invitation in **Draft participant email**, enter the authorized recipient, paste the original link, choose initial invitation/reminder and write the subject/message. The link must match this study, its token hash and the configured public origin; generic, foreign and query-string links are rejected.
2. Save the draft and review the exact recipient, sender, reply address and complete plain-text message. The app appends the validated link and an instruction to reply if the participant does not want reminders. Use a monitored reply mailbox. You can write English, Spanish or French content yourself; no automatic translation is claimed.
3. Confirm permission to contact this person and the deployment-access requirement, then select **Send this email now**. Fielding must be active; the invitation must still be valid, unused and retained. Completed/started, revoked, replaced, erased or expired invitations cannot be sent.
4. “Accepted” only means Resend accepted the request. **Check delivery** explicitly retrieves the provider’s latest status, without depending on a webhook reaching the protected site. “Delivered” is not evidence that a person read the message, consented or completed an interview. Refresh email records reloads saved application state; it does not poll the provider automatically.
5. Respond to opt-out replies using **Stop email to address**. The workspace remembers a normalized address hash and blocks future drafts/sends to it. Checking a provider bounce, complaint or suppression also applies this stop. There is no automatic inbox reader or self-service unsubscribe page in this stage. In-flight or already accepted mail cannot be recalled.

A reminder requires an initial email accepted for the same invitation and the same normalized recipient address. Wait at least 24 hours after the last accepted email; at most three reminders may be accepted per invitation. These checks run again at dispatch. This stage intentionally reminds only participants who have not started; active interviews are already bound to their original browser session. Manual “marked shared” status is separate from provider acceptance and is not used as proof an email was sent.

## Provider configuration

Jess deferred domain/Resend setup. Production sending remains disabled; manual invitation sharing works without it. The setup below is optional future work. The implementation and local/provider-contract tests are complete; live provider acceptance/delivery still needs configuration and a controlled check.

In Echo Lab’s [Production environment variables](https://vercel.com/jessholbrook-gmailcoms-projects/echo-lab/settings/environment-variables), add:

- `RESEND_API_KEY` as a **Secret**, scoped to Production. Use a Resend API key permitted to send and retrieve emails; a send-only key cannot support delivery checks. Do not paste the key into chat.
- `RESEARCH_EMAIL_FROM` as the bare sender email address on your verified Resend domain, such as `research@your-domain.example` (replace with your real verified address).
- `RESEARCH_EMAIL_REPLY_TO` as a real, monitored reply address for participant questions and opt-outs.

`RESEARCH_PUBLIC_URL=https://echo-lab-psi.vercel.app` and a generated 32-byte base64 `RESEARCH_EMAIL_ENCRYPTION_KEY` Secret are already configured for Production. No provider key or sender has been invented. Redeploy after adding/changing variables. Keep the encryption key stable and securely backed up: rotating it without migrating existing ciphertext makes saved drafts unreadable. A private backup generated during setup is outside the repository; never commit or publish it.

Resend domain verification/DNS and account setup are external steps. Relevant public references: [send email](https://resend.com/docs/api-reference/emails/send-email), [retrieve email](https://resend.com/docs/api-reference/emails/retrieve-email), [24-hour idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys), [domains](https://resend.com/docs/dashboard/domains/introduction). No webhook secret or cron service is needed in this stage. Use Resend’s documented simulator addresses for controlled provider testing; do not contact real participants as a deployment test.

The hosted app still requires Vercel sign-in, including participant links. Invitations do not bypass this. Keep this internal workflow until external access is separately approved.

## Retry and failure rules

Draft creation uses a scoped request ID and content fingerprint: exact retries return the same message, changed content conflicts. Drafts are immutable; cancel an unsent/definitively failed draft and create a new one to edit it. A study supports up to 1,000 retained email records. Researchers/admins manage messages; collaborators see masked recipient addresses and cannot inspect full bodies or send.

The app persists a send lease and immutable encrypted provider payload before dispatch. Attempts reuse the same `echo-invitation/<message-id>` provider idempotency key. Concurrent sends are blocked while the lease is active. Auth/validation failures are shown as failed; interrupted responses, rate limits and server errors are uncertain because the provider may have accepted the request. No request is retried in the background. The reviewer must retry the same message, with the same provider key and payload, within 23 hours of the first attempt. This deliberately stops before Resend’s documented 24-hour deduplication expiry. Later attempts are blocked, not silently duplicated. A provider-key change also blocks retries until reconciled.

An uncertain email cannot simply be cancelled and recreated for the same invitation. Check the Resend dashboard first. If reconciliation requires a new invitation, replace the old unused link so the original cannot admit a participant. Pausing/revoking/deleting after dispatch cannot recall mail already in flight. Provider/API read failures leave the saved delivery status unchanged rather than inventing success.

## Privacy and deletion

Recipient address, sender/reply addresses, subject, full message and raw individual link are stored together using AES-256-GCM, with a random nonce and message ID as authenticated context. Application records separately retain scoped IDs, version/state, timestamps, attempt counts, fingerprints and a normalized recipient hash. The key is server-side. Local development uses a mode-0600 key in the private data directory; production requires the configured key and never falls back to an ephemeral file.

Deleting a source response, erasing its invitation details or invitation retention deletes linked encrypted message records. Email retention independently removes records older than the configured source-retention period (default 90 days), on the existing request-driven cleanup path. Suppression hash records remain independently to honor opt-out stops; they contain no raw address, source/study pointer or message content. They are pseudonymous suppression markers, not proof of anonymity.

Delivery CSV contains recipient, subject and operational state/timestamps; it excludes message bodies and invitation tokens. Collaborator exports mask recipients. Exports and Resend’s copies are outside application deletion and need their own handling. No live human recipient has been contacted during implementation.

## Validation and next checkpoint

The full automated suite passes **87 tests**, including the email suite; strict TypeScript, production compilation, the compiled-server lifecycle and email/invitation browser checks pass. Automated tests cover exact-link validation, cryptographic tamper/ID binding, Resend request shape/idempotency/retrieval, ambiguous errors, draft retries/conflicts, workspace/role scopes, private stored data, lease/23-hour gates, reminder timing/address rules, suppression, CSV and invitation/source erasure. API fixtures deliberately use independent saved provider outcomes rather than a test delivery endpoint in the app. Browser checks cover composition, exact review, disabled sending without a key, cancellation, stops, export and mobile layout. Compiled-server and hosted checks cover lifecycle/configuration boundaries; a real provider acceptance/delivery check remains pending sender setup.

Provider/domain setup and live sending are deferred. The [read-only API with scoped keys](read-api.md) is now implemented; next proposed build is a read-only MCP server. Panel recruitment, actual payouts, OAuth MCP and scheduled campaigns remain separate work.
