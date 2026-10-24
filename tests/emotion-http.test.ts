import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, client } from "./harness";
import { emotionInterview } from "./emotion-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3120 : 3119 }),
  { timeout: 90000 },
);
after(stop);
test(
  "Hosted-compatible feeling protocol preserves optional answers, canonical evidence, scopes and deletion",
  { timeout: 90000 },
  async () => {
    const owner = await client(),
      other = await client(),
      anon = await client();
    for (const [c, email] of [
      [owner, "emotion@example.test"],
      [other, "emotion-other@example.test"],
    ] as const)
      await c("auth/signup", "POST", {
        name: "Feeling researcher",
        email,
        password: "feeling-test-password",
      });
    let study = (
      await owner("studies", "POST", { title: "Experience feelings" })
    ).study;
    study = (
      await owner(`studies/${study.id}`, "PUT", {
        guide: emotionInterview().guide,
        version: study.version,
      })
    ).study;
    study = (
      await owner(`studies/${study.id}/publish`, "POST", {
        version: study.version,
      })
    ).study;
    await owner(`studies/${study.id}/fielding`, "POST", { state: "active" });
    const root = `studies/${study.id}/emotions`;
    assert.equal((await anon(root)).status, 401);
    assert.equal((await other(root)).status, 404);
    assert.equal((await owner(root + "?attribute=segment")).status, 400);
    assert.equal((await owner(root + "?language=de")).status, 400);
    async function join() {
      return anon("public/" + study.id, "POST", {
        consent: true,
        attributes: { segment: "Team" },
      });
    }
    const joined = await join(),
      i = joined.interview,
      headers = { "x-interview-token": joined.token };
    const invalid = await anon(
      `interviews/${i.id}/answer`,
      "POST",
      {
        requestId: randomUUID(),
        version: 0,
        answer: "forged",
        value: ["prefer_not_to_answer", "", "secret"],
      },
      headers,
    );
    assert.equal(invalid.status, 400);
    const request = {
      requestId: randomUUID(),
      version: i.version,
      answer: "forged feeling",
      value: ["frustrated", "2", "=A very long wait."],
    };
    assert.equal(
      (await anon(`interviews/${i.id}/answer`, "POST", request)).status,
      404,
    );
    let r = await anon(`interviews/${i.id}/answer`, "POST", request, headers);
    assert.equal(r.status, 200);
    assert.equal(r.interview.status, "complete");
    assert.equal(r.interview.turns[0].emotion.method, "self-report-v1");
    assert.equal(r.interview.turns[0].emotion.feeling, "frustrated");
    assert.ok(!r.interview.turns[0].answer.includes("forged"));
    assert.equal(r.interview.turns[0].followUp, false);
    const retry = await anon(
      `interviews/${i.id}/answer`,
      "POST",
      request,
      headers,
    );
    assert.deepEqual(retry.interview.turns, r.interview.turns);
    const neutral = await join(),
      declined = await join(),
      unfinished = await join();
    assert.equal(
      (
        await anon(
          `interviews/${unfinished.interview.id}/answer`,
          "POST",
          {
            requestId: randomUUID(),
            version: 99,
            answer: "",
            value: ["happy", "1", ""],
          },
          { "x-interview-token": unfinished.token },
        )
      ).status,
      409,
    );
    for (const [j, value] of [
      [neutral, ["neutral", "", ""]],
      [declined, ["prefer_not_to_answer", "", ""]],
    ] as const)
      assert.equal(
        (
          await anon(
            `interviews/${j.interview.id}/answer`,
            "POST",
            { requestId: randomUUID(), version: 0, answer: "", value },
            { "x-interview-token": j.token },
          )
        ).interview.status,
        "complete",
      );
    let results = (await owner(root)).results;
    assert.equal(results[0].counts.included, 2);
    assert.equal(results[0].counts.declined, 1);
    assert.equal(results[0].counts.incomplete, 1);
    assert.equal(
      results[0].rows.find((v: any) => v.feeling === "frustrated").percent,
      50,
    );
    assert.equal(
      (await owner(root + "?attribute=segment&value=Missing")).results.length,
      0,
    );
    const summary = await owner(root + "/export"),
      sources = await owner(root + "/export?kind=sources");
    const summaryLines = summary.text.split(/\r?\n/);
    assert.equal(
      summaryLines[0].split(",").length,
      summaryLines[1].split(",").length,
    );
    assert.ok(summary.text.includes('"frustrated","Frustrated","1","2","50"'));
    assert.ok(sources.text.includes("'=A very long wait."));
    assert.ok(sources.text.includes(r.interview.turns[0].id));
    assert.ok(sources.text.includes('"declined","prefer_not_to_answer"'));
    study = (await owner(`studies/${study.id}`)).study;
    study.draft.questions[0].text = "How do you feel about the new experience?";
    study = (
      await owner(`studies/${study.id}`, "PUT", {
        guide: study.draft,
        version: study.version,
      })
    ).study;
    await owner(`studies/${study.id}/publish`, "POST", {
      version: study.version,
    });
    const frozen = (
      await anon(`interviews/${unfinished.interview.id}`, "GET", undefined, {
        "x-interview-token": unfinished.token,
      })
    ).interview;
    assert.equal(frozen.prompt, "How did this experience make you feel?");
    const fresh = await join();
    await anon(
      `interviews/${fresh.interview.id}/answer`,
      "POST",
      {
        requestId: randomUUID(),
        version: 0,
        answer: "",
        value: ["happy", "1", ""],
      },
      { "x-interview-token": fresh.token },
    );
    assert.equal((await owner(root)).results.length, 2);
    await owner(`studies/${study.id}/responses/${i.id}`, "PATCH", {
      excluded: true,
      reason: "Synthetic source exclusion",
    });
    assert.ok(
      !(await owner(root + "/export?kind=sources")).text.includes(i.id),
    );
    await owner(`studies/${study.id}/responses/${i.id}`, "DELETE");
    assert.ok(
      !(await owner(root + "/export?kind=sources")).text.includes(i.id),
    );
    results = (await owner(root)).results;
    assert.equal(
      results.find((v: any) => v.revisionId === i.revisionId).counts.included,
      1,
    );
  },
);
