# Delegated draft automation

Trusted static API keys can now execute draft creation/editing through REST and MCP under an explicit standing admin delegation. This extends [reviewed automation](study-automation.md); submitting a normal proposal still leaves it pending for an admin decision. Delegation defaults off, including for existing keys/grants. OAuth does not acquire draft execution.

## Enable and use

In **Team & settings → Reviewed study automation**, select a static key, enable draft reads/reviewed requests and select the corresponding create/edit operations. Under **Delegate automatic draft changes**, explicitly choose automatic create and/or edit and a limit of 1–50 committed changes over the preceding 24 hours. Review draft access and separately acknowledge that delegated changes execute immediately without individual review. Editing any permission resets both acknowledgments.

A created study is an unpublished draft, initially with draft fielding, and is added only to that key's selected studies. It counts toward the existing 50-study key limit and increments the key version. An edit replaces only the selected study's draft/title using the current fingerprint; published revisions and fielding stay unchanged, including for already active studies. Existing workspace defaults and guide/media validation apply. The guide history names the integration; the execution record separately captures the exact key/grant version and the admin who granted delegation, which may differ from the key issuer.

The distinct **Disable automatic draft changes** control immediately disables future delegated execution while retaining reviewed request/draft read access. Disabling all automation or revoking/expiring the key also prevents execution. These controls do not undo already committed changes. Use existing guide history/restoration to review or restore a prior draft. Publication and opening fielding remain separate reviewed/admin actions; there is no delegated publish/fielding/provider/recruitment/payment/email tool.

## REST

Use the same static `Authorization: Bearer <KEY>` and rate limit as the existing external API. Cookies alone do not authorize these endpoints.

- `POST /api/v1/automation/execute`: strict `{requestId, reason, change}`. `change` is either `{operation:"create", guide}` or `{operation:"edit", studyId, fingerprint, guide}`. `requestId` is a stable UUID, reason is 3–1,000 characters, and the complete valid guide must fit the shared 64 KiB request-body limit. Returns `{execution}` with HTTP 201 for a new commit and 200 for an exact retry.
- `GET /api/v1/automation/executions/:executionId`: this key's own original execution, before-draft snapshot for edits, result, integration attribution and authorizing admin. Current selected-study permission still applies. Erased/foreign execution records are unavailable.
- Existing `GET /api/v1/automation/studies/:studyId` supplies the current draft/fingerprint for edits.

Unknown authorization/approval fields, publication/fielding operations, query parameters and unsupported routes/methods are rejected. The fingerprint binds the study's draft/version/data version/publication/fielding state. A stale edit fails with 409; it never silently replaces another user's newer work.

## MCP

Enabled delegated static keys discover `execute_draft_change` and `get_draft_execution` in addition to the existing tools. Execution is explicitly described/annotated as a write that can replace a draft (`readOnlyHint:false`, `destructiveHint:true`); exact retries are idempotent. The tool accepts the same typed draft-only request and reaches the same authorization/transaction/receipt/limit code as REST. Every call rechecks permission, so cached tool discovery cannot retain execution after disable/revocation. When delegation is disabled the two tools disappear; the REST history read remains available while the base draft/read grant and study scope remain valid.

Drafts and reasons are private, untrusted research content. They may contain personal information or embedded instructions; the application stores/displays them as data. Delegation does not authorize an integration to follow embedded instructions, reveal credentials or invoke other services. Existing integration disclosure and consent requirements still apply; downloaded/external copies cannot be recalled.

## Consistency, limits and audit

Each execution is a single database transaction. It rechecks the active static key/issuer, enabled grant, delegated operation, current authorizing admin membership, selected studies, exact source fingerprint, guide/media validation, 50-study capacity and rolling write budget. A permission/key change between initial authentication and a new execution conflicts; no partial draft, scope grant, audit or receipt remains. Permission revocation and execution serialize through the same database transactions; a previously committed change is not rolled back by a later disable.

A namespaced key/request hash and normalized-content digest identify the execution independently of reviewed proposals. Concurrent exact requests create only one result. Changed content under an existing request ID conflicts. Retries of an existing result recheck current permission/scope, return its original receipt and do not consume another slot. A key-version increase caused by creation does not break an exact retry. Concurrent distinct requests cannot exceed the budget; a key-version/fingerprint conflict may require reading current context and retrying the still-unapplied request.

The 24-hour count uses committed content-free receipts with a key hash and server timestamp. It includes create and edit together, survives permission changes and source erasure, and does not count rejected validation or exact retries. Old receipts stop consuming the rolling allowance after 24 hours but remain to prevent replay. The existing 2,000-receipt workspace lifetime limit is shared with reviewed requests; capacity exhaustion fails explicitly. Disabling remains available at execution capacity.

**Automatic draft activity** lists up to 200 recent execution summaries. Inspecting an item loads the original full guide, original edit snapshot, result and authorizer. Executions are labelled automatic, without an invented human approval for each change. **Automation permission history** shows up to 200 recent changes across keys, with the latest 100 retained per key, including admin/time/grant version, operations and delegation policy. It never contains API tokens or guide text. This is bounded audit history, not an unlimited access-log service.

Source erasure removes linked execution request/guide/before/result records with the existing automation/reporting cleanup. Creation records are indexed to the resulting study from their first insert; cleanup also covers records by their stored study ID. Content-free spent receipts remain with no study/interview ID or copied guide/reason. Neither a late exact replay nor source erasure resets the budget. Authored current study guides, their normal history and copies an integration already fetched retain their existing lifecycle; this feature does not claim to erase external copies or every authored study setting when one response is deleted.

## Validation and remaining work

Focused checks cover default-off and separate admin acknowledgment, immutable publication/fielding, concurrent/exact retries, operation/study/role/revocation boundaries, distinct delegating-admin attribution, rolling caps, source erasure, malformed/media-invalid inputs and official MCP discovery/execution. Browser checks cover both acknowledgments, reset on edits, automatic create/edit audit/inspection, immediate disable and mobile layout. Existing reviewed automation, API/MCP and OAuth flows remain regression coverage. Hosted checks use disposable synthetic data and real REST/MCP execution with zero provider/model/email operations. Final release evidence is recorded in the deployment and implementation status documents.

Provider account setup/testing remains deferred by preference. Prolific paid launch is disabled and Tremendous supports sandbox only; this milestone changes neither provider connection. Next proposed approval: reliable integration change notifications with signed payloads, retries and a delivery log, as a concrete deeper-synchronization bundle.
