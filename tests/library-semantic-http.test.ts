import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { client, seed } from "./image-review-fixture";
import { savedLibrarySetup } from "./library-answers-fixture";
import { fixtureEmbedding, semanticUnit } from "./library-semantic-fixture";
import { libraryAttachmentFilter } from "../src/lib/library-attachments";
import type { LibraryEmbedding } from "../src/lib/library-semantic";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3350 : 3349 }),
  { timeout: 90000 },
);
after(stop);
const control = "library/semantic/";
async function setup(
  formats: ("pptx" | "docx" | "pdf" | "image")[] = ["pptx", "docx"],
) {
  const c = await savedLibrarySetup(formats),
    s = await import("../src/lib/library-semantic-server");
  const filter = libraryAttachmentFilter.parse({});
  return {
    ...c,
    s,
    filter,
    invoke: async (
      action: string,
      input: any = {},
      method = "POST",
      embed: any = fixtureEmbedding,
    ) => {
      const r = await s.dispatchLibrarySemantic(
        new Request("http://localhost/api/library/semantic/" + action, {
          method,
          body: JSON.stringify(input),
        }),
        ["library", "semantic", action],
        c.actor,
        embed,
      );
      return r!.json();
    },
  };
}
test(
  "private indexes cover both source types, retrieve nonliteral evidence with exact citations, preserve filters and save semantic provenance",
  { timeout: 90000 },
  async () => {
    const c = await setup(["pptx", "docx", "pdf", "image"]),
      input = { scope: "attachments" };
    let calls = 0;
    const embed: any = async (texts: string[], ...rest: any[]) => {
      calls++;
      assert.equal(
        texts.some((t) => t.includes("PRIVATE_PARTICIPANT_ANSWER")),
        false,
      );
      return fixtureEmbedding(texts);
    };
    const initial = await c.owner(control + "status", "POST", input);
    assert.equal(initial.coverage.indexed, 0);
    assert.equal(initial.coverage.eligible, 7);
    const built = await c.invoke("index", input, "POST", embed);
    assert.equal(built.built, 7);
    assert.equal(built.coverage.partial, false);
    assert.equal(calls, 1);
    assert.equal((await c.invoke("index", input, "POST", embed)).built, 0);
    assert.equal(calls, 1);
    const rows = await c.local.list<LibraryEmbedding>(
      "libraryEmbedding",
      c.actor.workspaceId,
    );
    assert.equal(rows.length, 7);
    for (const r of rows) {
      assert.equal("text" in r, false);
      assert.equal("hit" in r, false);
      assert.equal(r.vector.length, 256);
      assert.equal(r.dependencies.length, 1);
      assert.equal(JSON.stringify(r).includes("Save draft"), false);
    }
    const query = "retain unfinished progress",
      found = await c.s.retrieveLibrarySemantic(
        c.actor,
        "attachments",
        c.filter,
        query,
        50,
        fixtureEmbedding,
      );
    assert.equal(found.items[0].text, "Save draft before review.");
    assert.equal(found.retrieval.indexed, 7);
    const { dispatchLibraryAttachments } =
      await import("../src/lib/library-attachments-server");
    const request = {
      question: "How can unfinished progress be protected?",
      retrieval: "semantic",
      kinds: ["passage"],
      saveDraft: true,
      requestId: randomUUID(),
    };
    let generated = 0;
    const response = await dispatchLibraryAttachments(
      new Request("http://localhost/api/library/attachments/qa", {
        method: "POST",
        body: JSON.stringify(request),
      }),
      ["library", "attachments", "qa"],
      c.actor,
      async (evidence) => {
        generated++;
        assert.equal(evidence[0].text, "Save draft before review.");
        return {
          answer: "Marked semantic fixture finding",
          citations: [{ evidenceId: evidence[0].id, quote: evidence[0].text }],
          model: "marked-fixture",
          promptVersion: "marked-fixture",
          generatedAt: new Date().toISOString(),
        };
      },
      fixtureEmbedding,
    );
    const answer = await response!.json();
    assert.equal(answer.retrieval.mode, "semantic");
    assert.equal(generated, 1);
    assert.ok(answer.savedAnswerId);
    const saved = (
      await c.owner("library/attachments/answers/" + answer.savedAnswerId)
    ).answer;
    assert.equal(saved.original.retrieval.mode, "semantic");
    assert.equal(saved.original.retrieval.model, "text-embedding-3-small");
    const selected = c.fixtures[0];
    await seed(selected.r, (i) => {
      i.attributes = { team: "A" };
    });
    const segmented = await c.owner(control + "status", "POST", {
      scope: "attachments",
      studyIds: [selected.s.id],
      attribute: { key: "team", value: "A" },
    });
    assert.equal(segmented.coverage.eligible, 2);
    assert.equal(segmented.coverage.indexed, 0);
    const other = await c.owner(control + "status", "POST", {
      scope: "attachments",
      studyIds: [c.fixtures[1].s.id],
    });
    assert.equal(other.coverage.indexed, 2);
    assert.equal(
      (await c.invoke("index", { scope: "transcripts" })).coverage.indexed,
      8,
    );
    const transcript = await c.s.retrieveLibrarySemantic(
      c.actor,
      "transcripts",
      c.filter,
      "unfinished progress",
      50,
      fixtureEmbedding,
    );
    assert.equal(transcript.items.length, 8);
    assert.ok(transcript.items.every((h) => "quote" in h.hit));
    const f = c.fixtures[1];
    await c.owner(f.asset, "DELETE");
    const remaining = await c.local.list<LibraryEmbedding>(
      "libraryEmbedding",
      c.actor.workspaceId,
    );
    assert.equal(
      remaining.some((r) => r.dependencies[0].attachmentId === f.id),
      false,
    );
  },
);
test(
  "clear/build/search and source-change races cannot restore stale vectors, while malformed provider output leaves no partial index",
  { timeout: 90000 },
  async () => {
    const c = await setup(["pptx"]),
      input = { scope: "attachments" };
    await assert.rejects(
      () =>
        c.invoke("index", input, "POST", async (texts: string[]) => {
          await c.invoke("index", { scope: "attachments" }, "DELETE");
          return fixtureEmbedding(texts);
        }),
      (e) => e instanceof Error && "status" in e && e.status === 409,
    );
    assert.equal(
      (await c.local.list("libraryEmbedding", c.actor.workspaceId)).length,
      0,
    );
    await assert.rejects(
      () => c.invoke("index", input, "POST", async () => [[]]),
      /INVALID_EMBEDDING/,
    );
    assert.equal(
      (await c.local.list("libraryEmbedding", c.actor.workspaceId)).length,
      0,
    );
    await c.invoke("index", input);
    await assert.rejects(
      () =>
        c.s.retrieveLibrarySemantic(
          c.actor,
          "attachments",
          c.filter,
          "unfinished progress",
          30,
          async (texts) => {
            await c.invoke("index", { scope: "attachments" }, "DELETE");
            return fixtureEmbedding(texts);
          },
        ),
      (e) => e instanceof Error && "status" in e && e.status === 409,
    );
    const f = c.fixtures[0];
    await assert.rejects(
      () =>
        c.invoke("index", input, "POST", async (texts: string[]) => {
          await c.owner(f.asset + "/review", "PUT", {
            ...f.review,
            version: 1,
            includeInReports: false,
          });
          return fixtureEmbedding(texts);
        }),
      (e) => e instanceof Error && "status" in e && e.status === 409,
    );
    assert.equal(
      (await c.local.list("libraryEmbedding", c.actor.workspaceId)).length,
      0,
    );
    const empty = await c.s.retrieveLibrarySemantic(
      c.actor,
      "attachments",
      c.filter,
      "unfinished progress",
      30,
      async () => {
        throw Error("MUST_NOT_CALL");
      },
    );
    assert.equal(empty.items.length, 0);
    assert.equal(empty.retrieval.partial, true);
  },
);
test(
  "source writes and retention erase vectors physically; read-only, foreign and participant callers cannot build or clear indexes",
  { timeout: 90000 },
  async () => {
    const c = await setup(["pptx"]),
      f = c.fixtures[0];
    await c.invoke("index", { scope: "attachments" });
    await c.invoke("index", { scope: "transcripts" });
    const outsider = await client(),
      person = await client(),
      viewer = await client(),
      email = randomUUID() + "@example.test";
    await outsider("auth/signup", "POST", {
      name: "Other semantic",
      email: randomUUID() + "@example.test",
      password: "semantic-test-password",
    });
    await viewer("auth/signup", "POST", {
      name: "View semantic",
      email,
      password: "semantic-test-password",
    });
    await c.local.db
      .prepare("UPDATE users SET workspace_id=?,role='viewer' WHERE email=?")
      .run(c.actor.workspaceId, email);
    assert.equal(
      (await person(control + "status", "POST", { scope: "attachments" }))
        .status,
      401,
    );
    assert.equal(
      (
        await f.person(
          control + "status",
          "POST",
          { scope: "attachments" },
          f.h,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await outsider(control + "status", "POST", {
          scope: "attachments",
          studyIds: [f.s.id],
        })
      ).status,
      404,
    );
    assert.equal(
      (await viewer(control + "status", "POST", { scope: "attachments" }))
        .coverage.canEdit,
      false,
    );
    assert.equal(
      (await viewer(control + "index", "POST", { scope: "attachments" }))
        .status,
      403,
    );
    assert.equal(
      (await viewer(control + "index", "DELETE", { scope: "attachments" }))
        .status,
      403,
    );
    assert.equal(
      (
        await c.owner(control + "index", "POST", {
          scope: "attachments",
          vector: [1],
        })
      ).status,
      400,
    );
    await c.owner(f.asset + "/review", "PUT", {
      ...f.review,
      version: 1,
      includeInReports: false,
    });
    let rows = await c.local.list<LibraryEmbedding>(
      "libraryEmbedding",
      c.actor.workspaceId,
    );
    assert.equal(rows.filter((r) => r.scope === "attachments").length, 1);
    const i = await c.local.get<any>(
      "interview",
      f.r.interview.id,
      c.actor.workspaceId,
    );
    await c.local.put("interview", { ...i, excluded: true });
    assert.equal(
      (await c.local.list("libraryEmbedding", c.actor.workspaceId)).length,
      0,
    );
    await c.local.put("interview", { ...i, excluded: false });
    await c.invoke("index", { scope: "attachments" });
    const expired = await c.local.get<any>(
      "interview",
      i.id,
      c.actor.workspaceId,
    );
    expired.createdAt = new Date(Date.now() - 365 * 86400000).toISOString();
    await c.local.put("interview", expired);
    await (await import("../src/lib/features")).retention();
    assert.equal(
      (await c.local.list("libraryEmbedding", c.actor.workspaceId)).length,
      0,
    );
  },
);
