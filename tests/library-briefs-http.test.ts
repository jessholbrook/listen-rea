import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { client } from "./image-review-fixture";
import {
  briefSetup,
  briefRoot,
  answerRoot,
  briefInput,
  briefUpdate,
  answerEdit,
} from "./library-briefs-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3353 : 3352 }),
  { timeout: 90000 },
);
after(stop);
test(
  "briefs compose pinned approved answers without source copies, enforce review and export exact typed evidence with latest-only provenance",
  { timeout: 120000 },
  async () => {
    const c = await briefSetup(),
      input = { ...briefInput(c.answers), requestId: randomUUID() },
      r = await c.owner(briefRoot, "POST", input);
    assert.equal(r.status, 201);
    let b = r.brief;
    const path = briefRoot + "/" + b.id;
    assert.equal((await c.owner(briefRoot, "POST", input)).brief.id, b.id);
    assert.equal(
      (await c.owner(briefRoot, "POST", { ...input, title: "Different" }))
        .status,
      409,
    );
    assert.equal(b.current, true);
    assert.equal(b.canExport, false);
    assert.equal(b.sections.length, 2);
    const stored = await c.local.get<any>(
      "libraryBrief",
      b.id,
      c.actor.workspaceId,
    );
    assert.ok(stored.dependencies.length);
    for (const hidden of [
      "APPROVED_FINDING_",
      "Save draft",
      "SYNTHETIC_ORIGINAL_INTERPRETATION",
      "PRIVATE_PARTICIPANT_ANSWER",
    ])
      assert.equal(JSON.stringify(stored).includes(hidden), false);
    assert.equal(
      JSON.stringify(b).includes("SYNTHETIC_ORIGINAL_INTERPRETATION"),
      false,
    );
    assert.equal("dependencies" in b, false);
    assert.equal((await c.owner(path + "/export")).status, 409);
    assert.equal(
      (await c.owner(path, "PUT", briefUpdate(b, { includeInExports: true })))
        .status,
      400,
    );
    b = (
      await c.owner(
        path,
        "PUT",
        briefUpdate(b, { reviewed: true, includeInExports: true }),
      )
    ).brief;
    assert.equal(b.version, 2);
    assert.equal(b.updatedBy.id, c.actor.id);
    for (const format of ["md", "csv"]) {
      const out = await c.owner(path + "/export?format=" + format);
      assert.equal(out.status, 200);
      const text = out.bytes.toString();
      assert.ok(
        text.includes("APPROVED_FINDING_0") &&
          text.includes("APPROVED_FINDING_1"),
      );
      assert.ok(text.includes("?study="));
      assert.ok(text.includes(c.answers[0].sources[0].text));
      assert.ok(text.includes("Researcher commentary 2"));
      for (const privateText of [
        "SYNTHETIC_ORIGINAL_INTERPRETATION",
        "PRIVATE_PARTICIPANT_ANSWER",
        "workspaceId",
      ])
        assert.equal(text.includes(privateText), false);
      if (format === "csv") assert.ok(text.includes("'=Researcher summary"));
    }
    const oldVersion = b.version;
    const updates = await Promise.all([
      c.owner(path, "PUT", briefUpdate(b, { title: "Edited first" })),
      c.owner(path, "PUT", briefUpdate(b, { title: "Edited second" })),
    ]);
    assert.deepEqual(updates.map((r) => r.status).sort(), [200, 409]);
    b = (await c.owner(path)).brief;
    assert.equal(b.version, oldVersion + 1);
    assert.equal((await c.owner(path + "/export")).status, 409);
    assert.equal(
      (await c.owner(path, "DELETE", { version: oldVersion })).status,
      409,
    );
    assert.equal(
      (await c.owner(path, "DELETE", { version: b.version })).status,
      200,
    );
    assert.equal((await c.owner(path)).status, 404);
  },
);
test(
  "changed or unapproved answer revisions block brief exports and hide stale text until an explicit refresh/review, while answer deletion erases briefs",
  { timeout: 120000 },
  async () => {
    const c = await briefSetup();
    let b = await c.create(),
      path = briefRoot + "/" + b.id;
    b = (
      await c.owner(
        path,
        "PUT",
        briefUpdate(b, { reviewed: true, includeInExports: true }),
      )
    ).brief;
    let a = c.answers[0];
    a = (
      await c.owner(
        answerRoot + "/" + a.id,
        "PUT",
        answerEdit(a, { answer: "NEW_APPROVED_INTERPRETATION" }),
      )
    ).answer;
    let view = (await c.owner(path)).brief;
    assert.equal(view.current, false);
    assert.equal(view.canExport, false);
    assert.equal(view.reviewed, false);
    assert.equal(view.sections[0].state, "changed");
    assert.equal(view.sections[0].answer, undefined);
    assert.equal((await c.owner(path + "/export?format=csv")).status, 409);
    assert.equal(
      (
        await c.owner(
          path,
          "PUT",
          briefUpdate(view, { reviewed: true, includeInExports: true }),
        )
      ).status,
      409,
    );
    b = (
      await c.owner(
        path,
        "PUT",
        briefUpdate(view, {
          sections: view.sections.map((s: any) => ({
            answerId: s.answerId,
            answerVersion:
              s.answerId === a.id ? a.history.at(-1).version : s.answerVersion,
            heading: s.heading,
            commentary: s.commentary,
          })),
        }),
      )
    ).brief;
    assert.equal(b.current, true);
    assert.equal(b.canExport, false);
    assert.equal(
      b.sections[0].answer.revision.answer,
      "NEW_APPROVED_INTERPRETATION",
    );
    b = (
      await c.owner(
        path,
        "PUT",
        briefUpdate(b, { reviewed: true, includeInExports: true }),
      )
    ).brief;
    a = (
      await c.owner(
        answerRoot + "/" + a.id,
        "PUT",
        answerEdit(a, { includeInExports: false }),
      )
    ).answer;
    view = (await c.owner(path)).brief;
    assert.equal(view.sections[0].state, "unapproved");
    assert.equal(view.sections[0].answer, undefined);
    assert.equal((await c.owner(path + "/export")).status, 409);
    assert.equal(
      (
        await c.owner(answerRoot + "/" + a.id, "DELETE", {
          version: a.history.at(-1).version,
        })
      ).status,
      200,
    );
    assert.equal(
      await c.local.get("libraryBrief", b.id, c.actor.workspaceId),
      undefined,
    );
    assert.equal((await c.owner(path)).status, 404);
  },
);
test(
  "source withdrawal and erasure remove complete briefs, including researcher commentary and uncited generation dependencies; direct drift is revalidated",
  { timeout: 120000 },
  async () => {
    const c = await briefSetup();
    let b = await c.create();
    // The saved draft used passages and observations; retain only one citation at review.
    let a = c.answers[0];
    a = (
      await c.owner(
        answerRoot + "/" + a.id,
        "PUT",
        answerEdit(a, {
          citations: [
            a.history
              .at(-1)
              .citations.find(
                (x: any) =>
                  a.sources.find((h: any) => h.id === x.evidenceId)?.kind ===
                  "passage",
              ),
          ],
        }),
      )
    ).answer;
    b = (
      await c.owner(
        briefRoot + "/" + b.id,
        "PUT",
        briefUpdate(b, {
          sections: [
            {
              answerId: a.id,
              answerVersion: a.history.at(-1).version,
              heading: "Only cited passage",
              commentary: "PRIVATE_DEPENDENT_COMMENTARY",
            },
          ],
        }),
      )
    ).brief;
    const f = c.fixtures[0];
    await c.owner(f.asset + "/review", "PUT", {
      ...f.review,
      version: 1,
      includeInReports: false,
    });
    assert.equal(
      await c.local.get("libraryBrief", b.id, c.actor.workspaceId),
      undefined,
    );
    assert.equal(
      (await c.owner(briefRoot + "/" + b.id + "/export")).status,
      404,
    );
    const one = await c.create({
      sections: [briefInput([c.answers[1]]).sections[0]],
    });
    const interview = await c.local.get<any>(
      "interview",
      c.fixtures[1].r.interview.id,
      c.actor.workspaceId,
    );
    interview.attributes = { drift: "new" };
    await c.local.db
      .prepare("UPDATE documents SET data=? WHERE kind='interview' AND id=?")
      .run(JSON.stringify(interview), interview.id);
    assert.equal((await c.owner(briefRoot + "/" + one.id)).status, 404);
    assert.equal(
      await c.local.get("libraryBrief", one.id, c.actor.workspaceId),
      undefined,
    );
  },
);
test(
  "briefs honor workspace, viewer and public boundaries, reject forged fields, duplicate answers and excess bounds without partial writes",
  { timeout: 120000 },
  async () => {
    const c = await briefSetup(),
      b = await c.create(),
      path = briefRoot + "/" + b.id,
      anon = await client(),
      stranger = await client();
    assert.equal((await anon(briefRoot)).status, 401);
    await stranger("auth/signup", "POST", {
      name: "Other workspace",
      email: randomUUID() + "@example.test",
      password: "other-workspace-password",
    });
    assert.equal((await stranger(path)).status, 404);
    assert.equal(
      (
        await stranger(briefRoot, "POST", {
          ...briefInput(c.answers),
          requestId: randomUUID(),
        })
      ).status,
      404,
    );
    const email = randomUUID() + "@example.test",
      viewer = await client();
    await viewer("auth/signup", "POST", {
      name: "Brief viewer",
      email,
      password: "viewer-password",
    });
    await c.local.db
      .prepare("UPDATE users SET workspace_id=?,role='viewer' WHERE email=?")
      .run(c.actor.workspaceId, email);
    assert.equal((await viewer(path)).status, 200);
    assert.equal(
      (
        await viewer(briefRoot, "POST", {
          ...briefInput(c.answers),
          requestId: randomUUID(),
        })
      ).status,
      403,
    );
    assert.equal((await viewer(path, "PUT", briefUpdate(b))).status, 403);
    assert.equal(
      (await viewer(path, "DELETE", { version: b.version })).status,
      403,
    );
    for (const extra of [
      {
        sections: [
          briefInput(c.answers).sections[0],
          briefInput(c.answers).sections[0],
        ],
      },
      { sources: [] },
      { reviewed: true },
      { summary: "x".repeat(8001) },
      { sections: [] },
    ])
      assert.equal(
        (
          await c.owner(briefRoot, "POST", {
            ...briefInput(c.answers),
            requestId: randomUUID(),
            ...extra,
          })
        ).status,
        400,
      );
    assert.equal((await c.owner(briefRoot)).briefs.length, 1);
    const a = c.answers[1];
    await c.owner(
      answerRoot + "/" + a.id,
      "PUT",
      answerEdit(a, { reviewed: false, includeInExports: false }),
    );
    assert.equal(
      (
        await c.owner(briefRoot, "POST", {
          ...briefInput(c.answers),
          requestId: randomUUID(),
        })
      ).status,
      409,
    );
  },
);
test(
  "removed sections retain erasure dependencies for free-text commentary and response retention removes the complete brief",
  { timeout: 120000 },
  async () => {
    const c = await briefSetup();
    let b = await c.create();
    const path = briefRoot + "/" + b.id;
    b = (
      await c.owner(
        path,
        "PUT",
        briefUpdate(b, {
          summary: "Still derived from the removed first answer",
          sections: [briefInput([c.answers[1]]).sections[0]],
        }),
      )
    ).brief;
    const stored = await c.local.get<any>(
      "libraryBrief",
      b.id,
      c.actor.workspaceId,
    );
    assert.equal(stored.answerDependencies.length, 2);
    assert.equal("answerDependencies" in b, false);
    const a = c.answers[0];
    await c.owner(answerRoot + "/" + a.id, "DELETE", {
      version: a.history.at(-1).version,
    });
    assert.equal(
      await c.local.get("libraryBrief", b.id, c.actor.workspaceId),
      undefined,
    );
    const second = await c.create({
      sections: briefInput([c.answers[1]]).sections,
    });
    const i = await c.local.get<any>(
      "interview",
      c.fixtures[1].r.interview.id,
      c.actor.workspaceId,
    );
    i.createdAt = new Date(Date.now() - 365 * 86400000).toISOString();
    await c.local.db
      .prepare("UPDATE documents SET data=? WHERE kind='interview' AND id=?")
      .run(JSON.stringify(i), i.id);
    await (await import("../src/lib/features")).retention();
    assert.equal(
      await c.local.get("libraryBrief", second.id, c.actor.workspaceId),
      undefined,
    );
  },
);
