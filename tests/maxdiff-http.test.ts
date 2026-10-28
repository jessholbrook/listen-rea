import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, client } from "./harness";
before(() => start({ port: 3114 }), { timeout: 90000 });
after(stop);
test(
  "MaxDiff native protocol preserves assignments, revision/segment scope, retries, model provenance and source deletion",
  { timeout: 90000 },
  async () => {
    const owner = await client(),
      stranger = await client(),
      anon = await client();
    await owner("auth/signup", "POST", {
      name: "MaxDiff Owner",
      email: "maxdiff@example.test",
      password: "maxdiff-password-test",
    });
    await stranger("auth/signup", "POST", {
      name: "Other Owner",
      email: "other-maxdiff@example.test",
      password: "maxdiff-password-test",
    });
    let study = (
      await owner("studies", "POST", { title: "Research priorities" })
    ).study;
    study.draft.questions = [
      {
        ...study.draft.questions[1],
        id: "maxdiff",
        type: "maxdiff",
        text: "Which feature matters most?",
        followUps: 0,
        options: [],
        maxdiff: {
          items: ["Setup", "Evidence", "Team", "Exports"].map((text, n) => ({
            id: String(n),
            text,
          })),
          setSize: 3,
          cycles: 1,
        },
      },
    ];
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
    const root = `studies/${study.id}/maxdiff`;
    assert.equal((await anon(root)).status, 401);
    assert.equal((await stranger(root)).status, 404);
    assert.equal((await owner(root + "?attribute=segment")).status, 400);
    async function join(segment = "Team") {
      return anon("public/" + study.id, "POST", {
        consent: true,
        attributes: { segment },
      });
    }
    async function complete(segment = "Team") {
      const r = await join(segment),
        headers = { "x-interview-token": r.token };
      let i = r.interview;
      assert.equal(i.maxdiffStates, undefined);
      assert.equal(i.guide.questions[0].maxdiff, undefined);
      assert.equal(i.maxdiffPrompt.items.length, 3);
      assert.equal((await anon("interviews/" + i.id)).status, 404);
      const resumed = (
        await anon("interviews/" + i.id, "GET", undefined, headers)
      ).interview;
      assert.deepEqual(resumed.maxdiffPrompt, i.maxdiffPrompt);
      assert.equal(
        (
          await anon(
            "interviews/" + i.id + "/answer",
            "POST",
            {
              requestId: randomUUID(),
              version: i.version,
              answer: "",
              value: {
                best: i.maxdiffPrompt.items[0].id,
                worst: i.maxdiffPrompt.items[0].id,
              },
            },
            headers,
          )
        ).status,
        400,
      );
      for (let n = 0; n < 6 && i.status === "active"; n++) {
        const ids = i.maxdiffPrompt.items.map((x: any) => x.id).sort();
        const input = {
          requestId: randomUUID(),
          version: i.version,
          answer: "forged text",
          value: { best: ids[0], worst: ids.at(-1) },
        };
        const response = await anon(
          "interviews/" + i.id + "/answer",
          "POST",
          input,
          headers,
        );
        assert.equal(response.status, 200, JSON.stringify(response));
        i = response.interview;
        assert.ok(!i.turns.at(-1).answer.includes("forged"));
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
      assert.equal(i.status, "complete");
      assert.equal(i.turns.length, 4);
      return i;
    }
    const first = await complete(),
      second = await complete("Solo"),
      incomplete = await join();
    let result = (await owner(root)).results[0];
    assert.equal(result.counts.included, 2);
    assert.equal(result.counts.incomplete, 1);
    assert.ok(result.items.every((x: any) => x.exposures === 6));
    assert.equal(result.respondents, undefined);
    const input = {
      revisionId: result.revisionId,
      questionId: result.questionId,
      conceptId: null,
      sourceFingerprint: result.sourceFingerprint,
    };
    let model = await owner(root + "/model", "POST", input);
    assert.equal(model.status, 200, JSON.stringify(model));
    assert.equal(model.model.method, "pooled-joint-bw-logit-v1");
    assert.ok(
      Math.abs(
        model.model.items.reduce((s: number, x: any) => s + x.score, 0) - 100,
      ) < 1e-8,
    );
    assert.equal(model.model.bootstrap.completed, 0);
    assert.ok(model.csv.includes("source_fingerprint"));
    assert.ok(!model.csv.includes("Hierarchical Bayes"));
    assert.equal(
      (
        await owner(root + "/model", "POST", {
          ...input,
          sourceFingerprint: "0".repeat(64),
        })
      ).status,
      409,
    );
    assert.equal((await stranger(root + "/model", "POST", input)).status, 404);
    assert.equal(
      (await owner(root + "?attribute=segment&value=Solo")).results[0].counts
        .included,
      1,
    );
    assert.ok(
      (await owner(root + "/export")).text.includes("net_per_exposure"),
    );
    assert.ok(
      (await owner(root + "/export?kind=tasks")).text.includes(first.id),
    );
    const preview = await owner(`studies/${study.id}/preview`, "POST");
    assert.equal(preview.status, 201);
    assert.equal((await owner(root)).results[0].counts.total, 3);
    study = (await owner("studies/" + study.id)).study;
    study.draft.questions[0].maxdiff.items[0].text = "New setup";
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
    const next = await join();
    assert.equal((await owner(root)).results.length, 2);
    const restored = (
      await anon("interviews/" + incomplete.interview.id, "GET", undefined, {
        "x-interview-token": incomplete.token,
      })
    ).interview;
    assert.deepEqual(
      restored.maxdiffPrompt,
      incomplete.interview.maxdiffPrompt,
    );
    assert.ok(next.interview.maxdiffPrompt);
    await owner(`studies/${study.id}/responses/${second.id}`, "PATCH", {
      excluded: true,
      reason: "Synthetic review",
    });
    assert.equal(
      (await owner(root)).results.find(
        (r: any) => r.revisionId === input.revisionId,
      ).counts.included,
      1,
    );
    assert.equal((await owner(root + "/model", "POST", input)).status, 409);
    await owner(`studies/${study.id}/responses/${first.id}`, "DELETE");
    assert.ok(
      !(await owner(root + "/export?kind=tasks")).text.includes(first.id),
    );
    result = (await owner(root)).results.find(
      (r: any) => r.revisionId === input.revisionId,
    );
    assert.equal(result.counts.included, 0);
    assert.ok(result.items.every((x: any) => x.netPerExposure === null));
  },
);
