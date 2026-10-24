import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import path from "node:path";
import { start, stop, dataDirectory } from "./harness";
import { client, seed } from "./image-review-fixture";
import { participantPDFGuide } from "./participant-pdfs-fixture";
import { scannedPDF } from "./pdf-ocr-fixture";
import {
  pdfOCRPermissionVersion,
  pdfOCRPermissionText,
} from "../src/lib/pdf-ocr";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3222 : 3221 }),
  { timeout: 90000 },
);
after(stop);
async function fixture() {
  const owner = await client(),
    person = await client();
  await owner("auth/signup", "POST", {
    name: "OCR reviewer",
    email: randomUUID() + "@example.test",
    password: "pdf-ocr-password",
  });
  let s = (await owner("studies", "POST", { title: "Synthetic scanned PDF" }))
    .study;
  const root = "studies/" + s.id;
  s = (
    await owner(root, "PUT", {
      version: s.version,
      guide: participantPDFGuide(),
    })
  ).study;
  s = (await owner(root + "/publish", "POST", { version: s.version })).study;
  await owner(root + "/fielding", "POST", { state: "active" });
  const r = await person("public/" + s.id, "POST", { consent: true }),
    ip = "interviews/" + r.interview.id,
    h = { "x-interview-token": r.token };
  const uploaded = await person(
    ip + "/participant-pdfs",
    "POST",
    await scannedPDF(),
    {
      ...h,
      "content-type": "application/pdf",
      "x-upload-id": randomUUID(),
      "x-interview-version": "0",
      "x-pdf-description": "Synthetic scanned page",
      "x-pdf-consent": "yes",
    },
  );
  assert.equal(uploaded.status, 201);
  const asset = root + "/participant-pdfs/" + uploaded.pdf.id;
  await person(
    ip + "/answer",
    "POST",
    {
      version: 0,
      requestId: randomUUID(),
      answer: "Synthetic scan",
      participantPDFId: uploaded.pdf.id,
    },
    h,
  );
  await person(
    ip + "/answer",
    "POST",
    { version: 1, requestId: randomUUID(), answer: "Synthetic closing answer" },
    h,
  );
  const initial = await owner(asset + "/text", "POST", {});
  assert.equal(initial.status, 200);
  return {
    owner,
    person,
    root,
    ip,
    h,
    asset,
    initial,
    pdfId: uploaded.pdf.id,
    r,
  };
}
async function seedDraft(c: any) {
  const d = createClient({
    url: "file:" + path.join(dataDirectory(), "research.sqlite"),
  });
  const row = (
    await d.execute({
      sql: "SELECT data FROM documents WHERE kind='participantPDFText' AND id=?",
      args: [c.pdfId],
    })
  ).rows[0];
  const text = JSON.parse(String(row.data));
  text.ocr = [
    {
      id: randomUUID(),
      page: 2,
      draft: "Synthetic draft with an OCR eror",
      model: "synthetic-fixture",
      promptVersion: pdfOCRPermissionVersion,
      generatedAt: new Date().toISOString(),
      permission: {
        version: pdfOCRPermissionVersion,
        text: pdfOCRPermissionText,
        provider: "OpenAI",
        grantedAt: new Date().toISOString(),
        actor: { id: "fixture", name: "Synthetic permission" },
      },
    },
  ];
  await d.execute({
    sql: "UPDATE documents SET data=? WHERE kind='participantPDFText' AND id=?",
    args: [JSON.stringify(text), c.pdfId],
  });
  d.close();
  return text;
}

async function accepted() {
  const c = await fixture(),
    draft = await seedDraft(c);
  const text = (
    await c.owner(c.asset + "/ocr", "PUT", {
      source: c.initial.source,
      digest: draft.digest,
      page: 2,
      draftId: draft.ocr[0].id,
      text: "Save draft before review.",
      attested: true,
      version: 0,
    })
  ).text;
  assert.ok(text?.ocr[0].accepted);
  return { ...c, text };
}
function input(c: any, text = c.text, changes: any = {}) {
  return {
    source: c.initial.source,
    digest: text.digest,
    page: 2,
    draftId: text.ocr[0].id,
    text: "Save draft before review.\n",
    attested: true,
    version: text.history.at(-1).version,
    correctionVersion: text.ocr[0].corrections?.at(-1)?.version || 0,
    reason: "Check punctuation against original page",
    ...changes,
  };
}
async function include(c: any) {
  let r = await c.owner(c.asset + "/text");
  r = await c.owner(c.asset + "/text", "PUT", {
    source: r.source,
    digest: r.text.digest,
    version: r.text.history.at(-1).version,
    attested: true,
    includeInReports: true,
    passages: r.text.pages.map((quote: string, n: number) => ({
      page: n + 1,
      start: 0,
      end: quote.length,
      quote,
    })),
  });
  c.text = r.text;
  let a = (await c.owner(c.root + "/analysis", "POST", { mode: "manual" }))
    .analysis;
  // A marked private saved-answer fixture verifies that correction erases nested
  // originals/history too, even though this draft is never report evidence.
  a.pdfAnswers = [
    {
      id: randomUUID(),
      original: {
        question: "Private fixture question",
        answer: "Private saved answer sentinel",
        citations: [],
        model: "fixture",
        promptVersion: "fixture",
        generatedAt: new Date().toISOString(),
      },
      sources: [],
      history: [],
    },
  ];
  const d = createClient({
    url: "file:" + path.join(dataDirectory(), "research.sqlite"),
  });
  await d.execute({
    sql: "UPDATE documents SET data=? WHERE kind='analysis' AND id=?",
    args: [JSON.stringify(a), a.id],
  });
  d.close();
  a = (await c.owner(c.root + "/analysis", "PUT", { ...a, reviewed: true }))
    .analysis;
  let e = (
    await c.owner(c.root + "/reporting/editions", "POST", {
      analysisId: a.id,
      title: "Before OCR correction",
    })
  ).edition;
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
  "Verified OCR corrections preserve initial draft/acceptance/history, remove affected selections and revoke saved answers/reports before re-inclusion",
  { timeout: 90000 },
  async () => {
    const c = await accepted(),
      reports = await include(c),
      original = structuredClone(c.text.ocr[0]),
      history = structuredClone(c.text.history),
      beforeDigest = c.text.digest;
    const correction = input(c, c.text, {
      text: "Save draft before review.\n",
      reason: "Preserve the line ending",
    });
    // Normalized no-op corrections must preserve published links and history.
    assert.equal(
      (await c.owner(c.asset + "/ocr", "PUT", correction)).status,
      400,
    );
    assert.equal((await c.person("shared/" + reports.share)).status, 200);
    const body = input(c, c.text, {
      text: "Synthetic scanned research page\nSave draft before review.",
      reason: "Restore omitted heading after checking the original page",
    });
    const concurrent = await Promise.all([
      c.owner(c.asset + "/ocr", "PUT", body),
      c.owner(c.asset + "/ocr", "PUT", body),
    ]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
    let r = await c.owner(c.asset + "/text");
    assert.notEqual(r.text.digest, beforeDigest);
    assert.equal(r.text.pages[1], body.text);
    assert.deepEqual(r.text.ocr[0].accepted, original.accepted);
    assert.equal(r.text.ocr[0].draft, original.draft);
    assert.deepEqual(r.text.ocr[0].permission, original.permission);
    assert.deepEqual(r.text.history.slice(0, -1), history);
    const changed = r.text.ocr[0].corrections[0];
    assert.equal(changed.version, 1);
    assert.equal(changed.reason, body.reason);
    assert.equal(changed.reviewer.name, "OCR reviewer");
    assert.equal(changed.previousDigest, beforeDigest);
    assert.equal(changed.digest, r.text.digest);
    assert.equal(r.text.history.at(-1).includeInReports, false);
    assert.equal(r.text.history.at(-1).ocrCorrectionVersion, 1);
    assert.deepEqual(
      r.text.history.at(-1).passages.map((p: any) => p.page),
      [1],
    );
    assert.equal((await c.owner(c.root + "/analysis")).analysis, null);
    assert.equal((await c.person("shared/" + reports.memo)).status, 404);
    assert.equal((await c.person("shared/" + reports.share)).status, 404);
    assert.equal(
      (await c.owner(c.root + "/reporting/editions/" + reports.e.id)).status,
      404,
    );
    const d = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    assert.equal(
      (
        await d.execute({
          sql: "SELECT id FROM documents WHERE kind='analysis' AND id=?",
          args: [reports.a.id],
        })
      ).rows.length,
      0,
    );
    d.close();
    let a = (await c.owner(c.root + "/analysis", "POST", { mode: "manual" }))
      .analysis;
    assert.deepEqual(a.pdfEvidence || [], []);
    const quote = "Save draft before review.",
      start = body.text.indexOf(quote);
    assert.equal(
      (
        await c.owner(c.asset + "/text", "PUT", {
          source: r.source,
          digest: r.text.digest,
          version: r.text.history.at(-1).version,
          attested: true,
          includeInReports: true,
          passages: [{ page: 2, start: 0, end: quote.length, quote }],
        })
      ).status,
      400,
    );
    r = await c.owner(c.asset + "/text", "PUT", {
      source: r.source,
      digest: r.text.digest,
      version: r.text.history.at(-1).version,
      attested: true,
      includeInReports: true,
      passages: [{ page: 2, start, end: start + quote.length, quote }],
    });
    assert.equal(r.status, 200);
    a = (await c.owner(c.root + "/analysis", "POST", { mode: "manual" }))
      .analysis;
    assert.equal(a.pdfEvidence[0].digest, r.text.digest);
    assert.deepEqual(a.pdfEvidence[0].ocrPages, [2]);
    assert.equal(a.pdfEvidence[0].passages[0].start, start);
    const second = input(c, r.text, {
      text: quote,
      reason: "Remove nonselected heading after a new source comparison",
    });
    r = await c.owner(c.asset + "/ocr", "PUT", second);
    assert.equal(r.status, 200);
    assert.equal(r.text.ocr[0].corrections.length, 2);
    assert.deepEqual(r.text.ocr[0].corrections[0], changed);
    assert.deepEqual(r.text.ocr[0].accepted, original.accepted);
    assert.equal((await c.owner(c.asset + "/ocr", "PUT", second)).status, 409);
  },
);
test(
  "OCR corrections enforce editor/source/native-page, strict provenance, revision/size limits without partial invalidation",
  { timeout: 90000 },
  async () => {
    const c = await accepted(),
      reports = await include(c),
      body = input(c, c.text, {
        text: "Synthetic scanned research page\nSave draft before review.",
        reason: "Restore heading",
      }),
      url = c.asset + "/ocr";
    assert.equal((await c.person(url, "PUT", body)).status, 401);
    assert.equal(
      (
        await c.person(
          c.ip + "/participant-pdfs/" + c.pdfId + "/ocr",
          "PUT",
          body,
          c.h,
        )
      ).status,
      404,
    );
    const other = await client();
    await other("auth/signup", "POST", {
      name: "Other",
      email: randomUUID() + "@example.test",
      password: "ocr-corrections-password",
    });
    assert.equal((await other(url, "PUT", body)).status, 404);
    const d = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    try {
      await d.execute({
        sql: "UPDATE users SET role='viewer' WHERE workspace_id=(SELECT workspace_id FROM documents WHERE kind='participantPDFText' AND id=?)",
        args: [c.pdfId],
      });
      assert.equal((await c.owner(url, "PUT", body)).status, 403);
    } finally {
      await d.execute({
        sql: "UPDATE users SET role='admin' WHERE workspace_id=(SELECT workspace_id FROM documents WHERE kind='participantPDFText' AND id=?)",
        args: [c.pdfId],
      });
    }
    for (const patch of [
      { attested: false },
      { reason: " " },
      { text: " " },
      { text: "x".repeat(12001) },
      { reason: "x".repeat(1001) },
      { reviewer: { name: "forged" } },
    ])
      assert.equal(
        (await c.owner(url, "PUT", { ...body, ...patch })).status,
        400,
      );
    for (const patch of [
      { version: 99 },
      { correctionVersion: 99 },
      { digest: "0".repeat(64) },
      { page: 1 },
      { draftId: randomUUID() },
      { source: "0".repeat(64) },
    ])
      assert.equal(
        (await c.owner(url, "PUT", { ...body, ...patch })).status,
        409,
      );
    let originalAnswer = "";
    await seed(c.r, (i) => {
      originalAnswer = i.turns[0].answer;
      i.turns[0].answer = "Changed source";
    });
    assert.equal((await c.owner(url, "PUT", body)).status, 409);
    await seed(c.r, (i) => {
      i.turns[0].answer = originalAnswer;
    });
    const limited = structuredClone(c.text);
    limited.ocr[0].corrections = Array.from({ length: 20 }, (_, n) => ({
      ...limited.ocr[0].accepted,
      version: n + 1,
      reason: "Fixture history",
    }));
    await d.execute({
      sql: "UPDATE documents SET data=? WHERE kind='participantPDFText' AND id=?",
      args: [JSON.stringify(limited), c.pdfId],
    });
    assert.equal(
      (await c.owner(url, "PUT", { ...body, correctionVersion: 20 })).status,
      409,
    );
    await d.execute({
      sql: "UPDATE documents SET data=? WHERE kind='participantPDFText' AND id=?",
      args: [JSON.stringify(c.text), c.pdfId],
    });
    d.close();
    assert.equal((await c.person("shared/" + reports.share)).status, 200);
    assert.equal(
      (await c.owner(c.root + "/analysis")).analysis.id,
      reports.a.id,
    );
  },
);
test(
  "OCR correction reasons and earlier text stay private and whole-response erasure removes all revisions",
  { timeout: 90000 },
  async () => {
    const c = await accepted();
    const r = await c.owner(
      c.asset + "/ocr",
      "PUT",
      input(c, c.text, {
        text: "Synthetic scanned research page\nSave draft before review.",
        reason: "Private correction reason sentinel",
      }),
    );
    assert.equal(r.status, 200);
    const publicView = JSON.stringify(
      await c.person(c.ip, "GET", undefined, c.h),
    );
    assert.ok(!publicView.includes("Private correction reason sentinel"));
    assert.ok(!publicView.includes("corrections"));
    assert.equal(
      (await c.owner(c.root + "/responses/" + c.r.interview.id, "DELETE"))
        .status,
      200,
    );
    assert.equal(
      (await c.owner(c.asset + "/ocr", "PUT", input(c, r.text))).status,
      404,
    );
    const d = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    assert.equal(
      (
        await d.execute({
          sql: "SELECT id FROM documents WHERE kind='participantPDFText' AND id=?",
          args: [c.pdfId],
        })
      ).rows.length,
      0,
    );
    d.close();
  },
);
