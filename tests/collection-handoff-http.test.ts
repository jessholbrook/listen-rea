import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { transcriptSetup } from "./library-transcript-answers-fixture";
import { answerEdit } from "./library-briefs-fixture";
import { client } from "./image-review-fixture";
import { handoffLabels } from "../src/lib/collection-handoff";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3383 : 3382 }),
  { timeout: 90000 },
);
after(stop);
async function setup() {
  const c = await transcriptSetup();
  const collection = (
    await c.owner("library/collections", "POST", {
      requestId: randomUUID(),
      title: "Synthetic handoff collection",
      interviewIds: c.imports.map((i) => i.interviewId),
      briefIds: [],
    })
  ).collection;
  const asked = await c.ask({ collectionId: collection.id });
  let answer = (await c.owner("library/answers/" + asked.result.savedAnswerId))
    .answer;
  answer = (
    await c.owner(
      "library/answers/" + answer.id,
      "PUT",
      answerEdit(answer, { answer: "RESEARCHER_APPROVED_HANDOFF" }),
    )
  ).answer;
  const task = (
    await c.owner(`library/collections/${collection.id}/tasks`, "POST", {
      requestId: randomUUID(),
      title: "Synthetic open follow-up",
      assigneeId: c.actor.id,
      dueDate: "2028-02-29",
      status: "open",
      target: { kind: "interview", id: c.imports[0].interviewId },
    })
  ).task;
  const input = {
    requestId: randomUUID(),
    title: "=Synthetic handoff packet",
    summary: "MARKED_HANDOFF_SUMMARY",
    language: "en",
    answerIds: [answer.id],
    taskIds: [task.id],
  };
  return {
    ...c,
    collection,
    answer,
    task,
    input,
    path: `library/collections/${collection.id}/handoff`,
  };
}
const edit = (d: any, extra: any = {}) => ({
  id: d.packet.id,
  version: d.packet.version,
  title: d.packet.title,
  summary: d.packet.summary,
  language: d.packet.language,
  answerIds: d.packet.answerIds,
  taskIds: d.packet.taskIds,
  ...extra,
});
const review = (d: any, extra: any = {}) => ({
  id: d.packet.id,
  version: d.packet.version,
  signature: d.signature,
  reviewed: true,
  ...extra,
});
const exportPath = (c: any, d: any, format = "md") =>
  c.path +
  "/export?" +
  new URLSearchParams({
    id: d.packet.id,
    version: String(d.packet.version),
    signature: d.signature,
    format,
  });
const taskEdit = (t: any, extra: any = {}) => ({
  version: t.version,
  title: t.title,
  assigneeId: t.assigneeId,
  dueDate: t.dueDate,
  status: t.status,
  ...extra,
});
const collectionEdit = (c: any, extra: any = {}) => ({
  version: c.version,
  title: c.title,
  interviewIds: c.interviewIds,
  briefIds: c.briefIds,
  ...extra,
});
test(
  "packets create idempotently, require explicit current approval, export approved cited findings and open follow-ups with safe CSV and localized labels",
  { timeout: 120000 },
  async () => {
    const c = await setup();
    assert.equal((await c.owner(c.path)).packet, null);
    let d = await c.owner(c.path, "POST", c.input);
    assert.equal(d.status, 201);
    assert.equal(d.packet.canExport, false);
    assert.equal(d.packet.reviewedAt, null);
    assert.equal((await c.owner(exportPath(c, d))).status, 409);
    assert.equal(
      (await c.owner(c.path, "POST", c.input)).packet.id,
      d.packet.id,
    );
    assert.equal(
      (
        await c.owner(c.path, "POST", {
          ...c.input,
          summary: "Different request",
        })
      ).status,
      409,
    );
    for (const key of [
      "workspaceId",
      "requestId",
      "inputHash",
      "approvedSignature",
      "memberInterviewIds",
      "answerDependencies",
      "taskDependencies",
    ])
      assert.equal(JSON.stringify(d).includes(key), false, key);
    assert.equal(d.preview.includes("RESEARCHER_APPROVED_HANDOFF"), true);
    assert.equal(d.preview.includes("MARKED_TRANSCRIPT_ORIGINAL"), false);
    assert.equal(d.preview.includes(c.task.title), true);
    assert.equal(
      (
        await c.owner(
          c.path + "/review",
          "POST",
          review(d, { signature: "0".repeat(64) }),
        )
      ).status,
      409,
    );
    const original = review(d);
    d = await c.owner(c.path + "/review", "POST", original);
    assert.equal(d.packet.canExport, true);
    const stamp = d.packet.reviewedAt;
    assert.ok(stamp);
    assert.equal(
      (await c.owner(c.path + "/review", "POST", original)).packet.reviewedAt,
      stamp,
    );
    let r = await c.owner(exportPath(c, d));
    assert.equal(r.status, 200);
    let text = r.bytes.toString();
    assert.ok(text.includes(c.answer.id));
    assert.ok(text.includes(c.imports[0].interviewId));
    assert.ok(text.includes("RESEARCHER_APPROVED_HANDOFF"));
    assert.ok(text.includes(c.task.title));
    assert.ok(text.includes(`/api/library/answers/${c.answer.id}`));
    assert.equal(text.includes("MARKED_TRANSCRIPT_ORIGINAL"), false);
    r = await c.owner(exportPath(c, d, "csv"));
    assert.equal(r.status, 200);
    assert.ok(r.bytes.toString().includes('"\'=Synthetic handoff packet"'));
    assert.ok(r.bytes.toString().includes('"follow_up"'));
    assert.ok(r.bytes.toString().includes("2028-02-29"));
    for (const language of ["es", "fr"] as const) {
      d = await c.owner(c.path, "PUT", edit(d, { language }));
      assert.equal(d.packet.canExport, false);
      d = await c.owner(c.path + "/review", "POST", review(d));
      r = await c.owner(exportPath(c, d));
      assert.ok(r.bytes.toString().includes(handoffLabels[language].summary));
      assert.ok(r.bytes.toString().includes(handoffLabels[language].warning));
    }
  },
);
test(
  "packet edits, approval withdrawal, task progress and changing research reject stale exports/attestations; removed selections retain erasure dependencies and generations block ABA writes",
  { timeout: 120000 },
  async () => {
    const c = await setup();
    let d = await c.owner(c.path, "POST", c.input);
    d = await c.owner(c.path + "/review", "POST", review(d));
    const approved = d;
    const [a, b] = await Promise.all([
      c.owner(c.path, "PUT", edit(d, { summary: "Concurrent Alpha" })),
      c.owner(c.path, "PUT", edit(d, { summary: "Concurrent Beta" })),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    d = a.packet ? a : b;
    assert.equal(d.packet.canExport, false);
    assert.equal((await c.owner(exportPath(c, approved))).status, 409);
    d = await c.owner(c.path + "/review", "POST", review(d));
    d = await c.owner(
      c.path + "/review",
      "POST",
      review(d, { reviewed: false }),
    );
    assert.equal(d.packet.canExport, false);
    d = await c.owner(c.path + "/review", "POST", review(d));
    let t = (
      await c.owner(
        `library/collections/${c.collection.id}/tasks/${c.task.id}`,
        "PUT",
        taskEdit(c.task, { status: "completed" }),
      )
    ).task;
    assert.equal((await c.owner(exportPath(c, d))).status, 409);
    assert.equal(
      (await c.owner(c.path + "/review", "POST", review(d))).status,
      409,
    );
    d = await c.owner(c.path);
    assert.equal(d.packet.canExport, false);
    assert.equal(
      (await c.owner(c.path + "/review", "POST", review(d))).status,
      409,
    );
    d = await c.owner(c.path, "PUT", edit(d, { taskIds: [] }));
    d = await c.owner(c.path + "/review", "POST", review(d));
    assert.equal(d.packet.canExport, true);
    await c.owner(
      `library/collections/${c.collection.id}/tasks/${t.id}`,
      "DELETE",
      { version: t.version },
    );
    assert.equal((await c.owner(c.path)).packet, null);
    assert.equal((await c.owner(c.path, "POST", c.input)).status, 409);
    const fresh = await c.owner(c.path, "POST", {
      ...c.input,
      requestId: randomUUID(),
      taskIds: [],
    });
    assert.notEqual(fresh.packet.id, d.packet.id);
    assert.equal((await c.owner(c.path, "PUT", edit(d))).status, 404);
    assert.equal((await c.owner(exportPath(c, d))).status, 404);
    const tombs = await c.local.list<any>(
      "libraryCollectionHandoffTombstone",
      c.actor.workspaceId,
    );
    assert.ok(tombs.length);
    assert.deepEqual(Object.keys(tombs[0]).sort(), [
      "createdAt",
      "id",
      "workspaceId",
    ]);
  },
);
test(
  "captured source/answer/brief removal erases whole summary packets, including deselected and unselected research; raw stale sources are cleaned before rejecting exports",
  { timeout: 120000 },
  async () => {
    for (const mode of [
      "raw_source",
      "membership",
      "unselected_answer",
      "global_brief",
    ]) {
      const c = await setup();
      let collection = c.collection;
      let unselected: any, brief: any;
      if (mode === "unselected_answer")
        unselected = (await c.ask({ collectionId: collection.id })).result
          .savedAnswerId;
      if (mode === "global_brief") {
        brief = await c.create();
        collection = (
          await c.owner(
            "library/collections/" + collection.id,
            "PUT",
            collectionEdit(collection, { briefIds: [brief.id] }),
          )
        ).collection;
      }
      let d = await c.owner(c.path, "POST", c.input);
      d = await c.owner(c.path + "/review", "POST", review(d));
      if (mode === "raw_source") {
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
              turns: i.turns.map((t: any) => ({
                ...t,
                answer: t.answer + " SYNTHETIC_WITHDRAWAL",
              })),
            }),
            i.id,
            c.actor.workspaceId,
          );
        assert.equal((await c.owner(exportPath(c, d))).status, 404);
      }
      if (mode === "membership")
        await c.owner(
          "library/collections/" + collection.id,
          "PUT",
          collectionEdit(collection, {
            interviewIds: [c.imports[1].interviewId],
          }),
        );
      if (mode === "unselected_answer") {
        const a = (await c.owner("library/answers/" + unselected)).answer;
        await c.owner("library/answers/" + unselected, "DELETE", {
          version: a.history.at(-1).version,
        });
      }
      if (mode === "global_brief") {
        const f = c.fixtures[0];
        await c.owner(
          `studies/${f.s.id}/responses/${f.r.interview.id}`,
          "DELETE",
        );
      }
      assert.equal((await c.owner(c.path)).packet, null, mode);
      const stored = await c.local.list<any>(
        "libraryCollectionHandoff",
        c.actor.workspaceId,
      );
      assert.equal(
        JSON.stringify(stored).includes("MARKED_HANDOFF_SUMMARY"),
        false,
        mode,
      );
      assert.equal((await c.owner(c.path, "POST", c.input)).status, 409, mode);
    }
  },
);
test(
  "handoff permissions, eligible collection selections, strict shapes, future versions and routes reject unsafe writes",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      anon = await client();
    assert.equal((await anon(c.path)).status, 401);
    const service = await import("../src/lib/collection-handoff-server"),
      p = ["library", "collections", c.collection.id, "handoff"],
      req = new Request("http://localhost/api/" + c.path);
    const reader = await service.dispatchCollectionHandoff(req, p, {
      ...c.actor,
      role: "viewer" as any,
    });
    assert.equal((await reader!.json()).canEdit, false);
    await assert.rejects(
      () =>
        service.dispatchCollectionHandoff(req, p, {
          ...c.actor,
          workspaceId: randomUUID(),
        }),
      /unavailable/,
    );
    await assert.rejects(
      () =>
        service.dispatchCollectionHandoff(
          new Request(req.url, {
            method: "POST",
            body: JSON.stringify(c.input),
          }),
          p,
          { ...c.actor, role: "viewer" as any },
        ),
      /edit access/,
    );
    for (const input of [
      { ...c.input, reviewed: true },
      { ...c.input, answerIds: [c.answer.id, c.answer.id] },
      { ...c.input, summary: "x".repeat(8001) },
      { ...c.input, language: "de" },
    ])
      assert.equal((await c.owner(c.path, "POST", input)).status, 400);
    const global = (await c.ask()).result.savedAnswerId;
    assert.equal(
      (await c.owner(c.path, "POST", { ...c.input, answerIds: [global] }))
        .status,
      409,
    );
    assert.equal(
      (await c.owner(c.path, "POST", { ...c.input, taskIds: [randomUUID()] }))
        .status,
      409,
    );
    let d = await c.owner(c.path, "POST", c.input);
    assert.equal(
      (await c.owner(c.path, "PUT", edit(d, { version: 999 }))).status,
      409,
    );
    assert.equal(
      (await c.owner(c.path + "/review", "POST", review(d, { version: 999 })))
        .status,
      409,
    );
    assert.equal(
      (
        await c.owner(c.path + "/review", "POST", {
          ...review(d),
          preview: "forged",
        })
      ).status,
      400,
    );
    assert.equal((await c.owner(c.path + "/export?format=md")).status, 400);
    assert.equal((await c.owner(c.path + "/other")).status, 404);
    assert.equal((await c.owner(c.path + "/review")).status, 405);
    await c.owner(
      "library/answers/" + c.answer.id,
      "PUT",
      answerEdit(c.answer, { includeInExports: false }),
    );
    assert.equal(
      (await c.owner(c.path + "/review", "POST", review(d))).status,
      409,
    );
    assert.equal(
      (await c.owner(c.path, "PUT", edit(d, { summary: "Changed" }))).status,
      409,
    );
  },
);
test(
  "summary-only packets require re-review on source/context changes and collection deletion removes all packet state",
  { timeout: 120000 },
  async () => {
    const c = await setup();
    let d = await c.owner(c.path, "POST", {
      ...c.input,
      answerIds: [],
      taskIds: [],
    });
    d = await c.owner(c.path + "/review", "POST", review(d));
    assert.equal(d.packet.canExport, true);
    let collection = (
      await c.owner(
        "library/collections/" + c.collection.id,
        "PUT",
        collectionEdit(c.collection, { title: "Changed collection title" }),
      )
    ).collection;
    assert.equal((await c.owner(exportPath(c, d))).status, 409);
    d = await c.owner(c.path);
    d = await c.owner(c.path + "/review", "POST", review(d));
    assert.equal(d.packet.canExport, true);
    const i = await c.local.get<any>(
      "interview",
      c.imports[1].interviewId,
      c.actor.workspaceId,
    );
    await c.local.put("interview", {
      ...i,
      version: i.version + 1,
      turns: i.turns.map((t: any) => ({
        ...t,
        answer: t.answer + " CORRECTION",
      })),
    });
    // Captured collection answers are invalidated by the correction, even if omitted from the packet.
    assert.equal((await c.owner(c.path)).packet, null);
    d = await c.owner(c.path, "POST", {
      ...c.input,
      requestId: randomUUID(),
      answerIds: [],
      taskIds: [],
    });
    assert.equal(d.status, 201);
    await c.owner("library/collections/" + collection.id, "DELETE", {
      version: collection.version,
    });
    assert.equal(
      (await c.local.list("libraryCollectionHandoff", c.actor.workspaceId))
        .length,
      0,
    );
    assert.equal((await c.owner(c.path)).status, 404);
  },
);

test(
  "summary-only source erasure and unselected captured-task deletion remove packet text without relying on selected findings",
  { timeout: 120000 },
  async () => {
    for (const mode of ["source_only", "unselected_task"]) {
      const c = await setup();
      await c.owner("library/answers/" + c.answer.id, "DELETE", {
        version: c.answer.history.at(-1).version,
      });
      const d = await c.owner(c.path, "POST", {
        ...c.input,
        answerIds: [],
        taskIds: [],
      });
      assert.equal(d.status, 201);
      if (mode === "source_only")
        await c.owner(
          `studies/${c.imports[1].s.id}/responses/${c.imports[1].interviewId}`,
          "DELETE",
        );
      else
        await c.owner(
          `library/collections/${c.collection.id}/tasks/${c.task.id}`,
          "DELETE",
          { version: c.task.version },
        );
      assert.equal(
        (await c.local.list("libraryCollectionHandoff", c.actor.workspaceId))
          .length,
        0,
        mode,
      );
      assert.equal((await c.owner(c.path)).packet, null, mode);
    }
  },
);
