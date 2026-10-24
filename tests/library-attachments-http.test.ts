import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory } from "./harness";
import { pptxTextDB } from "./pptx-text-fixture";
import { start, stop } from "./harness";
import { client, seed } from "./image-review-fixture";
import { libraryAttachmentFixture } from "./library-attachments-fixture";
before(
  () =>
    start({
      port: process.env.RESEARCH_TEST_PORT
        ? Number(process.env.RESEARCH_TEST_PORT)
        : process.env.RESEARCH_TEST_PRODUCTION === "1"
          ? 3341
          : 3340,
    }),
  { timeout: 90000 },
);
after(stop);
const route = "library/attachments/";
test(
  "cross-study attachment search retains file provenance and exact filters, protects roles and withdraws current evidence",
  { timeout: 120000 },
  async () => {
    const owner = await client(),
      stranger = await client(),
      anon = await client();
    for (const c of [owner, stranger])
      await c("auth/signup", "POST", {
        name: "Library reviewer",
        email: randomUUID() + "@example.test",
        password: "library-attachments-password",
      });
    const fixtures = [];
    for (const f of ["image", "pdf", "docx", "pptx"] as const)
      fixtures.push(await libraryAttachmentFixture(owner, f));
    const [image, pdf, docx, pptx] = fixtures;
    const search = (filter = {}) => owner(route + "search", "POST", filter);
    let result = await search();
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.total, 7);
    assert.equal(result.searchedStudies, 4);
    assert.equal(new Set(result.hits.map((h: any) => h.studyId)).size, 4);
    for (const h of result.hits) {
      assert.equal(h.id.length, 64);
      assert.ok(h.revisionId && h.turnId && h.attachmentId && h.reviewedAt);
      assert.equal(h.attributes && typeof h.attributes, "object");
      if (h.kind === "passage")
        assert.ok(
          h.locator.number === 2 &&
            h.locator.start === 0 &&
            h.locator.end === h.text.length,
        );
      else {
        assert.equal(h.field, "notes");
        assert.equal(h.grounding, "not_applicable");
      }
      const current = await owner(route + "source", "POST", { id: h.id });
      assert.equal(current.status, 200);
      assert.deepEqual(current.source, h);
    }
    assert.equal(
      JSON.stringify(result).includes("PRIVATE_PARTICIPANT_ANSWER"),
      false,
    );
    assert.equal(
      (await search({ formats: ["image"], kinds: ["passage"] })).total,
      0,
    );
    assert.equal((await search({ formats: ["pptx"] })).total, 2);
    assert.equal((await search({ kinds: ["observation"] })).total, 4);
    assert.equal((await search({ kinds: ["passage"] })).total, 3);
    assert.equal((await search({ query: "researcher" })).total, 4);
    assert.equal((await search({ query: "SENTINELPRIVATEANSWER" })).total, 0);
    assert.equal((await search({ studyIds: [docx.s.id] })).total, 2);
    await seed(pptx.r, (i) => {
      i.attributes = { team: "A" };
    });
    assert.equal(
      (await search({ attribute: { key: "team", value: "A" } })).total,
      2,
    );
    assert.equal(
      (await search({ attribute: { key: "team", value: "a" } })).total,
      0,
    );
    assert.equal((await anon(route + "search", "POST", {})).status, 401);
    assert.equal(
      (await image.person(route + "search", "POST", {}, image.h)).status,
      401,
    );
    assert.equal((await stranger(route + "search", "POST", {})).total, 0);
    assert.equal(
      (await stranger(route + "search", "POST", { studyIds: [image.s.id] }))
        .status,
      404,
    );
    assert.equal(
      (await owner(route + "search", "POST", { formats: [] })).status,
      400,
    );
    assert.equal(
      (
        await owner(route + "source", "POST", {
          id: result.hits[0].id,
          studyIds: [randomUUID()],
        })
      ).status,
      404,
    );
    for (const lang of ["en", "es", "fr"]) {
      const empty = await owner(route + "qa", "POST", {
        query: "zzzznonexistentevidencezzzz",
        question: "What draft workflow?",
        language: lang,
      });
      assert.equal(empty.status, 200);
      assert.equal(empty.generated, false);
      assert.equal(empty.evidenceCount, 0);
      assert.deepEqual(empty.citations, []);
    }
    assert.equal(
      (await owner(route + "qa", "POST", { question: "What draft workflow?" }))
        .status,
      503,
    );
    const original = result.hits.find(
      (h: any) => h.studyId === pptx.s.id && h.kind === "observation",
    );
    const updated = await owner(pptx.asset + "/review", "PUT", {
      ...pptx.review,
      version: 1,
      notes: "Changed draft observation",
    });
    assert.equal(updated.status, 200);
    assert.equal(
      (await owner(route + "source", "POST", { id: original.id })).status,
      404,
    );
    const afterEdit = await search({
      formats: ["pptx"],
      kinds: ["observation"],
    });
    assert.equal(afterEdit.hits[0].text, "Changed draft observation");
    assert.notEqual(afterEdit.hits[0].id, original.id);
    await owner(pptx.asset + "/review", "PUT", {
      ...pptx.review,
      version: 2,
      includeInReports: false,
    });
    assert.equal(
      (await search({ formats: ["pptx"], kinds: ["observation"] })).total,
      0,
    );
    const passage = (await search({ formats: ["pptx"], kinds: ["passage"] }))
      .hits[0];
    const withdrawn = await owner(pptx.asset + "/text", "PUT", {
      ...pptx.verification,
      version: 1,
      passages: [],
      includeInReports: false,
    });
    assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn));
    assert.equal(
      (await owner(route + "source", "POST", { id: passage.id })).status,
      404,
    );
    for (const field of ["excluded", "preview"] as const) {
      await seed(docx.r, (i) => {
        i[field] = true;
      });
      assert.equal((await search({ formats: ["docx"] })).total, 0);
      await seed(docx.r, (i) => {
        i[field] = false;
      });
    }
    const pdfId = (await search({ formats: ["pdf"] })).hits[0].id;
    await owner(pdf.asset, "DELETE");
    assert.equal((await search({ formats: ["pdf"] })).total, 0);
    assert.equal(
      (await owner(route + "source", "POST", { id: pdfId })).status,
      404,
    );
    await owner(image.root + "/responses/" + image.r.interview.id, "DELETE");
    assert.equal((await search({ formats: ["image"] })).total, 0);
    await seed(docx.r, (i) => {
      i.status = "active";
    });
    assert.equal((await search()).total, 0);
  },
);

test(
  "researcher correction fields retain separate identities, viewers can read but cannot ask, and changed probe context invalidates sources",
  { timeout: 90000 },
  async () => {
    const owner = await client(),
      viewer = await client(),
      email = randomUUID() + "@example.test",
      viewerEmail = randomUUID() + "@example.test";
    await owner("auth/signup", "POST", {
      name: "Correction reviewer",
      email,
      password: "library-correction-password",
    });
    await viewer("auth/signup", "POST", {
      name: "Library viewer",
      email: viewerEmail,
      password: "library-correction-password",
    });
    const c = await libraryAttachmentFixture(owner, "pptx");
    const digest = createHash("sha256")
      .update(await readFile(path.join(dataDirectory(), "media", c.id)))
      .digest("hex");
    await seed(c.r, (i) => {
      i.turns[0].pptxProbe = {
        pptxId: c.id,
        snapshotSha256: digest,
        status: "asked",
        probe: "How does Save draft before review. help?",
        slide: 2,
        quote: "Save draft before review.",
        model: "synthetic-fixture",
        permissionVersion: "synthetic-fixture",
        promptVersion: "synthetic-fixture",
        generatedAt: new Date().toISOString(),
      };
    });
    const view = await owner(c.asset + "/review");
    const reviewed = await owner(c.asset + "/review", "PUT", {
      ...c.review,
      source: view.source,
      probeSource: view.probeSource,
      version: view.version,
      grounding: "unsupported",
      notes: "Researcher draft note",
      correction: "Researcher draft correction: avoid assuming success.",
    });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed));
    const search = await owner(route + "search", "POST", {
      kinds: ["observation"],
    });
    assert.equal(search.total, 2);
    assert.deepEqual(search.hits.map((h: any) => h.field).sort(), [
      "correction",
      "notes",
    ]);
    assert.equal(new Set(search.hits.map((h: any) => h.id)).size, 2);
    for (const h of search.hits) {
      assert.equal(h.grounding, "unsupported");
      assert.equal(h.version, 2);
      assert.equal(h.format, "pptx");
    }
    const db = pptxTextDB();
    try {
      await db.execute({
        sql: "UPDATE users SET workspace_id=(SELECT workspace_id FROM users WHERE email=?),role='viewer' WHERE email=?",
        args: [email, viewerEmail],
      });
    } finally {
      db.close();
    }
    assert.equal((await viewer(route + "search", "POST", {})).total, 3);
    assert.equal(
      (await viewer(route + "source", "POST", { id: search.hits[0].id }))
        .status,
      200,
    );
    assert.equal(
      (
        await viewer(route + "qa", "POST", {
          question: "What does draft review show?",
        })
      ).status,
      403,
    );
    assert.equal((await owner(route + "search")).status, 405);
    await seed(c.r, (i) => {
      i.turns[0].pptxProbe.probe = "Changed synthetic question?";
    });
    assert.equal(
      (await owner(route + "search", "POST", { kinds: ["observation"] })).total,
      0,
    );
    assert.equal(
      (await owner(route + "source", "POST", { id: search.hits[0].id })).status,
      404,
    );
  },
);

test(
  "a source withdrawn during generation rejects the otherwise valid answer before it reaches the researcher",
  { timeout: 90000 },
  async () => {
    const owner = await client(),
      email = randomUUID() + "@example.test";
    await owner("auth/signup", "POST", {
      name: "Race reviewer",
      email,
      password: "library-race-password",
    });
    const c = await libraryAttachmentFixture(owner, "pptx");
    process.env.RESEARCH_DATA_DIR = dataDirectory();
    for (const name of [
      "LIBSQL_URL",
      "LIBSQL_AUTH_TOKEN",
      "TURSO_DATABASE_URL",
      "TURSO_AUTH_TOKEN",
    ])
      process.env[name] = "";
    process.env.RESEARCH_STORAGE = "local";
    const local = await import("../src/lib/db");
    assert.equal(local.dataDir, dataDirectory());
    const { dispatchLibraryAttachments } =
      await import("../src/lib/library-attachments-server");
    const row = await local.db
      .prepare("SELECT id,name,email,workspace_id FROM users WHERE email=?")
      .get(email);
    assert.ok(row);
    const actor = {
      id: String(row.id),
      name: String(row.name),
      email,
      workspaceId: String(row.workspace_id),
      role: "admin" as const,
    };
    let calls = 0;
    await assert.rejects(
      () =>
        dispatchLibraryAttachments(
          new Request("http://localhost/api/library/attachments/qa", {
            method: "POST",
            body: JSON.stringify({
              studyIds: [c.s.id],
              kinds: ["observation"],
              question: "What does draft review show?",
            }),
          }),
          ["library", "attachments", "qa"],
          actor,
          async (evidence) => {
            calls++;
            assert.equal(evidence.length, 1);
            const changed = await owner(c.asset + "/review", "PUT", {
              ...c.review,
              version: 1,
              includeInReports: false,
            });
            assert.equal(changed.status, 200);
            return {
              answer: "A marked synthetic interpretation.",
              citations: [
                { evidenceId: evidence[0].id, quote: evidence[0].text },
              ],
              model: "marked-race-fixture",
              promptVersion: "fixture",
              generatedAt: new Date().toISOString(),
            };
          },
        ),
      (e) => e instanceof Error && "status" in e && e.status === 409,
    );
    assert.equal(calls, 1);
    assert.equal(
      (
        await owner(route + "search", "POST", {
          studyIds: [c.s.id],
          kinds: ["observation"],
        })
      ).total,
      0,
    );
  },
);
