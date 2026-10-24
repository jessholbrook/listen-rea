import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { start, stop, client } from "./harness";
import { emotionInterview } from "./emotion-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3122 : 3121 }),
  { timeout: 90000 },
);
after(stop);
test(
  "Invitation admission is one-use, retry-safe, scoped, private and source-deletion aware",
  { timeout: 90000 },
  async () => {
    const owner = await client(),
      other = await client(),
      anon = await client();
    for (const [c, email] of [
      [owner, "invite@example.test"],
      [other, "other-invite@example.test"],
    ] as const)
      await c("auth/signup", "POST", {
        name: "Researcher",
        email,
        password: "invitation-test-password",
      });
    let s = (await owner("studies", "POST", { title: "Invited feelings" }))
      .study;
    s = (
      await owner(`studies/${s.id}`, "PUT", {
        guide: emotionInterview().guide,
        version: s.version,
      })
    ).study;
    s = (await owner(`studies/${s.id}/publish`, "POST", { version: s.version }))
      .study;
    await owner(`studies/${s.id}/fielding`, "POST", { state: "active" });
    const collaborator = await client();
    const invite = (await owner("invites", "POST", { role: "collaborator" }))
      .invite;
    await collaborator("auth/signup", "POST", {
      name: "Observer",
      email: "invite-observer@example.test",
      password: "invitation-observer-password",
      invite,
    });
    const root = `studies/${s.id}`,
      pub = `public/${s.id}`;
    assert.equal((await owner(root + "/recruitment")).settings.mode, "open");
    assert.equal((await other(root + "/recruitment")).status, 404);
    assert.equal((await anon(root + "/recruitment")).status, 401);
    const batch = (refs: string[]) => ({
      requestId: randomUUID(),
      secret: randomBytes(32).toString("hex"),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      recipients: refs.map((reference) => ({
        reference,
        attributes: { segment: "Trusted" },
      })),
    });
    assert.equal((await collaborator(root + "/recruitment")).canManage, false);
    assert.equal(
      (
        await collaborator(root + "/recruitment", "PUT", {
          version: 0,
          mode: "invitation_only",
        })
      ).status,
      403,
    );
    assert.equal(
      (await collaborator(root + "/invitations", "POST", batch(["Blocked"])))
        .status,
      403,
    );
    const request = batch(["=Person A", "Person B", "Person C", "Person D"]);
    const issued = await owner(root + "/invitations", "POST", request);
    assert.equal(issued.status, 201);
    assert.deepEqual(
      (await owner(root + "/invitations", "POST", request)).links,
      issued.links,
    );
    assert.equal(
      (
        await owner(root + "/invitations", "POST", {
          ...request,
          expiresAt: new Date(Date.now() + 80000000).toISOString(),
        })
      ).status,
      409,
    );
    assert.equal(
      (await owner(root + "/invitations", "POST", batch(["person b"]))).status,
      409,
    );
    assert.equal(
      (
        await owner(root + "/recruitment", "PUT", {
          version: 0,
          mode: "invitation_only",
        })
      ).status,
      200,
    );
    assert.equal(
      (await owner(root + "/recruitment", "PUT", { version: 0, mode: "open" }))
        .status,
      409,
    );
    assert.equal((await anon(pub)).status, 403);
    assert.equal((await anon(pub, "POST", { consent: true })).status, 403);
    const token = (n: number) => issued.links[n].path.split("#invite=")[1];
    const roster = () => owner(root + "/recruitment");
    const view = async (n: number) =>
      (await roster()).invitations.find(
        (v: any) => v.id === issued.links[n].invitation.id,
      );
    assert.equal(
      (await anon(pub, "GET", undefined, { "x-participant-invite": token(0) }))
        .status,
      200,
    );
    const joined = await Promise.all(
      [0, 1].map(() =>
        anon(pub, "POST", {
          consent: true,
          invitationToken: token(0),
          attributes: { segment: "Forged" },
        }),
      ),
    );
    assert.deepEqual(joined.map((v) => v.status).sort(), [201, 409]);
    const j = joined.find((v) => v.status === 201)!;
    assert.deepEqual(j.interview.attributes, {});
    assert.equal(j.interview.invitationId, undefined);
    assert.equal((await view(0)).status, "in_progress");
    const privateSource = (await owner(root)).interviews.find(
      (i: any) => i.id === j.interview.id,
    );
    assert.equal(privateSource.attributes.segment, "Trusted");
    assert.equal(
      (await anon(pub, "GET", undefined, { "x-participant-invite": token(0) }))
        .status,
      409,
    );
    let v = await view(0);
    assert.equal(
      (
        await owner(root + `/invitations/${v.id}/revoke`, "POST", {
          version: v.version,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await anon(`interviews/${j.interview.id}`, "GET", undefined, {
          "x-interview-token": j.token,
        })
      ).status,
      200,
    );
    const completed = await anon(
      `interviews/${j.interview.id}/answer`,
      "POST",
      {
        requestId: randomUUID(),
        version: 0,
        value: ["happy", "1", ""],
        answer: "",
      },
      { "x-interview-token": j.token },
    );
    assert.equal(completed.interview.status, "complete");
    assert.equal((await view(0)).status, "complete");
    let b = await view(1);
    await owner(root + `/invitations/${b.id}/shared`, "POST", {
      version: b.version,
    });
    b = await view(1);
    assert.equal(b.status, "marked_shared");
    const replacement = {
      ...batch(["Person B"]),
      replace: { id: b.id, version: b.version },
    };
    const replaced = await owner(root + "/invitations", "POST", replacement);
    assert.equal(replaced.status, 201);
    assert.equal(
      (await anon(pub, "GET", undefined, { "x-participant-invite": token(1) }))
        .status,
      410,
    );
    assert.equal(
      (
        await anon(pub, "GET", undefined, {
          "x-participant-invite": replaced.links[0].path.split("#invite=")[1],
        })
      ).status,
      200,
    );
    const c = await view(2);
    await owner(root + `/invitations/${c.id}/erase`, "POST", {
      version: c.version,
    });
    assert.equal((await view(2)).reference, "");
    assert.deepEqual((await view(2)).attributes, {});
    assert.equal(
      (await anon(pub, "POST", { consent: true, invitationToken: token(2) }))
        .status,
      410,
    );
    await owner(root + "/recruitment", "PUT", { version: 1, mode: "open" });
    assert.equal(
      (await anon(pub, "POST", { consent: true, invitationToken: "bad" }))
        .status,
      404,
    );
    assert.equal((await anon(pub, "POST", { consent: true })).status, 201);
    const csv = await owner(root + "/invitations/export");
    assert.ok(csv.text.includes("'=Person A"));
    assert.ok(!csv.text.includes(token(0)));
    assert.ok(!JSON.stringify(await roster()).includes(request.secret));
    await owner(root + `/responses/${j.interview.id}`, "DELETE");
    v = await view(0);
    assert.equal(v.status, "response_deleted");
    assert.equal(v.reference, "");
    assert.deepEqual(v.attributes, {});
    assert.equal(v.response, null);
    assert.equal(
      (await anon(pub, "POST", { consent: true, invitationToken: token(0) }))
        .status,
      409,
    );
    await owner(root + "/fielding", "POST", { state: "paused" });
    assert.equal(
      (await anon(pub, "POST", { consent: true, invitationToken: token(3) }))
        .status,
      409,
    );
    assert.equal((await view(3)).linkStatus, "valid");
    s = (await owner(root)).study;
    s.draft.limit = 2;
    s = (await owner(root, "PUT", { version: s.version, guide: s.draft }))
      .study;
    await owner(root + "/publish", "POST", { version: s.version });
    await owner(root + "/fielding", "POST", { state: "active" });
    const cap = await Promise.all(
      [0, 1].map(() =>
        anon(pub, "POST", { consent: true, invitationToken: token(3) }),
      ),
    );
    assert.deepEqual(cap.map((v) => v.status).sort(), [201, 409]);
    assert.equal((await owner(root + "/recruitment")).capacity.remaining, 0);
    const expiring = {
      ...batch(["Expiring"]),
      expiresAt: new Date(Date.now() + 1500).toISOString(),
    };
    const e = await owner(root + "/invitations", "POST", expiring);
    assert.equal(e.status, 201);
    await new Promise((r) => setTimeout(r, 1600));
    assert.equal(
      (
        await anon(pub, "GET", undefined, {
          "x-participant-invite": e.links[0].path.split("#invite=")[1],
        })
      ).status,
      410,
    );
  },
);
