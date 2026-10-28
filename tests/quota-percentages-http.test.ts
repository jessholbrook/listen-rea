import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { start, stop, client } from "./harness";
import { emotionInterview } from "./emotion-fixture";
import { screenerGuide } from "./screener-quota-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3146 : 3145 }),
  { timeout: 90000 },
);
after(stop);
async function setup(screen = false, limit = 3) {
  const owner = await client(),
    anon = await client();
  await owner("auth/signup", "POST", {
    name: "Percent admin",
    email: randomUUID() + "@example.test",
    password: "percent-quota-password",
  });
  let s = (await owner("studies", "POST", { title: "Percent quota study" }))
    .study;
  s = (
    await owner(`studies/${s.id}`, "PUT", {
      version: s.version,
      guide: {
        ...(screen ? screenerGuide() : emotionInterview().guide),
        limit,
      },
    })
  ).study;
  s = (await owner(`studies/${s.id}/publish`, "POST", { version: s.version }))
    .study;
  const root = `studies/${s.id}`,
    pub = `public/${s.id}`;
  await owner(root + "/fielding", "POST", { state: "active" });
  return { owner, anon, root, pub };
}
const rule = (
  kind = "maximum",
  limit = 50,
  value = "A",
  source = "tags",
  unit = "percent",
) => ({
  id: randomUUID(),
  label: value,
  kind,
  limit,
  source,
  unit,
  enabled: true,
  conditions: [{ key: source === "tags" ? "segment" : "role", value }],
});
const config = (rules: any[], version = 0) => ({
  version,
  enabled: true,
  requireMatch: false,
  rules,
});
const req = (segment = "A") => ({ consent: true, attributes: { segment } }),
  head = (r: any) => ({ "x-interview-token": r.token });
async function publish(c: any, root: string, limit: number, live = true) {
  let s = (await c(root)).study;
  s = (
    await c(root, "PUT", { version: s.version, guide: { ...s.draft, limit } })
  ).study;
  if (live) await c(root + "/publish", "POST", { version: s.version });
}
const answer = (
  c: any,
  r: any,
  version: number,
  optionId?: string,
  value?: unknown,
  requestId = randomUUID(),
) =>
  c(
    `interviews/${r.interview.id}/answer`,
    "POST",
    { requestId, version, answer: "", optionId, value },
    head(r),
  );
test(
  "Relative maximums floor to whole places, reserve atomically, scale only on publication and retain earlier qualified sources on shrink",
  { timeout: 90000 },
  async () => {
    const { owner, anon, root, pub } = await setup();
    const a = rule(),
      b = rule("maximum", 1, "B");
    assert.equal(
      (await owner(root + "/quotas", "PUT", config([a, b]))).status,
      200,
    );
    const race = await Promise.all([
      anon(pub, "POST", req()),
      anon(pub, "POST", req()),
    ]);
    assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
    const joined = race.find((r) => r.status === 201)!;
    assert.deepEqual(
      (await owner(root + "/quotas")).progress.map((p: any) => p.resolvedCount),
      [1, 0],
    );
    assert.equal((await anon(pub, "POST", req("B"))).status, 409);
    await publish(owner, root, 6, false);
    assert.equal((await owner(root + "/quotas")).totalLimit, 3);
    assert.equal((await anon(pub, "POST", req())).status, 409);
    await publish(owner, root, 6);
    const expanded = await Promise.all(
      [0, 1, 2].map(() => anon(pub, "POST", req())),
    );
    assert.deepEqual(expanded.map((r) => r.status).sort(), [201, 201, 409]);
    assert.equal((await owner(root + "/quotas")).progress[0].resolvedCount, 3);
    await publish(owner, root, 4);
    const q = await owner(root + "/quotas");
    assert.equal(q.configurationError, null);
    assert.equal(q.progress[0].resolvedCount, 2);
    assert.equal(q.progress[0].reserved, 3);
    assert.equal(q.progress[0].full, true);
    assert.equal((await anon(pub, "POST", req())).status, 409);
    assert.equal(
      (
        await answer(anon, joined, 0, undefined, [
          "happy",
          "",
          "Synthetic percentage note.",
        ])
      ).interview.status,
      "complete",
    );
  },
);
test(
  "Rounded percentage minimums protect real study places, mix with count caps and reject infeasible or unrepresentable settings",
  { timeout: 90000 },
  async () => {
    const { owner, anon, root, pub } = await setup(),
      a = rule("minimum", 50),
      b = rule("maximum", 3, "B", "tags", "count");
    await owner(root + "/quotas", "PUT", config([a, b]));
    assert.equal((await anon(pub, "POST", req("B"))).status, 201);
    assert.equal((await anon(pub, "POST", req("B"))).status, 409);
    assert.equal(
      (
        await owner(
          root + "/quotas",
          "PUT",
          config([a, { ...b, kind: "minimum", unit: "percent", limit: 50 }], 1),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await owner(
          root + "/quotas",
          "PUT",
          config([{ ...a, kind: "exact" }, b], 1),
        )
      ).status,
      400,
    );
    await publish(owner, root, 5);
    assert.equal((await owner(root + "/quotas")).progress[0].resolvedCount, 3);
    assert.equal((await owner(root + "/quotas")).progress[1].resolvedCount, 3);
    assert.equal((await anon(pub, "POST", req("B"))).status, 201);
    assert.equal((await anon(pub, "POST", req("B"))).status, 409);
    for (let n = 0; n < 3; n++)
      assert.equal((await anon(pub, "POST", req("A"))).status, 201);
    const q = await owner(root + "/quotas");
    assert.equal(q.targetCapacity.needed, 0);
    assert.equal(q.progress[0].completeNeeded, 3);
    assert.equal(
      (
        await owner(
          root + "/quotas",
          "PUT",
          config([{ ...a, limit: 20 }, b], 1),
        )
      ).status,
      200,
    );
    assert.equal((await owner(root + "/quotas")).progress[0].resolvedCount, 1);
    assert.equal(
      (
        await owner(
          root + "/quotas",
          "PUT",
          config([{ ...a, kind: "exact", unit: "count", limit: 2 }, b], 2),
        )
      ).status,
      400,
    );
  },
);
test(
  "Incompatible exact percentages stop admissions and pending answer commits; corrected publication permits identical retry and preserves returns/deletion",
  { timeout: 90000 },
  async () => {
    const { owner, anon, root, pub } = await setup(true, 4),
      rules = [
        rule("exact", 50, "customer", "screener"),
        rule("exact", 50, "prospect", "screener"),
      ];
    await owner(root + "/quotas", "PUT", config(rules));
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
    const body = (responseId: string) => ({
        consent: true,
        surveyHandoff: {
          provider: "forsta",
          responseId,
          secret: randomBytes(32).toString("hex"),
        },
      }),
      firstBody = body("percent_first"),
      pendingBody = body("percent_pending"),
      first = await anon(pub, "POST", firstBody),
      pending = await anon(pub, "POST", pendingBody);
    await answer(anon, first, 0, "customer");
    await publish(owner, root, 3);
    let q = await owner(root + "/quotas");
    assert.match(q.configurationError, /whole participant count/);
    assert.equal(q.progress[0].resolvedCount, null);
    assert.equal(q.targetCapacity.feasible, false);
    assert.equal((await anon(pub, "POST", body("percent_new"))).status, 409);
    const id = randomUUID();
    assert.equal(
      (await answer(anon, pending, 0, "customer", undefined, id)).status,
      409,
    );
    const saved = await anon(
      `interviews/${pending.interview.id}`,
      "GET",
      undefined,
      head(pending),
    );
    assert.equal(saved.interview.turns.length, 0);
    assert.equal(saved.interview.version, 0);
    assert.equal(
      (await anon(pub, "POST", pendingBody)).interview.id,
      pending.interview.id,
    );
    assert.equal(
      (await answer(anon, first, 1, undefined, ["app"])).interview.status,
      "active",
    );
    assert.equal(
      (
        await answer(anon, first, 2, undefined, [
          "happy",
          "",
          "Previously qualified source.",
        ])
      ).interview.status,
      "complete",
    );
    await publish(owner, root, 6);
    q = await owner(root + "/quotas");
    assert.equal(q.configurationError, null);
    assert.equal(q.settings.version, 1);
    assert.deepEqual(
      q.progress.map((p: any) => p.resolvedCount),
      [3, 3],
    );
    const retried = await answer(anon, pending, 0, "customer", undefined, id);
    assert.equal(retried.status, 200);
    assert.equal(retried.interview.turns.length, 1);
    assert.equal(
      (await answer(anon, pending, 0, "customer", undefined, id)).interview
        .turns.length,
      1,
    );
    const third = await anon(pub, "POST", body("percent_third"));
    await answer(anon, third, 0, "customer");
    const last = await anon(pub, "POST", body("percent_full"));
    assert.equal(
      (await answer(anon, last, 0, "customer")).interview.status,
      "screened_out",
    );
    const dest = (
      await anon(
        `interviews/${last.interview.id}/survey-handoff`,
        "GET",
        undefined,
        head(last),
      )
    ).destination;
    assert.equal(new URL(dest.url).pathname, "/screened");
    assert.equal(new URL(dest.url).searchParams.get("rid"), "percent_full");
    await owner(root + "/responses/" + last.interview.id, "DELETE");
    assert.equal(
      (await owner(root + "/forsta-handoff")).rows.find(
        (r: any) => r.status === "response_deleted",
      ).responseId,
      "",
    );
  },
);
