import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { start, stop, client } from "./harness";
before(() => start({ port: 3107 }), { timeout: 90000 });
after(stop);
test(
  "workflow preserves live revisions, traces restores, copies defaults/audiences, and enforces workspace boundaries",
  { timeout: 90000 },
  async () => {
    const owner = await client(),
      stranger = await client(),
      collaborator = await client(),
      person = await client();
    await owner("auth/signup", "POST", {
      name: "Workflow Owner",
      email: "workflow@example.test",
      password: "workflow-test-password",
    });
    await stranger("auth/signup", "POST", {
      name: "Other Owner",
      email: "other-workflow@example.test",
      password: "workflow-test-password",
    });
    const invite = (await owner("invites", "POST", { role: "collaborator" }))
      .invite;
    await collaborator("auth/signup", "POST", {
      name: "Colleague",
      email: "colleague-workflow@example.test",
      password: "workflow-test-password",
      invite,
    });
    const initial = (await owner("workflow")).defaults;
    let s = (await owner("studies", "POST", { title: "Workflow source" }))
      .study;
    const created = (await owner(`studies/${s.id}/history`)).history[0];
    const defaults = {
      ...initial,
      audience: "Product research teams",
      intro: "A reusable introduction for a new internal research study.",
      limit: 7,
      guidelines: "Use plain language and ask about recent concrete events.",
    };
    assert.equal(
      (await collaborator("workflow/defaults", "PUT", defaults)).status,
      403,
    );
    assert.equal(
      (await owner("workflow/defaults", "PUT", defaults)).status,
      200,
    );
    assert.equal(
      (await owner("workflow/defaults", "PUT", defaults)).status,
      409,
    );
    assert.equal(
      (await owner(`studies/${s.id}`)).study.draft.intro,
      s.draft.intro,
    );
    const next = (
      await owner("studies", "POST", { title: "Defaults destination" })
    ).study;
    assert.equal(next.draft.audience, defaults.audience);
    assert.equal(next.draft.limit, 7);
    assert.equal(next.researchGuidelines, defaults.guidelines);
    const folder = (
      await owner("workflow/folders", "POST", { name: "Customer learning" })
    ).folder;
    s = (
      await owner(`studies/${s.id}/folder`, "PUT", {
        id: folder.id,
        version: s.version,
      })
    ).study;
    assert.equal(s.folderId, folder.id);
    const savedAudience = await owner(`studies/${s.id}/audience`, "POST", {
      name: "Recent feedback users",
      questionIds: [s.draft.questions[0].id],
      version: s.version,
    });
    assert.equal(savedAudience.status, 201);
    s = (await owner(`studies/${s.id}/publish`, "POST", { version: s.version }))
      .study;
    s = (await owner(`studies/${s.id}/fielding`, "POST", { state: "active" }))
      .study;
    const revision = s.revisionId;
    const admitted = await person(`public/${s.id}`, "POST", { consent: true }),
      interview = admitted.interview;
    const originalGuide = structuredClone(s.draft);
    const changedGuide = {
      ...s.draft,
      title: "Updated draft title",
      intro: "Changed draft introduction for a later revision.",
    };
    s = (
      await owner(`studies/${s.id}`, "PUT", {
        guide: changedGuide,
        version: s.version,
      })
    ).study;
    const hist = (await owner(`studies/${s.id}/history`)).history;
    assert.ok(
      hist.some(
        (h: any) =>
          h.action === "saved" && h.guide.title === changedGuide.title,
      ),
    );
    const restored = await owner(`studies/${s.id}/restore`, "POST", {
      version: s.version,
      id: created.id,
      source: "history",
    });
    assert.equal(restored.status, 200);
    assert.deepEqual(restored.study.draft, originalGuide);
    assert.equal(restored.study.revisionId, revision);
    assert.equal(restored.study.fielding, "active");
    assert.equal(
      (
        await owner(`studies/${s.id}/restore`, "POST", {
          version: s.version,
          id: created.id,
        })
      ).status,
      409,
    );
    s = restored.study;
    const entries = (await owner(`studies/${s.id}/history`)).history;
    assert.equal(entries[0].action, "restored");
    assert.equal(entries[0].restoredFrom, created.id);
    assert.ok(entries[0].version > s.version - 1);
    const resumed = await person(
      `interviews/${interview.id}`,
      "GET",
      undefined,
      { "x-interview-token": admitted.token },
    );
    assert.deepEqual(resumed.interview.guide, interview.guide);
    const applied = await owner(`studies/${next.id}/audience`, "PUT", {
      id: savedAudience.audience.id,
      version: next.version,
    });
    assert.equal(applied.status, 200);
    assert.equal(
      applied.study.draft.questions.length,
      next.draft.questions.length + 1,
    );
    assert.notEqual(
      applied.study.draft.questions[0].id,
      s.draft.questions[0].id,
    );
    assert.equal(
      (
        await owner(`studies/${applied.study.id}/restore`, "POST", {
          id: created.id,
          version: applied.study.version,
        })
      ).status,
      404,
    );
    assert.equal((await stranger(`studies/${s.id}/history`)).status, 404);
    const other = (
      await stranger("studies", "POST", { title: "Other workspace study" })
    ).study;
    assert.equal(
      (
        await stranger(`studies/${other.id}/audience`, "PUT", {
          id: savedAudience.audience.id,
          version: other.version,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await stranger(`studies/${other.id}/folder`, "PUT", {
          id: folder.id,
          version: other.version,
        })
      ).status,
      404,
    );
    assert.equal(
      (await stranger("workflow/folders/" + folder.id, "DELETE")).status,
      404,
    );
    assert.equal(
      (
        await stranger(
          "workflow/audiences/" + savedAudience.audience.id,
          "DELETE",
        )
      ).status,
      404,
    );
    assert.equal((await person("workflow")).status, 401);
    await owner("workflow/folders/" + folder.id, "PUT", {
      name: "Renamed folder",
    });
    assert.equal((await owner("workflow")).folders[0].name, "Renamed folder");
    await owner("workflow/folders/" + folder.id, "DELETE");
    const unfiled = (await owner(`studies/${s.id}`)).study;
    assert.equal(unfiled.folderId, null);
    assert.equal(unfiled.revisionId, revision);
    await owner("workflow/audiences/" + savedAudience.audience.id, "DELETE");
    assert.equal((await owner("workflow")).audiences.length, 0);
    assert.equal(
      (await owner(`studies/${next.id}`)).study.draft.questions.length,
      applied.study.draft.questions.length,
    );
  },
);

test(
  "saved screeners retain section routing and reject omitted dependencies",
  { timeout: 60000 },
  async () => {
    const owner = await client();
    await owner("auth/signup", "POST", {
      name: "Routing Owner",
      email: "routing-workflow@example.test",
      password: "workflow-test-password",
    });
    let s = (await owner("studies", "POST", { title: "Screening routing" }))
      .study;
    const first = s.draft.questions[0];
    const second = {
      ...structuredClone(first),
      id: "second-screener",
      text: "Which product group do you work with?",
      section: "Conditional screeners",
    };
    s.draft.questions.splice(1, 0, second);
    s.draft.sections = [
      {
        name: second.section,
        condition: { questionId: first.id, optionId: "yes" },
      },
    ];
    s = (
      await owner(`studies/${s.id}`, "PUT", {
        guide: s.draft,
        version: s.version,
      })
    ).study;
    assert.equal(
      (
        await owner(`studies/${s.id}/audience`, "POST", {
          name: "Incomplete",
          questionIds: [second.id],
          version: s.version,
        })
      ).status,
      400,
    );
    const audience = (
      await owner(`studies/${s.id}/audience`, "POST", {
        name: "Complete screening",
        questionIds: [first.id, second.id],
        version: s.version,
      })
    ).audience;
    assert.equal(audience.sections.length, 1);
    const destination = (
      await owner("studies", "POST", { title: "Screening destination" })
    ).study;
    const applied = (
      await owner(`studies/${destination.id}/audience`, "PUT", {
        id: audience.id,
        version: destination.version,
      })
    ).study;
    assert.equal(
      applied.draft.sections[0].condition.questionId,
      applied.draft.questions[0].id,
    );
    assert.equal(
      applied.draft.sections[0].name,
      applied.draft.questions[1].section,
    );
    const restored = await owner(`studies/${s.id}/publish`, "POST", {
      version: s.version,
    });
    const revisionId = restored.study.revisionId;
    const original = structuredClone(s.draft);
    const changed = await owner(`studies/${s.id}`, "PUT", {
      guide: { ...s.draft, title: "Changed title" },
      version: restored.study.version,
    });
    const restore = await owner(`studies/${s.id}/restore`, "POST", {
      id: revisionId,
      source: "revision",
      version: changed.study.version,
    });
    assert.equal(restore.status, 200);
    assert.deepEqual(restore.study.draft, original);
  },
);
