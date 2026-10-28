import JSZip from "jszip";
import { createClient } from "@libsql/client";
import path from "node:path";
import { scannedPDF } from "./pdf-ocr-fixture";
import {
  pdfOCRPermissionText,
  pdfOCRPermissionVersion,
} from "../src/lib/pdf-ocr";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, dataDirectory } from "./harness";
import { client, seed } from "./image-review-fixture";
import { samplePDF, participantPDFGuide } from "./participant-pdfs-fixture";
before(
  () =>
    start({
      port: process.env.RESEARCH_TEST_PORT
        ? Number(process.env.RESEARCH_TEST_PORT)
        : process.env.RESEARCH_TEST_PRODUCTION === "1"
          ? 3219
          : 3218,
    }),
  { timeout: 90000 },
);
after(stop);
async function setup() {
  const owner = await client(),
    person = await client();
  await owner("auth/signup", "POST", {
    name: "PDF reviewer",
    email: randomUUID() + "@example.test",
    password: "pdf-test-password",
  });
  let s = (await owner("studies", "POST", { title: "PDF workflow" })).study;
  const root = "studies/" + s.id;
  s = (
    await owner(root, "PUT", {
      version: s.version,
      guide: participantPDFGuide(),
    })
  ).study;
  s = (await owner(root + "/publish", "POST", { version: s.version })).study;
  await owner(root + "/fielding", "POST", { state: "active" });
  const r = await person("public/" + s.id, "POST", { consent: true });
  return {
    owner,
    person,
    s,
    root,
    r,
    ip: "interviews/" + r.interview.id,
    headers: { "x-interview-token": r.token },
  };
}
async function upload(
  ctx: any,
  id = randomUUID(),
  description = "Synthetic two-page research PDF",
  version = 0,
  changes: any = {},
) {
  return ctx.person(ctx.ip + "/participant-pdfs", "POST", await scannedPDF(), {
    ...ctx.headers,
    "content-type": "application/pdf",
    "x-upload-id": id,
    "x-interview-version": String(version),
    "x-pdf-description": encodeURIComponent(description),
    "x-pdf-consent": "yes",
    ...changes,
  });
}
async function answer(
  ctx: any,
  pdfId?: string,
  version = 0,
  requestId = randomUUID(),
) {
  return ctx.person(
    ctx.ip + "/answer",
    "POST",
    {
      version,
      requestId,
      answer: "The synthetic document shows the workflow.",
      participantPDFId: pdfId,
    },
    ctx.headers,
  );
}

async function source() {
  const c = await setup(),
    pdf = await upload(c);
  await answer(c, pdf.pdf.id);
  await answer(c, undefined, 1);
  return {
    ...c,
    pdfId: pdf.pdf.id,
    url: c.root + "/participant-pdfs/" + pdf.pdf.id + "/text",
  };
}
async function fixture(included = true, ocr = true) {
  const c = await source();
  let r = await c.owner(c.url, "POST", {});
  if (ocr) {
    const d = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    const text = r.text,
      draftId = randomUUID();
    text.ocr = [
      {
        id: draftId,
        page: 2,
        draft: "Save draft befor review.",
        model: "synthetic-http",
        promptVersion: pdfOCRPermissionVersion,
        generatedAt: new Date().toISOString(),
        permission: {
          version: pdfOCRPermissionVersion,
          text: pdfOCRPermissionText,
          provider: "OpenAI",
          grantedAt: new Date().toISOString(),
          actor: { id: "fixture", name: "Fixture permission" },
        },
      },
    ];
    await d.execute({
      sql: "UPDATE documents SET data=? WHERE kind='participantPDFText' AND id=?",
      args: [JSON.stringify(text), c.pdfId],
    });
    d.close();
    r = await c.owner(c.root + "/participant-pdfs/" + c.pdfId + "/ocr", "PUT", {
      source: r.source,
      digest: text.digest,
      page: 2,
      draftId,
      text: "Save draft before review.",
      attested: true,
      version: 0,
    });
    assert.equal(r.status, 200);
  }
  const page = ocr ? 2 : 1,
    quote = r.text.pages[page - 1];
  const verified = await c.owner(c.url, "PUT", {
    source: r.source,
    digest: r.text.digest,
    version: r.text.history.at(-1)?.version || 0,
    attested: true,
    includeInReports: included,
    passages: [{ page, start: 0, end: quote.length, quote }],
  });
  assert.equal(verified.status, 200);
  const a = (await c.owner(c.root + "/analysis", "POST", { mode: "manual" }))
    .analysis;
  return { ...c, a, endpoint: c.root + "/pdf-qa" };
}
async function draft(c: any, empty = false) {
  const original = {
    question: "What wording change does the reviewer recommend?",
    answer: "Private original AI wording sentinel",
    citations: empty
      ? []
      : [
          {
            pdfId: c.pdfId,
            verificationVersion: c.a.pdfEvidence[0].verificationVersion,
            page: 2,
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
    sources: structuredClone(c.a.pdfEvidence),
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
  const sql = createClient({
    url: "file:" + path.join(dataDirectory(), "research.sqlite"),
  });
  try {
    const row = (
      await sql.execute({
        sql: "SELECT data FROM documents WHERE kind='analysis' AND id=?",
        args: [c.a.id],
      })
    ).rows[0];
    const a = JSON.parse(String(row.data));
    a.pdfAnswers = [...(a.pdfAnswers || []), entry];
    await sql.execute({
      sql: "UPDATE documents SET data=? WHERE kind='analysis' AND id=?",
      args: [JSON.stringify(a), a.id],
    });
  } finally {
    sql.close();
  }
  return entry;
}
const endpoint = (c: any) => c.root + "/pdf-answers";
async function edit(c: any, id: string, changes: any = {}, method = "PUT") {
  const a = (await c.owner(c.root + "/analysis")).analysis,
    r = a.pdfAnswers.find((s: any) => s.id === id).history.at(-1);
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
      title: "Reviewed saved PDF Q&A",
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
  "Saved PDF Q&A drafts stay private; exact review/inclusion produces attributed report/deck projections without original/history or forged metadata",
  { timeout: 90000 },
  async () => {
    const c = await fixture(),
      saved = await draft(c),
      privateReports = await reports(c);
    assert.equal(privateReports.e.pdfAnswers, undefined);
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
          citations: [{ ...saved.original.citations[0], page: 1 }],
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
    assert.deepEqual(included.analysis.pdfAnswers[0].original, saved.original);
    assert.deepEqual(
      included.analysis.pdfAnswers[0].history[0],
      saved.history[0],
    );
    assert.equal(
      (await c.person("shared/" + privateReports.share)).status,
      404,
    );
    const r = await reports(c),
      projection = r.e.pdfAnswers[0];
    assert.equal(
      projection.answer,
      "Reviewed neutral wording recommendation sentinel",
    );
    assert.equal(projection.reviewerName, "PDF reviewer");
    assert.equal(projection.edited, true);
    assert.equal(projection.original, undefined);
    assert.equal(projection.history, undefined);
    assert.equal(r.e.sampleSize, 1);
    assert.deepEqual(r.a.themes, []);
    for (const token of [r.memo, r.share]) {
      const memo = (await c.person("shared/" + token)).memo;
      assert.ok(memo.includes(projection.answer));
      assert.ok(memo.includes("Reviewed PDF passage Q&A"));
      assert.ok(memo.includes("Researcher-verified OCR"));
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
        pdfAnswers: [{ ...projection, reviewerName: "forged" }],
      },
    );
    assert.equal(forged.edition.pdfAnswers[0].reviewerName, "PDF reviewer");
    const a = (await c.owner(c.root + "/analysis")).analysis,
      record = a.pdfAnswers[0],
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
      (await c.owner(c.root + "/analysis")).analysis.pdfAnswers.length,
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
    const gates = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
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
      bounded.pdfAnswers[0].history = Array.from({ length: 50 }, (_, n) => ({
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
    await c.owner(c.root + "/participant-pdfs/" + c.pdfId, "DELETE");
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
