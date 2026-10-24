import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  emailLinkToken,
  reminderIssue,
  retryExpired,
  maskedEmail,
  type InvitationEmail,
} from "../src/lib/invitation-email";
import {
  sendInvitationEmail,
  emailConfiguration,
  invitationDelivery,
} from "../src/lib/invitation-email-provider";
import { MockAgent, fetch } from "undici";
const token = randomBytes(32).toString("base64url");
const base: InvitationEmail = {
  id: "id",
  workspaceId: "w",
  studyId: "s",
  invitationId: "i",
  kind: "invitation",
  version: 1,
  createdAt: new Date().toISOString(),
  createdBy: "Researcher",
  state: "accepted",
  sealed: "encrypted",
  fingerprint: "hash",
  recipientHash: "hash",
  attempts: 1,
  acceptedAt: "2026-10-19T00:00:00Z",
};
test("Email links are exact individual links and retry/reminder limits use conservative time bounds", () => {
  assert.equal(
    emailLinkToken(
      `https://echo.example/s/s#invite=${token}`,
      "https://echo.example",
      "s",
    ),
    token,
  );
  for (const link of [
    `https://evil.example/s/s#invite=${token}`,
    `https://echo.example/s/x#invite=${token}`,
    `https://echo.example/s/s?invite=${token}`,
    `https://echo.example/s/s#invite=${token}&x=1`,
  ])
    assert.throws(() => emailLinkToken(link, "https://echo.example", "s"));
  const at = Date.parse("2026-10-20T00:00:00Z");
  assert.equal(reminderIssue("reminder", [base], at), null);
  assert.ok(reminderIssue("reminder", [base], at - 1));
  assert.ok(reminderIssue("invitation", [base], at));
  assert.ok(reminderIssue("reminder", [{ ...base, state: "uncertain" }], at));
  assert.ok(
    reminderIssue(
      "reminder",
      [base, ...[0, 1, 2].map(() => ({ ...base, kind: "reminder" as const }))],
      at,
    ),
  );
  assert.equal(
    retryExpired(
      { ...base, firstAttemptAt: base.acceptedAt },
      Date.parse(base.acceptedAt!) + 23 * 3600000,
    ),
    true,
  );
  assert.equal(maskedEmail("private@example.test"), "p***@example.test");
});
test("Encrypted email content uses authenticated encryption bound to its message ID", async () => {
  process.env.RESEARCH_EMAIL_ENCRYPTION_KEY =
    randomBytes(32).toString("base64");
  const { sealEmail, openEmail } =
    await import("../src/lib/invitation-email-crypto");
  const payload = { to: "private@example.test", token };
  const sealed = sealEmail(payload, "message");
  assert.ok(!sealed.includes(token));
  assert.ok(!sealed.includes(payload.to));
  assert.deepEqual(openEmail(sealed, "message"), payload);
  assert.throws(() => openEmail(sealed, "another"));
  const parts = sealed.split(".");
  const bytes = Buffer.from(parts[2], "base64");
  bytes[0] ^= 1;
  parts[2] = bytes.toString("base64");
  assert.throws(() => openEmail(parts.join("."), "message"));
});
test("Resend transport sends the frozen plain-text payload and stable idempotency key; timeout and errors stay explicit", async () => {
  process.env.RESEND_API_KEY = "synthetic-test-key";
  process.env.RESEARCH_EMAIL_FROM = "research@example.test";
  process.env.RESEARCH_EMAIL_REPLY_TO = "reply@example.test";
  process.env.RESEARCH_PUBLIC_URL = "https://echo.example";
  assert.equal(emailConfiguration().ready, true);
  const agent = new MockAgent();
  agent.disableNetConnect();
  const pool = agent.get("https://api.resend.com");
  const payload = {
    from: "research@example.test",
    reply_to: "reply@example.test",
    to: ["delivered@resend.dev"],
    subject: "Reviewed subject",
    text: "Exact reviewed text",
  };
  pool
    .intercept({
      path: "/emails",
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Idempotency-Key": "echo-invitation/message" },
    })
    .reply(200, { id: "provider-message" })
    .times(2);
  const transport = ((input: any, init: any) =>
    fetch(input, { ...init, dispatcher: agent })) as typeof fetch;
  assert.deepEqual(await sendInvitationEmail(payload, "message", transport), {
    ok: true,
    id: "provider-message",
  });
  assert.deepEqual(await sendInvitationEmail(payload, "message", transport), {
    ok: true,
    id: "provider-message",
  });
  pool
    .intercept({ path: "/emails", method: "POST" })
    .reply(401, { message: "private provider response" });
  const denied = await sendInvitationEmail(payload, "denied", transport);
  assert.equal(denied.ok, false);
  assert.equal("uncertain" in denied && denied.uncertain, false);
  assert.ok(!JSON.stringify(denied).includes("private provider response"));
  const lost = await sendInvitationEmail(payload, "lost", (async () => {
    throw new Error("socket reset with private details");
  }) as unknown as typeof fetch);
  assert.equal("uncertain" in lost && lost.uncertain, true);
  assert.ok(!JSON.stringify(lost).includes("private details"));
  pool
    .intercept({ path: "/emails/provider-message", method: "GET" })
    .reply(200, { last_event: "bounced" });
  assert.equal(
    await invitationDelivery("provider-message", transport),
    "bounced",
  );
  await agent.close();
  delete process.env.RESEND_API_KEY;
});
