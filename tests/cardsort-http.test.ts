import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, client } from "./harness";
import { cardsortInterview, assignments } from "./cardsort-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3116 : 3115 }),
  { timeout: 90000 },
);
after(stop);
test(
  "card-sort drafts, confirmation, reasons, scopes and deletion honor native protocol and source boundaries",
  { timeout: 90000 },
  async () => {
    const owner = await client(),
      stranger = await client(),
      anon = await client();
    await owner("auth/signup", "POST", {
      name: "Sort Owner",
      email: "cardsort@example.test",
      password: "cardsort-password-test",
    });
    await stranger("auth/signup", "POST", {
      name: "Other Owner",
      email: "other-cardsort@example.test",
      password: "cardsort-password-test",
    });
    let study = (
      await owner("studies", "POST", { title: "Research navigation" })
    ).study;
    study.draft.questions = cardsortInterview().guide.questions;
    study = (
      await owner("studies/" + study.id, "PUT", {
        guide: study.draft,
        version: study.version,
      })
    ).study;
    study = (
      await owner("studies/" + study.id + "/publish", "POST", {
        version: study.version,
      })
    ).study;
    await owner("studies/" + study.id + "/fielding", "POST", {
      state: "active",
    });
    const root = `studies/${study.id}/cardsort`;
    assert.equal((await anon(root)).status, 401);
    assert.equal((await stranger(root)).status, 404);
    assert.equal((await owner(root + "?attribute=segment")).status, 400);
    const joined = await anon("public/" + study.id, "POST", {
      consent: true,
      attributes: { segment: "Team" },
    });
    let i = joined.interview;
    const headers = { "x-interview-token": joined.token },
      ip = "interviews/" + i.id;
    assert.equal(i.cardsortStates, undefined);
    assert.equal(i.guide.questions[0].cardsort, undefined);
    assert.equal(i.cardsortPrompt.cards.length, 3);
    assert.equal(
      (
        await anon(ip + "/cardsort-draft", "POST", {
          requestId: randomUUID(),
          version: 0,
          assignments: [],
        })
      ).status,
      404,
    );
    const draft = {
      requestId: randomUUID(),
      version: i.version,
      assignments: assignments(["team"]),
    };
    i = (await anon(ip + "/cardsort-draft", "POST", draft, headers)).interview;
    assert.equal(i.version, 1);
    assert.equal(i.turns.length, 0);
    assert.deepEqual(i.cardsortPrompt.draft, draft.assignments);
    assert.equal(
      (await anon(ip + "/cardsort-draft", "POST", draft, headers)).interview
        .version,
      1,
    );
    assert.equal(
      (
        await anon(
          ip + "/cardsort-draft",
          "POST",
          { ...draft, requestId: randomUUID() },
          headers,
        )
      ).status,
      409,
    );
    const restored = (await anon(ip, "GET", undefined, headers)).interview;
    assert.deepEqual(restored.cardsortPrompt, i.cardsortPrompt);
    assert.equal((await owner(root)).results[0].counts.incomplete, 1);
    assert.equal((await owner(root)).results[0].counts.included, 0);
    assert.equal(
      (
        await anon(
          ip + "/answer",
          "POST",
          {
            requestId: randomUUID(),
            version: i.version,
            answer: "",
            value: draft.assignments,
          },
          headers,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await anon(
          ip + "/cardsort-draft",
          "POST",
          {
            requestId: randomUUID(),
            version: i.version,
            assignments: [{ cardId: "0", groupId: "missing" }],
          },
          headers,
        )
      ).status,
      400,
    );
    const confirm = {
      requestId: randomUUID(),
      version: i.version,
      answer: "forged text",
      value: assignments(["team", "team", "research"]),
    };
    i = (await anon(ip + "/answer", "POST", confirm, headers)).interview;
    assert.equal(i.cardsortPrompt.phase, "reason");
    assert.equal(i.turns.length, 1);
    assert.ok(!i.turns[0].answer.includes("forged"));
    assert.equal(
      (await anon(ip + "/answer", "POST", confirm, headers)).interview.turns
        .length,
      1,
    );
    assert.equal(
      (
        await anon(
          ip + "/cardsort-draft",
          "POST",
          { requestId: randomUUID(), version: i.version, assignments: [] },
          headers,
        )
      ).status,
      409,
    );
    i = (
      await anon(
        ip + "/answer",
        "POST",
        { requestId: randomUUID(), version: i.version, answer: "=1+1" },
        headers,
      )
    ).interview;
    assert.equal(i.status, "complete");
    assert.equal(i.turns.length, 2);
    const first = i;
    async function complete(groups: (string | null)[], segment = "Team") {
      const r = await anon("public/" + study.id, "POST", {
          consent: true,
          attributes: { segment },
        }),
        h = { "x-interview-token": r.token };
      let i = r.interview;
      i = (
        await anon(
          "interviews/" + i.id + "/answer",
          "POST",
          {
            requestId: randomUUID(),
            version: i.version,
            answer: "",
            value: assignments(groups),
          },
          h,
        )
      ).interview;
      i = (
        await anon(
          "interviews/" + i.id + "/answer",
          "POST",
          {
            requestId: randomUUID(),
            version: i.version,
            answer: "I grouped the cards by activity.",
          },
          h,
        )
      ).interview;
      assert.equal(i.status, "complete");
      return i;
    }
    await complete(["team", "research", null]);
    await complete([null, null, "research"], "Solo");
    const pending = await anon("public/" + study.id, "POST", { consent: true });
    let r = (await owner(root)).results[0];
    assert.equal(r.counts.included, 3);
    assert.equal(r.counts.incomplete, 1);
    assert.deepEqual(
      r.rows.map((c: any) => [
        c.groups[0].count,
        c.groups[1].count,
        c.uncertain,
      ]),
      [
        [2, 0, 1],
        [1, 1, 1],
        [0, 2, 1],
      ],
    );
    const pair = r.pairs.find((p: any) => p.cardA === "0" && p.cardB === "1");
    assert.deepEqual(
      [pair.together, pair.bothAssigned, pair.percent],
      [1, 2, 50],
    );
    assert.equal(
      (await owner(root + "?attribute=segment&value=Solo")).results[0].counts
        .included,
      1,
    );
    assert.ok((await owner(root + "/export")).text.includes("uncertain"));
    const exported = (await owner(root + "/export?kind=assignments")).text;
    assert.ok(exported.includes(first.turns[0].id));
    assert.ok(exported.includes("'=1+1"));
    assert.ok(
      (await owner(root + "/export?kind=pairs")).text.includes(
        "both_assigned_real_groups",
      ),
    );
    const preview = await owner(`studies/${study.id}/preview`, "POST");
    assert.equal(preview.status, 201);
    assert.equal((await owner(root)).results[0].counts.total, 4);
    study = (await owner("studies/" + study.id)).study;
    study.draft.questions[0].cardsort.cards[0].text = "New invitation";
    study = (
      await owner("studies/" + study.id, "PUT", {
        guide: study.draft,
        version: study.version,
      })
    ).study;
    study = (
      await owner("studies/" + study.id + "/publish", "POST", {
        version: study.version,
      })
    ).study;
    const fresh = await anon("public/" + study.id, "POST", { consent: true });
    assert.ok(
      fresh.interview.cardsortPrompt.cards.some(
        (c: any) => c.text === "New invitation",
      ),
    );
    assert.deepEqual(
      (
        await anon("interviews/" + pending.interview.id, "GET", undefined, {
          "x-interview-token": pending.token,
        })
      ).interview.cardsortPrompt,
      pending.interview.cardsortPrompt,
    );
    assert.equal((await owner(root)).results.length, 2);
    await owner(`studies/${study.id}/responses/${first.id}`, "PATCH", {
      excluded: true,
      reason: "Synthetic review",
    });
    assert.equal(
      (await owner(root)).results.find(
        (x: any) => x.revisionId === first.revisionId,
      ).counts.included,
      2,
    );
    assert.ok(
      !(await owner(root + "/export?kind=assignments")).text.includes(first.id),
    );
    await owner(`studies/${study.id}/responses/${first.id}`, "DELETE");
    assert.ok(
      !(await owner(root + "/export?kind=assignments")).text.includes(
        first.turns[0].id,
      ),
    );
  },
);
