import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { client } from "./image-review-fixture";
import { transcriptSetup } from "./library-transcript-answers-fixture";
import { answerEdit, briefInput, briefUpdate } from "./library-briefs-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3356 : 3355 }),
  { timeout: 90000 },
);
after(stop);
const root = "library/answers";
test(
  "transcript drafts retain immutable originals and exact source offsets, save once, review latest text and export without private originals or external identifiers",
  { timeout: 120000 },
  async () => {
    const c = await transcriptSetup(),
      asked = await c.ask();
    const id = asked.result.savedAnswerId,
      path = root + "/" + id;
    assert.ok(id);
    assert.equal((await c.ask(asked.input)).result.savedAnswerId, id);
    assert.equal(c.count(), 1);
    let s = (await c.owner(path)).answer;
    assert.equal(s.scope, "transcripts");
    assert.equal(s.history[0].reviewed, false);
    assert.equal(s.sources.length, 1);
    assert.equal(s.sources[0].format, "transcript");
    const source = s.sources[0],
      full = c.imports.find(
        (i) => i.interviewId === source.interviewId,
      )!.transcript;
    assert.equal(
      full.slice(source.locator.start, source.locator.end),
      source.text,
    );
    assert.equal(source.locator.unit, "turn");
    assert.equal(source.locator.number, 1);
    assert.equal(
      (await c.owner("library/attachments/answers/" + id)).status,
      404,
    );
    assert.equal((await c.owner(root)).answers.length, 1);
    assert.equal(
      (await c.owner("library/attachments/answers")).answers.length,
      2,
    );
    assert.equal((await c.owner(root + "?scope=all")).answers.length, 3);
    assert.equal((await c.owner(path + "/export")).status, 409);
    const original = structuredClone(s.original);
    s = (
      await c.owner(
        path,
        "PUT",
        answerEdit(s, {
          answer: "PRIVATE_EARLIER_TRANSCRIPT_REVIEW",
          reviewed: false,
          includeInExports: false,
        }),
      )
    ).answer;
    s = (
      await c.owner(
        path,
        "PUT",
        answerEdit(s, { answer: "=APPROVED_TRANSCRIPT_FINDING" }),
      )
    ).answer;
    assert.deepEqual(s.original, original);
    assert.equal(s.history.length, 3);
    assert.deepEqual(
      (await c.owner(path + "/source", "POST", { id: source.id })).source,
      source,
    );
    for (const format of ["md", "csv"]) {
      const r = await c.owner(path + "/export?format=" + format);
      assert.equal(r.status, 200);
      const text = r.bytes.toString();
      for (const shown of [
        source.text,
        "APPROVED_TRANSCRIPT_FINDING",
        "transcript",
        "?study=",
        source.transcript.prompt,
      ])
        assert.ok(text.includes(shown));
      for (const hidden of [
        "MARKED_TRANSCRIPT_ORIGINAL",
        "PRIVATE_EARLIER_TRANSCRIPT_REVIEW",
        "private-external-",
        "PRIVATE_PARTICIPANT_ANSWER",
      ])
        assert.equal(text.includes(hidden), false);
      if (format === "csv")
        assert.ok(text.includes("'=APPROVED_TRANSCRIPT_FINDING"));
    }
    const sent = c.payload();
    assert.equal(sent[6].maxTokens, 2000);
    assert.ok(sent[6].signal);
    assert.equal(JSON.stringify(sent[1]).includes("private-external-"), false);
    assert.equal(JSON.stringify(sent[1]).includes("attributes"), false);
    assert.equal(
      JSON.stringify(sent[1]).includes("PRIVATE_PARTICIPANT_ANSWER"),
      false,
    );
    const competing = await Promise.all([
      c.owner(
        path,
        "PUT",
        answerEdit(s, {
          answer: "First competing edit",
          reviewed: false,
          includeInExports: false,
        }),
      ),
      c.owner(
        path,
        "PUT",
        answerEdit(s, {
          answer: "Second competing edit",
          reviewed: false,
          includeInExports: false,
        }),
      ),
    ]);
    assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await c.owner(path + "/export")).status, 409);
    const native = await c.ask(
      {
        studyIds: [c.fixtures[0].s.id],
        question: "What private participant answer was supplied?",
      },
      async (...args: any[]) => {
        const h = args[1].evidence[0];
        return {
          answer: "Marked native transcript interpretation",
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
    );
    const nativeSaved = (
      await c.owner(root + "/" + native.result.savedAnswerId)
    ).answer;
    assert.equal(nativeSaved.sources[0].transcript.source, "interview");
  },
);
test(
  "mixed transcript/attachment briefs preserve provenance and erasure covers every generation input, including uncited responses and removed sections",
  { timeout: 120000 },
  async () => {
    const c = await transcriptSetup(),
      q = await c.ask();
    let s = (await c.owner(root + "/" + q.result.savedAnswerId)).answer;
    s = (
      await c.owner(
        root + "/" + s.id,
        "PUT",
        answerEdit(s, { answer: "APPROVED_TRANSCRIPT_FINDING" }),
      )
    ).answer;
    let b = (
      await c.owner("library/briefs", "POST", {
        ...briefInput([s, c.answers[0]]),
        requestId: randomUUID(),
      })
    ).brief;
    b = (
      await c.owner(
        "library/briefs/" + b.id,
        "PUT",
        briefUpdate(b, { reviewed: true, includeInExports: true }),
      )
    ).brief;
    for (const format of ["md", "csv"]) {
      const r = await c.owner(
        "library/briefs/" + b.id + "/export?format=" + format,
      );
      assert.equal(r.status, 200);
      const text = r.bytes.toString();
      assert.ok(
        text.includes("APPROVED_TRANSCRIPT_FINDING") &&
          text.includes("APPROVED_FINDING_0"),
      );
      assert.ok(text.includes(s.sources[0].text));
      assert.ok(text.includes("transcript"));
      assert.equal(text.includes("MARKED_TRANSCRIPT_ORIGINAL"), false);
    }
    b = (
      await c.owner(
        "library/briefs/" + b.id,
        "PUT",
        briefUpdate(b, {
          sections: briefInput([c.answers[0]]).sections,
          summary: "Still derived from the removed transcript",
        }),
      )
    ).brief;
    const uncited = c.imports.find(
      (i) => i.interviewId !== s.sources[0].interviewId,
    )!;
    await c.owner(
      "studies/" + uncited.s.id + "/responses/" + uncited.interviewId,
      "DELETE",
    );
    assert.equal(
      await c.local.get("libraryAnswer", s.id, c.actor.workspaceId),
      undefined,
    );
    assert.equal(
      await c.local.get("libraryBrief", b.id, c.actor.workspaceId),
      undefined,
    );
    assert.equal((await c.owner(root + "/" + s.id)).status, 404);
    assert.equal(
      (await c.owner("library/attachments/answers/" + c.answers[0].id)).status,
      200,
    );
  },
);
test(
  "save authority, strict inputs, insufficient citations, semantic retrieval and in-flight source changes cannot create forged or stale drafts",
  { timeout: 120000 },
  async () => {
    const c = await transcriptSetup(),
      no = await client(),
      other = await client();
    assert.equal((await no("library/qa", "POST", {})).status, 401);
    await other("auth/signup", "POST", {
      name: "Other",
      email: randomUUID() + "@example.test",
      password: "other-transcript-password",
    });
    assert.equal(
      (
        await other("library/qa", "POST", {
          studyIds: [c.imports[0].s.id],
          question: "Draft workflow?",
          saveDraft: true,
          requestId: randomUUID(),
        })
      ).status,
      404,
    );
    for (const extra of [
      { sources: [] },
      { model: "forged" },
      { requestId: undefined },
    ])
      assert.equal(
        (
          await c.owner("library/qa", "POST", {
            studyIds: [c.imports[0].s.id],
            question: "Draft workflow?",
            saveDraft: true,
            requestId: randomUUID(),
            ...extra,
          })
        ).status,
        400,
      );
    await assert.rejects(
      () => c.ask({}, async () => ({ answer: "No evidence", citations: [] })),
      (e: any) => e.status === 400,
    );
    await assert.rejects(
      () =>
        c.ask({}, async (...args: any[]) => {
          const h = args[1].evidence[0];
          return {
            answer: "Fabricated",
            citations: [
              {
                studyId: h.studyId,
                interviewId: h.interviewId,
                turnId: h.turnId,
                quote: "invented",
              },
            ],
          };
        }),
      /INVALID_CITATION/,
    );
    await assert.rejects(
      () =>
        c.ask({}, async () => {
          throw Error("PROVIDER_UNAVAILABLE");
        }),
      /PROVIDER_UNAVAILABLE/,
    );
    const embed = await import("../src/lib/library-semantic-server"),
      fixture = await import("./library-semantic-fixture");
    await embed.dispatchLibrarySemantic(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          scope: "transcripts",
          studyIds: c.imports.map((i) => i.s.id),
        }),
      }),
      ["library", "semantic", "index"],
      c.actor,
      fixture.fixtureEmbedding,
    );
    const semantic = await c.ask({ retrieval: "semantic" });
    assert.equal(semantic.result.retrieval.mode, "semantic");
    const saved = (await c.owner(root + "/" + semantic.result.savedAnswerId))
      .answer;
    assert.equal(saved.original.retrieval.model, "text-embedding-3-small");
    await assert.rejects(
      () =>
        c.ask({}, async (...args: any[]) => {
          const h = args[1].evidence[0],
            i = await c.local.get<any>(
              "interview",
              h.interviewId,
              c.actor.workspaceId,
            );
          await c.local.put("interview", { ...i, excluded: true });
          return {
            answer: "Stale",
            citations: [
              {
                studyId: h.studyId,
                interviewId: h.interviewId,
                turnId: h.turnId,
                quote: h.quote,
              },
            ],
          };
        }),
      (e: any) => e.status === 409,
    );
    assert.equal(
      (await c.local.list<any>("libraryAnswer", c.actor.workspaceId)).filter(
        (s) => s.scope === "transcripts",
      ).length,
      0,
    );
  },
);
test(
  "source changes, direct drift, expiry and viewer permissions preserve transcript confidentiality and erase stored originals/reviews",
  { timeout: 120000 },
  async () => {
    const c = await transcriptSetup(),
      q = await c.ask(),
      id = q.result.savedAnswerId,
      path = root + "/" + id;
    const viewer = await client(),
      email = randomUUID() + "@example.test";
    await viewer("auth/signup", "POST", {
      name: "Viewer",
      email,
      password: "viewer-transcript-password",
    });
    await c.local.db
      .prepare("UPDATE users SET workspace_id=?,role='viewer' WHERE email=?")
      .run(c.actor.workspaceId, email);
    let s = (await c.owner(path)).answer;
    assert.equal((await viewer(path)).status, 200);
    assert.equal((await viewer(path, "PUT", answerEdit(s))).status, 403);
    assert.equal(
      (
        await viewer("library/qa", "POST", {
          question: "Draft workflow?",
          saveDraft: true,
          requestId: randomUUID(),
        })
      ).status,
      403,
    );
    const full = await c.local.get<any>(
      "interview",
      s.sources[0].interviewId,
      c.actor.workspaceId,
    );
    full.origin.title = "Changed import context";
    await c.local.put("interview", full);
    assert.equal(
      await c.local.get("libraryAnswer", id, c.actor.workspaceId),
      undefined,
    );
    const second = await c.ask();
    s = (await c.owner(root + "/" + second.result.savedAnswerId)).answer;
    const direct = await c.local.get<any>(
      "interview",
      s.sources[0].interviewId,
      c.actor.workspaceId,
    );
    direct.turns[0].answer += " Changed source text";
    await c.local.db
      .prepare("UPDATE documents SET data=? WHERE kind='interview' AND id=?")
      .run(JSON.stringify(direct), direct.id);
    assert.equal((await c.owner(root + "/" + s.id + "/export")).status, 404);
    assert.equal(
      await c.local.get("libraryAnswer", s.id, c.actor.workspaceId),
      undefined,
    );
    const third = await c.ask();
    s = (await c.owner(root + "/" + third.result.savedAnswerId)).answer;
    const expired = await c.local.get<any>(
      "interview",
      s.sources[0].interviewId,
      c.actor.workspaceId,
    );
    expired.createdAt = new Date(Date.now() - 365 * 86400000).toISOString();
    await c.local.put("interview", expired);
    await (await import("../src/lib/features")).retention();
    assert.equal(
      await c.local.get("libraryAnswer", s.id, c.actor.workspaceId),
      undefined,
    );
  },
);
