import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { start, stop, dataDirectory } from "./harness";
import { client, seed } from "./image-review-fixture";
import { docxTextDB, docxVerificationInput } from "./docx-text-fixture";
import { docxSynthesisSource } from "./docx-synthesis-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3237 : 3236 }),
  { timeout: 90000 },
);
after(stop);
async function fixture(included = true) {
  const c = await docxSynthesisSource(included);
  return { ...c, endpoint: c.root + "/docx-qa" };
}
const ask = (c: any, patch: any = {}) => ({
  id: c.a.id,
  version: c.a.version,
  question: "What should happen before review?",
  ...patch,
});
test(
  "DOCX Q&A requires edit authority, exact analysis and strict excerpt-only requests; failed generation preserves private and published state",
  { timeout: 90000 },
  async () => {
    const c = await fixture(),
      anon = await client(),
      other = await fixture();
    assert.equal((await anon(c.endpoint, "POST", ask(c))).status, 401);
    assert.equal((await c.person(c.endpoint, "POST", ask(c), c.h)).status, 401);
    assert.equal((await other.owner(c.endpoint, "POST", ask(c))).status, 404);
    const d = docxTextDB();
    try {
      await d.execute({
        sql: "UPDATE users SET role='viewer' WHERE workspace_id=?",
        args: [c.s.workspaceId],
      });
      assert.equal((await c.owner(c.endpoint, "POST", ask(c))).status, 403);
    } finally {
      await d.execute({
        sql: "UPDATE users SET role='admin' WHERE workspace_id=?",
        args: [c.s.workspaceId],
      });
    }
    for (const patch of [{ id: randomUUID() }, { version: 99 }])
      assert.equal(
        (await c.owner(c.endpoint, "POST", ask(c, patch))).status,
        409,
      );
    for (const patch of [
      { question: "x" },
      { question: "x".repeat(2001) },
      { sources: c.a.docxEvidence },
      { saveDraft: "invalid" },
      { model: "forged" },
      { reviewed: true },
    ])
      assert.equal(
        (await c.owner(c.endpoint, "POST", ask(c, patch))).status,
        400,
      );
    c.a = (
      await c.owner(c.root + "/analysis", "PUT", { ...c.a, reviewed: true })
    ).analysis;
    let e = (
      await c.owner(c.root + "/reporting/editions", "POST", {
        analysisId: c.a.id,
        title: "DOCX Q&A state baseline",
      })
    ).edition;
    e = (
      await c.owner(c.root + "/reporting/editions/" + e.id, "PUT", {
        ...e,
        reviewed: true,
      })
    ).edition;
    const share = (
        await c.owner(c.root + "/reporting/editions/" + e.id + "/share", "POST")
      ).token,
      memoShare = (await c.owner(c.root + "/share", "POST")).token;
    const rows = (
      await d.execute({
        sql: "SELECT kind,id,data FROM documents WHERE workspace_id=? ORDER BY kind,id",
        args: [c.s.workspaceId],
      })
    ).rows;
    assert.equal((await c.owner(c.endpoint, "POST", ask(c))).status, 503);
    assert.deepEqual((await c.owner(c.root + "/analysis")).analysis, c.a);
    assert.deepEqual(
      (
        await d.execute({
          sql: "SELECT kind,id,data FROM documents WHERE workspace_id=? ORDER BY kind,id",
          args: [c.s.workspaceId],
        })
      ).rows,
      rows,
    );
    for (const token of [share, memoShare])
      assert.equal((await anon("shared/" + token)).status, 200);
    assert.deepEqual(
      (await c.owner(c.root + "/reporting/editions/" + e.id)).edition,
      e,
    );
    d.close();
  },
);
test(
  "DOCX Q&A rejects unincluded, ineligible, foreign-scope, changed-source/snapshot/language evidence and erased analyses",
  { timeout: 90000 },
  async () => {
    const empty = await fixture(false);
    assert.equal(
      (await empty.owner(empty.endpoint, "POST", ask(empty))).status,
      400,
    );
    const c = await fixture();
    assert.equal(
      (
        await c.owner(
          c.endpoint + "?concept=other&revision=other",
          "POST",
          ask(c),
        )
      ).status,
      404,
    );
    for (const field of ["preview", "excluded"]) {
      await seed(c.r, (i) => {
        i[field] = true;
      });
      assert.equal((await c.owner(c.endpoint, "POST", ask(c))).status, 409);
      await seed(c.r, (i) => {
        i[field] = false;
      });
    }
    await seed(c.r, (i) => {
      i.status = "active";
    });
    assert.equal((await c.owner(c.endpoint, "POST", ask(c))).status, 409);
    await seed(c.r, (i) => {
      i.status = "complete";
    });
    await seed(c.r, (i) => {
      i.turns[0].answer = "Changed source answer";
    });
    assert.equal((await c.owner(c.endpoint, "POST", ask(c))).status, 409);
    await seed(c.r, (i) => {
      i.turns[0].answer = "Synthetic written answer";
    });
    const file = path.join(dataDirectory(), "media", c.id),
      original = await readFile(file);
    try {
      await writeFile(
        file,
        JSON.stringify({
          version: 1,
          paragraphs: ["Changed snapshot", "Save draft before review."],
        }),
      );
      assert.equal((await c.owner(c.endpoint, "POST", ask(c))).status, 409);
    } finally {
      await writeFile(file, original);
    }
    const language = await fixture(),
      s = (await language.owner(language.root)).study,
      guide = structuredClone(s.draft);
    guide.localization = {
      sourceLanguage: "en",
      reportingLanguage: "fr",
      guidance: "",
      translations: [],
    };
    await language.owner(language.root, "PUT", { version: s.version, guide });
    assert.equal(
      (await language.owner(language.endpoint, "POST", ask(language))).status,
      409,
    );
    for (const action of ["withdraw", "file", "response"]) {
      const deleted = await fixture();
      if (action === "withdraw") {
        const v = await deleted.owner(deleted.textPath);
        await deleted.owner(deleted.textPath, "PUT", {
          ...docxVerificationInput(v),
          includeInReports: false,
        });
      } else
        await deleted.owner(
          action === "file"
            ? deleted.asset
            : deleted.root + "/responses/" + deleted.r.interview.id,
          "DELETE",
        );
      assert.equal(
        (await deleted.owner(deleted.endpoint, "POST", ask(deleted))).status,
        404,
      );
    }
  },
);
