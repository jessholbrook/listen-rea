import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, client } from "./harness";
import { emotionInterview } from "./emotion-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3124 : 3123 }),
  { timeout: 90000 },
);
after(stop);
test(
  "Incentive reviews freeze terms and protect manual payments, retries, currency totals, roles and erasure",
  { timeout: 90000 },
  async () => {
    const owner = await client(),
      other = await client(),
      anon = await client(),
      collab = await client();
    for (const [c, email] of [
      [owner, "incentives@example.test"],
      [other, "other-incentives@example.test"],
    ] as const)
      await c("auth/signup", "POST", {
        name: "Researcher",
        email,
        password: "incentives-test-password",
      });
    const invite = (await owner("invites", "POST", { role: "collaborator" }))
      .invite;
    await collab("auth/signup", "POST", {
      name: "Observer",
      email: "incentives-observer@example.test",
      password: "incentives-test-password",
      invite,
    });
    let s = (await owner("studies", "POST", { title: "Incentive study" }))
      .study;
    s = (
      await owner(`studies/${s.id}`, "PUT", {
        version: s.version,
        guide: emotionInterview().guide,
      })
    ).study;
    await owner(`studies/${s.id}/publish`, "POST", { version: s.version });
    await owner(`studies/${s.id}/fielding`, "POST", { state: "active" });
    const root = `studies/${s.id}/incentives`,
      source = `studies/${s.id}/responses/`;
    const join = async () => anon(`public/${s.id}`, "POST", { consent: true });
    const complete = async () => {
      const j = await join();
      await anon(
        `interviews/${j.interview.id}/answer`,
        "POST",
        {
          requestId: randomUUID(),
          version: 0,
          value: ["happy", "", ""],
          answer: "",
        },
        { "x-interview-token": j.token },
      );
      return j.interview.id;
    };
    const first = await complete(),
      second = await complete(),
      active = (await join()).interview.id;
    const terms = {
      enabled: true,
      amountMinor: 2500,
      currency: "USD",
      description: "Complete and included.",
    };
    assert.equal((await anon(root)).status, 401);
    assert.equal((await other(root)).status, 404);
    assert.equal((await collab(root)).canManage, false);
    assert.equal(
      (await collab(root, "PUT", { version: 0, ...terms })).status,
      403,
    );
    assert.equal(
      (await owner(root, "PUT", { version: 0, ...terms })).status,
      200,
    );
    assert.equal(
      (await owner(root, "PUT", { version: 0, ...terms })).status,
      409,
    );
    const action = (
      id: string,
      version: number,
      kind: string,
      extra: object = {},
    ) =>
      owner(root + "/" + id, "POST", {
        requestId: randomUUID(),
        version,
        action: kind,
        reason: "Reviewed synthetic source",
        termsVersion: 1,
        ...extra,
      });
    const row = async (id: string) =>
      (await owner(root)).rows.find((v: any) => v.interviewId === id);
    assert.equal((await action(active, 0, "approve")).status, 409);
    assert.equal((await action(first, 0, "record_payment")).status, 400);
    assert.equal(
      (await action(first, 0, "approve", { termsVersion: 99 })).status,
      409,
    );
    assert.equal(
      (
        await collab(root + "/" + first, "POST", {
          requestId: randomUUID(),
          version: 0,
          action: "approve",
          reason: "No permission",
          termsVersion: 1,
        })
      ).status,
      403,
    );
    const approve = {
      requestId: randomUUID(),
      version: 0,
      action: "approve",
      reason: "Eligible synthetic source",
      termsVersion: 1,
    };
    assert.equal(
      (await owner(root + "/" + first, "POST", approve)).status,
      200,
    );
    assert.equal(
      (await owner(root + "/" + first, "POST", approve)).status,
      200,
    );
    assert.equal(
      (
        await owner(root + "/" + first, "POST", {
          ...approve,
          reason: "Changed request",
        })
      ).status,
      409,
    );
    assert.equal((await row(first)).record.events.length, 1);
    await owner(root, "PUT", {
      version: 1,
      ...terms,
      amountMinor: 4000,
      currency: "EUR",
    });
    assert.equal((await row(first)).record.terms.amountMinor, 2500);
    assert.equal((await row(first)).record.terms.currency, "USD");
    assert.equal((await action(second, 0, "approve")).status, 409);
    await action(second, 0, "approve", { termsVersion: 2 });
    await owner(source + first, "PATCH", {
      excluded: true,
      reason: "Source quality review",
    });
    assert.equal((await row(first)).status, "ineligible");
    const payment = {
      reference: "=Transfer-001",
      method: "gift_card",
      paidAt: new Date().toISOString(),
    };
    assert.equal(
      (await action(first, 1, "record_payment", { payment })).status,
      409,
    );
    await owner(source + first, "PATCH", { excluded: false, reason: "" });
    const paid = {
      requestId: randomUUID(),
      version: 1,
      action: "record_payment",
      reason: "Sent externally",
      payment: { ...payment, amountMinor: 1, currency: "EUR" },
    };
    const simultaneous = await Promise.all([
      owner(root + "/" + first, "POST", paid),
      owner(root + "/" + first, "POST", paid),
    ]);
    assert.ok(simultaneous.every((v) => v.status === 200));
    assert.equal((await row(first)).record.payments.length, 1);
    assert.equal((await row(first)).record.events.length, 2);
    assert.equal(
      (
        await action(second, 1, "record_payment", {
          payment: { ...payment, reference: "=TRANSFER-001" },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await action(second, 1, "record_payment", {
          payment: {
            ...payment,
            reference: "Future",
            paidAt: new Date(Date.now() + 86400000).toISOString(),
          },
        })
      ).status,
      400,
    );
    let data = await owner(root);
    assert.equal(data.totals.USD.paidMinor, 2500);
    assert.equal(data.totals.EUR.approvedMinor, 4000);
    await owner(source + first, "PATCH", {
      excluded: true,
      reason: "Later exclusion",
    });
    data = await owner(root);
    assert.equal(data.totals.USD.paidMinor, 2500);
    assert.ok((await row(first)).eligibilityReason);
    assert.equal(
      (await action(first, 2, "approve", { termsVersion: 2 })).status,
      409,
    );
    assert.equal((await action(first, 2, "void_payment")).status, 200);
    assert.equal(
      (await row(first)).record.payments[0].voidedAt !== undefined,
      true,
    );
    assert.equal((await action(first, 2, "void_payment")).status, 409);
    await owner(source + first, "PATCH", { excluded: false, reason: "" });
    await action(first, 3, "approve", { termsVersion: 2 });
    assert.equal(
      (await action(first, 4, "record_payment", { payment })).status,
      409,
    );
    assert.equal(
      (
        await action(first, 4, "record_payment", {
          payment: { ...payment, reference: "=Replacement-002" },
        })
      ).status,
      200,
    );
    const csv = await owner(root + "/export");
    assert.ok(csv.text.includes(first));
    assert.ok(csv.text.includes("void_payment"));
    assert.ok(csv.text.includes("Replacement-002"));
    await owner(source + first, "DELETE");
    assert.equal(await row(first), undefined);
    assert.ok(
      !(await owner(root + "/export")).text.includes("Replacement-002"),
    );
    assert.equal((await owner(root + "/" + first, "POST", paid)).status, 404);
    // The content-free reference tombstone survives source erasure.
    assert.equal(
      (
        await action(second, 1, "record_payment", {
          payment: { ...payment, reference: "=Replacement-002" },
        })
      ).status,
      409,
    );
    await action(second, 1, "decline");
    assert.equal((await row(second)).status, "declined");
    await owner(root, "PUT", { version: 2, ...terms, enabled: false });
    assert.equal(
      (await action(second, 2, "approve", { termsVersion: 3 })).status,
      409,
    );
  },
);
