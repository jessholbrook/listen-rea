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
  selectInboxPackets,
  defaultInboxFilters,
  inboxNextDeadline,
  type ReviewInbox,
  type InboxPacket,
} from "../src/lib/team-review-inbox";
import {
  reviewOverdue,
  reviewDueMatches,
  deadlineLabels,
} from "../src/lib/review-deadlines";
import { localCalendarDay } from "../src/lib/research-action-center";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3392 : 3391 }),
  { timeout: 90000 },
);
after(stop);
const inbox = "library/review-inbox";
test(
  "review dates preserve current content decisions, final approval and exports; exact retries and concurrent date edits respect the review version",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(),
      g = await c.create("Synthetic scheduled review", [
        c.actor.id,
        c.person.id,
      ]);
    let d = g.d;
    for (const call of [c.owner, c.person.call])
      d = await call(
        g.path + "/feedback",
        "POST",
        feedbackAction(d, { op: "decision", approved: true }),
      );
    d = await c.owner(g.path + "/review", "POST", finalReview(d));
    const original = d,
      request = feedbackAction(d, {
        op: "deadline",
        reviewerId: c.actor.id,
        dueDate: "2028-02-29",
      });
    d = await c.owner(g.path + "/feedback", "POST", request);
    assert.equal(d.status, 200);
    assert.equal(d.feedback.reviewers[0].dueDate, "2028-02-29");
    assert.equal(d.signature, original.signature);
    assert.equal(d.packet.version, original.packet.version);
    assert.equal(d.packet.updatedAt, original.packet.updatedAt);
    assert.equal(d.packet.reviewedAt, original.packet.reviewedAt);
    assert.equal(d.packet.canExport, true);
    assert.deepEqual(
      d.feedback.reviewers.map((r: any) => r.approvedAt),
      original.feedback.reviewers.map((r: any) => r.approvedAt),
    );
    assert.equal(
      (await c.owner(g.path + "/feedback", "POST", request)).feedback.version,
      d.feedback.version,
    );
    const result = await Promise.all([
      c.owner(
        g.path + "/feedback",
        "POST",
        feedbackAction(d, {
          op: "deadline",
          reviewerId: c.actor.id,
          dueDate: "2028-03-01",
        }),
      ),
      c.person.call(
        g.path + "/feedback",
        "POST",
        feedbackAction(d, {
          op: "deadline",
          reviewerId: c.person.id,
          dueDate: "2028-03-02",
        }),
      ),
    ]);
    assert.deepEqual(result.map((r) => r.status).sort(), [200, 409]);
    d = await c.owner(g.path);
    assert.equal(d.packet.canExport, true);
    assert.equal(
      (
        await c.owner(g.path + "/feedback", "POST", {
          ...request,
          dueDate: "2029-01-01",
        })
      ).status,
      409,
    );
    const queue = await c.owner(inbox);
    assert.equal(queue.packets[0].state, "exported");
    assert.ok(queue.packets[0].reviewers.some((r: any) => r.dueDate));
    for (const format of ["md", "csv"]) {
      const output = await c.owner(
        g.path +
          "/export?" +
          new URLSearchParams({
            id: d.packet.id,
            version: String(d.packet.version),
            signature: d.signature,
            format,
          }),
      );
      assert.equal(output.status, 200);
      assert.equal(/2028-0[23]-/.test(output.bytes.toString()), false);
    }
    d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(d, {
        op: "deadline",
        reviewerId: c.actor.id,
        dueDate: null,
      }),
    );
    assert.equal(d.feedback.reviewers[0].dueDate, null);
    assert.equal(d.packet.canExport, true);
  },
);
test(
  "deadline mutations require an editor, current requested reviewer, strict dates, current generation/signature and bounded fields",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(),
      g = await c.create("Synthetic date boundaries", [c.person.id]),
      anon = await client(),
      foreign = await client();
    await foreign("auth/signup", "POST", {
      name: "Foreign date editor",
      email: randomUUID() + "@example.test",
      password: "foreign-dates-password",
    });
    const request = feedbackAction(g.d, {
      op: "deadline",
      reviewerId: c.person.id,
      dueDate: "2028-02-29",
    });
    assert.equal(
      (await anon(g.path + "/feedback", "POST", request)).status,
      401,
    );
    assert.equal(
      (await foreign(g.path + "/feedback", "POST", request)).status,
      404,
    );
    for (const dueDate of [
      "2027-02-29",
      "2028-02-30",
      "1900-01-01",
      "2101-01-01",
      "2028-2-29",
      "2028-02-29T00:00:00Z",
      "",
      123,
    ])
      assert.equal(
        (await c.owner(g.path + "/feedback", "POST", { ...request, dueDate }))
          .status,
        400,
        String(dueDate),
      );
    assert.equal(
      (
        await c.owner(g.path + "/feedback", "POST", {
          ...request,
          reviewerId: c.actor.id,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await c.owner(g.path + "/feedback", "POST", {
          ...request,
          unknown: true,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await c.owner(g.path + "/feedback", "POST", {
          ...request,
          signature: "0".repeat(64),
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await c.owner(g.path + "/feedback", "POST", {
          ...request,
          version: 999,
        })
      ).status,
      409,
    );
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.person.id);
    assert.equal(
      (await c.person.call(g.path + "/feedback", "POST", request)).status,
      403,
    );
    let d = await c.owner(g.path);
    d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(d, {
        op: "deadline",
        reviewerId: c.person.id,
        dueDate: "2100-12-31",
      }),
    );
    assert.equal(d.status, 200);
    assert.equal(d.feedback.reviewers[0].available, false);
    assert.equal(d.feedback.ready, false);
    d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(d, {
        op: "deadline",
        reviewerId: c.person.id,
        dueDate: "2000-01-01",
      }),
    );
    assert.equal(d.status, 200);
  },
);
test(
  "content changes retain planned dates but revoke decisions; removing/readding a reviewer drops their date and old scheduled writes cannot affect replacements",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(false),
      g = await c.create("Synthetic deadline lifetime", [c.actor.id]);
    let d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(g.d, {
        op: "deadline",
        reviewerId: c.actor.id,
        dueDate: "2028-02-29",
      }),
    );
    d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(d, { op: "decision", approved: true }),
    );
    d = await c.owner(g.path + "/review", "POST", finalReview(d));
    d = await c.owner(
      g.path,
      "PUT",
      packetEdit(d, { summary: "Changed scheduled review content" }),
    );
    assert.equal(d.feedback.reviewers[0].dueDate, "2028-02-29");
    assert.equal(d.feedback.reviewers[0].approvedAt, null);
    assert.equal(d.packet.canExport, false);
    d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(d, { op: "assign", reviewerIds: [] }),
    );
    d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(d, { op: "assign", reviewerIds: [c.actor.id] }),
    );
    assert.equal(d.feedback.reviewers[0].dueDate, null);
    const late = feedbackAction(d, {
      op: "deadline",
      reviewerId: c.actor.id,
      dueDate: "2028-03-01",
    });
    await c.owner(g.path, "DELETE", {
      id: d.packet.id,
      version: d.packet.version,
    });
    assert.equal(
      (await c.local.list("libraryHandoffFeedback", c.actor.workspaceId))
        .length,
      0,
    );
    const replacement = await c.owner(g.path, "POST", {
      requestId: randomUUID(),
      title: "Synthetic new generation",
      summary: "Replacement packet",
      language: "en",
      answerIds: [],
      taskIds: [],
    });
    assert.equal(replacement.status, 201);
    assert.equal(
      (await c.owner(g.path + "/feedback", "POST", late)).status,
      404,
    );
  },
);
test(
  "source/collection deletion and orphan pruning erase dates with their owning review without separate scheduling records",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(false);
    for (const mode of ["collection", "orphan", "source"]) {
      const g = await c.create("Synthetic scheduled erasure " + mode, [
        c.actor.id,
      ]);
      const d = await c.owner(
        g.path + "/feedback",
        "POST",
        feedbackAction(g.d, {
          op: "deadline",
          reviewerId: c.actor.id,
          dueDate: "2028-02-29",
        }),
      );
      assert.equal(d.status, 200);
      if (mode === "collection")
        await c.owner("library/collections/" + g.collection.id, "DELETE", {
          version: g.collection.version,
        });
      if (mode === "orphan")
        await c.local.db
          .prepare(
            "DELETE FROM documents WHERE kind='libraryCollectionHandoff' AND id=? AND workspace_id=?",
          )
          .run(d.packet.id, c.actor.workspaceId);
      if (mode === "source")
        await c.owner(
          `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
          "DELETE",
        );
      assert.deepEqual((await c.owner(inbox)).packets, []);
      assert.equal(
        (await c.local.list("libraryHandoffFeedback", c.actor.workspaceId))
          .length,
        0,
      );
    }
  },
);
test("deadline filters bind reviewer, decision and date to the same pending request and prioritize its earliest deadline before packet status", () => {
  const r = (
    id: string,
    dueDate: string | null,
    approvedAt: string | null = null,
  ) => ({ id, name: id, available: true, approvedAt, dueDate });
  const p = (
    id: string,
    reviewers: any[],
    state: InboxPacket["state"] = "awaiting",
  ): InboxPacket => ({
    id,
    collectionId: "c",
    collectionTitle: "Alpha",
    title: "Packet " + id,
    updatedAt: "2028-02-28T00:00:00Z",
    version: 1,
    openComments: 0,
    state,
    reviewers,
  });
  const data: ReviewInbox = {
    userId: "me",
    members: [],
    collections: [],
    packets: [
      p("a", [r("me", null)], "blocked"),
      p("b", [r("me", "2028-02-29")]),
      p("c", [r("me", "2028-02-27")]),
      p("d", [r("me", "2028-02-28")]),
      p("e", [r("me", "2028-02-26", "approved"), r("other", "2028-02-27")]),
      p("f", []),
      p("g", [r("me", "2028-03-06")]),
    ],
  };
  const select = (extra: any = {}) =>
    selectInboxPackets(
      data,
      { ...defaultInboxFilters, ...extra },
      "2028-02-28",
    ).map((p) => p.id);
  assert.deepEqual(select(), ["c", "d", "b", "g", "a"]);
  assert.deepEqual(select({ due: "overdue" }), ["c"]);
  assert.deepEqual(select({ due: "today" }), ["d"]);
  assert.deepEqual(select({ due: "week" }), ["d", "b"]);
  assert.deepEqual(select({ due: "undated" }), ["a"]);
  assert.deepEqual(
    select({ reviewer: "", decision: "approved", due: "overdue" }),
    [],
  );
  assert.deepEqual(select({ reviewer: "other", due: "overdue" }), ["e"]);
  assert.deepEqual(
    select({ reviewer: "unassigned", decision: "all", due: "undated" }),
    [],
  );
  assert.equal(
    inboxNextDeadline(
      data.packets[4],
      data,
      { ...defaultInboxFilters, decision: "all" },
      "2028-02-28",
    ),
    null,
  );
  assert.equal(reviewOverdue(r("me", "2028-02-28"), "2028-02-28"), false);
  assert.equal(
    reviewOverdue(r("me", "2028-02-27", "approved"), "2028-02-28"),
    false,
  );
});
test("calendar deadline windows handle local midnight, leap days and seven calendar days across daylight-saving changes", () => {
  const old = process.env.TZ;
  try {
    process.env.TZ = "America/Los_Angeles";
    assert.equal(
      localCalendarDay(new Date("2028-03-12T07:59:59Z")),
      "2028-03-11",
    );
    assert.equal(
      localCalendarDay(new Date("2028-03-12T08:00:00Z")),
      "2028-03-12",
    );
    for (const [today, inside, outside] of [
      ["2028-03-10", "2028-03-16", "2028-03-17"],
      ["2028-11-03", "2028-11-09", "2028-11-10"],
      ["2028-02-28", "2028-03-05", "2028-03-06"],
      ["2028-12-28", "2029-01-03", "2029-01-04"],
    ]) {
      assert.equal(
        reviewDueMatches({ approvedAt: null, dueDate: inside }, "week", today),
        true,
      );
      assert.equal(
        reviewDueMatches({ approvedAt: null, dueDate: outside }, "week", today),
        false,
      );
    }
    for (const lang of ["es", "fr"] as const)
      assert.deepEqual(
        Object.keys(deadlineLabels[lang]).sort(),
        Object.keys(deadlineLabels.en).sort(),
      );
  } finally {
    if (old === undefined) delete process.env.TZ;
    else process.env.TZ = old;
  }
});
