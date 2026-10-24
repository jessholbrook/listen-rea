import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { transcriptSetup } from "./library-transcript-answers-fixture";
import { client } from "./image-review-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3386 : 3385 }),
  { timeout: 90000 },
);
after(stop);
async function setup(withPeople = true) {
  const c = await transcriptSetup();
  const collection = (
    await c.owner("library/collections", "POST", {
      requestId: randomUUID(),
      title: "Synthetic feedback collection",
      interviewIds: c.imports.map((i) => i.interviewId),
      briefIds: [],
    })
  ).collection;
  const path = `library/collections/${collection.id}/handoff`;
  const input = {
    requestId: randomUUID(),
    title: "Synthetic review packet",
    summary: "MARKED_INTERNAL_REVIEW_SUMMARY",
    language: "en",
    answerIds: [],
    taskIds: [],
  };
  const d = await c.owner(path, "POST", input);
  assert.equal(d.status, 201);
  const people = [];
  for (const [name, role] of withPeople
    ? [
        ["Synthetic researcher", "researcher"],
        ["Synthetic collaborator", "collaborator"],
      ]
    : []) {
    const id = randomUUID(),
      email = id + "@example.test",
      password = "feedback-test-password";
    await c.local.db
      .prepare(
        "INSERT INTO users(id,email,name,password,workspace_id,role) VALUES(?,?,?,?,?,?)",
      )
      .run(
        id,
        email,
        name,
        c.local.passwordHash(password),
        c.actor.workspaceId,
        role,
      );
    const call = await client();
    assert.equal(
      (await call("auth/login", "POST", { email, password })).status,
      200,
    );
    people.push({ id, email, password, call });
  }
  return { ...c, collection, path, input, d, people };
}
const action = (d: any, extra: any) => ({
  id: d.packet.id,
  packetVersion: d.packet.version,
  version: d.feedback.version,
  signature: d.signature,
  ...extra,
});
const review = (d: any) => ({
  id: d.packet.id,
  version: d.packet.version,
  signature: d.signature,
  reviewed: true,
});
const edit = (d: any, extra: any) => ({
  id: d.packet.id,
  version: d.packet.version,
  title: d.packet.title,
  summary: d.packet.summary,
  language: d.packet.language,
  answerIds: d.packet.answerIds,
  taskIds: d.packet.taskIds,
  ...extra,
});
const exportPath = (c: any, d: any) =>
  c.path +
  "/export?" +
  new URLSearchParams({
    id: d.packet.id,
    version: String(d.packet.version),
    signature: d.signature,
    format: "md",
  });
test(
  "named reviewers, resolved feedback and explicit final approval gate actual exports; retries preserve decisions and reopening revokes approval",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      [a, b] = c.people;
    let d = await c.owner(c.path + "/review", "POST", review(c.d));
    const old = d;
    d = await c.owner(
      c.path + "/feedback",
      "POST",
      action(d, { op: "assign", reviewerIds: [a.id, b.id] }),
    );
    assert.equal(d.packet.canExport, false);
    assert.equal((await c.owner(exportPath(c, old))).status, 409);
    assert.equal(
      (
        await c.owner(
          c.path + "/feedback",
          "POST",
          action(d, { op: "decision", approved: true }),
        )
      ).status,
      403,
    );
    d = await a.call(
      c.path + "/feedback",
      "POST",
      action(d, {
        op: "comment",
        requestId: randomUUID(),
        body: "PRIVATE_REVIEW_COMMENT <script>alert(1)</script>",
      }),
    );
    assert.equal(
      (
        await a.call(
          c.path + "/feedback",
          "POST",
          action(d, { op: "decision", approved: true }),
        )
      ).status,
      409,
    );
    d = await c.owner(
      c.path + "/feedback",
      "POST",
      action(d, {
        op: "resolve",
        commentId: d.feedback.comments[0].id,
        resolved: true,
      }),
    );
    const vote = action(d, { op: "decision", approved: true });
    d = await a.call(c.path + "/feedback", "POST", vote);
    const stamp = d.feedback.reviewers[0].approvedAt;
    assert.ok(stamp);
    assert.equal(d.feedback.ready, false);
    assert.equal(
      (await c.owner(c.path + "/review", "POST", review(d))).status,
      409,
    );
    d = await b.call(
      c.path + "/feedback",
      "POST",
      action(d, { op: "decision", approved: true }),
    );
    assert.equal(d.feedback.ready, true);
    assert.equal(
      (await a.call(c.path + "/feedback", "POST", vote)).feedback.reviewers[0]
        .approvedAt,
      stamp,
    );
    d = await c.owner(c.path + "/review", "POST", review(d));
    assert.equal(d.packet.canExport, true);
    const output = await c.owner(exportPath(c, d));
    assert.equal(output.status, 200);
    assert.ok(
      output.bytes.toString().includes("MARKED_INTERNAL_REVIEW_SUMMARY"),
    );
    assert.equal(
      output.bytes.toString().includes("PRIVATE_REVIEW_COMMENT"),
      false,
    );
    for (const key of [
      "authorId",
      "inputHash",
      "requestId",
      "tombstones",
      "contentSignature",
      "workspaceId",
    ])
      assert.equal(JSON.stringify(d.feedback).includes(key), false, key);
    d = await c.owner(
      c.path + "/feedback",
      "POST",
      action(d, {
        op: "resolve",
        commentId: d.feedback.comments[0].id,
        resolved: false,
      }),
    );
    assert.equal(d.packet.canExport, false);
    assert.ok(d.feedback.reviewers.every((v: any) => !v.approvedAt));
  },
);
test(
  "content edits reset decisions; unavailable reviewers block export and returning users do not regain votes",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      [a, b] = c.people;
    let d = await c.owner(
      c.path + "/feedback",
      "POST",
      action(c.d, { op: "assign", reviewerIds: [a.id, b.id] }),
    );
    d = await c.owner(
      c.path + "/feedback",
      "POST",
      action(d, {
        op: "comment",
        requestId: randomUUID(),
        body: "Retained discussion",
      }),
    );
    d = await c.owner(
      c.path + "/feedback",
      "POST",
      action(d, {
        op: "resolve",
        commentId: d.feedback.comments[0].id,
        resolved: true,
      }),
    );
    for (const p of [a, b])
      d = await p.call(
        c.path + "/feedback",
        "POST",
        action(d, { op: "decision", approved: true }),
      );
    const stale = action(d, { op: "decision", approved: true });
    d = await c.owner(c.path, "PUT", edit(d, { summary: "Changed packet" }));
    assert.ok(d.feedback.reviewers.every((v: any) => !v.approvedAt));
    assert.equal(d.feedback.comments[0].body, "Retained discussion");
    assert.equal(
      (await a.call(c.path + "/feedback", "POST", stale)).status,
      409,
    );
    for (const p of [a, b])
      d = await p.call(
        c.path + "/feedback",
        "POST",
        action(d, { op: "decision", approved: true }),
      );
    d = await c.owner(c.path + "/review", "POST", review(d));
    assert.equal(d.packet.canExport, true);
    await c.local.db
      .prepare("UPDATE users SET workspace_id=? WHERE id=?")
      .run(randomUUID(), b.id);
    d = await c.owner(c.path);
    assert.equal(d.feedback.reviewers[1].available, false);
    assert.equal(d.feedback.reviewers[1].name, null);
    assert.equal(d.packet.canExport, false);
    assert.equal((await c.owner(exportPath(c, d))).status, 409);
    await c.local.db
      .prepare("UPDATE users SET workspace_id=? WHERE id=?")
      .run(c.actor.workspaceId, b.id);
    d = await c.owner(c.path);
    assert.equal(d.feedback.reviewers[1].available, true);
    assert.equal(d.feedback.reviewers[1].approvedAt, null);
    assert.equal(d.packet.canExport, false);
  },
);
test(
  "concurrent comments serialize; retries and tombstones prevent duplicates and resurrection with bounded lifetime storage",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      [a, b] = c.people;
    const first = action(c.d, {
      op: "comment",
      requestId: randomUUID(),
      body: "First private comment",
    });
    const second = action(c.d, {
      op: "comment",
      requestId: randomUUID(),
      body: "Concurrent private comment",
    });
    const results = await Promise.all([
      a.call(c.path + "/feedback", "POST", first),
      b.call(c.path + "/feedback", "POST", second),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const index = results[0].status === 200 ? 0 : 1,
      author = c.people[index],
      other = c.people[1 - index],
      input = index === 0 ? first : second;
    let d = results[index];
    assert.equal(
      (await author.call(c.path + "/feedback", "POST", input)).status,
      200,
    );
    assert.equal(
      (
        await author.call(c.path + "/feedback", "POST", {
          ...input,
          body: "Different text",
        })
      ).status,
      409,
    );
    const id = d.feedback.comments[0].id;
    assert.equal(
      (
        await other.call(
          c.path + "/feedback",
          "POST",
          action(d, { op: "delete_comment", commentId: id }),
        )
      ).status,
      403,
    );
    d = await author.call(
      c.path + "/feedback",
      "POST",
      action(d, { op: "delete_comment", commentId: id }),
    );
    assert.equal(
      (await author.call(c.path + "/feedback", "POST", input)).status,
      409,
    );
    const stored = await c.local.get<any>(
      "libraryHandoffFeedback",
      d.packet.id,
      c.actor.workspaceId,
    );
    assert.deepEqual(stored.comments, []);
    assert.match(stored.tombstones[0], /^[a-f0-9]{64}$/);
    await c.local.put("libraryHandoffFeedback", {
      ...stored,
      commentCount: 100,
    });
    d = await c.owner(c.path);
    assert.equal(d.feedback.remainingComments, 0);
    assert.equal(
      (
        await c.owner(
          c.path + "/feedback",
          "POST",
          action(d, {
            op: "comment",
            requestId: randomUUID(),
            body: "Over limit",
          }),
        )
      ).status,
      409,
    );
  },
);
test(
  "source, collection, packet and orphan cleanup erase private feedback including context added after drafting; old generations cannot write",
  { timeout: 120000 },
  async () => {
    for (const mode of [
      "source",
      "collection",
      "packet",
      "new_source",
      "orphan",
    ]) {
      const c = await setup(false);
      let d = c.d;
      let source = c.imports[0];
      if (mode === "new_source") {
        const s = (
          await c.owner("studies", "POST", {
            title: "Synthetic new feedback context",
          })
        ).study;
        const r = await c.owner("library/imports", "POST", {
          studyId: s.id,
          requestId: randomUUID(),
          externalId: randomUUID(),
          title: "Synthetic added transcript",
          transcript:
            "Interviewer: What changed?\nParticipant: New context was added for internal review.",
          permissionConfirmed: true,
          transcriptReviewed: true,
        });
        assert.equal(r.status, 201);
        source = { s, interviewId: r.interviewId, transcript: "" };
        const collection = (
          await c.owner("library/collections/" + c.collection.id)
        ).collection;
        assert.equal(
          (
            await c.owner("library/collections/" + collection.id, "PUT", {
              version: collection.version,
              title: collection.title,
              interviewIds: [...collection.interviewIds, r.interviewId],
              briefIds: collection.briefIds,
            })
          ).status,
          200,
        );
        d = await c.owner(c.path);
      }
      const late = action(d, {
        op: "comment",
        requestId: randomUUID(),
        body: "ERASE_PRIVATE_FEEDBACK",
      });
      d = await c.owner(c.path + "/feedback", "POST", late);
      assert.equal(d.status, 200, mode);
      assert.equal(
        (await c.local.list("libraryHandoffFeedback", c.actor.workspaceId))
          .length,
        1,
      );
      if (mode === "source" || mode === "new_source")
        assert.equal(
          (
            await c.owner(
              `studies/${source.s.id}/responses/${source.interviewId}`,
              "DELETE",
            )
          ).status,
          200,
        );
      if (mode === "collection")
        assert.equal(
          (
            await c.owner("library/collections/" + c.collection.id, "DELETE", {
              version: c.collection.version,
            })
          ).status,
          200,
        );
      if (mode === "packet")
        assert.equal(
          (
            await c.owner(c.path, "DELETE", {
              id: d.packet.id,
              version: d.packet.version,
            })
          ).status,
          200,
        );
      if (mode === "orphan") {
        await c.local.db
          .prepare(
            "DELETE FROM documents WHERE kind='libraryCollectionHandoff' AND id=? AND workspace_id=?",
          )
          .run(d.packet.id, c.actor.workspaceId);
        assert.equal((await c.owner(c.path)).packet, null);
      }
      assert.equal(
        (await c.local.list("libraryHandoffFeedback", c.actor.workspaceId))
          .length,
        0,
        mode,
      );
      if (mode !== "collection") {
        const replacement = await c.owner(c.path, "POST", {
          ...c.input,
          requestId: randomUUID(),
        });
        assert.equal(replacement.status, 201, mode);
        assert.equal(
          (await c.owner(c.path + "/feedback", "POST", late)).status,
          404,
          mode,
        );
      }
    }
  },
);
test(
  "feedback endpoints enforce authentication, workspace, role, current generation and strict operation fields",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      [a, b] = c.people,
      anon = await client(),
      foreign = await client();
    await foreign("auth/signup", "POST", {
      name: "Other workspace",
      email: randomUUID() + "@example.test",
      password: "foreign-feedback-password",
    });
    const valid = action(c.d, { op: "assign", reviewerIds: [a.id] });
    assert.equal((await anon(c.path + "/feedback", "POST", valid)).status, 401);
    assert.equal(
      (await foreign(c.path + "/feedback", "POST", valid)).status,
      404,
    );
    assert.equal((await c.owner(c.path + "/feedback")).status, 405);
    assert.equal(
      (await c.owner(c.path + "/feedback/unknown", "POST", valid)).status,
      404,
    );
    for (const extra of [
      { op: "assign", reviewerIds: [a.id, a.id] },
      { op: "comment", requestId: randomUUID(), body: "x".repeat(2001) },
      { op: "comment", requestId: randomUUID(), body: " " },
      { op: "decision", approved: true, userId: a.id },
      { op: "assign", reviewerIds: [], unknown: true },
    ])
      assert.equal(
        (await c.owner(c.path + "/feedback", "POST", action(c.d, extra)))
          .status,
        400,
        JSON.stringify(extra),
      );
    assert.equal(
      (await c.owner(c.path + "/feedback", "POST", { ...valid, version: 100 }))
        .status,
      409,
    );
    assert.equal(
      (
        await c.owner(c.path + "/feedback", "POST", {
          ...valid,
          signature: "0".repeat(64),
        })
      ).status,
      409,
    );
    let d = await c.owner(c.path + "/feedback", "POST", valid);
    assert.equal(
      (
        await b.call(
          c.path + "/feedback",
          "POST",
          action(d, { op: "decision", approved: true }),
        )
      ).status,
      403,
    );
    d = await a.call(
      c.path + "/feedback",
      "POST",
      action(d, {
        op: "comment",
        requestId: randomUUID(),
        body: "Authored before role change",
      }),
    );
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(a.id);
    const read = await a.call(c.path);
    assert.equal(read.feedback.comments[0].canDelete, false);
    assert.equal(
      (
        await a.call(
          c.path + "/feedback",
          "POST",
          action(read, { op: "decision", approved: true }),
        )
      ).status,
      403,
    );
    d = await c.owner(c.path);
    assert.equal(d.feedback.reviewers[0].available, false);
    assert.equal(
      (
        await c.owner(
          c.path + "/feedback",
          "POST",
          action(d, { op: "assign", reviewerIds: [a.id] }),
        )
      ).status,
      404,
    );
  },
);
