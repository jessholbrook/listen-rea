import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { start, stop, client } from "./harness";
import { screenerGuide, screenerRule } from "./screener-quota-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3142 : 3141 }),
  { timeout: 90000 },
);
after(stop);
async function setup() {
  const owner = await client(),
    anon = await client();
  assert.equal(
    (
      await owner("auth/signup", "POST", {
        name: "Screen quota admin",
        email: randomUUID() + "@example.test",
        password: "screener-quota-password",
      })
    ).status,
    200,
  );
  let s = (await owner("studies", "POST", { title: "Screen quotas" })).study;
  s = (
    await owner(`studies/${s.id}`, "PUT", {
      guide: screenerGuide(),
      version: s.version,
    })
  ).study;
  s = (await owner(`studies/${s.id}/publish`, "POST", { version: s.version }))
    .study;
  const root = `studies/${s.id}`,
    pub = `public/${s.id}`,
    rules = [screenerRule(), screenerRule("tools", "app")],
    input = { version: 0, enabled: true, requireMatch: true, rules };
  await owner(root + "/fielding", "POST", { state: "active" });
  assert.equal((await owner(root + "/quotas", "PUT", input)).status, 200);
  return { owner, anon, s, root, pub, input };
}
const header = (r: any) => ({ "x-interview-token": r.token });
async function answer(
  c: any,
  r: any,
  version: number,
  optionId?: string,
  value?: unknown,
  requestId = randomUUID(),
) {
  return c(
    `interviews/${r.interview.id}/answer`,
    "POST",
    { version, optionId, value, answer: "", requestId },
    header(r),
  );
}
async function join(c: any, pub: string, extra = {}) {
  const r = await c(pub, "POST", { consent: true, ...extra });
  assert.equal(r.status, 201);
  return r;
}
test(
  "Screening candidates reserve only after all required answers; atomic last-place commits persist private, idempotent screen-outs",
  { timeout: 90000 },
  async () => {
    const { owner, anon, root, pub } = await setup();
    const a = await join(anon, pub, {
        attributes: { role: "customer", tools: "app" },
        quotaRuleIds: ["forged"],
      }),
      b = await join(anon, pub);
    assert.equal(a.interview.screenerQuota, undefined);
    assert.equal((await owner(root + "/quotas")).screening, 2);
    await answer(anon, a, 0, "customer");
    await answer(anon, b, 0, "customer");
    let p = await owner(root + "/quotas");
    assert.deepEqual(
      p.progress.map((r: any) => r.reserved),
      [0, 0],
    );
    assert.equal(p.screening, 2);
    assert.equal(
      (await answer(anon, a, 1, undefined, ["invalid"])).status,
      400,
    );
    const ids = [randomUUID(), randomUUID()],
      results = await Promise.all([
        answer(anon, a, 1, undefined, ["web", "app"], ids[0]),
        answer(anon, b, 1, undefined, ["app"], ids[1]),
      ]);
    assert.deepEqual(results.map((r) => r.interview.status).sort(), [
      "active",
      "screened_out",
    ]);
    const wi = results.findIndex((r) => r.interview.status === "active"),
      winner = [a, b][wi],
      loser = [a, b][1 - wi];
    const denied = results[1 - wi];
    assert.equal(denied.interview.screenOutReason, undefined);
    assert.equal(denied.interview.screenerQuota, undefined);
    assert.equal(denied.interview.quotaRuleIds, undefined);
    const retry = await answer(
      anon,
      loser,
      1,
      undefined,
      1 - wi === 0 ? ["web", "app"] : ["app"],
      ids[1 - wi],
    );
    assert.equal(retry.status, 200);
    assert.equal(retry.interview.turns.length, 2);
    assert.equal(retry.interview.status, "screened_out");
    assert.equal(
      (await answer(anon, loser, 2, undefined, ["happy", "", ""])).status,
      409,
    );
    p = await owner(root + "/quotas");
    assert.equal(p.screening, 0);
    assert.equal(p.quotaScreenOuts, 1);
    assert.deepEqual(
      p.progress.map((r: any) => [r.active, r.rejected]),
      [
        [1, 1],
        [1, 1],
      ],
    );
    const detail = await owner(root);
    assert.equal(
      detail.interviews.find((i: any) => i.id === loser.interview.id)
        .screenOutReason,
      "quota_full",
    );
    assert.equal(detail.interviews[0].screenerQuota, undefined);
    assert.equal(
      (
        await answer(anon, winner, 2, undefined, [
          "happy",
          "",
          "Synthetic note",
        ])
      ).interview.status,
      "complete",
    );
    assert.deepEqual(
      (await owner(root + "/quotas")).progress.map((r: any) => r.complete),
      [1, 1],
    );
    await owner(root + "/responses/" + winner.interview.id, "DELETE");
    assert.deepEqual(
      (await owner(root + "/quotas")).progress.map((r: any) => r.reserved),
      [0, 0],
    );
  },
);
test(
  "Pending plans lock definitions, enforce live caps, bypass when disabled, and preserve the original guide across incompatible publication",
  { timeout: 90000 },
  async () => {
    const { owner, anon, root, pub, input } = await setup(),
      a = await join(anon, pub);
    assert.equal(
      (
        await owner(root + "/quotas", "PUT", {
          ...input,
          version: 1,
          rules: [
            {
              ...input.rules[0],
              conditions: [{ key: "role", value: "prospect" }],
            },
            input.rules[1],
          ],
        })
      ).status,
      409,
    );
    await owner(root + "/quotas", "PUT", {
      ...input,
      version: 1,
      enabled: false,
    });
    await answer(anon, a, 0, "customer");
    assert.equal(
      (await answer(anon, a, 1, undefined, ["app"])).interview.status,
      "active",
    );
    await owner(root + "/quotas", "PUT", { ...input, version: 2 });
    assert.deepEqual(
      (await owner(root + "/quotas")).progress.map((r: any) => r.reserved),
      [0, 0],
    );
    const ineligible = await join(anon, pub);
    assert.equal(
      (await answer(anon, ineligible, 0, "ineligible")).interview.status,
      "screened_out",
    );
    assert.equal((await owner(root + "/quotas")).quotaScreenOuts, 0);
    const pending = await join(anon, pub);
    let s = (await owner(root)).study;
    const guide = screenerGuide();
    guide.questions[1].id = "new_tools";
    s = (await owner(root, "PUT", { version: s.version, guide })).study;
    await owner(root + "/publish", "POST", { version: s.version });
    assert.equal((await anon(pub, "POST", { consent: true })).status, 409);
    await answer(anon, pending, 0, "customer");
    assert.equal(
      (await answer(anon, pending, 1, undefined, ["app"])).interview.status,
      "active",
    );
    const preview = await owner(root + "/preview", "POST", {});
    assert.equal(
      (await answer(anon, preview, 0, "customer")).interview.status,
      "active",
    );
    assert.equal((await owner(root + "/quotas")).screening, 0);
  },
);
test(
  "Screener no-match and quota-full outcomes use frozen match requirements and existing private invitation/handoff return behavior",
  { timeout: 90000 },
  async () => {
    const { owner, anon, root, pub, input } = await setup();
    const unmatched = await join(anon, pub);
    await owner(root + "/quotas", "PUT", {
      ...input,
      version: 1,
      requireMatch: false,
    });
    await answer(anon, unmatched, 0, "prospect");
    assert.equal(
      (await answer(anon, unmatched, 1, undefined, ["web"])).interview.status,
      "screened_out",
    );
    assert.equal(
      (await owner(root)).interviews.find(
        (i: any) => i.id === unmatched.interview.id,
      ).screenOutReason,
      "quota_no_match",
    );
    await owner(root + "/quotas", "PUT", { ...input, version: 2 });
    const winner = await join(anon, pub);
    await answer(anon, winner, 0, "customer");
    await answer(anon, winner, 1, undefined, ["app"]);
    await owner(root + "/forsta-handoff", "PUT", {
      version: 0,
      enabled: true,
      reviewed: true,
      routes: {
        complete: "https://survey.example.test/complete",
        screened_out: "https://survey.example.test/screened",
        withdrawn: "",
      },
    });
    await owner(root + "/recruitment", "PUT", {
      version: 0,
      mode: "invitation_only",
    });
    const batch = await owner(root + "/invitations", "POST", {
      requestId: randomUUID(),
      secret: randomBytes(32).toString("hex"),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      recipients: [{ reference: "Screening invitation" }],
    });
    const request = {
      consent: true,
      invitationToken: batch.links[0].path.split("#invite=")[1],
      surveyHandoff: {
        provider: "forsta",
        responseId: "screening_quota",
        secret: randomBytes(32).toString("hex"),
      },
    };
    const invited = await join(anon, pub, request);
    await answer(anon, invited, 0, "customer");
    assert.equal(
      (await answer(anon, invited, 1, undefined, ["app"])).interview.status,
      "screened_out",
    );
    const dest = (
      await anon(
        `interviews/${invited.interview.id}/survey-handoff`,
        "GET",
        undefined,
        header(invited),
      )
    ).destination;
    assert.equal(new URL(dest.url).pathname, "/screened");
    assert.equal(new URL(dest.url).searchParams.get("rid"), "screening_quota");
    await owner(root + "/fielding", "POST", { state: "paused" });
    const recovered = await anon(pub, "POST", request);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.interview.id, invited.interview.id);
    assert.equal(recovered.interview.status, "screened_out");
    const roster = (await owner(root + "/forsta-handoff")).rows;
    assert.equal(roster[0].status, "screened_out");
    await owner(root + "/responses/" + invited.interview.id, "DELETE");
    assert.equal((await owner(root + "/quotas")).quotaScreenOuts, 1);
    assert.equal(
      (await owner(root + "/forsta-handoff")).rows[0].responseId,
      "",
    );
  },
);
