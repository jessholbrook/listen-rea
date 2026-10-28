import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { client } from "./image-review-fixture";
import { answerEdit } from "./library-briefs-fixture";
import {
  inboxSetup,
  feedbackAction,
  finalReview,
  packetEdit,
} from "./team-review-inbox-fixture";
import {
  selectInboxPackets,
  defaultInboxFilters,
  inboxLabels,
  type ReviewInbox,
  type InboxPacket,
} from "../src/lib/team-review-inbox";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3389 : 3388 }),
  { timeout: 90000 },
);
after(stop);
const path = "library/review-inbox";
test(
  "review inbox projects current packet/reviewer states and counts without private text or approval side effects",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(),
      a = await c.create("Synthetic Alpha", [c.actor.id, c.person.id]),
      b = await c.create("Synthetic Beta", [c.person.id]),
      empty = await c.create("Synthetic unassigned");
    let d = await c.owner(
      a.path + "/feedback",
      "POST",
      feedbackAction(a.d, {
        op: "comment",
        requestId: randomUUID(),
        body: "PRIVATE_INBOX_COMMENT",
      }),
    );
    let inbox = await c.owner(path);
    assert.equal(inbox.status, 200);
    assert.equal(inbox.packets.length, 3);
    assert.equal(inbox.userId, c.actor.id);
    let p = inbox.packets.find((p: any) => p.id === d.packet.id);
    assert.equal(p.state, "blocked");
    assert.equal(p.openComments, 1);
    assert.equal(p.reviewers.length, 2);
    assert.equal(
      inbox.packets.find((p: any) => p.id === empty.d.packet.id).state,
      "ready",
    );
    assert.equal(
      inbox.packets.find((p: any) => p.id === b.d.packet.id).state,
      "awaiting",
    );
    for (const key of [
      "PRIVATE_INBOX",
      "workspaceId",
      "inputHash",
      "requestId",
      "signature",
      "summary",
      "preview",
      "comments",
      "authorId",
      "transcript",
      "password",
      "email",
      "decisions",
      "tombstones",
    ])
      assert.equal(JSON.stringify(inbox).includes(key), false, key);
    assert.equal(
      (await c.local.list("libraryCollectionReview", c.actor.workspaceId))
        .length,
      0,
    );
    const stored = await c.local.get<any>(
      "libraryHandoffFeedback",
      d.packet.id,
      c.actor.workspaceId,
    );
    await c.owner(path);
    assert.deepEqual(
      await c.local.get(
        "libraryHandoffFeedback",
        d.packet.id,
        c.actor.workspaceId,
      ),
      stored,
    );
    d = await c.owner(
      a.path + "/feedback",
      "POST",
      feedbackAction(d, {
        op: "resolve",
        commentId: d.feedback.comments[0].id,
        resolved: true,
      }),
    );
    for (const actor of [c.owner, c.person.call])
      d = await actor(
        a.path + "/feedback",
        "POST",
        feedbackAction(d, { op: "decision", approved: true }),
      );
    assert.equal(
      (await c.owner(path)).packets.find((p: any) => p.id === d.packet.id)
        .state,
      "ready",
    );
    d = await c.owner(a.path + "/review", "POST", finalReview(d));
    assert.equal(
      (await c.owner(path)).packets.find((p: any) => p.id === d.packet.id)
        .state,
      "exported",
    );
    d = await c.owner(
      a.path + "/feedback",
      "POST",
      feedbackAction(d, {
        op: "resolve",
        commentId: d.feedback.comments[0].id,
        resolved: false,
      }),
    );
    inbox = await c.owner(path);
    p = inbox.packets.find((p: any) => p.id === d.packet.id);
    assert.equal(p.state, "blocked");
    assert.ok(p.reviewers.every((r: any) => !r.approvedAt));
  },
);
test(
  "inbox authentication, foreign isolation, read-only routing and lost reviewer access use current membership without reviving votes",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(),
      g = await c.create("Synthetic access", [c.person.id]),
      anon = await client(),
      foreign = await client();
    assert.equal((await anon(path)).status, 401);
    await foreign("auth/signup", "POST", {
      name: "Other inbox",
      email: randomUUID() + "@example.test",
      password: "foreign-inbox-password",
    });
    const isolated = await foreign(path);
    assert.deepEqual(isolated.packets, []);
    assert.deepEqual(isolated.collections, []);
    for (const method of ["POST", "PUT", "DELETE"])
      assert.equal((await c.owner(path, method, {})).status, 405);
    assert.equal((await c.owner(path + "/anything")).status, 404);
    let d = await c.person.call(
      g.path + "/feedback",
      "POST",
      feedbackAction(g.d, { op: "decision", approved: true }),
    );
    d = await c.owner(g.path + "/review", "POST", finalReview(d));
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.person.id);
    let inbox = await c.person.call(path),
      p = inbox.packets[0];
    assert.equal(inbox.status, 200);
    assert.equal(p.state, "blocked");
    assert.equal(p.reviewers[0].name, null);
    assert.equal(p.reviewers[0].available, false);
    assert.equal(p.reviewers[0].approvedAt, null);
    await c.local.db
      .prepare("UPDATE users SET role='researcher',workspace_id=? WHERE id=?")
      .run(randomUUID(), c.person.id);
    inbox = await c.owner(path);
    assert.equal(inbox.packets[0].reviewers[0].name, null);
    await c.local.db
      .prepare("UPDATE users SET workspace_id=? WHERE id=?")
      .run(c.actor.workspaceId, c.person.id);
    inbox = await c.owner(path);
    p = inbox.packets[0];
    assert.equal(p.state, "awaiting");
    assert.equal(p.reviewers[0].approvedAt, null);
  },
);
test(
  "inbox revalidates task eligibility, packet edits and raw research drift before exposing an export or reviewer approval",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(false),
      g = await c.create("Synthetic drift", [c.actor.id]);
    const asked = await c.ask({ collectionId: g.collection.id });
    let answer = (
      await c.owner("library/answers/" + asked.result.savedAnswerId)
    ).answer;
    answer = (
      await c.owner("library/answers/" + answer.id, "PUT", answerEdit(answer))
    ).answer;
    const task = (
      await c.owner(`library/collections/${g.collection.id}/tasks`, "POST", {
        requestId: randomUUID(),
        title: "Synthetic selected task",
        assigneeId: c.actor.id,
        dueDate: null,
        status: "open",
        target: null,
      })
    ).task;
    let d = await c.owner(g.path);
    d = await c.owner(
      g.path,
      "PUT",
      packetEdit(d, { answerIds: [answer.id], taskIds: [task.id] }),
    );
    d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(d, { op: "decision", approved: true }),
    );
    d = await c.owner(g.path + "/review", "POST", finalReview(d));
    const stamp = d.feedback.reviewers[0].approvedAt;
    assert.equal(
      (await c.owner(path)).packets[0].reviewers[0].approvedAt,
      stamp,
    );
    await c.owner(
      `library/collections/${g.collection.id}/tasks/${task.id}`,
      "PUT",
      {
        version: task.version,
        title: task.title,
        assigneeId: task.assigneeId,
        dueDate: task.dueDate,
        status: "completed",
      },
    );
    let inbox = await c.owner(path);
    assert.equal(inbox.packets[0].state, "blocked");
    assert.equal(inbox.packets[0].reviewers[0].approvedAt, null);
    d = await c.owner(g.path);
    d = await c.owner(g.path, "PUT", packetEdit(d, { taskIds: [] }));
    assert.equal((await c.owner(path)).packets[0].state, "awaiting");
    const i = await c.local.get<any>(
      "interview",
      c.imports[0].interviewId,
      c.actor.workspaceId,
    );
    await c.local.db
      .prepare(
        "UPDATE documents SET data=? WHERE kind='interview' AND id=? AND workspace_id=?",
      )
      .run(
        JSON.stringify({
          ...i,
          version: i.version + 1,
          turns: i.turns.map((t: any) => ({
            ...t,
            answer: t.answer + " MARKED_RAW_INBOX_CORRECTION",
          })),
        }),
        i.id,
        c.actor.workspaceId,
      );
    inbox = await c.owner(path);
    assert.deepEqual(inbox.packets, []);
    assert.equal(
      (await c.local.list("libraryHandoffFeedback", c.actor.workspaceId))
        .length,
      0,
    );
  },
);
test(
  "inbox drops source/collection/packet deletions and prunes orphan feedback without storing a second queue",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(false);
    for (const mode of ["collection", "packet", "orphan", "source"]) {
      const g = await c.create("Synthetic erasure " + mode, [c.actor.id]);
      const d = await c.owner(
        g.path + "/feedback",
        "POST",
        feedbackAction(g.d, {
          op: "comment",
          requestId: randomUUID(),
          body: "ERASE_INBOX_PRIVATE_COMMENT",
        }),
      );
      assert.equal((await c.owner(path)).packets.length, 1);
      if (mode === "source")
        await c.owner(
          `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
          "DELETE",
        );
      if (mode === "collection")
        await c.owner("library/collections/" + g.collection.id, "DELETE", {
          version: g.collection.version,
        });
      if (mode === "packet")
        await c.owner(g.path, "DELETE", {
          id: d.packet.id,
          version: d.packet.version,
        });
      if (mode === "orphan")
        await c.local.db
          .prepare(
            "DELETE FROM documents WHERE kind='libraryCollectionHandoff' AND id=? AND workspace_id=?",
          )
          .run(d.packet.id, c.actor.workspaceId);
      assert.deepEqual((await c.owner(path)).packets, []);
      assert.equal(
        (await c.local.list("libraryHandoffFeedback", c.actor.workspaceId))
          .length,
        0,
      );
    }
    assert.equal(
      Number(
        (
          await c.local.db
            .prepare(
              "SELECT COUNT(*) AS n FROM documents WHERE workspace_id=? AND kind LIKE '%Inbox%'",
            )
            .get(c.actor.workspaceId)
        )?.n,
      ),
      0,
    );
  },
);
test("review filters intersect without widening missing scopes; personal decisions and packet state stay distinct with deterministic priority ordering", () => {
  const make = (
    id: string,
    state: InboxPacket["state"],
    reviewers: any[],
    extra: any = {},
  ): InboxPacket => ({
    id,
    collectionId: "c1",
    collectionTitle: "Équipe Alpha",
    title: "Draft packet",
    version: 1,
    updatedAt: "2026-10-22T12:00:00Z",
    openComments: 0,
    state,
    reviewers,
    ...extra,
  });
  const me = { id: "me", name: "Me", available: true, approvedAt: null },
    other = { ...me, id: "other" };
  const data: ReviewInbox = {
    userId: "me",
    members: [],
    collections: [],
    packets: [
      make("z", "exported", [{ ...me, approvedAt: "stamp" }]),
      make("c", "ready", []),
      make("a", "awaiting", [me]),
      make("b", "blocked", [{ ...other, name: null, available: false }], {
        collectionId: "c2",
      }),
      make("d", "awaiting", [{ ...me, approvedAt: "stamp" }, other]),
    ],
  };
  const select = (extra: any = {}) =>
    selectInboxPackets(data, { ...defaultInboxFilters, ...extra }).map(
      (p) => p.id,
    );
  assert.deepEqual(select(), ["a"]);
  assert.deepEqual(select({ reviewer: "", decision: "all" }), [
    "b",
    "a",
    "d",
    "c",
    "z",
  ]);
  assert.deepEqual(select({ decision: "approved" }), ["d", "z"]);
  assert.deepEqual(
    select({
      reviewer: "other",
      decision: "pending",
      collectionId: "c2",
      state: "blocked",
      query: " ÉQUIPE ",
    }),
    ["b"],
  );
  assert.deepEqual(select({ reviewer: "unassigned", decision: "all" }), ["c"]);
  assert.deepEqual(select({ reviewer: "unassigned" }), []);
  assert.deepEqual(select({ collectionId: "removed" }), []);
  assert.deepEqual(select({ reviewer: "removed", decision: "all" }), []);
  assert.deepEqual(select({ query: "nonmatching" }), []);
  for (const lang of ["es", "fr"] as const)
    assert.deepEqual(
      Object.keys(inboxLabels[lang]).sort(),
      Object.keys(inboxLabels.en).sort(),
    );
});
