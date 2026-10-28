import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { client } from "./image-review-fixture";
import {
  inboxSetup,
  feedbackAction,
  finalReview,
  packetEdit,
} from "./team-review-inbox-fixture";
import {
  workloadSetup,
  planningPath,
  reassign,
} from "./review-workload-fixture";
import { activityLabels } from "../src/lib/review-activity";
before(() => start({ port: 3402 }), { timeout: 90000 });
after(stop);
const path = "library/review-activity";
const query = (v: Record<string, string>) =>
  path + "?" + new URLSearchParams(v);
const forPacket = (c: any, g: any) =>
  c.owner(query({ packetId: g.d.packet.id }));
test(
  "successful actions record transactional attribution and coordination changes; retries/conflicts/read refreshes do not duplicate user activity",
  { timeout: 120000 },
  async () => {
    const c = await workloadSetup(),
      g = await c.create("History coordination", [c.actor.id, c.person.id]);
    let d = g.d;
    const run = async (extra: any, call = c.owner) => {
      d = await call(g.path + "/feedback", "POST", feedbackAction(d, extra));
      assert.equal(d.status, 200);
      return d;
    };
    const log = () => forPacket(c, g);
    let r = await log();
    assert.deepEqual(
      r.events.map((v: any) => v.action),
      ["assign", "packet_created"],
    );
    const deadline = feedbackAction(d, {
      op: "deadline",
      reviewerId: c.person.id,
      dueDate: "2028-03-01",
    });
    d = await c.owner(g.path + "/feedback", "POST", deadline);
    const count = (await log()).total;
    assert.equal(
      (await c.owner(g.path + "/feedback", "POST", deadline)).reused,
      true,
    );
    assert.equal((await log()).total, count);
    await run({ op: "decision", approved: true });
    const p = (await c.owner(planningPath(g))).planning;
    d = await c.owner(
      g.path + "/feedback",
      "POST",
      reassign(p, c.person.id, c.replacement.id),
    );
    assert.equal(d.status, 200);
    r = await log();
    const moved = r.events.find((v: any) => v.action === "reassign");
    assert.equal(moved.actor.id, c.actor.id);
    assert.equal(moved.after[1].id, c.replacement.id);
    assert.equal(moved.after[1].dueDate, "2028-03-01");
    assert.deepEqual(
      moved.clearedReviewers.map((v: any) => v.id),
      [c.actor.id],
    );
    const requestId = randomUUID();
    await run({ op: "comment", requestId, body: "PRIVATE_HISTORY_COMMENT" });
    const comment = d.feedback.comments[0];
    await run({ op: "resolve", commentId: comment.id, resolved: true });
    await run({ op: "decision", approved: true });
    await run({ op: "decision", approved: true }, c.replacement.call);
    d = await c.owner(g.path + "/review", "POST", finalReview(d));
    assert.ok(d.packet.reviewedAt);
    await run({
      op: "deadline",
      reviewerId: c.replacement.id,
      dueDate: "2028-03-02",
    });
    r = await log();
    assert.equal(r.events[0].action, "deadline");
    assert.equal(r.events[0].finalApprovalReset, false);
    assert.deepEqual(r.events[0].clearedReviewers, []);
    await run({ op: "resolve", commentId: comment.id, resolved: false });
    r = await log();
    assert.equal(r.events[0].action, "comment_reopened");
    assert.equal(r.events[0].finalApprovalReset, true);
    assert.equal(r.events[0].clearedReviewers.length, 2);
    await run({ op: "delete_comment", commentId: comment.id });
    r = await log();
    assert.equal(r.events[0].action, "comment_deleted");
    const oldCount = r.total;
    assert.equal(
      (
        await c.owner(
          g.path + "/feedback",
          "POST",
          feedbackAction(d, {
            op: "comment",
            requestId,
            body: "PRIVATE_HISTORY_COMMENT",
          }),
        )
      ).status,
      409,
    );
    assert.equal((await log()).total, oldCount);
    const stored = await c.local.get<any>(
      "libraryReviewActivity",
      d.packet.id,
      c.actor.workspaceId,
    );
    assert.ok(stored.events.every((v: any) => v.sequence > 0));
    assert.equal(JSON.stringify(stored).includes("PRIVATE_"), false);
    assert.equal(JSON.stringify(stored).includes(c.person.name), false);
    for (const word of [
      "PRIVATE_",
      "summary",
      "transcript",
      "body",
      "email",
      "password",
      "workspaceId",
      "inputHash",
      "contentSignature",
      "requestId",
    ])
      assert.equal(JSON.stringify(r).includes(word), false, word);
    assert.deepEqual(await log(), r); // no logging from a stable read
  },
);
test(
  "plans including batch application and final approval actions are recorded once without copying template names or changing exports",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(false),
      g = await c.create("Plan history"),
      p = (
        await c.owner("library/review-plans", "POST", {
          name: "PRIVATE_HISTORY_TEMPLATE_NAME",
          reviewers: [{ id: c.actor.id, days: 0 }],
        })
      ).plan;
    let d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(g.d, {
        op: "plan",
        planId: p.id,
        planVersion: 1,
        start: "2028-03-01",
        acknowledged: true,
      }),
    );
    d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(d, { op: "decision", approved: true }),
    );
    const approved = finalReview(d);
    d = await c.owner(g.path + "/review", "POST", approved);
    const count = (await forPacket(c, g)).total;
    assert.equal(
      (await c.owner(g.path + "/review", "POST", approved)).reused,
      true,
    );
    assert.equal((await forPacket(c, g)).total, count);
    d = await c.owner(g.path + "/review", "POST", {
      ...finalReview(d),
      reviewed: false,
    });
    assert.equal((await forPacket(c, g)).events[0].action, "final_withdrawn");
    const preview = await c.owner("library/review-plan-batch/preview", "POST", {
      planId: p.id,
      planVersion: 1,
      start: "2028-03-02",
      packets: [{ id: d.packet.id, collectionId: g.collection.id }],
    });
    const item = preview.packets[0];
    await c.owner("library/review-plan-batch/apply", "POST", {
      planId: p.id,
      planVersion: 1,
      start: "2028-03-02",
      acknowledged: true,
      packets: [
        {
          id: item.id,
          collectionId: item.collectionId,
          packetVersion: item.packetVersion,
          version: item.version,
          signature: item.signature,
        },
      ],
    });
    const r = await forPacket(c, g);
    assert.equal(r.events[0].action, "plan");
    assert.equal(r.events[0].after[0].dueDate, "2028-03-02");
    assert.equal(r.events.filter((v: any) => v.action === "plan").length, 2);
    assert.equal(JSON.stringify(r).includes("PRIVATE_"), false);
    d = await c.owner(g.path);
    d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(d, { op: "decision", approved: true }),
    );
    d = await c.owner(g.path + "/review", "POST", finalReview(d));
    assert.equal(d.packet.canExport, true);
    const out = await c.owner(
      g.path +
        "/export?" +
        new URLSearchParams({
          id: d.packet.id,
          version: String(d.packet.version),
          signature: d.signature,
          format: "md",
        }),
    );
    assert.equal(out.status, 200);
    assert.equal(out.bytes.toString().includes("Review activity"), false);
  },
);
test(
  "automatic context invalidations are system actions with affected decisions, while packet edits retain only coordination facts",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(),
      g = await c.create("Invalidation history", [c.actor.id, c.person.id]);
    let d = g.d;
    for (const call of [c.owner, c.person.call])
      d = await call(
        g.path + "/feedback",
        "POST",
        feedbackAction(d, { op: "decision", approved: true }),
      );
    d = await c.owner(g.path + "/review", "POST", finalReview(d));
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.person.id);
    let r = await forPacket(c, g),
      event = r.events[0];
    assert.equal(event.action, "review_invalidated");
    assert.equal(event.actor, null);
    assert.equal(event.finalApprovalReset, true);
    assert.deepEqual(
      event.clearedReviewers.map((v: any) => v.id),
      [c.person.id],
    );
    assert.equal((await forPacket(c, g)).total, r.total);
    await c.local.db
      .prepare("UPDATE users SET workspace_id=? WHERE id=?")
      .run(randomUUID(), c.person.id);
    r = await forPacket(c, g);
    assert.equal(
      r.events.find((v: any) => v.id === event.id).clearedReviewers[0].name,
      null,
    );
    d = await c.owner(g.path);
    d = await c.owner(
      g.path,
      "PUT",
      packetEdit(d, { summary: "PRIVATE_NEW_PACKET_RESEARCH" }),
    );
    assert.equal(d.status, 200);
    r = await forPacket(c, g);
    assert.ok(
      r.events.some(
        (v: any) => v.action === "packet_edited" && v.actor.id === c.actor.id,
      ),
    );
    assert.equal(r.events[0].action, "review_invalidated");
    assert.equal(JSON.stringify(r).includes("PRIVATE_"), false);
  },
);
test(
  "history is authenticated workspace-private and read-only, and displays current names and packet titles without stale copies",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(),
      g = await c.create("Current title history", [c.person.id]),
      anon = await client(),
      foreign = await client();
    assert.equal((await anon(path)).status, 401);
    await foreign("auth/signup", "POST", {
      name: "Foreign history",
      email: randomUUID() + "@example.test",
      password: "foreign-history-password",
    });
    assert.deepEqual((await foreign(path)).events, []);
    assert.equal((await foreign(query({ packetId: g.d.packet.id }))).total, 0);
    assert.equal((await c.owner(path, "POST", {})).status, 405);
    assert.equal((await c.owner(path + "/extra")).status, 404);
    assert.equal((await c.owner(path + "?extra=1")).status, 400);
    assert.equal((await c.owner(path + "?page=0&page=1")).status, 400);
    await c.local.db
      .prepare(
        "UPDATE users SET name='Current history reviewer',role='viewer' WHERE id=?",
      )
      .run(c.person.id);
    const d = await c.owner(
      g.path,
      "PUT",
      packetEdit(g.d, { title: "Current renamed packet" }),
    );
    assert.equal(d.status, 200);
    const r = await c.person.call(query({ packetId: d.packet.id }));
    assert.equal(r.status, 200);
    assert.ok(
      r.events.every((v: any) => v.packet.title === "Current renamed packet"),
    );
    assert.ok(
      r.events.some((v: any) =>
        v.after?.some((p: any) => p.name === "Current history reviewer"),
      ),
    );
    assert.equal(JSON.stringify(r).includes(g.d.packet.title), false);
    assert.equal(JSON.stringify(r).includes(c.person.name), false);
    for (const l of Object.values(activityLabels))
      assert.deepEqual(Object.keys(l), Object.keys(activityLabels.en));
  },
);
test(
  "server filters intersect actors/participants/actions/packet/local dates, retain unavailable selections, paginate and validate dates and zones",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(),
      g = await c.create("Filtered activity", [c.person.id]),
      other = await c.create("Other history"),
      record = await c.local.get<any>(
        "libraryReviewActivity",
        g.d.packet.id,
        c.actor.workspaceId,
      ),
      event = record.events.at(-1);
    const events = Array.from({ length: 25 }, (_, n) => ({
      ...event,
      id: randomUUID(),
      sequence: n + 1,
      at: n === 0 ? "2028-03-01T00:30:00.000Z" : "2028-03-01T20:00:00.000Z",
    }));
    await c.local.put("libraryReviewActivity", {
      ...record,
      events,
      omitted: 7,
    });
    let r = await c.owner(
      query({
        packetId: g.d.packet.id,
        personId: c.person.id,
        action: "assign",
        from: "2028-03-01",
        to: "2028-03-01",
        timeZone: "America/Los_Angeles",
      }),
    );
    assert.equal(r.total, 24);
    assert.equal(r.events.length, 20);
    assert.equal(r.pages, 2);
    assert.equal(r.omitted, 7);
    r = await c.owner(
      query({
        packetId: g.d.packet.id,
        personId: c.person.id,
        action: "assign",
        from: "2028-02-29",
        to: "2028-02-29",
        timeZone: "America/Los_Angeles",
      }),
    );
    assert.equal(r.total, 1);
    r = await c.owner(query({ packetId: g.d.packet.id, page: "999" }));
    assert.equal(r.page, 1);
    assert.equal(r.events.length, 5);
    for (const values of [
      { from: "2027-02-29" },
      { from: "2028-03-02", to: "2028-03-01" },
      { timeZone: "No/Zone" },
      { action: "injected" },
      { page: "-1" },
    ] as Record<string, string>[])
      assert.equal((await c.owner(query(values))).status, 400);
    assert.equal((await c.owner(query({ packetId: randomUUID() }))).total, 0);
    assert.equal(
      (
        await c.owner(
          query({ packetId: other.d.packet.id, personId: c.person.id }),
        )
      ).total,
      0,
    );
    assert.equal((await c.owner(query({ personId: "system" }))).total, 0);
  },
);
test(
  "history keeps a bounded recent window and source/packet/collection/orphan erasure removes it without restoring old generations",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(false),
      g = await c.create("Bounded history", [c.actor.id]);
    let d = g.d;
    for (let n = 0; n < 105; n++) {
      d = await c.owner(
        g.path + "/feedback",
        "POST",
        feedbackAction(d, {
          op: "deadline",
          reviewerId: c.actor.id,
          dueDate: n % 2 ? null : "2028-03-01",
        }),
      );
      assert.equal(d.status, 200);
    }
    const stored = await c.local.get<any>(
      "libraryReviewActivity",
      g.d.packet.id,
      c.actor.workspaceId,
    );
    assert.equal(stored.events.length, 100);
    assert.equal(stored.omitted, 7);
    assert.equal(stored.events.at(-1).sequence, 107);
    assert.ok(JSON.stringify(stored).length <= 200000);
    await c.owner(g.path, "DELETE", {
      id: d.packet.id,
      version: d.packet.version,
    });
    assert.equal(
      await c.local.get<any>(
        "libraryReviewActivity",
        d.packet.id,
        c.actor.workspaceId,
      ),
      undefined,
    );
    const replacement = await c.owner(g.path, "POST", {
      requestId: randomUUID(),
      title: "New history generation",
      summary: "PRIVATE_REPLACEMENT",
      language: "en",
      answerIds: [],
      taskIds: [],
    });
    assert.equal(replacement.status, 201);
    assert.equal((await c.owner(query({ packetId: g.d.packet.id }))).total, 0);
    await c.owner(
      `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
      "DELETE",
    );
    assert.equal((await c.owner(path)).total, 0);
    assert.equal(
      await c.local.get<any>(
        "libraryReviewActivity",
        replacement.packet.id,
        c.actor.workspaceId,
      ),
      undefined,
    );
    await c.local.put("libraryReviewActivity", { ...stored, id: randomUUID() });
    assert.equal((await c.owner(path)).total, 0);
    assert.equal(
      (await c.local.list("libraryReviewActivity", c.actor.workspaceId)).length,
      0,
    );
  },
);
test(
  "existing packets are not backfilled, and concurrent writes and rejected operations record exactly the committed changes",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(false),
      g = await c.create("Existing packet history", [c.actor.id]);
    await c.local.db
      .prepare(
        "DELETE FROM documents WHERE kind='libraryReviewActivity' AND id=? AND workspace_id=?",
      )
      .run(g.d.packet.id, c.actor.workspaceId);
    assert.equal((await forPacket(c, g)).total, 0);
    assert.equal((await c.owner(g.path)).packet.id, g.d.packet.id);
    assert.equal((await forPacket(c, g)).total, 0);
    assert.equal(
      (
        await c.owner(
          g.path + "/feedback",
          "POST",
          feedbackAction(g.d, { op: "assign", reviewerIds: [c.actor.id] }),
        )
      ).reused,
      true,
    );
    assert.equal((await forPacket(c, g)).total, 0);
    const calls = await Promise.all(
      ["2028-03-01", "2028-03-02"].map((dueDate) =>
        c.owner(
          g.path + "/feedback",
          "POST",
          feedbackAction(g.d, {
            op: "deadline",
            reviewerId: c.actor.id,
            dueDate,
          }),
        ),
      ),
    );
    assert.deepEqual(calls.map((v) => v.status).sort(), [200, 409]);
    let r = await forPacket(c, g);
    assert.equal(r.total, 1);
    assert.equal(r.events[0].action, "deadline");
    assert.equal(r.events[0].sequence, 1);
    const d = await c.owner(g.path);
    assert.equal(
      (
        await c.owner(
          g.path + "/feedback",
          "POST",
          feedbackAction(d, {
            op: "plan",
            planId: randomUUID(),
            planVersion: 1,
            start: "2028-03-01",
            acknowledged: true,
          }),
        )
      ).status,
      404,
    );
    assert.equal((await forPacket(c, g)).total, 1);
    const current = (await c.owner("library/collections/" + g.collection.id))
      .collection;
    await c.owner("library/collections/" + g.collection.id, "DELETE", {
      version: current.version,
    });
    r = await c.owner(path);
    assert.equal(r.total, 0);
    assert.equal(
      await c.local.get(
        "libraryReviewActivity",
        d.packet.id,
        c.actor.workspaceId,
      ),
      undefined,
    );
  },
);
