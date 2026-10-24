# Read-only API and scoped keys

The F40 initial stage is a versioned, server-to-server JSON API at `/api/v1`. It uses the existing database; no domain, email provider or new service is needed. Resend sending remains deferred at Jess’s request. This API cannot edit research, publish/open fielding, admit participants, send email, spend money or download recordings.

## Create and rotate a key

An admin opens **Team & settings → Read-only API keys**, gives the integration a name, selects 1–50 specific studies, selects read permissions and an expiry of 1–90 days, then confirms the grant. Study names and short IDs are visible when selecting access; each issued key also lists its granted studies for review. Draft studies may be selected, but their data remains unavailable until publication. Future new studies are never granted automatically.

The creation view shows a masked key with a copy button. Save it in a secret store. Closing the settings view or acknowledging the key clears it from the browser view. There is no retrieval endpoint. Lost keys should be revoked and replaced. To rotate, issue a replacement, update the integration, check its reads and revoke the old key. Each workspace supports up to 20 active keys and 100 retained key records, including revoked/expired records; metadata is retained for administration rather than auto-deleting revocation history.

The browser generates 32 cryptographically random bytes. The server stores only a SHA-256 token hash and scoped metadata; it never stores the raw bearer secret. Exact in-flight creation retries use the same request ID and random secret to recover the same response; changing the request conflicts. Retrying creation of a revoked/expired key does not reactivate it. Keys are immutable; changing study access or permissions requires rotation.

Only admins can list/create/revoke keys. Every bearer request checks that the issuing account still exists as an admin in the same workspace. Demotion/removal disables its keys; restoring the same account’s admin role can restore otherwise valid keys, so revoke keys explicitly when access should end permanently. Any current workspace admin can revoke a key. New requests fail after revocation; an already authenticated request may finish. Downloaded copies are outside application revocation/deletion.

## Scopes and endpoints

| Scope            | GET endpoint                              | Returns                                                                                            |
| ---------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `studies:read`   | `/studies`                                | Paginated published studies in the key’s explicit allowlist.                                       |
| `studies:read`   | `/studies/:studyId`                       | Published title, fielding state, revision ID, dates, data version and question count.              |
| `responses:read` | `/studies/:studyId/responses`             | Paginated completed, included, non-preview response summaries.                                     |
| `responses:read` | `/studies/:studyId/responses/:responseId` | Response summary plus original prompts, answers, structured values and source turn IDs/timestamps. |
| `analyses:read`  | `/studies/:studyId/analyses`              | Paginated reviewed current analysis summaries.                                                     |
| `analyses:read`  | `/studies/:studyId/analyses/:analysisId`  | Reviewed summary, limitations, memo, themes and exact citations.                                   |

Scopes are independent. A response-only key can read responses for its known allowed study IDs without listing study metadata. Analysis scope includes reviewed memos and cited participant quotes; it does not grant full response access. Keys cannot read another workspace or an unselected study, including response/analysis IDs from those studies.

Response summaries contain IDs, dates, revision/language, native/imported classification and turn count. Detail projections deliberately omit participant/session tokens, invitation IDs, participant tags/contact metadata, guides/routing state, private media IDs, recording bytes, imported external identifiers, pending requests and internal provider state. Original free text can still contain volunteered personal information: these projections are not anonymization. Select scopes and studies accordingly.

Excluded, withdrawn, incomplete and preview interviews are unavailable. Deleted sources disappear immediately from subsequent reads. Imported responses may appear if completed/included, with `source: "imported"`; import provenance IDs/contact labels/media are not exported. Reviewed analyses must match the study’s current `dataVersion`, and their citations must still match live eligible source turns exactly. Stale, unreviewed or invalidated analyses are omitted from lists and return 404 by ID. Review is a human approval flag, not a guarantee of research validity.

No recruitment roster, email, financial ledger, media, draft guide, workspace membership or provider-usage endpoint is exposed. API bearer keys are not accepted by the existing cookie-authenticated researcher endpoints. Workspace cookies alone do not authenticate `/api/v1`.

## Requests and pagination

Send `Authorization: Bearer <key>` over HTTPS. Never put a key in a URL, source repository or client-side application. Example (environment variables, no real secret in the command):

```sh
curl "$ECHO_LAB_URL/api/v1/studies?limit=25" \
  -H "Authorization: Bearer $ECHO_LAB_API_KEY"
```

A detail response is `{ "data": { ... } }`. Lists return `{ "data": [ ... ], "nextCursor": null }` or an opaque `nextCursor` to pass back as `?cursor=...`. List pages accept only `limit` (integer 1–100, default 25) and `cursor`. Duplicate/unknown parameters and cursors for another resource/study are rejected. Detail endpoints accept no query parameters.

IDs order pages in ascending lexicographic order; cursors are positions, not credentials. Every page rechecks key authorization and current sources. Pagination is a live view, not a transaction-wide snapshot: new records and deletions between pages can change later results. Empty analysis pages can still have a next cursor when candidate records fail current citation checks; continue until the cursor is null.

All non-GET methods, including OPTIONS and HEAD, return 405 with `Allow: GET`; no browser CORS grant is enabled. Read-only refers to research operations. Authentication usage counters and the existing source-retention housekeeping can write operational metadata.

Each key permits 60 authenticated attempts per UTC minute, shared with the MCP endpoint. A database transaction checks and increments the counter across instances, including failed scope/resource/query attempts. Responses report `X-RateLimit-Limit`/`X-RateLimit-Remaining`; 429 includes `Retry-After` seconds. This is a per-key rate limit, not an entire public-internet abuse-control service.

Responses set `Cache-Control: private, no-store`, `Vary: Authorization`, `X-Content-Type-Options: nosniff` and a server-generated `X-Request-ID`. Errors use:

```json
{
  "error": {
    "code": "insufficient_scope",
    "message": "This API key does not grant the required read permission.",
    "requestId": "server-generated-uuid"
  }
}
```

Codes/statuses: `invalid_request`/400, `unauthorized`/401, `insufficient_scope`/403, `not_found`/404, `method_not_allowed`/405, `rate_limited`/429, `internal_error`/500. A 401 includes `WWW-Authenticate: Bearer realm="Echo Lab API"`. Internal errors do not return database errors or stack traces. The management view records last use; this stage does not provide a full request audit log, OAuth, SDK or webhooks.

## Vercel deployment protection

Production remains https://echo-lab-psi.vercel.app behind Vercel access protection. A research API key does not bypass Vercel’s outer check, and this release does not disable it. Use an authorized Vercel CLI session (`vercel curl`) or a separately managed Vercel automation bypass header if your integration is permitted that access. The latter credential comes from Vercel project protection settings and is separate from the Echo Lab key; never expose either in URLs. External integrations need both layers until an external-access deployment decision is approved.

## Validation and next item

The full automated suite passes **198 tests**. Strict TypeScript, the production build, compiled-server API lifecycle, API-key browser checks and workflow browser regression pass. Tests cover exact field projections, published/current/reviewed source gates, bounded resource-specific pagination, admin/cookie/bearer separation, cross-study/workspace denial, mutation denial, exact creation retries, source exclusion/deletion, expiry/revocation, issuer demotion and concurrent durable rate limits. Browser checks exercise study/permission selection, the masked one-time key view, bearer reads, last-used metadata, mobile layout and revocation. The HTTP lifecycle also runs against the compiled production server. Hosted verification uses disposable synthetic data and preserves existing owners and the paused pilot; no new persistent owner key is installed automatically.

The [read-only MCP server](mcp.md) now shares this authorization, data projection and rate counter. Its six read tools are available at `/api/mcp`. [OAuth delegation for MCP](oauth.md) is now implemented; these access tokens are intentionally unavailable to the REST API. The [Qualtrics handoff](survey-handoff.md) is now implemented. [Rally handoff](rally-handoff.md) is now implemented. [Decipher/Forsta handoff](forsta-handoff.md) is now implemented. Screener-answer quotas are implemented. Minimum/exact targets are implemented. Percentage quotas are implemented. Participant branding is implemented; see [logo, colors and snapshot rules](participant-branding.md). Private concept images are implemented; see [image contract](concept-images.md). Prototype links and tasks are implemented; see [prototype contract](prototype-concepts.md). Private video concepts are implemented; see [video rules](concept-videos.md). [Timed concept presentation](timed-concepts.md) is implemented. [Single-/multiple-choice image answers](answer-images.md) are implemented. [Ranking and MaxDiff image answers](ranking-maxdiff-images.md) are implemented. [Study media watermarking](media-watermarks.md) is implemented. [One-time concept video viewing](one-time-video.md) is implemented. [Participant confidentiality acknowledgements](confidentiality-acknowledgements.md) are implemented. [Private participant image uploads](participant-image-uploads.md) are implemented. [Optional image-aware AI follow-ups](participant-image-ai.md) are implemented. [Researcher image review and correction history](participant-image-review.md) are implemented. [Reviewed attachment evidence in analysis and reports](attachment-evidence.md) is implemented. [AI synthesis of included researcher observations](attachment-synthesis.md) is implemented. [Private PDF participant uploads and researcher review](participant-pdfs.md) are implemented. [PDF text extraction with page citations and researcher verification](pdf-text.md) is implemented. [Verified PDF passages in analysis and reports](pdf-evidence.md) are implemented. [AI synthesis of verified PDF passages](pdf-synthesis.md) is implemented. [Optional PDF-aware interview follow-ups](participant-pdf-ai.md) are implemented. [Researcher PDF grounding reviews and correction history](participant-pdf-review.md) are implemented. [Explicit inclusion of researcher PDF observations and corrections](pdf-observations.md) is implemented. [AI synthesis of included researcher PDF observations](pdf-observation-synthesis.md) is implemented. [Researcher Q&A over included PDF observations](pdf-observation-qa.md) is implemented. [Saved and reviewed PDF-observation Q&A report appendices](pdf-observation-answer-reviews.md) are implemented. Next for approval: **researcher-triggered OCR for scanned PDF pages (F12)**. Research write/launch tools remain separate follow-on work. Resend delivery/domain setup remains deferred.
