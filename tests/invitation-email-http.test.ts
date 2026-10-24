import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient } from "@libsql/client";
import { start, stop, client, base, dataDirectory } from "./harness";
import { emotionInterview } from "./emotion-fixture";
before(
  () =>
    start({
      email: true,
      port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3126 : 3125,
    }),
  { timeout: 90000 },
);
after(stop);
test(
  "Email drafts preserve private links, scopes, review gates, manual reminder bounds, suppression and erasure",
  { timeout: 90000 },
  async () => {
    const owner = await client(),
      other = await client(),
      anon = await client(),
      collab = await client();
    for (const [c, email] of [
      [owner, "mail@example.test"],
      [other, "other-mail@example.test"],
    ] as const)
      await c("auth/signup", "POST", {
        name: "Researcher",
        email,
        password: "email-test-password",
      });
    const invite = (await owner("invites", "POST", { role: "collaborator" }))
      .invite;
    await collab("auth/signup", "POST", {
      name: "Observer",
      email: "mail-observer@example.test",
      password: "email-test-password",
      invite,
    });
    let s = (await owner("studies", "POST", { title: "Email invitations" }))
      .study;
    s = (
      await owner(`studies/${s.id}`, "PUT", {
        version: s.version,
        guide: emotionInterview().guide,
      })
    ).study;
    await owner(`studies/${s.id}/publish`, "POST", { version: s.version });
    await owner(`studies/${s.id}/fielding`, "POST", { state: "active" });
    const root = `studies/${s.id}`,
      emails = root + "/emails";
    const issued = await owner(root + "/invitations", "POST", {
      requestId: randomUUID(),
      secret: randomBytes(32).toString("hex"),
      expiresAt: new Date(Date.now() + 86400000 * 7).toISOString(),
      recipients: [{ reference: "P001" }, { reference: "P002" }],
    });
    const input = {
      requestId: randomUUID(),
      invitationId: issued.links[0].invitation.id,
      kind: "invitation",
      to: "private@example.test",
      subject: "Research invitation",
      message: "We would value your perspective.",
      link: base + issued.links[0].path,
    };
    assert.equal((await anon(emails)).status, 401);
    assert.equal((await other(emails)).status, 404);
    assert.equal((await collab(emails, "POST", input)).status, 403);
    assert.equal((await owner(emails)).configured, false);
    assert.equal(
      (
        await owner(emails, "POST", {
          ...input,
          link: input.link.replace(base, "https://evil.example"),
        })
      ).status,
      400,
    );
    const draft = await owner(emails, "POST", input);
    assert.equal(draft.status, 201);
    const id = draft.message.id;
    assert.equal((await owner(emails, "POST", input)).message.id, id);
    assert.equal(
      (await owner(emails, "POST", { ...input, subject: "Changed" })).status,
      409,
    );
    assert.equal(
      (await owner(emails, "POST", { ...input, requestId: randomUUID() }))
        .status,
      409,
    );
    const preview = await owner(emails + "/" + id);
    assert.ok(preview.message.payload.text.includes(input.link));
    assert.ok(preview.message.payload.text.includes("reply@example.test"));
    assert.equal((await collab(emails + "/" + id)).status, 403);
    assert.equal((await collab(emails)).messages[0].to, "p***@example.test");
    assert.equal(
      (await owner(emails + "/" + id + "/send", "POST", { version: 1 })).status,
      400,
    );
    assert.equal(
      (
        await owner(emails + "/" + id + "/send", "POST", {
          version: 1,
          confirmed: true,
        })
      ).status,
      503,
    );
    const sql = createClient({
      url: "file:" + dataDirectory() + "/research.sqlite",
    });
    try {
      const get = async () =>
        JSON.parse(
          (
            await sql.execute({
              sql: "SELECT data FROM documents WHERE kind='invitationEmail' AND id=?",
              args: [id],
            })
          ).rows[0].data as string,
        );
      const stored = await get();
      assert.ok(!JSON.stringify(stored).includes(input.to));
      assert.ok(!JSON.stringify(stored).includes(input.link));
      assert.ok(!JSON.stringify(stored).includes(input.subject));
      await sql.execute({
        sql: "UPDATE documents SET data=? WHERE kind='invitationEmail' AND id=?",
        args: [
          JSON.stringify({
            ...stored,
            state: "sending",
            version: 2,
            leaseUntil: Date.now() + 60000,
            firstAttemptAt: new Date().toISOString(),
          }),
          id,
        ],
      });
      assert.equal(
        (
          await owner(emails + "/" + id + "/send", "POST", {
            version: 2,
            confirmed: true,
          })
        ).status,
        409,
      );
      await sql.execute({
        sql: "UPDATE documents SET data=? WHERE kind='invitationEmail' AND id=?",
        args: [
          JSON.stringify({
            ...stored,
            state: "uncertain",
            version: 2,
            firstAttemptAt: new Date(Date.now() - 23 * 3600000).toISOString(),
          }),
          id,
        ],
      });
      assert.equal(
        (
          await owner(emails + "/" + id + "/send", "POST", {
            version: 2,
            confirmed: true,
          })
        ).status,
        409,
      );
      // Independently saved provider outcomes allow API gate checks without any real email or test endpoint in the application.
      await sql.execute({
        sql: "UPDATE documents SET data=? WHERE kind='invitationEmail' AND id=?",
        args: [
          JSON.stringify({
            ...stored,
            state: "accepted",
            acceptedAt: new Date().toISOString(),
            delivery: "accepted",
            providerId: "synthetic-provider-id",
          }),
          id,
        ],
      });
      assert.equal(
        (
          await owner(emails + "/" + id + "/send", "POST", {
            version: 1,
            confirmed: true,
          })
        ).status,
        200,
      );
      const reminder = { ...input, kind: "reminder", requestId: randomUUID() };
      assert.equal((await owner(emails, "POST", reminder)).status, 409);
      await sql.execute({
        sql: "UPDATE documents SET data=? WHERE kind='invitationEmail' AND id=?",
        args: [
          JSON.stringify({
            ...stored,
            state: "accepted",
            acceptedAt: new Date(Date.now() - 86400001).toISOString(),
            delivery: "accepted",
          }),
          id,
        ],
      });
      assert.equal(
        (
          await owner(emails, "POST", {
            ...reminder,
            to: "changed@example.test",
          })
        ).status,
        409,
      );
      const next = await owner(emails, "POST", reminder);
      assert.equal(next.status, 201);
      assert.equal(
        (
          await owner(emails + "/" + next.message.id + "/cancel", "POST", {
            version: 1,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await owner(emails + "/" + next.message.id + "/send", "POST", {
            version: 2,
            confirmed: true,
          })
        ).status,
        409,
      );
      const roster = await owner(emails + "/export");
      assert.ok(roster.text.includes(input.to));
      assert.ok(!roster.text.includes(input.link));
      assert.ok(!(await collab(emails + "/export")).text.includes(input.to));
      assert.equal(
        (await owner(emails + "/" + id + "/suppress", "POST", { version: 1 }))
          .status,
        200,
      );
      assert.equal(
        (await owner(emails, "POST", { ...reminder, requestId: randomUUID() }))
          .status,
        409,
      );
      assert.equal(
        (
          await owner(
            root + `/invitations/${input.invitationId}/erase`,
            "POST",
            { version: 1 },
          )
        ).status,
        200,
      );
      assert.equal((await owner(emails)).messages.length, 0);
      // A separate invited source checks full response deletion, not only invitation erasure.
      const second = {
        ...input,
        requestId: randomUUID(),
        invitationId: issued.links[1].invitation.id,
        to: "another@example.test",
        link: base + issued.links[1].path,
      };
      const d = await owner(emails, "POST", second);
      assert.equal(d.status, 201);
      const joined = await anon(`public/${s.id}`, "POST", {
        consent: true,
        invitationToken: issued.links[1].path.split("#invite=")[1],
      });
      await owner(root + `/responses/${joined.interview.id}`, "DELETE");
      assert.equal((await owner(emails)).messages.length, 0);
    } finally {
      sql.close();
    }
  },
);
