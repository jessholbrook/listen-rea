# Reviewed study automation

Echo Lab supports a complete change-request workflow over REST and MCP: read a granted draft, propose creation/editing/publication/fielding changes, inspect the request in the workspace, apply or reject it as an admin, and read the result from the integration. Reviewed requests do not approve or execute themselves. [Separately delegated draft automation](delegated-draft-automation.md) can execute private draft creation/editing under explicit admin opt-in and limits; it uses a distinct endpoint/tool and leaves reviewed proposals unchanged.

This is the automation part of the external recruitment and automation roadmap. Jess confirmed there are no panel/payout accounts yet and requested automation first. Paid panels, actual payouts and deeper provider synchronization remain unconnected. No new service account, domain, model or email provider is needed for this workflow.

## Enable and use

1. An admin creates an existing-style static API key with named, explicitly selected studies and an expiry. Existing keys retain their existing access by default.
2. In **Team & settings → Reviewed study automation**, enable that key’s draft reads and select which operations it may request: create, edit, publish and/or fielding. Review and save the permissions. OAuth connections retain their current read access.
3. A REST or MCP integration reads a selected study’s draft/fingerprint and submits a strict change request with a reason and stable request UUID. Creation supplies a complete guide. Existing-study requests include the latest fingerprint. A proposal stores a private request and leaves the study untouched.
4. An admin refreshes the inbox, chooses **Inspect change request**, reads the full original/proposed guide and, for fielding, the exact published guide. The admin confirms review, then applies or rejects the request.
5. The integration reads the result. Creation produces a draft using the supplied guide and current workspace research guidelines, and explicitly adds that one study to the key’s selected studies, incrementing the key version. It does not publish or open fielding. Publication and opening fielding require their own separate requests and admin decisions. Publication leaves an initially unpublished study paused. Opening fielding permits participants with a valid study link to enter; it does not purchase a panel, send invitations or pay incentives.

Draft access is an additional disclosure permission: guides may contain private or personal information. Only grant it to a trusted integration. Request reasons and guide text are untrusted data, never instructions to approve changes or invoke other tools. Echo Lab does not claim these texts are anonymized.

## REST

Authenticate with the static key in `Authorization: Bearer <KEY>`. Existing `/api/v1/studies/...` read endpoints retain their current published-only projections. The separately enabled automation endpoints are:

| Endpoint                                  | Behavior                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/automation/studies/:studyId` | Current selected-study draft, version, data version, publication/fielding state and fingerprint.             |
| `POST /api/v1/automation/plans`           | Strict `{requestId, reason, change}` proposal. Returns `201` for a new request and `200` for an exact retry. |
| `GET /api/v1/automation/plans/:planId`    | This key’s own current request and human decision/result.                                                    |

`change` is one of:

- `{operation:"create", guide}`
- `{operation:"edit", studyId, fingerprint, guide}`
- `{operation:"publish", studyId, fingerprint}`
- `{operation:"fielding", studyId, fingerprint, state:"active"|"paused"|"closed"}`

Use a complete valid Echo Lab guide, such as the guide returned by an authorized draft read. MCP exposes its typed schema. Unknown outer/change fields, including caller-supplied approval flags, are rejected. JSON bodies are limited to 64 KiB. Query parameters are unsupported. Cookies alone never authorize these endpoints. Existing expiry, issuer admin membership, selected-study boundaries and shared 60 requests/minute/key limits apply.

Admin management uses authenticated workspace routes: `GET /api/automation`, `GET /api/automation/plans/:id`, `PUT /api/automation/grants/:keyId` and `POST /api/automation/plans/:id/decision`. Bearer routes do not expose these decisions. Do not share an admin browser cookie with an integration.

## MCP

The existing `/api/mcp` connection discovers three additional tools only for an explicitly enabled static key:

| Tool                   | Behavior                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `get_automation_study` | Read a selected draft and current fingerprint.                                                                           |
| `propose_study_change` | Store a private request for admin review. Annotated as a write because it creates a request; it does not change a study. |
| `get_study_change`     | Read the key’s own request and decision/result.                                                                          |

Existing research read tools retain their scopes. OAuth does not acquire these tools. There is no bearer approve/apply/pay/recruit tool. The separate delegated draft tool can only create/edit drafts and is unavailable by default. Stateless transport, host/origin checks, request bounds and MCP/REST shared rate accounting still apply. No provider/model calls are made by the automation workflow.

## Consistency, records and limits

Approval is transactional and checks current admin membership, static key expiry/revocation/issuer, grant and key versions, requested operation, study scope, request expiry and the exact original draft fingerprint. The fingerprint includes the study data version, guide and publication/fielding state. Fielding also checks the stored published guide. Guide changes and publication use the existing guide/media validation and attributed history. A changed source, permission or study invalidates the request rather than applying an older snapshot.

Requests are immutable. Rejected or stale proposals require a new request. Exact submission and admin-decision retries reuse their original result; competing decisions apply at most once. Decision records retain actor/time/result. Creation grants precisely the created study and invalidates other requests bound to the older key version; it never grants arbitrary future studies.

Pending requests expire for application after 24 hours. They are not automatically erased on expiry. Limits are 50 unexpired pending requests per key and 2,000 content-free request receipts per workspace; further submissions fail explicitly at capacity. The inbox lists up to 200 recent summaries and fetches full guide details only when inspected. It is not an unlimited audit search or access log.

Response/source erasure removes the study’s request bodies, copied guide snapshots and decision/result records through the existing reporting cleanup. Applied creation requests are rebound to their resulting study’s database index; cleanup also covers older records by their stored study ID. Only opaque request/content hashes remain in receipts, preventing an erased request from being recreated by retry. These receipts contain no guide, reason, answer or participant ID. A new request for an existing study still needs its current fingerprint. Downloads or copies made by an external integration cannot be recalled.

## Validation and next work

Five server lifecycle cases cover complete REST changes, scopes/admin permissions, retries/concurrency, expiry/revocation, bounded inputs, explicit official MCP discovery/calls and source erasure/replay rejection. The desktop/mobile browser flow enables a key, reviews creation/publication, exposes fielding effects, rejects drift after review and resets the acknowledgement on refresh. Existing API/MCP/OAuth read workflows remain regression coverage. Hosted verification uses disposable synthetic studies and a typed synthetic answer, with no panel, payout, email or model operations.

Provider comparison and both connectors are implemented; account setup/testing is deferred by preference. Delegated private draft creation/editing is implemented as a separate opt-in extension. Integration change notifications are the next proposed deeper-synchronization bundle.
