import JSZip from "jszip";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { client } from "./image-review-fixture";
import { docxTextDB } from "./docx-text-fixture";
import { docxSynthesisSource } from "./docx-synthesis-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3240 : 3239 }),
  { timeout: 90000 },
);
after(stop);
async function fixture() {
  const c = await docxSynthesisSource();
  return { ...c, docxId: c.id, headers: c.h, endpoint: c.root + "/docx-qa" };
}
const setup = fixture;
async function draft(c: any, empty = false) {
  const original = {
    question: "What wording change does the reviewer recommend?",
    answer: "Private original AI wording sentinel",
    citations: empty
      ? []
      : [
          {
            docxId: c.docxId,
            verificationVersion: c.a.docxEvidence[0].verificationVersion,
            paragraph: 2,
            start: 0,
            end: 25,
            quote: "Save draft before review.",
          },
        ],
    model: "synthetic-fixture",
    promptVersion: "synthetic-fixture",
    generatedAt: new Date().toISOString(),
  };
  const entry = {
    id: randomUUID(),
    original,
    sources: structuredClone(c.a.docxEvidence),
    history: [
      {
        version: 1,
        at: new Date().toISOString(),
        editor: { id: "synthetic", name: "Synthetic saver" },
        answer: original.answer,
        citations: original.citations,
        reviewed: false,
        includeInReports: false,
      },
    ],
  };
  const sql = docxTextDB();
  try {
    const row = (
      await sql.execute({
        sql: "SELECT data FROM documents WHERE kind='analysis' AND id=?",
        args: [c.a.id],
      })
    ).rows[0];
    const a = JSON.parse(String(row.data));
    a.docxAnswers = [...(a.docxAnswers || []), entry];
    await sql.execute({
      sql: "UPDATE documents SET data=? WHERE kind='analysis' AND id=?",
      args: [JSON.stringify(a), a.id],
    });
  } finally {
    sql.close();
  }
  return entry;
}
const endpoint = (c: any) => c.root + "/docx-answers";
async function edit(c: any, id: string, changes: any = {}, method = "PUT") {
  const a = (await c.owner(c.root + "/analysis")).analysis,
    r = a.docxAnswers.find((s: any) => s.id === id).history.at(-1);
  return c.owner(endpoint(c), method, {
    id: a.id,
    version: a.version,
    answerId: id,
    answerVersion: r.version,
    ...(method === "PUT"
      ? {
          answer: r.answer,
          citations: r.citations,
          reviewed: r.reviewed,
          includeInReports: r.includeInReports,
        }
      : {}),
    ...changes,
  });
}
async function reports(c: any) {
  let a = (await c.owner(c.root + "/analysis")).analysis;
  a = (await c.owner(c.root + "/analysis", "PUT", { ...a, reviewed: true }))
    .analysis;
  let e = (
    await c.owner(c.root + "/reporting/editions", "POST", {
      analysisId: a.id,
      title: "Reviewed saved DOCX Q&A",
    })
  ).edition;
  assert.ok(e);
  e = (
    await c.owner(c.root + "/reporting/editions/" + e.id, "PUT", {
      ...e,
      reviewed: true,
    })
  ).edition;
  return {
    a,
    e,
    memo: (await c.owner(c.root + "/share", "POST")).token,
    share: (
      await c.owner(c.root + "/reporting/editions/" + e.id + "/share", "POST")
    ).token,
  };
}
test(
  "Saved DOCX Q&A drafts stay private; exact review/inclusion produces attributed report/deck projections without original/history or forged metadata",
  { timeout: 90000 },
  async () => {
    const c = await fixture(),
      saved = await draft(c),
      privateReports = await reports(c);
    assert.equal(privateReports.e.docxAnswers, undefined);
    assert.ok(
      !(await c.person("shared/" + privateReports.share)).memo.includes(
        saved.original.answer,
      ),
    );
    for (const patch of [
      { includeInReports: true, reviewed: false },
      { includeInReports: true, reviewed: true, citations: [] },
    ])
      assert.equal((await edit(c, saved.id, patch)).status, 400);
    assert.equal(
      (
        await edit(c, saved.id, {
          citations: [{ ...saved.original.citations[0], paragraph: 1 }],
        })
      ).status,
      502,
    );
    assert.equal((await edit(c, saved.id, { model: "forged" })).status, 400);
    assert.equal((await edit(c, saved.id, { question: "forged" })).status, 400);
    const included = await edit(c, saved.id, {
      answer: "Reviewed neutral wording recommendation sentinel",
      reviewed: true,
      includeInReports: true,
    });
    assert.equal(included.status, 200);
    assert.equal(included.analysis.reviewed, false);
    assert.deepEqual(included.analysis.docxAnswers[0].original, saved.original);
    assert.deepEqual(
      included.analysis.docxAnswers[0].history[0],
      saved.history[0],
    );
    assert.equal(
      (await c.person("shared/" + privateReports.share)).status,
      404,
    );
    const r = await reports(c),
      projection = r.e.docxAnswers[0];
    assert.equal(
      projection.answer,
      "Reviewed neutral wording recommendation sentinel",
    );
    assert.equal(projection.reviewerName, "DOCX passage reviewer");
    assert.equal(projection.edited, true);
    assert.equal(projection.original, undefined);
    assert.equal(projection.history, undefined);
    assert.equal(r.e.sampleSize, 1);
    assert.deepEqual(r.a.themes, []);
    for (const token of [r.memo, r.share]) {
      const memo = (await c.person("shared/" + token)).memo;
      assert.ok(memo.includes(projection.answer));
      assert.ok(memo.includes("Reviewed DOCX passage Q&A"));
      assert.ok(!memo.includes("Researcher-verified OCR"));
      assert.ok(!memo.includes(saved.original.answer));
    }
    const { analysisDto } = await import("../src/lib/external-api");
    assert.ok(
      !JSON.stringify(analysisDto(r.a, true)).includes(projection.answer),
    );
    assert.ok(
      !JSON.stringify(
        await c.person(c.ip, "GET", undefined, c.headers),
      ).includes(projection.answer),
    );
    const deck = await c.owner(
      c.root + "/reporting/editions/" + r.e.id + "/deck",
    );
    assert.equal(deck.status, 200);
    const zip = await JSZip.loadAsync(deck.bytes),
      text = (
        await Promise.all(
          Object.keys(zip.files)
            .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
            .map((n) => zip.file(n)!.async("string")),
        )
      ).join(" ");
    assert.ok(text.includes(projection.answer));
    assert.ok(!text.includes(saved.original.answer));
    const forged = await c.owner(
      c.root + "/reporting/editions/" + r.e.id,
      "PUT",
      {
        ...r.e,
        docxAnswers: [{ ...projection, reviewerName: "forged" }],
      },
    );
    assert.equal(
      forged.edition.docxAnswers[0].reviewerName,
      "DOCX passage reviewer",
    );
    const a = (await c.owner(c.root + "/analysis")).analysis,
      record = a.docxAnswers[0],
      body = {
        id: a.id,
        version: a.version,
        answerId: saved.id,
        answerVersion: record.history.at(-1).version,
        answer: projection.answer,
        citations: projection.citations,
        reviewed: true,
        includeInReports: true,
      };
    const concurrent = await Promise.all([
      c.owner(endpoint(c), "PUT", body),
      c.owner(endpoint(c), "PUT", body),
    ]);
    assert.deepEqual(concurrent.map((x) => x.status).sort(), [200, 409]);
    assert.equal((await c.person("shared/" + r.share)).status, 404);
  },
);
test(
  "Private-only reviews preserve published answers; included edits, withdrawal and deletion revoke report snapshots/shares",
  { timeout: 90000 },
  async () => {
    const c = await fixture(),
      first = await draft(c);
    await edit(c, first.id, { reviewed: true, includeInReports: true });
    const second = await draft(c),
      r = await reports(c);
    await edit(c, second.id, {
      answer: "Another private draft sentinel",
      reviewed: true,
    });
    assert.equal((await c.person("shared/" + r.share)).status, 200);
    await edit(c, first.id, { includeInReports: false, reviewed: true });
    assert.equal((await c.person("shared/" + r.memo)).status, 404);
    assert.equal((await c.person("shared/" + r.share)).status, 404);
    assert.equal(
      (await c.owner(c.root + "/reporting/editions/" + r.e.id)).status,
      404,
    );
    await edit(c, first.id, { includeInReports: true, reviewed: true });
    const next = await reports(c);
    await edit(c, first.id, {}, "DELETE");
    assert.equal((await c.person("shared/" + next.share)).status, 404);
    assert.equal(
      (await c.owner(c.root + "/analysis")).analysis.docxAnswers.length,
      1,
    );
  },
);
test(
  "Saved Q&A auth, no-citation/limit gates, provider failure and source erasure preserve provenance and prevent invalid sharing",
  { timeout: 90000 },
  async () => {
    const c = await fixture(),
      saved = await draft(c, true),
      a = (await c.owner(c.root + "/analysis")).analysis,
      body = {
        id: a.id,
        version: a.version,
        answerId: saved.id,
        answerVersion: 1,
        answer: saved.original.answer,
        citations: [],
        reviewed: true,
        includeInReports: true,
      };
    const anon = await client();
    assert.equal((await anon(endpoint(c), "PUT", body)).status, 401);
    const other = await setup();
    assert.equal((await other.owner(endpoint(c), "PUT", body)).status, 404);
    assert.equal((await c.owner(endpoint(c), "PUT", body)).status, 400);
    const before = (await c.owner(c.root + "/analysis")).analysis;
    assert.equal(
      (
        await c.owner(c.endpoint, "POST", {
          id: before.id,
          version: before.version,
          question: "What change was recommended?",
          saveDraft: true,
        })
      ).status,
      503,
    );
    assert.deepEqual((await c.owner(c.root + "/analysis")).analysis, before);
    const gates = docxTextDB();
    try {
      await gates.execute({
        sql: "UPDATE users SET role='viewer' WHERE workspace_id=(SELECT workspace_id FROM documents WHERE kind='study' AND id=?)",
        args: [c.s.id],
      });
      assert.equal((await c.owner(endpoint(c), "PUT", body)).status, 403);
      await gates.execute({
        sql: "UPDATE users SET role='admin' WHERE workspace_id=(SELECT workspace_id FROM documents WHERE kind='study' AND id=?)",
        args: [c.s.id],
      });
      const bounded = structuredClone(before);
      bounded.docxAnswers[0].history = Array.from({ length: 50 }, (_, n) => ({
        ...saved.history[0],
        version: n + 1,
      }));
      await gates.execute({
        sql: "UPDATE documents SET data=? WHERE kind='analysis' AND id=?",
        args: [JSON.stringify(bounded), before.id],
      });
      assert.equal(
        (await edit(c, saved.id, { reviewed: true, includeInReports: false }))
          .status,
        409,
      );
      await gates.execute({
        sql: "UPDATE documents SET data=? WHERE kind='analysis' AND id=?",
        args: [JSON.stringify(before), before.id],
      });
    } finally {
      gates.close();
    }
    for (let n = 1; n < 20; n++) await draft(c);
    const full = (await c.owner(c.root + "/analysis")).analysis;
    assert.equal(
      (
        await c.owner(c.endpoint, "POST", {
          id: full.id,
          version: full.version,
          question: "What change was recommended?",
          saveDraft: true,
        })
      ).status,
      409,
    );
    await c.owner(c.root + "/participant-docx/" + c.docxId, "DELETE");
    assert.equal((await c.owner(c.root + "/analysis")).analysis, null);
    assert.equal(
      (
        await c.owner(endpoint(c), "DELETE", {
          id: a.id,
          version: a.version,
          answerId: saved.id,
          answerVersion: 1,
        })
      ).status,
      404,
    );
  },
);
