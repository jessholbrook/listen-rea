import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { recordingSetup } from "./library-recordings-fixture";
import { transcriptSetup } from "./library-transcript-answers-fixture";
import { briefInput, answerEdit } from "./library-briefs-fixture";
import { fixtureEmbedding } from "./library-semantic-fixture";
import { libraryAttachmentFilter } from "../src/lib/library-attachments";
const root = "library/collections";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3371 : 3370 }),
  { timeout: 90000 },
);
after(stop);
const input = (extra: any = {}) => ({
  requestId: randomUUID(),
  title: "Synthetic collection",
  interviewIds: [],
  briefIds: [],
  ...extra,
});
const edit = (c: any, extra: any = {}) => ({
  version: c.version,
  title: c.title,
  interviewIds: c.interviewIds,
  briefIds: c.briefIds,
  ...extra,
});
test(
  "collections are atomic, bounded, role/workspace scoped and versioned; retries and deletion cannot recreate old membership",
  { timeout: 120000 },
  async () => {
    const c = await recordingSetup(),
      data = input();
    const replies = await Promise.all([
      c.owner(root, "POST", data),
      c.owner(root, "POST", data),
    ]);
    assert.deepEqual(replies.map((r) => r.status).sort(), [200, 201]);
    let v = replies[0].collection;
    assert.equal(v.id, replies[1].collection.id);
    assert.equal(v.workspaceId, undefined);
    assert.equal(v.requestId, undefined);
    assert.equal(
      (await c.owner(root, "POST", { ...data, title: "Changed title" })).status,
      409,
    );
    for (const bad of [
      input({ interviewIds: [randomUUID()] }),
      input({ briefIds: [randomUUID()] }),
      input({ interviewIds: Array.from({ length: 201 }, () => randomUUID()) }),
      input({ briefIds: Array.from({ length: 31 }, () => randomUUID()) }),
      input({ interviewIds: [v.id, v.id] }),
      input({ title: "x" }),
      input({ workspaceId: c.actor.workspaceId }),
    ])
      assert.ok((await c.owner(root, "POST", bad)).status >= 400);
    const service = await import("../src/lib/library-collections-server");
    await assert.rejects(
      () =>
        service.dispatchLibraryCollections(
          new Request("http://localhost/api/" + root, {
            method: "POST",
            body: JSON.stringify(input()),
          }),
          ["library", "collections"],
          { ...c.actor, role: "viewer" as any },
        ),
      /edit access/,
    );
    await assert.rejects(
      () =>
        service.dispatchLibraryCollections(
          new Request("http://localhost/api/" + root + "/" + v.id),
          ["library", "collections", v.id],
          { ...c.actor, workspaceId: randomUUID() },
        ),
      /unavailable/,
    );
    const original = edit(v, { title: "Renamed collection" });
    v = (await c.owner(root + "/" + v.id, "PUT", original)).collection;
    assert.equal(v.version, 2);
    assert.equal(
      (await c.owner(root + "/" + v.id, "PUT", original)).collection.version,
      2,
    );
    assert.equal(
      (
        await c.owner(root + "/" + v.id, "PUT", {
          ...original,
          title: "Conflicting title",
        })
      ).status,
      409,
    );
    assert.equal(
      (await c.owner(root + "/" + v.id, "PUT", edit(v, { version: 999 })))
        .status,
      409,
    );
    assert.equal(
      (await c.owner(root + "/" + v.id, "DELETE", { version: 1 })).status,
      409,
    );
    await c.owner(root + "/" + v.id, "DELETE", { version: 2 });
    assert.equal((await c.owner(root, "POST", data)).status, 409);
    for (let n = 0; n < 50; n++)
      await c.local.put("libraryCollection", {
        ...input(),
        id: randomUUID(),
        workspaceId: c.actor.workspaceId,
        inputHash: "marked-capacity-fixture",
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    assert.equal((await c.owner(root, "POST", input())).status, 409);
  },
);
test(
  "collection keyword/attachment/semantic retrieval intersect scope without erasing unrelated vectors; membership edits invalidate only scoped answers and dependent briefs",
  { timeout: 120000 },
  async () => {
    const c = await transcriptSetup(),
      first = c.imports[0],
      second = c.imports[1],
      globalBrief = await c.create();
    let collection = (
      await c.owner(
        root,
        "POST",
        input({
          interviewIds: [first.interviewId],
          briefIds: [globalBrief.id],
        }),
      )
    ).collection;
    let r = await c.owner("library/search", "POST", {
      collectionId: collection.id,
      query: "",
      studyIds: [],
    });
    assert.equal(r.status, 200);
    assert.deepEqual(
      [...new Set(r.hits.map((h: any) => h.interviewId))],
      [first.interviewId],
    );
    assert.equal(
      (
        await c.owner("library/search", "POST", {
          collectionId: collection.id,
          query: "",
          studyIds: [second.s.id],
        })
      ).hits.length,
      0,
    );
    assert.equal(
      (
        await c.owner("library/search", "POST", {
          collectionId: collection.id,
          query: "",
          attribute: { key: "segment", value: "missing" },
        })
      ).hits.length,
      0,
    );
    assert.equal(
      (
        await c.owner("library/attachments/search", "POST", {
          collectionId: collection.id,
          query: "",
        })
      ).hits.length,
      0,
    );
    const semantic = await import("../src/lib/library-semantic-server"),
      req = (action: string, data: any) =>
        semantic.dispatchLibrarySemantic(
          new Request("http://localhost/api/library/semantic/" + action, {
            method: "POST",
            body: JSON.stringify(data),
          }),
          ["library", "semantic", action === "build" ? "index" : action],
          c.actor,
          fixtureEmbedding,
        );
    await req("build", {
      scope: "transcripts",
      studyIds: c.imports.map((i) => i.s.id),
    });
    const before = (
      await c.local.list<any>("libraryEmbedding", c.actor.workspaceId)
    ).length;
    assert.ok(before >= 2);
    const found = await semantic.retrieveLibrarySemantic(
      c.actor,
      "transcripts",
      libraryAttachmentFilter.parse({ collectionId: collection.id }),
      "progress",
      50,
      fixtureEmbedding,
    );
    assert.ok(found.items.length);
    assert.ok(
      found.items.every((h) => h.hit.interviewId === first.interviewId),
    );
    assert.equal(
      (await c.local.list("libraryEmbedding", c.actor.workspaceId)).length,
      before,
    );
    const asked = await c.ask({ collectionId: collection.id, studyIds: [] });
    let answer = (
      await c.owner("library/answers/" + asked.result.savedAnswerId)
    ).answer;
    assert.equal(answer.filter.collectionId, collection.id);
    assert.ok(
      c
        .payload()[1]
        .evidence.every((h: any) => h.interviewId === first.interviewId),
    );
    answer = (
      await c.owner("library/answers/" + answer.id, "PUT", answerEdit(answer))
    ).answer;
    const b = await c.owner("library/briefs", "POST", {
      ...briefInput([answer]),
      requestId: randomUUID(),
    });
    assert.equal(b.status, 201);
    collection = (
      await c.owner(
        root + "/" + collection.id,
        "PUT",
        edit(collection, { briefIds: [globalBrief.id, b.brief.id] }),
      )
    ).collection;
    assert.equal((await c.owner("library/answers/" + answer.id)).status, 200);
    collection = (
      await c.owner(
        root + "/" + collection.id,
        "PUT",
        edit(collection, { interviewIds: [] }),
      )
    ).collection;
    assert.equal((await c.owner("library/answers/" + answer.id)).status, 404);
    assert.equal((await c.owner("library/briefs/" + b.brief.id)).status, 404);
    assert.equal(
      (await c.owner("library/briefs/" + globalBrief.id)).status,
      200,
    );
    assert.deepEqual(collection.briefIds, [globalBrief.id]);
    assert.equal(
      (await c.owner("library/sources/" + first.interviewId)).status,
      200,
    );
    const calls = c.count();
    await assert.rejects(
      () => c.ask(asked.input),
      /removed.*membership|new request/i,
    );
    assert.equal(c.count(), calls);
    assert.equal(
      (
        await c.owner("library/search", "POST", {
          collectionId: collection.id,
          query: "",
        })
      ).hits.length,
      0,
    );
    const empty = await c.ask({
      collectionId: collection.id,
      saveDraft: false,
      studyIds: [],
    });
    assert.equal(empty.result.evidenceCount, 0);
    assert.equal(c.count(), calls);
    const semEmpty = await semantic.retrieveLibrarySemantic(
      c.actor,
      "transcripts",
      libraryAttachmentFilter.parse({ collectionId: collection.id }),
      "progress",
      50,
      fixtureEmbedding,
    );
    assert.equal(semEmpty.items.length, 0);
    assert.equal(
      (await c.local.list("libraryEmbedding", c.actor.workspaceId)).length,
      before,
    );
    // Attachment evidence follows exactly the selected interview, with no brief-source expansion.
    let attachmentCollection = (
      await c.owner(
        root,
        "POST",
        input({ interviewIds: [c.fixtures[0].r.interview.id] }),
      )
    ).collection;
    const attachmentHits = (
      await c.owner("library/attachments/search", "POST", {
        collectionId: attachmentCollection.id,
        query: "",
      })
    ).hits;
    assert.ok(attachmentHits.length);
    assert.ok(
      attachmentHits.every(
        (h: any) => h.interviewId === c.fixtures[0].r.interview.id,
      ),
    );
    const attachmentService =
      await import("../src/lib/library-attachments-server");
    const savedAttachment = await attachmentService.dispatchLibraryAttachments(
      new Request("http://localhost/api/library/attachments/qa", {
        method: "POST",
        body: JSON.stringify({
          collectionId: attachmentCollection.id,
          question: "What does draft review show?",
          saveDraft: true,
          requestId: randomUUID(),
        }),
      }),
      ["library", "attachments", "qa"],
      c.actor,
      async (evidence) => ({
        answer: "MARKED_COLLECTION_ATTACHMENT_FINDING",
        citations: [{ evidenceId: evidence[0].id, quote: evidence[0].text }],
        model: "marked-collection-fixture",
        promptVersion: "marked-collection-fixture",
        generatedAt: new Date().toISOString(),
      }),
    );
    const attachmentId = (await savedAttachment!.json()).savedAnswerId;
    assert.equal(
      (await c.owner("library/attachments/answers/" + attachmentId)).answer
        .filter.collectionId,
      attachmentCollection.id,
    );
    await c.owner(
      root + "/" + attachmentCollection.id,
      "PUT",
      edit(attachmentCollection, { interviewIds: [] }),
    );
    assert.equal(
      (await c.owner("library/attachments/answers/" + attachmentId)).status,
      404,
    );
    await c.owner(root + "/" + collection.id, "DELETE", {
      version: collection.version,
    });
    assert.equal(
      (await c.owner("library/search", "POST", { collectionId: collection.id }))
        .status,
      404,
    );
    assert.equal(
      (await c.owner("library/briefs/" + globalBrief.id)).status,
      200,
    );
  },
);
test(
  "membership changes and collection deletion reject in-flight generation/indexing without saving stale answers or vectors",
  { timeout: 120000 },
  async () => {
    const c = await transcriptSetup();
    let collection = (
      await c.owner(
        root,
        "POST",
        input({ interviewIds: [c.imports[0].interviewId] }),
      )
    ).collection;
    const output = async (_s: any, p: any) => {
      collection = (
        await c.owner(
          root + "/" + collection.id,
          "PUT",
          edit(collection, { interviewIds: [c.imports[1].interviewId] }),
        )
      ).collection;
      const h = p.evidence[0];
      return {
        answer: "MARKED_LATE_ANSWER",
        citations: [
          {
            studyId: h.studyId,
            interviewId: h.interviewId,
            turnId: h.turnId,
            quote: h.quote,
          },
        ],
      };
    };
    await assert.rejects(
      () => c.ask({ collectionId: collection.id, studyIds: [] }, output),
      /changed while answering/,
    );
    assert.equal((await c.owner("library/answers")).answers.length, 0);
    const semantic = await import("../src/lib/library-semantic-server");
    await assert.rejects(
      () =>
        semantic.dispatchLibrarySemantic(
          new Request("http://localhost/api/library/semantic/index", {
            method: "POST",
            body: JSON.stringify({
              scope: "transcripts",
              collectionId: collection.id,
            }),
          }),
          ["library", "semantic", "index"],
          c.actor,
          async (texts) => {
            collection = (
              await c.owner(
                root + "/" + collection.id,
                "PUT",
                edit(collection, { interviewIds: [] }),
              )
            ).collection;
            return fixtureEmbedding(texts);
          },
        ),
      /changed while indexing/,
    );
    assert.equal(
      (await c.local.list("libraryEmbedding", c.actor.workspaceId)).length,
      0,
    );
    collection = (
      await c.owner(
        root + "/" + collection.id,
        "PUT",
        edit(collection, { interviewIds: [c.imports[0].interviewId] }),
      )
    ).collection;
    await assert.rejects(
      () =>
        c.ask(
          { collectionId: collection.id, studyIds: [] },
          async (_s: any, p: any) => {
            await c.owner(root + "/" + collection.id, "DELETE", {
              version: collection.version,
            });
            const h = p.evidence[0];
            return {
              answer: "MARKED_DELETED_COLLECTION",
              citations: [
                {
                  studyId: h.studyId,
                  interviewId: h.interviewId,
                  turnId: h.turnId,
                  quote: h.quote,
                },
              ],
            };
          },
        ),
      /collection is unavailable/,
    );
    assert.equal((await c.owner("library/answers")).answers.length, 0);
  },
);
test(
  "withdrawal, brief removal and source erasure physically prune all collection references, advance versions and do not auto-restore membership",
  { timeout: 120000 },
  async () => {
    const c = await transcriptSetup(),
      source = c.imports[0];
    let one = (
      await c.owner(
        root,
        "POST",
        input({ interviewIds: c.imports.map((i) => i.interviewId) }),
      )
    ).collection;
    let two = (
      await c.owner(root, "POST", input({ interviewIds: [source.interviewId] }))
    ).collection;
    const asked = await c.ask({
      collectionId: one.id,
      studyIds: [],
      question: "What happens with invoices?",
    });
    assert.ok(asked.result.savedAnswerId);
    one = (
      await c.owner(
        root + "/" + one.id,
        "PUT",
        edit(one, { interviewIds: [...one.interviewIds].reverse() }),
      )
    ).collection;
    assert.equal(
      (await c.owner("library/answers/" + asked.result.savedAnswerId)).status,
      200,
      "Reordering the same interview set must preserve findings",
    );
    const i = await c.local.get<any>(
      "interview",
      source.interviewId,
      c.actor.workspaceId,
    );
    // Simulate a historical/source edit bypassing normal hooks: first read must prune before returning a saved interpretation.
    await c.local.db
      .prepare(
        "UPDATE documents SET data=json_set(data,'$.excluded',1) WHERE kind='interview' AND id=? AND workspace_id=?",
      )
      .run(i.id, c.actor.workspaceId);
    assert.equal(
      (await c.owner("library/answers/" + asked.result.savedAnswerId)).status,
      404,
    );
    one = (await c.owner(root + "/" + one.id)).collection;
    two = (await c.owner(root + "/" + two.id)).collection;
    assert.deepEqual(one.interviewIds, [c.imports[1].interviewId]);
    assert.deepEqual(two.interviewIds, []);
    assert.equal(one.version, 3);
    assert.equal(
      (await c.owner("library/answers/" + asked.result.savedAnswerId)).status,
      404,
    );
    await c.local.put("interview", {
      ...i,
      excluded: false,
      version: i.version + 2,
    });
    assert.equal(
      (await c.owner(root + "/" + two.id)).collection.interviewIds.length,
      0,
    );
    assert.equal(
      (
        await c.owner(
          root + "/" + two.id,
          "PUT",
          edit({ ...two, version: 1 }, { interviewIds: [source.interviewId] }),
        )
      ).status,
      409,
    );
    let linked = await c.create();
    one = (
      await c.owner(
        root + "/" + one.id,
        "PUT",
        edit(one, { briefIds: [linked.id] }),
      )
    ).collection;
    assert.equal(
      (
        await c.owner("library/briefs/" + linked.id, "DELETE", {
          version: linked.version,
        })
      ).status,
      200,
    );
    assert.deepEqual(
      (await c.owner(root + "/" + one.id)).collection.briefIds,
      [],
    );
    await c.owner(
      "studies/" + c.imports[1].s.id + "/responses/" + c.imports[1].interviewId,
      "DELETE",
    );
    assert.equal(
      (await c.owner(root + "/" + one.id)).collection.interviewIds.length,
      0,
    );
    const stored = await c.local.get<any>(
      "libraryCollection",
      one.id,
      c.actor.workspaceId,
    );
    assert.equal(
      JSON.stringify(stored).includes(c.imports[1].interviewId),
      false,
    );
    assert.equal(JSON.stringify(stored).includes(linked.id), false);
  },
);
