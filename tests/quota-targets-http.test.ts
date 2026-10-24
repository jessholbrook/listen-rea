import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { start, stop, client } from "./harness";
import { emotionInterview } from "./emotion-fixture";
import { screenerGuide } from "./screener-quota-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3144 : 3143 }),
  { timeout: 90000 },
);
after(stop);
async function setup(screen = false, exact = true) {
  const owner = await client(),
    anon = await client();
  await owner("auth/signup", "POST", {
    name: "Target admin",
    email: randomUUID() + "@example.test",
    password: "quota-target-password",
  });
  let s = (await owner("studies", "POST", { title: "Quota target study" }))
    .study;
  const guide = {
    ...(screen ? screenerGuide() : emotionInterview().guide),
    limit: 3,
  };
  s = (await owner(`studies/${s.id}`, "PUT", { version: s.version, guide }))
    .study;
  s = (await owner(`studies/${s.id}/publish`, "POST", { version: s.version }))
    .study;
  const root = `studies/${s.id}`,
    pub = `public/${s.id}`,
    source = screen ? "screener" : "tags",
    key = screen ? "role" : "segment",
    a = screen ? "customer" : "A",
    b = screen ? "prospect" : "B";
  const rules = [
      {
        id: randomUUID(),
        source,
        label: a,
        kind: "minimum",
        limit: 2,
        enabled: true,
        conditions: [{ key, value: a }],
      },
      {
        id: randomUUID(),
        source,
        label: b,
        kind: exact ? "exact" : "maximum",
        limit: exact ? 1 : 3,
        enabled: true,
        conditions: [{ key, value: b }],
      },
    ],
    input = { version: 0, enabled: true, requireMatch: false, rules };
  await owner(root + "/fielding", "POST", { state: "active" });
  assert.equal((await owner(root + "/quotas", "PUT", input)).status, 200);
  return { owner, anon, root, pub, input };
}
const req = (segment: string) => ({ consent: true, attributes: { segment } });
const head = (r: any) => ({ "x-interview-token": r.token });
async function choice(
  c: any,
  r: any,
  optionId: string,
  requestId = randomUUID(),
) {
  return c(
    `interviews/${r.interview.id}/answer`,
    "POST",
    { requestId, version: 0, answer: "", optionId },
    head(r),
  );
}
test(
  "Tag targets protect the remaining sample, enforce exact caps atomically, track completion separately and follow the published study capacity",
  { timeout: 90000 },
  async () => {
    const { owner, anon, root, pub, input } = await setup();
    const race = await Promise.all([
      anon(pub, "POST", req("B")),
      anon(pub, "POST", req("B")),
    ]);
    assert.deepEqual(race.map((x) => x.status).sort(), [201, 409]);
    const b = race.find((r) => r.status === 201)!;
    assert.equal((await anon(pub, "POST", req("other"))).status, 409);
    let s = (await owner(root)).study;
    s = (
      await owner(root, "PUT", {
        version: s.version,
        guide: { ...s.draft, limit: 4 },
      })
    ).study;
    await owner(root + "/publish", "POST", { version: s.version });
    assert.equal((await anon(pub, "POST", req("other"))).status, 201);
    assert.equal((await anon(pub, "POST", req("other"))).status, 409);
    const a1 = await anon(pub, "POST", req("A")),
      a2 = await anon(pub, "POST", req("A"));
    assert.equal(a1.status, 201);
    assert.equal(a2.status, 201);
    let q = await owner(root + "/quotas");
    assert.equal(q.totalLimit, 4);
    assert.equal(q.targetCapacity.needed, 0);
    assert.equal(q.progress[0].full, false);
    assert.equal(q.progress[0].completeNeeded, 2);
    assert.equal(q.progress[1].full, true);
    assert.equal(
      (
        await owner(root + "/quotas", "PUT", {
          ...input,
          version: 1,
          rules: [
            { ...input.rules[0], kind: "exact", limit: 1 },
            input.rules[1],
          ],
        })
      ).status,
      400,
    );
    await anon(
      `interviews/${a1.interview.id}/answer`,
      "POST",
      {
        requestId: randomUUID(),
        version: 0,
        answer: "",
        value: ["happy", "", "Synthetic target answer."],
      },
      head(a1),
    );
    assert.equal((await owner(root + "/quotas")).progress[0].completeNeeded, 1);
    await owner(root + "/responses/" + a1.interview.id, "PATCH", {
      excluded: true,
      reason: "Synthetic exclusion",
    });
    assert.equal((await owner(root + "/quotas")).progress[0].complete, 1);
    await anon(`interviews/${a2.interview.id}/stop`, "POST", {}, head(a2));
    assert.equal((await owner(root + "/quotas")).targetCapacity.needed, 1);
    assert.equal((await anon(pub, "POST", req("other"))).status, 409);
    assert.equal((await anon(pub, "POST", req("A"))).status, 201);
    await owner(root + "/responses/" + b.interview.id, "DELETE");
    assert.equal((await anon(pub, "POST", req("other"))).status, 409);
    assert.equal((await anon(pub, "POST", req("B"))).status, 201);
    s = (await owner(root)).study;
    s = (
      await owner(root, "PUT", {
        version: s.version,
        guide: { ...s.draft, limit: 5 },
      })
    ).study;
    await owner(root + "/publish", "POST", { version: s.version });
    assert.equal((await anon(pub, "POST", req("A"))).status, 201);
    assert.equal((await owner(root + "/quotas")).progress[0].reserved, 3);
    assert.equal((await owner(root + "/quotas")).progress[0].full, false);
  },
);
test(
  "Protected tag rejections preserve invitations and handoff proofs; disabled targets permit ordinary admission and infeasible new limits block admission",
  { timeout: 90000 },
  async () => {
    const { owner, anon, root, pub, input } = await setup(false, false),
      b = await anon(pub, "POST", req("B"));
    await owner(root + "/forsta-handoff", "PUT", {
      version: 0,
      enabled: true,
      reviewed: true,
      routes: {
        complete: "https://survey.example.test/done",
        screened_out: "",
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
      recipients: [
        { reference: "Target outsider", attributes: { segment: "B" } },
      ],
    });
    const request = {
      ...req("A"),
      invitationToken: batch.links[0].path.split("#invite=")[1],
      surveyHandoff: {
        provider: "forsta",
        responseId: "protected_target",
        secret: randomBytes(32).toString("hex"),
      },
    };
    assert.equal((await anon(pub, "POST", request)).status, 409);
    assert.equal((await owner(root + "/forsta-handoff")).rows.length, 0);
    await anon(`interviews/${b.interview.id}/stop`, "POST", {}, head(b));
    const joined = await anon(pub, "POST", request);
    assert.equal(joined.status, 201);
    assert.equal(
      (await anon(pub, "POST", request)).interview.id,
      joined.interview.id,
    );
    await owner(root + "/quotas", "PUT", {
      ...input,
      version: 1,
      enabled: false,
    });
    await owner(root + "/recruitment", "PUT", { version: 1, mode: "open" });
    const ordinary = await anon(pub, "POST", req("other"));
    assert.equal(ordinary.status, 201);
    assert.equal(
      (await owner(root + "/quotas", "PUT", { ...input, version: 2 })).status,
      400,
    );
    await owner(root + "/responses/" + ordinary.interview.id, "DELETE");
    assert.equal(
      (await owner(root + "/quotas", "PUT", { ...input, version: 2 })).status,
      200,
    );
    let s = (await owner(root)).study;
    s = (
      await owner(root, "PUT", {
        version: s.version,
        guide: { ...s.draft, limit: 1 },
      })
    ).study;
    await owner(root + "/publish", "POST", { version: s.version });
    assert.equal((await anon(pub, "POST", req("A"))).status, 409);
  },
);
test(
  "Single-choice targets defer classification, save target-protection screen-outs, apply live exact caps and preserve idempotent outcomes",
  { timeout: 90000 },
  async () => {
    const { owner, anon, root, pub, input } = await setup(true, false);
    const candidates = await Promise.all(
      [0, 1, 2].map(() => anon(pub, "POST", { consent: true })),
    );
    assert.ok(candidates.every((r) => r.status === 201));
    assert.equal((await owner(root + "/quotas")).targetCapacity.settled, 0);
    const ids = [randomUUID(), randomUUID()],
      race = await Promise.all(
        [0, 1].map((n) => choice(anon, candidates[n], "prospect", ids[n])),
      );
    assert.deepEqual(race.map((r) => r.interview.status).sort(), [
      "active",
      "screened_out",
    ]);
    const li = race.findIndex((r) => r.interview.status === "screened_out"),
      loser = candidates[li];
    assert.equal(race[li].interview.screenOutReason, undefined);
    assert.equal(
      (await choice(anon, loser, "prospect", ids[li])).interview.turns.length,
      1,
    );
    let q = await owner(root + "/quotas");
    assert.equal(q.progress[0].protected, 1);
    assert.equal(q.progress[0].rejected, 0);
    assert.equal(
      (await owner(root)).interviews.find(
        (i: any) => i.id === loser.interview.id,
      ).screenOutReason,
      "quota_minimum",
    );
    await choice(anon, candidates[2], "customer");
    assert.equal((await owner(root + "/quotas")).targetCapacity.needed, 1);
    assert.equal(
      (
        await owner(root + "/quotas", "PUT", {
          ...input,
          version: 1,
          rules: [
            input.rules[0],
            { ...input.rules[1], kind: "exact", limit: 1 },
          ],
        })
      ).status,
      200,
    );
    const outsider = await anon(pub, "POST", { consent: true });
    assert.equal(
      (await choice(anon, outsider, "prospect")).interview.status,
      "screened_out",
    );
    assert.equal(
      (await owner(root)).interviews.find(
        (i: any) => i.id === outsider.interview.id,
      ).screenOutReason,
      "quota_full",
    );
    const eligible = await anon(pub, "POST", { consent: true });
    assert.equal(
      (await choice(anon, eligible, "customer")).interview.status,
      "active",
    );
    q = await owner(root + "/quotas");
    assert.equal(q.targetCapacity.needed, 0);
    assert.deepEqual(
      q.progress.map((p: any) => p.reserved),
      [2, 1],
    );
  },
);
