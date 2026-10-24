import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { transcriptSetup } from "./library-transcript-answers-fixture";
import { answerEdit, briefInput } from "./library-briefs-fixture";
import { client } from "./image-review-fixture";
import {
  selectActionTasks,
  defaultActionFilters,
  localCalendarDay,
  actionOverdue,
  type ActionCenter,
} from "../src/lib/research-action-center";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3380 : 3379 }),
  { timeout: 90000 },
);
after(stop);
async function setup() {
  const c = await transcriptSetup(),
    collections: any[] = [];
  for (const title of [
    "Synthetic Alpha collection",
    "Synthetic Beta collection",
  ]) {
    collections.push(
      (
        await c.owner("library/collections", "POST", {
          requestId: randomUUID(),
          title,
          interviewIds: c.imports.map((i) => i.interviewId),
          briefIds: [],
        })
      ).collection,
    );
  }
  const task = async (index: number, target: any = null, extra: any = {}) => {
    const r = await c.owner(
      `library/collections/${collections[index].id}/tasks`,
      "POST",
      {
        requestId: randomUUID(),
        title: "Synthetic research action",
        assigneeId: c.actor.id,
        dueDate: null,
        status: "open",
        target,
        ...extra,
      },
    );
    assert.equal(r.status, 201, JSON.stringify(r));
    return r.task;
  };
  return { ...c, collections, task };
}
const path = "library/action-center";
test(
  "action center combines original collection tasks with minimal current labels, direct answer scopes and no approval or duplicated task records",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      a = (await c.ask({ collectionId: c.collections[0].id })).result
        .savedAnswerId,
      b = await c.create();
    let collection = c.collections[0];
    collection = (
      await c.owner("library/collections/" + collection.id, "PUT", {
        version: collection.version,
        title: collection.title,
        interviewIds: collection.interviewIds,
        briefIds: [b.id],
      })
    ).collection;
    const tasks = [
      await c.task(0, { kind: "interview", id: c.imports[0].interviewId }),
      await c.task(0, { kind: "answer", id: a }),
      await c.task(0, { kind: "brief", id: b.id }),
      await c.task(1, null, {
        title: "Synthetic team coordination",
        assigneeId: null,
        status: "completed",
      }),
    ];
    const before = await c.local.list<any>(
      "libraryCollectionTask",
      c.actor.workspaceId,
    );
    const data = await c.owner(path);
    assert.equal(data.status, 200);
    assert.equal(data.tasks.length, 4);
    assert.equal(data.collections.length, 2);
    assert.equal(data.userId, c.actor.id);
    assert.equal(data.canEdit, true);
    assert.deepEqual(
      data.tasks.map((t: any) => t.id).sort(),
      tasks.map((t) => t.id).sort(),
    );
    assert.equal(
      data.tasks.find((t: any) => t.target?.kind === "answer").source.scope,
      "transcripts",
    );
    assert.equal(
      data.tasks.find((t: any) => t.target?.kind === "brief").source.label,
      b.title,
    );
    assert.deepEqual(Object.keys(data.collections[0]).sort(), ["id", "title"]);
    assert.deepEqual(Object.keys(data.members[0]).sort(), ["id", "name"]);
    for (const forbidden of [
      "MARKED_TRANSCRIPT_ORIGINAL",
      "APPROVED_FINDING",
      "fingerprint",
      "inputHash",
      "requestId",
      "workspaceId",
      "tokenHash",
      "email",
    ]) {
      assert.equal(JSON.stringify(data).includes(forbidden), false, forbidden);
    }
    await c.owner(path);
    assert.deepEqual(
      await c.local.list("libraryCollectionTask", c.actor.workspaceId),
      before,
    );
    assert.equal(
      (await c.owner("library/answers/" + a)).answer.history.at(-1).reviewed,
      false,
    );
    assert.equal(
      (await c.local.list("libraryCollectionReview", c.actor.workspaceId))
        .length,
      0,
    );
  },
);
test(
  "action center read is authenticated and scoped, preserves read-only permissions and refuses mutations or unknown routes",
  { timeout: 120000 },
  async () => {
    const c = await setup();
    await c.task(0);
    const anon = await client();
    assert.equal((await anon(path)).status, 401);
    const service = await import("../src/lib/research-action-center-server"),
      p = ["library", "action-center"],
      req = new Request("http://localhost/api/" + path);
    const foreign = await service.dispatchActionCenter(req, p, {
      ...c.actor,
      workspaceId: randomUUID(),
    });
    const data = await foreign!.json();
    assert.deepEqual(data.tasks, []);
    assert.deepEqual(data.collections, []);
    assert.deepEqual(data.members, []);
    const reader = await service.dispatchActionCenter(req, p, {
      ...c.actor,
      role: "viewer" as any,
    });
    assert.equal((await reader!.json()).canEdit, false);
    for (const method of ["POST", "PUT", "DELETE"])
      assert.equal((await c.owner(path, method, {})).status, 405);
    assert.equal((await c.owner(path + "/other")).status, 404);
  },
);
test(
  "source correction, legacy exclusion, collection deletion and deleted request replay cannot leave task text in the action center",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      answerId = (await c.ask({ collectionId: c.collections[0].id })).result
        .savedAnswerId;
    await c.task(
      0,
      { kind: "answer", id: answerId },
      { title: "MARKED_REMOVED_ANSWER_TASK" },
    );
    await c.task(
      0,
      { kind: "interview", id: c.imports[0].interviewId },
      { title: "MARKED_REMOVED_SOURCE_TASK" },
    );
    await c.task(1, null, { title: "Team coordination remains" });
    const globalId = (await c.ask()).result.savedAnswerId;
    let globalAnswer = (await c.owner("library/answers/" + globalId)).answer;
    globalAnswer = (
      await c.owner(
        "library/answers/" + globalId,
        "PUT",
        answerEdit(globalAnswer),
      )
    ).answer;
    const globalBrief = (
      await c.owner("library/briefs", "POST", {
        ...briefInput([globalAnswer]),
        requestId: randomUUID(),
      })
    ).brief;
    const linked = c.collections[0];
    await c.owner("library/collections/" + linked.id, "PUT", {
      version: linked.version,
      title: linked.title,
      interviewIds: linked.interviewIds,
      briefIds: [globalBrief.id],
    });
    await c.task(
      0,
      { kind: "brief", id: globalBrief.id },
      { title: "MARKED_REMOVED_GLOBAL_BRIEF_TASK" },
    );
    const i = await c.local.get<any>(
      "interview",
      c.imports[0].interviewId,
      c.actor.workspaceId,
    );
    // Bypass normal source hooks to prove read-time current-answer validation.
    await c.local.db
      .prepare(
        "UPDATE documents SET data=? WHERE kind='interview' AND id=? AND workspace_id=?",
      )
      .run(
        JSON.stringify({
          ...i,
          turns: i.turns.map((t: any) => ({
            ...t,
            answer: t.answer + " SYNTHETIC_CHANGED",
          })),
        }),
        i.id,
        c.actor.workspaceId,
      );
    let data = await c.owner(path);
    assert.equal(data.tasks.length, 2);
    assert.equal(
      JSON.stringify(data).includes("MARKED_REMOVED_GLOBAL_BRIEF_TASK"),
      false,
    );
    assert.equal(
      JSON.stringify(data).includes("MARKED_REMOVED_ANSWER_TASK"),
      false,
    );
    await c.local.db
      .prepare(
        "UPDATE documents SET data=json_set(data,'$.excluded',1) WHERE kind='interview' AND id=? AND workspace_id=?",
      )
      .run(i.id, c.actor.workspaceId);
    data = await c.owner(path);
    assert.equal(data.tasks.length, 1);
    assert.equal(
      JSON.stringify(data).includes("MARKED_REMOVED_SOURCE_TASK"),
      false,
    );
    const collection = (
      await c.owner("library/collections/" + c.collections[1].id)
    ).collection;
    await c.owner("library/collections/" + collection.id, "DELETE", {
      version: collection.version,
    });
    data = await c.owner(path);
    assert.equal(data.tasks.length, 0);
    assert.equal(
      JSON.stringify(data).includes("Team coordination remains"),
      false,
    );
    assert.equal(
      (await c.local.list("libraryCollectionTask", c.actor.workspaceId)).length,
      0,
    );
  },
);
test(
  "action center changes update original task versions and removed assignees are cleared before projection",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      t = await c.task(0),
      taskPath = `library/collections/${t.collectionId}/tasks/${t.id}`;
    let current = (await c.owner(path)).tasks[0];
    const content = {
      version: current.version,
      title: current.title,
      assigneeId: current.assigneeId,
      dueDate: "2028-01-01",
      status: "completed",
    };
    assert.equal((await c.owner(taskPath, "PUT", content)).status, 200);
    current = (await c.owner(path)).tasks[0];
    assert.equal(current.version, t.version + 1);
    assert.ok(current.completedAt);
    assert.equal(
      (await c.owner(taskPath, "PUT", { ...content, status: "in_progress" }))
        .status,
      409,
    );
    const member = randomUUID();
    await c.local.db
      .prepare(
        "INSERT INTO users(id,email,name,password,workspace_id,role) VALUES(?,?,?,?,?,?)",
      )
      .run(
        member,
        member + "@example.test",
        "Synthetic assignee",
        "unused",
        c.actor.workspaceId,
        "collaborator",
      );
    const assigned = await c.task(1, null, { assigneeId: member });
    await c.local.db.prepare("DELETE FROM users WHERE id=?").run(member);
    current = (await c.owner(path)).tasks.find(
      (t: any) => t.id === assigned.id,
    );
    assert.equal(current.assigneeId, null);
    assert.equal(current.version, assigned.version + 1);
  },
);
test("action filters intersect collection, assignee, state, title and due windows with deterministic priority and completed/undated rules", () => {
  const rows = [
    {
      id: "later",
      collectionId: "a",
      assigneeId: "me",
      status: "open",
      title: "Review invoices",
      dueDate: "2028-03-02",
    },
    {
      id: "today",
      collectionId: "b",
      assigneeId: "me",
      status: "in_progress",
      title: "Review draft",
      dueDate: "2028-02-29",
    },
    {
      id: "late",
      collectionId: "a",
      assigneeId: null,
      status: "open",
      title: "Review draft",
      dueDate: "2028-02-28",
    },
    {
      id: "done",
      collectionId: "a",
      assigneeId: "me",
      status: "completed",
      title: "Review draft",
      dueDate: "2028-01-01",
    },
    {
      id: "undated",
      collectionId: "b",
      assigneeId: null,
      status: "open",
      title: "Coordination",
      dueDate: null,
    },
    {
      id: "end",
      collectionId: "a",
      assigneeId: "other",
      status: "open",
      title: "Review",
      dueDate: "2028-03-07",
    },
  ].map((t) => ({ ...t, createdAt: "2028-01-01", source: null }));
  const data = { tasks: rows, userId: "me" } as unknown as ActionCenter,
    select = (extra: any = {}) =>
      selectActionTasks(
        data,
        { ...defaultActionFilters, ...extra },
        "2028-02-29",
      ).map((t) => t.id);
  assert.deepEqual(select(), ["late", "today", "later", "end", "undated"]);
  assert.deepEqual(select({ due: "today" }), ["today"]);
  assert.deepEqual(select({ due: "week" }), ["today", "later"]);
  assert.deepEqual(select({ due: "overdue", status: "all" }), ["late"]);
  assert.deepEqual(select({ due: "undated" }), ["undated"]);
  assert.deepEqual(
    select({ assignee: "mine", collectionId: "a", query: " INVOICES " }),
    ["later"],
  );
  assert.deepEqual(select({ assignee: "unassigned" }), ["late", "undated"]);
  assert.deepEqual(select({ status: "completed" }), ["done"]);
  assert.deepEqual(select({ status: "completed", due: "overdue" }), []);
  assert.equal(actionOverdue(rows[3] as any, "2028-02-29"), false);
});
test("calendar-day priorities respect local midnight and seven calendar days across daylight-saving changes", () => {
  const old = process.env.TZ;
  try {
    process.env.TZ = "America/Los_Angeles";
    assert.equal(
      localCalendarDay(new Date("2026-11-01T06:30:00Z")),
      "2026-10-31",
    );
    assert.equal(
      localCalendarDay(new Date("2026-11-01T08:30:00Z")),
      "2026-11-01",
    );
    const tasks = ["2026-11-01", "2026-11-07", "2026-11-08"].map(
      (dueDate, n) => ({
        id: String(n),
        dueDate,
        status: "open",
        title: "Test",
        createdAt: "2026-01-01",
      }),
    );
    const data = { tasks, userId: "me" } as unknown as ActionCenter;
    assert.deepEqual(
      selectActionTasks(
        data,
        { ...defaultActionFilters, due: "week" },
        "2026-11-01",
      ).map((t) => t.id),
      ["0", "1"],
    );
  } finally {
    if (old === undefined) delete process.env.TZ;
    else process.env.TZ = old;
  }
});
