import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { start, stop, client } from "./harness";
import { conceptGuide } from "./concept-fixture";
before(() => start({ port: 3106 }), { timeout: 90000 });
after(stop);
test(
  "concept HTTP lifecycle persists assignments, freezes stimuli and isolates analyses, Q&A, sharing and exports",
  { timeout: 60000 },
  async () => {
    const owner = await client(),
      person = await client(),
      stranger = await client();
    await owner("auth/signup", "POST", {
      name: "Concept Researcher",
      email: "concept@example.test",
      password: "concept-test-password",
    });
    await stranger("auth/signup", "POST", {
      name: "Stranger Researcher",
      email: "stranger@example.test",
      password: "stranger-test-password",
    });
    let s = (await owner("studies", "POST", { title: "Concept lifecycle" }))
      .study;
    const guide = conceptGuide();
    s = (await owner("studies/" + s.id, "PUT", { guide, version: s.version }))
      .study;
    s = (
      await owner("studies/" + s.id + "/publish", "POST", {
        version: s.version,
      })
    ).study;
    s = (
      await owner("studies/" + s.id + "/fielding", "POST", { state: "active" })
    ).study;
    const rev = s.revisionId;
    let r = await person("public/" + s.id, "POST", { consent: true }),
      i = r.interview;
    const headers = { "x-interview-token": r.token };
    assert.equal(i.guide.conceptTest.concepts.length, 0);
    while (i.status === "active") {
      const q = i.guide.questions[i.current];
      let value: any,
        answer = "";
      if (q.type === "open")
        answer =
          q.conceptId === "alpha"
            ? "Alpha is useful and fast."
            : q.conceptId === "beta"
              ? "Beta is clear and traceable."
              : "Shared research context.";
      else if (q.type === "rating") value = q.conceptId === "alpha" ? 5 : 1;
      else if (q.type === "multiple") value = ["a", "b"];
      else if (q.type === "ranking") value = ["b", "a"];
      r = await person(
        "interviews/" + i.id + "/answer",
        "POST",
        {
          requestId: crypto.randomUUID(),
          version: i.version,
          answer,
          value,
          conceptId: "forged",
        },
        headers,
      );
      assert.equal(r.status, 200);
      i = r.interview;
      if (i.status === "active" && i.guide.questions[i.current].conceptId) {
        assert.equal(i.guide.conceptTest.concepts.length, 1);
        const resumed = await person(
          "interviews/" + i.id,
          "GET",
          undefined,
          headers,
        );
        assert.deepEqual(resumed.interview.guide, i.guide);
      }
    }
    const data = await owner("studies/" + s.id);
    const saved = data.interviews[0];
    assert.equal(saved.conceptAssignments.length, 2);
    assert.ok(saved.turns.every((t: any) => t.conceptId !== "forged"));
    guide.conceptTest!.concepts[0].description = "Changed after admission";
    s = (await owner("studies/" + s.id, "PUT", { guide, version: s.version }))
      .study;
    s = (
      await owner("studies/" + s.id + "/publish", "POST", {
        version: s.version,
      })
    ).study;
    assert.notEqual(
      saved.guide.conceptTest.concepts.find((c: any) => c.id === "alpha")
        .description,
      "Changed after admission",
    );
    const scope = (id: string) => "?concept=" + id + "&revision=" + rev;
    const alpha = await owner(
      "studies/" + s.id + "/analysis" + scope("alpha"),
      "POST",
      { mode: "manual" },
    );
    assert.equal(alpha.status, 200);
    assert.equal(alpha.stats.denominator, 1);
    const beta = await owner(
      "studies/" + s.id + "/analysis" + scope("beta"),
      "POST",
      { mode: "manual" },
    );
    assert.equal(beta.status, 200);
    assert.notEqual(alpha.analysis.id, beta.analysis.id);
    assert.equal(
      (await owner("studies/" + s.id + "/analysis" + scope("alpha"))).analysis
        .id,
      alpha.analysis.id,
    );
    const foreign = saved.turns.find(
      (t: any) => t.conceptId === "beta" && t.templateQuestionId === "reaction",
    );
    let edit = {
      id: alpha.analysis.id,
      version: 1,
      summary: "",
      limitations: "Small fixture.",
      themes: [
        {
          title: "Useful concept",
          description: "",
          citations: [
            { interviewId: i.id, turnId: foreign.id, quote: foreign.answer },
          ],
        },
      ],
      reviewed: false,
    };
    assert.equal(
      (
        await owner(
          "studies/" + s.id + "/analysis" + scope("alpha"),
          "PUT",
          edit,
        )
      ).status,
      502,
      "A source quote from another concept must be rejected",
    );
    const source = saved.turns.find(
      (t: any) =>
        t.conceptId === "alpha" && t.templateQuestionId === "reaction",
    );
    edit.themes[0].citations = [
      { interviewId: i.id, turnId: source.id, quote: source.answer },
    ];
    edit.reviewed = true;
    const reviewed = await owner(
      "studies/" + s.id + "/analysis" + scope("alpha"),
      "PUT",
      edit,
    );
    assert.equal(reviewed.status, 200);
    const shared = await owner(
      "studies/" + s.id + "/share" + scope("alpha"),
      "POST",
    );
    assert.equal(shared.status, 200);
    const report = await person("shared/" + shared.token);
    assert.ok(report.memo.includes("Alpha is useful"));
    assert.ok(!report.memo.includes("Beta is clear"));
    assert.equal(
      (await stranger("studies/" + s.id + "/analysis" + scope("alpha"))).status,
      404,
    );
    assert.equal(
      (await owner("studies/" + s.id + "/analysis?concept=alpha")).status,
      400,
    );
    assert.equal(
      (
        await owner(
          "studies/" + s.id + "/qa?concept=alpha&revision=not-a-revision",
          "POST",
          { question: "What matters to this concept?" },
        )
      ).status,
      404,
    );
    const measures = await owner("studies/" + s.id + "/measures");
    assert.equal(
      measures.results.filter((r: any) => r.type === "rating").length,
      2,
    );
    assert.equal(
      measures.results.find(
        (r: any) => r.type === "rating" && r.conceptId === "alpha",
      ).mean,
      5,
    );
    const csv = await owner("studies/" + s.id + "/export");
    assert.ok(csv.text.includes("concept_id"));
    assert.ok(csv.text.includes("template_question_id"));
    await owner("studies/" + s.id + "/responses/" + i.id, "DELETE");
    assert.equal((await person("shared/" + shared.token)).status, 404);
    assert.equal(
      (await owner("studies/" + s.id + "/analysis" + scope("alpha"))).analysis,
      null,
    );
  },
);
