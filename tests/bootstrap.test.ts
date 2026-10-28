import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { start, stop, client } from "./harness";
before(() => start({ port: 3104, restrict: true }), { timeout: 90000 });
after(stop);
test("hosted signup policy requires the first-owner code, then permits only one-use invitations", async () => {
  const first = await client(),
    second = await client();
  const input = {
    name: "First Owner",
    email: "first@example.test",
    password: "temporary-test-password",
  };
  assert.equal((await first("auth/signup", "POST", input)).status, 403);
  assert.equal(
    (await first("auth/signup", "POST", { ...input, setupCode: "incorrect" }))
      .status,
    403,
  );
  assert.equal(
    (
      await first("auth/signup", "POST", {
        ...input,
        setupCode: "test-only-internal-setup-code",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await second("auth/signup", "POST", {
        ...input,
        email: "second@example.test",
        setupCode: "test-only-internal-setup-code",
      })
    ).status,
    403,
  );
  const invite = await first("invites", "POST", { role: "collaborator" });
  assert.equal(
    (
      await second("auth/signup", "POST", {
        ...input,
        email: "second@example.test",
        invite: invite.invite,
      })
    ).status,
    200,
  );
  const third = await client();
  assert.equal(
    (
      await third("auth/signup", "POST", {
        ...input,
        email: "third@example.test",
        invite: invite.invite,
      })
    ).status,
    400,
  );
});
