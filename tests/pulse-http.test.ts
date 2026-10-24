import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, client } from "./harness";
import { pulseFixture } from "./pulse-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3118 : 3117 }),
  { timeout: 90000 },
);
after(stop);
test(
  "Pulse native waves preserve baseline, coding/version/source boundaries, segments and exports",
  { timeout: 90000 },
  async () => {
    const owner = await client(),
      stranger = await client(),
      anon = await client();
    for (const [c, email] of [
      [owner, "pulse@example.test"],
      [stranger, "other-pulse@example.test"],
    ] as const)
      assert.equal(
        (
          await c("auth/signup", "POST", {
            name: "Pulse Researcher",
            email,
            password: "pulse-test-password",
          })
        ).status,
        200,
      );
    let study = (
      await owner("studies", "POST", { title: "Experience tracker" })
    ).study;
    const design = { ...pulseFixture().guide };
    study = (
      await owner(`studies/${study.id}`, "PUT", {
        guide: design,
        version: study.version,
      })
    ).study;
    const create = {
      version: study.version,
      name: "Experience Pulse",
      label: "Wave one",
      date: "2026-10-19",
      recruitment: "Stable panel and quotas",
    };
    assert.equal(
      (await owner(`studies/${study.id}/pulse`, "POST", create)).status,
      400,
    );
    study = (
      await owner(`studies/${study.id}/publish`, "POST", {
        version: study.version,
      })
    ).study;
    let series = (
      await owner(`studies/${study.id}/pulse`, "POST", {
        ...create,
        version: study.version,
      })
    ).series;
    const root = `pulse/${series.id}`;
    assert.equal(series.baselineRevisionId, study.revisionId);
    assert.equal((await anon(root)).status, 401);
    assert.equal((await stranger(root)).status, 404);
    assert.equal(
      (
        await stranger(root + "/waves", "POST", {
          version: series.version,
          label: "Other",
          date: "2026-10-20",
          recruitment: "Panel",
        })
      ).status,
      404,
    );
    assert.equal((await owner(root + "?attribute=segment")).status, 400);
    assert.equal(
      (
        await owner(root + "/waves", "POST", {
          version: series.version,
          label: "Other",
          date: "2026-02-30",
          recruitment: "Panel",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await owner(`studies/${study.id}/pulse`, "POST", {
          ...create,
          version: study.version,
        })
      ).status,
      409,
    );
    const codes = [
      {
        id: "cost",
        name: "Cost concern",
        definition: "Explicit price concerns, excluding praise.",
      },
    ];
    series = (
      await owner(root + "/codebook", "POST", {
        version: series.version,
        codes,
      })
    ).series;
    const stale = await owner(root + "/codebook", "POST", {
      version: 1,
      codes,
    });
    assert.equal(stale.status, 409);
    await owner(`studies/${study.id}/fielding`, "POST", { state: "active" });
    async function complete(
      sid: string,
      rating: number,
      yes: boolean,
      segment = "Team",
    ) {
      const joined = await anon("public/" + sid, "POST", {
        consent: true,
        attributes: { segment },
      });
      assert.equal(joined.status, 201);
      let i = joined.interview;
      for (const answer of [
        { value: rating },
        { optionId: yes ? "yes" : "no" },
        { answer: "=The price is too high for me." },
      ]) {
        const r = await anon(
          `interviews/${i.id}/answer`,
          "POST",
          {
            answer: "",
            ...answer,
            requestId: randomUUID(),
            version: i.version,
          },
          { "x-interview-token": joined.token },
        );
        assert.equal(r.status, 200);
        i = r.interview;
      }
      assert.equal(i.status, "complete");
      return i;
    }
    const a = await complete(study.id, 8, true),
      b = await complete(study.id, 4, false, "Solo");
    let result = await owner(root);
    assert.equal(result.waves[0].metrics[0].mean, 6);
    assert.equal(result.waves[0].comparable, false);
    async function review(i: any, assignments: unknown[]) {
      const r = await owner(root + "/review", "POST", {
        version: series.version,
        interviewId: i.id,
        sourceVersion: i.version,
        codebookVersion: series.codebooks.at(-1).version,
        assignments,
      });
      if (r.series) series = r.series;
      return r;
    }
    assert.equal(
      (await review(a, [{ codeId: "unknown", turnId: a.turns[2].id }])).status,
      400,
    );
    assert.equal(
      (await review(a, [{ codeId: "cost", turnId: b.turns[2].id }])).status,
      400,
    );
    assert.equal(
      (await review(a, [{ codeId: "cost", turnId: a.turns[2].id }])).status,
      200,
    );
    assert.equal((await review(b, [])).status, 200);
    result = await owner(root);
    assert.equal(result.waves[0].comparable, true);
    assert.equal(result.waves[0].themes[0].percent, 50);
    assert.equal(result.waves[0].counts.reviewed, 2);
    const segment = await owner(root + "?attribute=segment&value=Team");
    assert.equal(segment.waves[0].metrics[0].mean, 8);
    assert.equal(segment.waves[0].themes[0].percent, 100);
    const evidence = await owner(root + "/export?kind=evidence");
    assert.ok(evidence.text.includes(a.turns[2].id));
    assert.ok(evidence.text.includes("'=The price"));
    assert.ok(evidence.text.includes("Explicit price concerns"));
    const comparison = await owner(root + "/export");
    assert.ok(comparison.text.includes('"rating_mean","","6","2"'));
    const collaborator = await client();
    const invite = (await owner("invites", "POST", { role: "collaborator" }))
      .invite;
    await collaborator("auth/signup", "POST", {
      name: "Pulse collaborator",
      email: "pulse-collaborator@example.test",
      password: "pulse-collaborator-password",
      invite,
    });
    assert.equal((await collaborator(root)).status, 200);
    const created = await owner(root + "/waves", "POST", {
      version: series.version,
      label: "Wave two",
      date: "2026-10-20",
      recruitment: series.recruitment,
    });
    assert.equal(created.status, 200);
    series = created.series;
    let wave2 = created.study;
    assert.equal(wave2.fielding, "draft");
    assert.equal(wave2.revisionId, null);
    assert.equal(
      (
        await collaborator(`studies/${wave2.id}/fielding`, "POST", {
          state: "active",
        })
      ).status,
      403,
    );
    assert.deepEqual(wave2.draft, series.baseline);
    wave2.draft.questions.push({
      ...wave2.draft.questions[2],
      id: "timely",
      text: "What happened today?",
    });
    wave2 = (
      await owner(`studies/${wave2.id}`, "PUT", {
        guide: wave2.draft,
        version: wave2.version,
      })
    ).study;
    wave2 = (
      await owner(`studies/${wave2.id}/publish`, "POST", {
        version: wave2.version,
      })
    ).study;
    result = await owner(root);
    assert.deepEqual(result.waves[1].warnings, []);
    assert.equal(result.waves[1].timely.length, 1);
    series = (
      await owner(root + "/wave", "POST", {
        version: series.version,
        studyId: wave2.id,
        label: "Wave two",
        date: "2026-10-20",
        recruitment: "New panel",
      })
    ).series;
    assert.ok(
      (await owner(root)).waves[1].warnings.some((v: string) =>
        v.includes("Recruitment"),
      ),
    );
    series = (
      await owner(root + "/codebook", "POST", {
        version: series.version,
        codes: [
          {
            ...codes[0],
            definition: "Price must explicitly prevent purchase.",
          },
        ],
      })
    ).series;
    result = await owner(root);
    assert.equal(result.waves[0].counts.reviewed, 0);
    assert.ok(
      result.waves[0].warnings.some((v: string) =>
        v.includes("Prior codebook"),
      ),
    );
    assert.equal(
      (await review(a, [{ codeId: "cost", turnId: a.turns[2].id }])).status,
      200,
    );
    await owner(`studies/${study.id}/responses/${a.id}`, "PATCH", {
      excluded: true,
      reason: "Synthetic exclusion",
    });
    assert.ok(
      !(await owner(root + "/export?kind=evidence")).text.includes(a.id),
    );
    await owner(`studies/${study.id}/responses/${a.id}`, "DELETE");
    assert.equal((await owner(root)).waves[0].counts.included, 1);
    assert.ok(
      !(await owner(root + "/export?kind=evidence")).text.includes(a.id),
    );
    assert.equal((await review(a, [])).status, 404);
    // A new published revision does not blend earlier responses into the current wave.
    study = (await owner(`studies/${study.id}`)).study;
    study.draft.questions[0].text = "How satisfied are you today?";
    study = (
      await owner(`studies/${study.id}`, "PUT", {
        guide: study.draft,
        version: study.version,
      })
    ).study;
    await owner(`studies/${study.id}/publish`, "POST", {
      version: study.version,
    });
    result = await owner(root);
    assert.equal(result.waves[0].counts.otherRevisions, 1);
    assert.equal(result.waves[0].metrics[0].mean, null);
    assert.ok(
      result.waves[0].warnings.some((v: string) =>
        v.includes("Recurring question"),
      ),
    );
    assert.equal(series.baseline.questions[0].text, "How satisfied are you?");
  },
);
