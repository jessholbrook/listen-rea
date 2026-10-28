import test from "node:test";
import assert from "node:assert/strict";
import { invitationToken } from "../src/lib/recruitment-tokens";
import {
  invitationBatchInput,
  invitationView,
  redactInvitation,
  type ParticipantInvitation,
} from "../src/lib/recruitment";
import { invitationSessionKey } from "../src/lib/invitation-session";
test("Invitation tokens and saved sessions are scoped and deterministic", async () => {
  const secret = "ab".repeat(32),
    t = invitationToken(secret, "w", "s", "r", 0);
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(t, invitationToken(secret, "w", "s", "r", 0));
  for (const other of [
    invitationToken(secret, "x", "s", "r", 0),
    invitationToken(secret, "w", "x", "r", 0),
    invitationToken(secret, "w", "s", "r", 1),
  ])
    assert.notEqual(t, other);
  assert.equal(await invitationSessionKey("s", null), "study-session:s");
  assert.notEqual(
    await invitationSessionKey("s", t),
    await invitationSessionKey("s", "other"),
  );
  assert.ok(!(await invitationSessionKey("s", t)).includes(t));
});
test("Invitation schema rejects normalized duplicate references and bounded tags", () => {
  const input = {
    requestId: crypto.randomUUID(),
    secret: "ab".repeat(32),
    expiresAt: new Date().toISOString(),
    recipients: [{ reference: " Team A " }, { reference: "Ｔｅａｍ A" }],
  };
  assert.equal(invitationBatchInput.safeParse(input).success, false);
  assert.equal(
    invitationBatchInput.safeParse({
      ...input,
      recipients: [
        {
          reference: "A",
          attributes: Object.fromEntries(
            Array.from({ length: 21 }, (_, n) => [String(n), "x"]),
          ),
        },
      ],
    }).success,
    false,
  );
});
test("Redaction removes invitation details and status retains source deletion", () => {
  const v: ParticipantInvitation = {
    id: "id",
    workspaceId: "w",
    studyId: "s",
    batchId: "b",
    version: 1,
    reference: "Private",
    attributes: { segment: "Private" },
    createdAt: "2026-10-19T00:00:00Z",
    updatedAt: "2026-10-19T00:00:00Z",
    expiresAt: "2026-10-20T00:00:00Z",
    createdBy: "Team",
  };
  assert.equal(
    invitationView(v, undefined, Date.parse("2026-10-19T00:00:00Z")).status,
    "ready",
  );
  const clean = redactInvitation(v, "2026-10-19T01:00:00Z");
  assert.equal(clean.reference, "");
  assert.deepEqual(clean.attributes, {});
  assert.equal(clean.version, 2);
  assert.equal(
    invitationView({ ...clean, claimedAt: "2026-10-19T01:00:00Z" }).status,
    "response_deleted",
  );
});
