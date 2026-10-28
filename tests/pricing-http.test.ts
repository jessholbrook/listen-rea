import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, client } from "./harness";
before(() => start({ port: 3113 }), { timeout: 90000 });
after(stop);
test(
  "hostable pricing protocol preserves frozen ladders, tokens, revisions, retry semantics, evidence and deletion",
  { timeout: 90000 },
  async () => {
    const owner = await client(),
      stranger = await client(),
      anon = await client();
    await owner("auth/signup", "POST", {
      name: "Pricing Owner",
      email: "pricing@example.test",
      password: "pricing-password-test",
    });
    await stranger("auth/signup", "POST", {
      name: "Other Owner",
      email: "other-pricing@example.test",
      password: "pricing-password-test",
    });
    let study = (
      await owner("studies", "POST", { title: "Subscription price test" })
    ).study;
    const g = study.draft;
    g.questions = [
      {
        ...g.questions[1],
        id: "price",
        type: "pricing",
        text: "An Echo Lab subscription.",
        followUps: 0,
        options: [],
        pricing: {
          prices: [1000, 2000, 3000],
          currency: "USD",
          unit: "per month",
          askReason: true,
        },
      },
      {
        ...g.questions[1],
        id: "end",
        type: "statement",
        text: "Thank you for your pricing responses.",
        followUps: 0,
      },
    ];
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
    await owner("studies/" + study.id + "/fielding", "POST", {
      state: "active",
    });
    const root = "studies/" + study.id + "/pricing";
    assert.equal((await anon(root)).status, 401);
    assert.equal((await stranger(root)).status, 404);
    assert.equal((await owner(root + "?attribute=segment")).status, 400);
    const records: any[] = [];
    async function complete(
      highest: number,
      flip = false,
      segment = "Team",
      finish = true,
    ) {
      const joined = await anon("public/" + study.id, "POST", {
        consent: true,
        attributes: { segment },
      });
      let i = joined.interview;
      const headers = { "x-interview-token": joined.token };
      records.push({ id: i.id, headers });
      assert.equal(i.pricingStates, undefined);
      assert.equal(i.guide.questions[0].pricing, undefined);
      assert.ok(i.pricingPrompt.amountMinor);
      const initial = i.pricingPrompt.amountMinor;
      assert.equal((await anon("interviews/" + i.id)).status, 404);
      assert.equal(
        (await anon("interviews/" + i.id, "GET", undefined, headers)).interview
          .pricingPrompt.amountMinor,
        initial,
      );
      assert.equal(
        (
          await anon(
            "interviews/" + i.id + "/answer",
            "POST",
            {
              requestId: randomUUID(),
              version: i.version,
              answer: "",
              optionId: "maybe",
            },
            headers,
          )
        ).status,
        400,
      );
      for (let n = 0; n < 15 && i.status === "active"; n++) {
        const p = i.pricingPrompt;
        if (!p && !finish) break;
        const input = {
          requestId: randomUUID(),
          version: i.version,
          answer: p?.phase === "reason" ? "The value fits our budget." : "",
          optionId:
            p && p.phase !== "reason"
              ? (
                  p.phase === "check" && flip
                    ? p.amountMinor > highest
                    : p.amountMinor <= highest
                )
                ? "yes"
                : "no"
              : undefined,
        };
        const r = await anon(
          "interviews/" + i.id + "/answer",
          "POST",
          input,
          headers,
        );
        assert.equal(r.status, 200, JSON.stringify(r));
        i = r.interview;
        const duplicate = await anon(
          "interviews/" + i.id + "/answer",
          "POST",
          input,
          headers,
        );
        assert.equal(duplicate.interview.version, i.version);
        assert.equal(duplicate.interview.turns.length, i.turns.length);
        if (i.status === "active")
          assert.equal(
            (
              await anon(
                "interviews/" + i.id + "/answer",
                "POST",
                { ...input, requestId: randomUUID() },
                headers,
              )
            ).status,
            409,
          );
      }
      return i;
    }
    await complete(0);
    await complete(1000);
    await complete(2000);
    const top = await complete(3000, false, "Solo");
    await complete(2000, true);
    await complete(1000, false, "Team", false);
    let data = await owner(root),
      r = data.results[0];
    assert.equal(r.counts.denominator, 4);
    assert.equal(r.counts.nonbuyers, 1);
    assert.equal(r.counts.inconsistent, 1);
    assert.equal(r.counts.incomplete, 1);
    assert.deepEqual(
      r.points.map((p: any) => p.demand),
      [0.75, 0.5, 0.25],
    );
    assert.deepEqual(
      r.points.map((p: any) => p.revenuePerRespondentMinor),
      [750, 1000, 750],
    );
    assert.deepEqual(r.revenueMaxPrices, [2000]);
    const solo = (await owner(root + "?attribute=segment&value=Solo"))
      .results[0];
    assert.equal(solo.counts.denominator, 1);
    assert.ok(solo.points.every((p: any) => p.demand === 1));
    const curves = await owner(root + "/export");
    assert.ok(curves.text.includes("revenue_per_respondent_minor"));
    assert.ok(curves.text.includes("2000"));
    const responses = await owner(root + "/export?kind=responses");
    assert.ok(responses.text.includes("The value fits our budget."));
    assert.ok(responses.text.includes('"inconsistent"'));
    assert.ok(responses.text.includes(top.id));
    const preview = await owner("studies/" + study.id + "/preview", "POST");
    assert.equal((await owner(root)).results[0].counts.total, 6);
    assert.equal(preview.status, 201);
    // Existing interviews retain prices when a new revision changes the ladder.
    study = (await owner("studies/" + study.id)).study;
    study.draft.questions[0].pricing.prices = [500, 1000, 1500];
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
    assert.deepEqual(
      (await owner(root)).results[0].config.prices,
      [1000, 2000, 3000],
    );
    const next = await complete(1500);
    assert.equal(next.status, "complete");
    assert.equal((await owner(root)).results.length, 2);
    await owner(`studies/${study.id}/responses/${top.id}`, "PATCH", {
      excluded: true,
      reason: "Synthetic review",
    });
    assert.equal(
      (await owner(root)).results.find((x: any) => x.config.prices[0] === 1000)
        .counts.denominator,
      3,
    );
    await owner(`studies/${study.id}/responses/${top.id}`, "DELETE");
    assert.ok(
      !(await owner(root + "/export?kind=responses")).text.includes(top.id),
    );
  },
);
