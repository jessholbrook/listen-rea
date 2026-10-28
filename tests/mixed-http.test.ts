import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { start, stop, client } from "./harness";
import { mixedGuide } from "./mixed-fixture";
before(() => start({ port: 3105 }), { timeout: 90000 });
after(stop);
test(
  "mixed HTTP flow validates answers, freezes assignments, resumes idempotently and exports computed measures",
  { timeout: 60000 },
  async () => {
    const owner = await client(),
      participant = await client(),
      other = await client();
    await owner("auth/signup", "POST", {
      name: "Mixed Researcher",
      email: "mixed@example.test",
      password: "mixed-test-password",
    });
    await other("auth/signup", "POST", {
      name: "Other Workspace",
      email: "other@example.test",
      password: "other-test-password",
    });
    let study = (
      await owner("studies", "POST", { title: "Mixed method lifecycle" })
    ).study;
    let g = mixedGuide();
    study = (
      await owner("studies/" + study.id, "PUT", {
        guide: g,
        version: study.version,
      })
    ).study;
    study = (
      await owner("studies/" + study.id + "/publish", "POST", {
        version: study.version,
      })
    ).study;
    study = (
      await owner("studies/" + study.id + "/fielding", "POST", {
        state: "active",
      })
    ).study;
    let r = await participant("public/" + study.id, "POST", { consent: true });
    let i = r.interview;
    const headers = { "x-interview-token": r.token };
    const order = i.optionAssignments.source;
    assert.equal(order.length, 3);
    const send = (value: unknown, extra = {}) =>
      participant(
        "interviews/" + i.id + "/answer",
        "POST",
        {
          requestId: crypto.randomUUID(),
          version: i.version,
          answer: "",
          value,
          ...extra,
        },
        headers,
      );
    assert.equal((await send(["a", "a"])).status, 400);
    r = await send(["a", "b"]);
    assert.equal(r.status, 200);
    i = r.interview;
    assert.equal(i.current, 1);
    assert.equal((await send(11)).status, 400);
    const requestId = crypto.randomUUID();
    r = await send(0, { requestId });
    assert.equal(r.status, 200);
    i = r.interview;
    assert.equal(i.current, 2);
    const assigned = i.optionAssignments.rank;
    const duplicate = await participant(
      "interviews/" + i.id + "/answer",
      "POST",
      { requestId, version: 1, answer: "", value: 0 },
      headers,
    );
    assert.equal(duplicate.interview.turns.length, 2);
    const resumed = await participant(
      "interviews/" + i.id,
      "GET",
      undefined,
      headers,
    );
    assert.deepEqual(resumed.interview.optionAssignments.rank, assigned);
    g.questions[1].scale!.max = 5;
    study = (
      await owner("studies/" + study.id, "PUT", {
        guide: g,
        version: study.version,
      })
    ).study;
    await owner("studies/" + study.id + "/publish", "POST", {
      version: study.version,
    });
    assert.equal(i.guide.questions[1].scale.max, 10);
    assert.equal((await send(["a", "a"])).status, 400);
    r = await send(["b", "a"]);
    i = r.interview;
    assert.equal(i.current, 3);
    assert.equal((await send({ speed: 2 })).status, 400);
    r = await send({ speed: 1, clarity: 5 });
    i = r.interview;
    r = await send(["c"]);
    i = r.interview;
    r = await send(undefined);
    i = r.interview;
    assert.equal(i.status, "complete");
    const result = await owner("studies/" + study.id + "/measures");
    assert.equal(result.status, 200);
    assert.equal(
      result.results.find((r: any) => r.questionId === "rating").mean,
      0,
    );
    assert.equal(
      (await other("studies/" + study.id + "/measures")).status,
      404,
    );
    const csv = await owner("studies/" + study.id + "/export");
    assert.ok(csv.text.includes("structured_value"));
    assert.ok(csv.text.includes("1. B"));
    await owner("studies/" + study.id + "/responses/" + i.id, "PATCH", {
      excluded: true,
      reason: "Fixture excluded",
    });
    assert.deepEqual(
      (await owner("studies/" + study.id + "/measures")).results,
      [],
    );
  },
);
