import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { start, stop, client } from "./harness";
import { emotionInterview } from "./emotion-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3140 : 3139 }),
  { timeout: 90000 },
);
after(stop);
const rule = (key = "segment", value = "customer", limit = 1) => ({
  id: randomUUID(),
  label: value,
  enabled: true,
  limit,
  conditions: [{ key, value }],
});
async function setup(screen = false, roles = false) {
  const owner = await client(),
    other = await client(),
    anon = await client(),
    collaborator = await client(),
    researcher = await client();
  for (const c of roles ? [owner, other] : [owner])
    await c("auth/signup", "POST", {
      name: "Quota admin",
      email: randomUUID() + "@example.test",
      password: "quota-test-password",
    });
  if (roles)
    for (const [c, role] of [
      [collaborator, "collaborator"],
      [researcher, "researcher"],
    ] as const) {
      const invite = (await owner("invites", "POST", { role })).invite;
      await c("auth/signup", "POST", {
        name: role,
        email: randomUUID() + "@example.test",
        password: "quota-test-password",
        invite,
      });
    }
  let s = (await owner("studies", "POST", { title: "Quota study" })).study;
  const guide = {
    ...emotionInterview().guide,
    title: "Quota study",
    limit: 20,
  };
  if (screen)
    guide.questions = [
      {
        id: "eligible",
        type: "choice",
        text: "Which applies?",
        options: [
          { id: "no", text: "Other", rejects: true },
          { id: "yes", text: "Eligible", rejects: false },
        ],
        followUps: 0,
        instructions: "",
        section: "",
        condition: null,
      },
    ];
  s = (await owner(`studies/${s.id}`, "PUT", { guide, version: s.version }))
    .study;
  s = (await owner(`studies/${s.id}/publish`, "POST", { version: s.version }))
    .study;
  const root = `studies/${s.id}`,
    pub = `public/${s.id}`;
  await owner(root + "/fielding", "POST", { state: "active" });
  const input = {
    version: 0,
    enabled: true,
    requireMatch: true,
    rules: [rule()],
  };
  return { owner, other, anon, collaborator, researcher, s, root, pub, input };
}
const request = (
  attributes: Record<string, string> = { segment: "customer" },
) => ({ consent: true, attributes });
const header = (r: any) => ({ "x-interview-token": r.token });
async function progress(c: any, root: string) {
  return (await c(root + "/quotas")).progress[0];
}
test(
  "Quotas enforce workspace/role/version controls, reserve the last place atomically and keep used matching rules fixed",
  { timeout: 90000 },
  async () => {
    const { owner, other, anon, collaborator, researcher, root, pub, input } =
      await setup(false, true);
    const old = await anon(pub, "POST", request());
    assert.equal(old.status, 201);
    assert.equal((await anon(root + "/quotas")).status, 401);
    assert.equal((await other(root + "/quotas")).status, 404);
    assert.equal(
      (await collaborator(root + "/quotas", "PUT", input)).status,
      403,
    );
    assert.equal(
      (await researcher(root + "/quotas", "PUT", input)).status,
      200,
    );
    assert.equal((await owner(root + "/quotas", "PUT", input)).status, 409);
    assert.equal((await progress(owner, root)).reserved, 0);
    assert.equal((await anon(pub, "POST", request({}))).status, 409);
    const outcomes = await Promise.all([
      anon(pub, "POST", request()),
      anon(pub, "POST", request()),
    ]);
    assert.deepEqual(outcomes.map((x) => x.status).sort(), [201, 409]);
    const joined = outcomes.find((x) => x.status === 201)!;
    assert.equal(joined.interview.quotaRuleIds, undefined);
    assert.equal(joined.interview.quotaVersion, undefined);
    assert.equal((await progress(owner, root)).active, 1);
    assert.equal((await owner(root)).interviews.length, 2);
    assert.equal(
      (
        await owner(root + "/quotas", "PUT", {
          ...input,
          version: 1,
          rules: [
            {
              ...input.rules[0],
              conditions: [{ key: "segment", value: "prospect" }],
            },
          ],
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await owner(root + "/quotas", "PUT", {
          ...input,
          version: 1,
          enabled: false,
          rules: [],
        })
      ).status,
      409,
    );
    const preview = await owner(root + "/preview", "POST", {});
    assert.equal(preview.status, 201);
    assert.equal((await progress(owner, root)).active, 1);
    await anon(
      `interviews/${joined.interview.id}/answer`,
      "POST",
      {
        requestId: randomUUID(),
        version: 0,
        answer: "",
        value: ["happy", "", "Synthetic quota answer."],
      },
      header(joined),
    );
    assert.equal((await progress(owner, root)).complete, 1);
    assert.equal((await progress(owner, root)).active, 0);
    await owner(root + "/responses/" + joined.interview.id, "PATCH", {
      excluded: true,
      reason: "Synthetic exclusion",
    });
    assert.equal((await progress(owner, root)).remaining, 0);
    await owner(root + "/quotas", "PUT", {
      ...input,
      version: 1,
      enabled: false,
    });
    const bypass = await anon(pub, "POST", request());
    assert.equal(bypass.status, 201);
    await owner(root + "/quotas", "PUT", { ...input, version: 2 });
    assert.equal((await progress(owner, root)).reserved, 1);
    assert.equal((await anon(pub, "POST", request())).status, 409);
    await owner(root + "/responses/" + joined.interview.id, "DELETE");
    assert.equal((await progress(owner, root)).reserved, 0);
    assert.equal((await anon(pub, "POST", request())).status, 201);
    assert.equal(
      (
        await anon(
          `interviews/${old.interview.id}`,
          "GET",
          undefined,
          header(old),
        )
      ).status,
      200,
    );
  },
);
test(
  "Quota rejection preserves invitations; trusted invitation tags win; stopped and screened-out sources release reservations",
  { timeout: 90000 },
  async () => {
    const { owner, anon, root, pub, input } = await setup();
    await owner(root + "/quotas", "PUT", input);
    const joined = await anon(pub, "POST", request());
    assert.equal(joined.status, 201);
    await owner(root + "/recruitment", "PUT", {
      version: 0,
      mode: "invitation_only",
    });
    const batch = await owner(root + "/invitations", "POST", {
      requestId: randomUUID(),
      secret: randomBytes(32).toString("hex"),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      recipients: [
        {
          reference: "customer invitation",
          attributes: { segment: "customer" },
        },
      ],
    });
    const invited = {
      ...request({ segment: "forged" }),
      invitationToken: batch.links[0].path.split("#invite=")[1],
    };
    assert.equal((await anon(pub, "POST", invited)).status, 409);
    await anon(
      `interviews/${joined.interview.id}/stop`,
      "POST",
      {},
      header(joined),
    );
    assert.equal((await progress(owner, root)).remaining, 1);
    const admitted = await anon(pub, "POST", invited);
    assert.equal(admitted.status, 201);
    assert.equal((await progress(owner, root)).active, 1);
    const screened = await setup(true);
    await screened.owner(screened.root + "/quotas", "PUT", screened.input);
    const candidate = await screened.anon(screened.pub, "POST", request());
    const ending = await screened.anon(
      `interviews/${candidate.interview.id}/answer`,
      "POST",
      { requestId: randomUUID(), version: 0, answer: "Other", optionId: "no" },
      header(candidate),
    );
    assert.equal(ending.interview.status, "screened_out");
    assert.equal((await progress(screened.owner, screened.root)).reserved, 0);
    assert.equal(
      (await screened.anon(screened.pub, "POST", request())).status,
      201,
    );
  },
);
test(
  "Overlapping caps all apply, config changes preserve assigned groups, and handoff recovery survives a full quota",
  { timeout: 90000 },
  async () => {
    const { owner, anon, root, pub, input } = await setup();
    const b = rule("country", "US", 2),
      rules = [input.rules[0], b];
    await owner(root + "/quotas", "PUT", { ...input, rules });
    await owner(root + "/forsta-handoff", "PUT", {
      version: 0,
      enabled: true,
      reviewed: true,
      routes: {
        complete: "https://survey.example.test/thanks",
        screened_out: "",
        withdrawn: "",
      },
    });
    const body = {
      ...request({ segment: "customer", country: "US" }),
      surveyHandoff: {
        provider: "forsta",
        responseId: "quota_handoff",
        secret: randomBytes(32).toString("hex"),
      },
    };
    const a = await anon(pub, "POST", body);
    assert.equal(a.status, 201);
    const recovered = await anon(pub, "POST", body);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.interview.id, a.interview.id);
    assert.equal(recovered.token, a.token);
    assert.equal(
      (
        await anon(pub, "POST", {
          ...body,
          surveyHandoff: { ...body.surveyHandoff, responseId: "new_response" },
        })
      ).status,
      409,
    );
    assert.equal((await owner(root + "/forsta-handoff")).rows.length, 1);
    assert.equal(
      (await anon(pub, "POST", request({ segment: "prospect", country: "US" })))
        .status,
      201,
    );
    assert.equal(
      (await anon(pub, "POST", request({ country: "US" }))).status,
      409,
    );
    const rows = (await owner(root + "/quotas")).progress;
    assert.deepEqual(
      rows.map((p: any) => p.reserved),
      [1, 2],
    );
    await owner(root + "/quotas", "PUT", {
      ...input,
      version: 1,
      rules: [{ ...rules[0], enabled: false }, b],
    });
    assert.equal(
      (await anon(pub, "POST", request({ segment: "customer" }))).status,
      409,
    );
    await owner(root + "/quotas", "PUT", {
      ...input,
      version: 2,
      requireMatch: false,
      rules: [{ ...rules[0], enabled: false }, b],
    });
    assert.equal(
      (await anon(pub, "POST", request({ segment: "customer" }))).status,
      201,
    );
    assert.deepEqual(
      (await owner(root + "/quotas")).progress.map((p: any) => p.reserved),
      [1, 2],
    );
  },
);
