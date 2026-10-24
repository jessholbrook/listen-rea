import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { transcriptSetup } from "./library-transcript-answers-fixture";
import { answerEdit, briefInput, briefUpdate } from "./library-briefs-fixture";
import { client } from "./image-review-fixture";
const root = "library/collections";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3374 : 3373 }),
  { timeout: 90000 },
);
after(stop);
async function setup() {
  const c = await transcriptSetup();
  const made = await c.owner(root, "POST", {
    requestId: randomUUID(),
    title: "Synthetic collection review",
    interviewIds: c.imports.map((i) => i.interviewId),
    briefIds: [],
  });
  assert.equal(made.status, 201);
  return {
    ...c,
    collection: made.collection,
    path: root + "/" + made.collection.id + "/dashboard",
  };
}
const check = (d: any) => ({
  collectionVersion: d.collection.version,
  reviewVersion: d.reviewVersion,
  signature: d.signature,
  checked: true,
});
const edit = (c: any, extra: any = {}) => ({
  version: c.version,
  title: c.title,
  interviewIds: c.interviewIds,
  briefIds: c.briefIds,
  ...extra,
});
async function saved(c: any, extra: any = {}) {
  const r = await c.ask({
    collectionId: c.collection.id,
    studyIds: [c.imports[0].s.id],
    ...extra,
  });
  return (await c.owner("library/answers/" + r.result.savedAnswerId)).answer;
}
test(
  "dashboard coverage counts distinct interviews in current approved collection citations, not global findings or linked-brief evidence; review queues and projections remain precise",
  { timeout: 120000 },
  async () => {
    const c = await setup();
    let a = await saved(c);
    const globalBrief = await c.create();
    let collection = (
      await c.owner(
        root + "/" + c.collection.id,
        "PUT",
        edit(c.collection, { briefIds: [globalBrief.id] }),
      )
    ).collection;
    let d = (await c.owner(c.path)).dashboard;
    assert.deepEqual(d.coverage, { total: 2, cited: 0, uncited: 2 });
    assert.equal(d.answers.length, 1);
    assert.equal(d.answers[0].status, "draft");
    assert.equal(d.briefs[0].status, "needs_review");
    assert.equal(
      JSON.stringify(d).includes("MARKED_TRANSCRIPT_ORIGINAL"),
      false,
    );
    assert.equal(JSON.stringify(d).includes("APPROVED_FINDING"), false);
    assert.equal(JSON.stringify(d).includes("fingerprint"), false);
    assert.equal(JSON.stringify(d).includes("sourceStates"), false);
    a = (
      await c.owner(
        "library/answers/" + a.id,
        "PUT",
        answerEdit(a, { includeInExports: false }),
      )
    ).answer;
    d = (await c.owner(c.path)).dashboard;
    assert.equal(d.answers[0].status, "reviewed");
    assert.equal(d.coverage.cited, 0);
    a = (await c.owner("library/answers/" + a.id, "PUT", answerEdit(a))).answer;
    let other = await saved(c);
    other = (
      await c.owner("library/answers/" + other.id, "PUT", answerEdit(other))
    ).answer;
    d = (await c.owner(c.path)).dashboard;
    assert.equal(d.coverage.cited, 1);
    assert.equal(
      d.interviews.find((i: any) => i.id === c.imports[0].interviewId)
        .approvedCitations,
      2,
    );
    const b = (
      await c.owner("library/briefs", "POST", {
        ...briefInput([a]),
        requestId: randomUUID(),
      })
    ).brief;
    const approved = (
      await c.owner(
        "library/briefs/" + b.id,
        "PUT",
        briefUpdate(b, { reviewed: true, includeInExports: true }),
      )
    ).brief;
    collection = (
      await c.owner(
        root + "/" + collection.id,
        "PUT",
        edit(collection, { briefIds: [globalBrief.id, b.id] }),
      )
    ).collection;
    d = (await c.owner(c.path)).dashboard;
    assert.equal(
      d.briefs.find((b: any) => b.id === approved.id).status,
      "approved",
    );
    a = (
      await c.owner(
        "library/answers/" + a.id,
        "PUT",
        answerEdit(a, { answer: "MARKED_NEW_REVIEW", includeInExports: false }),
      )
    ).answer;
    d = (await c.owner(c.path)).dashboard;
    assert.equal(d.briefs.find((x: any) => x.id === b.id).status, "outdated");
    assert.equal(d.coverage.cited, 1);
    await c.owner(
      "library/answers/" + other.id,
      "PUT",
      answerEdit(other, { reviewed: false, includeInExports: false }),
    );
    d = (await c.owner(c.path)).dashboard;
    assert.equal(d.coverage.cited, 0);
  },
);
test(
  "source checks are explicit, retry-safe and optimistic; source/evidence changes are detected without approving research or overwriting a stale baseline",
  { timeout: 120000 },
  async () => {
    const c = await setup();
    const a = await saved(c);
    let d = (await c.owner(c.path)).dashboard;
    assert.equal(d.changes.unchecked, 2);
    assert.equal(d.checkedAt, null);
    assert.equal(
      await c.local.get(
        "libraryCollectionReview",
        c.collection.id,
        c.actor.workspaceId,
      ),
      undefined,
    );
    const original = check(d),
      results = await Promise.all([
        c.owner(c.path + "/check", "POST", original),
        c.owner(c.path + "/check", "POST", original),
      ]);
    assert.ok(results.every((r) => r.status === 200));
    d = results[0].dashboard;
    assert.equal(d.reviewVersion, 1);
    assert.equal(d.changes.unchanged, 2);
    assert.equal(results[1].dashboard.checkedAt, d.checkedAt);
    assert.equal(
      (await c.owner("library/answers/" + a.id)).answer.history.at(-1).reviewed,
      false,
    );
    assert.equal(
      (
        await c.owner(c.path + "/check", "POST", {
          ...check(d),
          reviewVersion: 999,
        })
      ).status,
      409,
    );
    const stamp = d.checkedAt;
    let i = await c.local.get<any>(
      "interview",
      c.imports[0].interviewId,
      c.actor.workspaceId,
    );
    await c.local.put("interview", {
      ...i,
      version: i.version + 1,
      turns: i.turns.map((t: any) => ({
        ...t,
        answer: t.answer + " MARKED_CORRECTION",
      })),
    });
    assert.equal(
      (await c.owner(c.path + "/check", "POST", original)).status,
      409,
    );
    d = (await c.owner(c.path)).dashboard;
    assert.equal(d.changes.changed, 1);
    assert.equal(d.checkedAt, stamp);
    assert.equal(d.answers.length, 0);
    d = (await c.owner(c.path + "/check", "POST", check(d))).dashboard;
    assert.equal(d.reviewVersion, 2);
    assert.equal(d.changes.changed, 0);
    const f = c.fixtures[0],
      collection = (
        await c.owner(
          root + "/" + c.collection.id,
          "PUT",
          edit(c.collection, {
            interviewIds: [...c.collection.interviewIds, f.r.interview.id],
          }),
        )
      ).collection;
    d = (await c.owner(c.path)).dashboard;
    assert.equal(d.changes.added, 1);
    d = (await c.owner(c.path + "/check", "POST", check(d))).dashboard;
    const review = (
      await c.local.list<any>("participantPPTXReview", c.actor.workspaceId)
    ).find((r) => r.interviewId === f.r.interview.id);
    assert.ok(review);
    const last = review.history.at(-1);
    await c.local.put("participantPPTXReview", {
      ...review,
      history: [
        ...review.history,
        {
          ...last,
          version: last.version + 1,
          at: new Date().toISOString(),
          notes: "MARKED_REVIEW_CHANGE",
        },
      ],
    });
    d = (await c.owner(c.path)).dashboard;
    assert.equal(
      d.interviews.find((i: any) => i.id === f.r.interview.id).change,
      "changed",
    );
    assert.equal(d.collection.version, collection.version);
  },
);
test(
  "membership removal and source erasure physically strip baseline identifiers, keep only a count, reject late checks and remove the dashboard checkpoint with its collection",
  { timeout: 120000 },
  async () => {
    const c = await setup();
    let d = (await c.owner(c.path)).dashboard;
    d = (await c.owner(c.path + "/check", "POST", check(d))).dashboard;
    const stale = check(d),
      removed = c.imports[0];
    await c.owner(
      "studies/" + removed.s.id + "/responses/" + removed.interviewId,
      "DELETE",
    );
    d = (await c.owner(c.path)).dashboard;
    assert.equal(d.coverage.total, 1);
    assert.equal(d.changes.removed, 1);
    assert.equal((await c.owner(c.path + "/check", "POST", stale)).status, 409);
    let state = await c.local.get<any>(
      "libraryCollectionReview",
      c.collection.id,
      c.actor.workspaceId,
    );
    assert.equal(JSON.stringify(state).includes(removed.interviewId), false);
    assert.equal(JSON.stringify(state).includes(removed.transcript), false);
    assert.equal(state.sourceStates.length, 1);
    let collection = (await c.owner(root + "/" + c.collection.id)).collection;
    collection = (
      await c.owner(
        root + "/" + collection.id,
        "PUT",
        edit(collection, { interviewIds: [] }),
      )
    ).collection;
    d = (await c.owner(c.path)).dashboard;
    assert.equal(d.changes.removed, 2);
    assert.equal(d.coverage.total, 0);
    state = await c.local.get<any>(
      "libraryCollectionReview",
      collection.id,
      c.actor.workspaceId,
    );
    assert.deepEqual(state.sourceStates, []);
    collection = (
      await c.owner(
        root + "/" + collection.id,
        "PUT",
        edit(collection, { interviewIds: [c.imports[1].interviewId] }),
      )
    ).collection;
    d = (await c.owner(c.path)).dashboard;
    assert.equal(d.changes.added, 1);
    d = (await c.owner(c.path + "/check", "POST", check(d))).dashboard;
    assert.equal(d.changes.removed, 0);
    assert.equal(d.changes.unchanged, 1);
    await c.owner(root + "/" + collection.id, "DELETE", {
      version: collection.version,
    });
    assert.equal((await c.owner(c.path)).status, 404);
    assert.equal(
      (await c.owner(c.path + "/check", "POST", check(d))).status,
      404,
    );
    assert.equal(
      await c.local.get(
        "libraryCollectionReview",
        collection.id,
        c.actor.workspaceId,
      ),
      undefined,
    );
  },
);
test(
  "dashboard scope and check permissions reject foreign/public, forged baseline data, unsupported methods and stale finding-state attestations",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      anon = await client();
    assert.equal((await anon(c.path)).status, 401);
    const service = await import("../src/lib/collection-review-server"),
      p = ["library", "collections", c.collection.id, "dashboard"];
    const view = await service.dispatchCollectionReview(
      new Request("http://localhost/api/" + c.path),
      p,
      { ...c.actor, role: "viewer" as any },
    );
    assert.equal((await view!.json()).dashboard.canCheck, false);
    await assert.rejects(
      () =>
        service.dispatchCollectionReview(
          new Request("http://localhost/api/" + c.path),
          p,
          { ...c.actor, workspaceId: randomUUID() },
        ),
      /unavailable/,
    );
    let d = (await c.owner(c.path)).dashboard;
    await assert.rejects(
      () =>
        service.dispatchCollectionReview(
          new Request("http://localhost/api/" + c.path + "/check", {
            method: "POST",
            body: JSON.stringify(check(d)),
          }),
          [...p, "check"],
          { ...c.actor, role: "viewer" as any },
        ),
      /edit access/,
    );
    assert.equal((await c.owner(c.path, "PUT", {})).status, 405);
    for (const bad of [
      { ...check(d), checked: false },
      { ...check(d), sourceStates: [] },
      { ...check(d), reviewVersion: -1 },
    ])
      assert.equal((await c.owner(c.path + "/check", "POST", bad)).status, 400);
    assert.equal(
      (
        await c.owner(c.path + "/check", "POST", {
          ...check(d),
          signature: "0".repeat(64),
        })
      ).status,
      409,
    );
    const a = await saved(c);
    assert.equal(
      (await c.owner(c.path + "/check", "POST", check(d))).status,
      409,
    );
    d = (await c.owner(c.path)).dashboard;
    await c.owner("library/answers/" + a.id, "PUT", answerEdit(a));
    assert.equal(
      (await c.owner(c.path + "/check", "POST", check(d))).status,
      409,
    );
    assert.equal(
      await c.local.get(
        "libraryCollectionReview",
        c.collection.id,
        c.actor.workspaceId,
      ),
      undefined,
    );
  },
);
