import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, dataDirectory } from "./harness";
import { client, seed } from "./image-review-fixture";
import { libraryAttachmentFixture } from "./library-attachments-fixture";
import { savedLibrarySetup as setup } from "./library-answers-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3347 : 3346 }),
  { timeout: 90000 },
);
after(stop);
const root = "library/attachments/answers";
const edit = (s: any, changes: any = {}) => ({
  version: s.history.at(-1).version,
  answer: s.history.at(-1).answer,
  citations: s.history.at(-1).citations,
  reviewed: false,
  includeInExports: false,
  ...changes,
});
test(
  "saved cross-study answers have server-bound originals, idempotent saves, private review history and latest-only reviewed exports",
  { timeout: 120000 },
  async () => {
    const c = await setup(),
      first = await c.ask(),
      id = first.result.savedAnswerId,
      path = root + "/" + id;
    assert.ok(id);
    assert.equal(c.count(), 1);
    const repeated = await c.ask(first.input);
    assert.equal(repeated.result.savedAnswerId, id);
    assert.equal(c.count(), 1);
    await assert.rejects(
      () => c.ask({ ...first.input, question: "Changed draft question?" }),
      (e) => e instanceof Error && "status" in e && e.status === 409,
    );
    assert.equal((await c.owner(root)).answers.length, 1);
    let saved = (await c.owner(path)).answer;
    const originalSnapshot = structuredClone(saved.original);
    assert.equal(saved.original.answer, "SYNTHETIC_ORIGINAL_INTERPRETATION");
    assert.equal(saved.original.model, "marked-provider-fixture");
    assert.equal(saved.history[0].reviewed, false);
    assert.equal(saved.sources.length, 4);
    assert.equal(new Set(saved.sources.map((h: any) => h.studyId)).size, 2);
    for (const format of ["md", "csv"])
      assert.equal(
        (await c.owner(path + "/export?format=" + format)).status,
        409,
      );
    assert.equal(
      (
        await c.owner(
          path,
          "PUT",
          edit(saved, { reviewed: false, includeInExports: true }),
        )
      ).status,
      400,
    );
    assert.equal(
      (await c.owner(path, "PUT", { ...edit(saved), model: "forged" })).status,
      400,
    );
    assert.equal(
      (
        await c.owner(
          path,
          "PUT",
          edit(saved, {
            citations: [{ ...saved.original.citations[0], quote: "Invented" }],
          }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await c.owner(
          path,
          "PUT",
          edit(saved, {
            citations: [
              { ...saved.original.citations[0], evidenceId: "b".repeat(64) },
            ],
          }),
        )
      ).status,
      400,
    );
    assert.equal(
      (await c.owner(path, "PUT", edit(saved, { citations: [] }))).status,
      400,
    );
    const approved = await c.owner(
      path,
      "PUT",
      edit(saved, {
        answer: "=REVIEWED_LATEST_FINDING",
        reviewed: true,
        includeInExports: true,
        citations: [saved.original.citations[0]],
      }),
    );
    assert.equal(approved.status, 200, JSON.stringify(approved));
    saved = approved.answer;
    assert.equal(saved.history.length, 2);
    assert.equal(saved.original.answer, "SYNTHETIC_ORIGINAL_INTERPRETATION");
    assert.equal(saved.history[1].editor.name, c.actor.name);
    assert.deepEqual(saved.original, originalSnapshot);
    for (const format of ["md", "csv"]) {
      const exported = await c.owner(path + "/export?format=" + format);
      assert.equal(exported.status, 200);
      const text = exported.bytes.toString();
      assert.match(text, /REVIEWED_LATEST_FINDING/);
      assert.equal(text.includes("SYNTHETIC_ORIGINAL_INTERPRETATION"), false);
      assert.equal(text.includes("PRIVATE_PARTICIPANT_ANSWER"), false);
      assert.ok(text.includes(saved.original.citations[0].quote));
      if (format === "csv")
        assert.ok(text.includes("'=REVIEWED_LATEST_FINDING"));
    }
    assert.equal(
      (await c.owner(path, "PUT", edit(saved, { version: 1 }))).status,
      409,
    );
    const competing = await Promise.all([
      c.owner(path, "PUT", edit(saved, { answer: "PRIVATE_REVIEW_REVISION" })),
      c.owner(
        path,
        "PUT",
        edit(saved, { answer: "CONCURRENT_OTHER_REVISION" }),
      ),
    ]);
    assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
    saved = (await c.owner(path)).answer;
    assert.equal(saved.history.length, 3);
    assert.equal((await c.owner(path + "/export?format=md")).status, 409);
    assert.equal(
      (await c.owner(path, "DELETE", { version: saved.history.at(-1).version }))
        .status,
      200,
    );
    assert.equal((await c.owner(path)).status, 404);
    assert.equal((await c.owner(root)).answers.length, 0);
    const stored = await c.local.db
      .prepare("SELECT data FROM documents WHERE kind='libraryAnswer' AND id=?")
      .get(id);
    assert.equal(stored, undefined);
  },
);
test(
  "file erasure, review withdrawal, verification changes, exclusion, attribute updates and response purge erase frozen originals/history across studies",
  { timeout: 120000 },
  async () => {
    const c = await setup(["image", "pdf", "docx", "pptx"]);
    for (const f of c.fixtures) {
      const one = await c.ask({ studyIds: [f.s.id] }),
        path = root + "/" + one.result.savedAnswerId;
      assert.equal((await c.owner(path)).status, 200);
      const off = await c.owner(f.asset + "/review", "PUT", {
        ...f.review,
        version: 1,
        includeInReports: false,
      });
      assert.equal(off.status, 200, JSON.stringify(off));
      const stored = await c.local.db
        .prepare(
          "SELECT data FROM documents WHERE kind='libraryAnswer' AND id=?",
        )
        .get(one.result.savedAnswerId);
      assert.equal(stored, undefined);
      assert.equal((await c.owner(path)).status, 404);
      if (f.verification) {
        const passage = await c.ask({
          studyIds: [f.s.id],
          kinds: ["passage"],
          question:
            "What does " + f.verification.passages[0].quote + " describe?",
        });
        const pid = passage.result.savedAnswerId;
        assert.ok(pid);
        assert.equal((await c.owner(f.asset, "DELETE")).status, 200);
        assert.equal(
          await c.local.db
            .prepare(
              "SELECT data FROM documents WHERE kind='libraryAnswer' AND id=?",
            )
            .get(pid),
          undefined,
        );
      }
    }
    const f = await libraryAttachmentFixture(c.owner, "pptx");
    let answer = await c.ask({ studyIds: [f.s.id] });
    const live = await c.owner(f.ip);
    void live;
    const i = await c.local.get<any>(
      "interview",
      f.r.interview.id,
      c.actor.workspaceId,
    );
    await c.local.put("interview", { ...i, excluded: true });
    assert.equal(
      await c.local.get(
        "libraryAnswer",
        answer.result.savedAnswerId,
        c.actor.workspaceId,
      ),
      undefined,
    );
    await c.local.put("interview", { ...i, excluded: false });
    answer = await c.ask({ studyIds: [f.s.id] });
    await c.local.put("interview", { ...i, attributes: { team: "changed" } });
    assert.equal(
      await c.local.get(
        "libraryAnswer",
        answer.result.savedAnswerId,
        c.actor.workspaceId,
      ),
      undefined,
    );
    answer = await c.ask({ studyIds: [f.s.id] });
    await c.owner(f.root + "/responses/" + f.r.interview.id, "DELETE");
    assert.equal(
      await c.local.get(
        "libraryAnswer",
        answer.result.savedAnswerId,
        c.actor.workspaceId,
      ),
      undefined,
    );
  },
);
test(
  "read-only members and foreign/public callers cannot change drafts; unrelated evidence does not erase a frozen answer",
  { timeout: 90000 },
  async () => {
    const c = await setup(["pptx"]),
      first = await c.ask(),
      path = root + "/" + first.result.savedAnswerId;
    const stranger = await client(),
      anonymous = await client(),
      viewer = await client(),
      email = randomUUID() + "@example.test";
    await stranger("auth/signup", "POST", {
      name: "Other library",
      email: randomUUID() + "@example.test",
      password: "library-other-password",
    });
    await viewer("auth/signup", "POST", {
      name: "Read library",
      email,
      password: "library-viewer-password",
    });
    await c.local.db
      .prepare("UPDATE users SET workspace_id=?,role='viewer' WHERE email=?")
      .run(c.actor.workspaceId, email);
    assert.equal((await viewer(root)).canEdit, false);
    assert.equal((await viewer(path)).status, 200);
    const saved = (await c.owner(path)).answer;
    assert.equal((await viewer(path, "PUT", edit(saved))).status, 403);
    assert.equal((await viewer(path, "DELETE", { version: 1 })).status, 403);
    assert.equal((await stranger(path)).status, 404);
    assert.equal((await anonymous(path)).status, 401);
    assert.equal((await stranger(root)).answers.length, 0);
    const f = c.fixtures[0];
    assert.equal((await f.person(path, "GET", undefined, f.h)).status, 401);
    await libraryAttachmentFixture(c.owner, "docx");
    assert.equal((await c.owner(path)).status, 200);
    // Included review history is source evidence, so changing it removes the saved original even if a later review had omitted that citation.
    const view = await c.owner(f.asset + "/text");
    const off = await c.owner(f.asset + "/text", "PUT", {
      ...f.verification,
      version: view.verification.history.at(-1).version,
      includeInReports: false,
      passages: [],
    });
    assert.equal(off.status, 200);
    assert.equal((await c.owner(path)).status, 404);
  },
);

test(
  "save gates reject empty/failed/stale generation, enforce record and history bounds, and image erasure removes originals before any read",
  { timeout: 90000 },
  async () => {
    const c = await setup(["image"]);
    assert.equal(
      (
        await c.owner("library/attachments/qa", "POST", {
          question: "What draft workflow?",
          saveDraft: true,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await c.owner("library/attachments/qa", "POST", {
          question: "What draft workflow?",
          saveDraft: true,
          requestId: randomUUID(),
          query: "zzzznonexistentzzzz",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await c.owner("library/attachments/qa", "POST", {
          question: "What draft workflow?",
          saveDraft: true,
          requestId: randomUUID(),
        })
      ).status,
      503,
    );
    assert.equal((await c.owner(root)).answers.length, 0);
    const first = await c.ask(),
      id = first.result.savedAnswerId,
      f = c.fixtures[0];
    const saved = await c.local.get<any>(
      "libraryAnswer",
      id,
      c.actor.workspaceId,
    );
    for (let n = 1; n < 20; n++)
      saved.history.push({ ...saved.history[0], version: n + 1 });
    await c.local.put("libraryAnswer", saved);
    assert.equal(
      (await c.owner(root + "/" + id, "PUT", edit(saved))).status,
      409,
    );
    await c.owner(f.asset, "DELETE");
    assert.equal(
      await c.local.get("libraryAnswer", id, c.actor.workspaceId),
      undefined,
    );
    const next = await libraryAttachmentFixture(c.owner, "pptx");
    const { dispatchLibraryAttachments } =
      await import("../src/lib/library-attachments-server");
    await assert.rejects(
      () =>
        dispatchLibraryAttachments(
          new Request("http://localhost/api/library/attachments/qa", {
            method: "POST",
            body: JSON.stringify({
              question: "What does draft review show?",
              studyIds: [next.s.id],
              saveDraft: true,
              requestId: randomUUID(),
            }),
          }),
          ["library", "attachments", "qa"],
          c.actor,
          async (evidence) => {
            await c.owner(next.asset + "/review", "PUT", {
              ...next.review,
              version: 1,
              includeInReports: false,
            });
            return {
              answer: "Marked source race fixture",
              citations: evidence.map((h) => ({
                evidenceId: h.id,
                quote: h.text,
              })),
              model: "marked-fixture",
              promptVersion: "marked-fixture",
              generatedAt: new Date().toISOString(),
            };
          },
        ),
      (e) => e instanceof Error && "status" in e && e.status === 409,
    );
    assert.equal((await c.owner(root)).answers.length, 0);
    const fresh = await c.ask({ studyIds: [next.s.id], kinds: ["passage"] }),
      stored = await c.local.get<any>(
        "libraryAnswer",
        fresh.result.savedAnswerId,
        c.actor.workspaceId,
      );
    for (let n = 0; n < 99; n++)
      await c.local.put("libraryAnswer", {
        ...stored,
        id: randomUUID(),
        requestId: randomUUID(),
      });
    const before = c.count();
    await assert.rejects(
      () => c.ask(),
      (e) => e instanceof Error && "status" in e && e.status === 409,
    );
    assert.equal(c.count(), before);
  },
);

test(
  "withdrawal of uncited input evidence also erases a saved interpretation without retaining its text in dependency references",
  { timeout: 90000 },
  async () => {
    const c = await setup(["pptx", "docx", "pdf", "image"]),
      answer = await c.ask();
    const stored = await c.local.get<any>(
      "libraryAnswer",
      answer.result.savedAnswerId,
      c.actor.workspaceId,
    );
    const uncited = stored.dependencies.find(
      (d: any) => !stored.sources.some((h: any) => h.id === d.id),
    );
    assert.ok(uncited);
    assert.equal(
      stored.dependencies.some(
        (d: any) => "text" in d || "attributes" in d || "reviewerName" in d,
      ),
      false,
    );
    const f = c.fixtures.find((f) => f.id === uncited.attachmentId)!;
    const off =
      uncited.kind === "observation"
        ? await c.owner(f.asset + "/review", "PUT", {
            ...f.review,
            version: 1,
            includeInReports: false,
          })
        : await c.owner(f.asset + "/text", "PUT", {
            ...f.verification,
            version: 1,
            includeInReports: false,
            passages: [],
          });
    assert.equal(off.status, 200, JSON.stringify(off));
    assert.equal(
      await c.local.get("libraryAnswer", stored.id, c.actor.workspaceId),
      undefined,
    );
    assert.equal(
      (await c.owner(root + "/" + stored.id + "/export?format=md")).status,
      404,
    );
  },
);

test(
  "request-driven retention removes cross-study saved originals and history when an input response expires",
  { timeout: 90000 },
  async () => {
    const c = await setup(),
      answer = await c.ask(),
      id = answer.result.savedAnswerId,
      f = c.fixtures[0];
    const i = await c.local.get<any>(
      "interview",
      f.r.interview.id,
      c.actor.workspaceId,
    );
    i.createdAt = new Date(Date.now() - 365 * 86400000).toISOString();
    await c.local.put("interview", i);
    assert.ok(await c.local.get("libraryAnswer", id, c.actor.workspaceId));
    const { retention } = await import("../src/lib/features");
    await retention();
    assert.equal(
      await c.local.get("libraryAnswer", id, c.actor.workspaceId),
      undefined,
    );
    assert.equal(
      await c.local.get("interview", i.id, c.actor.workspaceId),
      undefined,
    );
    assert.equal(
      (await c.owner(root + "/" + id + "/export?format=md")).status,
      404,
    );
  },
);
