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
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3213 : 3212 }),
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
test(
  "OCR authorization/permission/page gates, private draft isolation, explicit verification, evidence inclusion and invalidation",
  { timeout: 90000 },
  async () => {
    const c = await fixture(),
      ocr = c.asset + "/ocr",
      native = {
        source: c.initial.source,
        digest: c.initial.text.digest,
        page: 2,
        permission: true,
        permissionVersion: pdfOCRPermissionVersion,
      };
    assert.equal((await c.owner(ocr)).status, 405);
    assert.equal((await c.person(ocr, "POST", native)).status, 401);
    assert.equal(
      (
        await c.person(
          c.ip + "/participant-pdfs/" + c.pdfId + "/ocr",
          "POST",
          native,
          c.h,
        )
      ).status,
      404,
    );
    assert.equal(
      (await c.owner(ocr, "POST", { ...native, permission: false })).status,
      400,
    );
    assert.equal(
      (await c.owner(ocr, "POST", { ...native, permissionVersion: "stale" }))
        .status,
      400,
    );
    assert.equal(
      (await c.owner(ocr, "POST", { ...native, model: "forged" })).status,
      400,
    );
    assert.equal(
      (await c.owner(ocr, "POST", { ...native, page: 1 })).status,
      409,
    );
    assert.equal(
      (await c.owner(ocr, "POST", { ...native, page: 3 })).status,
      409,
    );
    assert.equal((await c.owner(ocr, "POST", native)).status, 503);
    const authDB = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    try {
      await authDB.execute({
        sql: "UPDATE users SET role='viewer' WHERE workspace_id=(SELECT workspace_id FROM documents WHERE kind='participantPDFText' AND id=?)",
        args: [c.pdfId],
      });
      assert.equal((await c.owner(ocr, "POST", native)).status, 403);
      assert.equal((await c.owner(ocr, "PUT", {})).status, 403);
    } finally {
      await authDB.execute({
        sql: "UPDATE users SET role='admin' WHERE workspace_id=(SELECT workspace_id FROM documents WHERE kind='participantPDFText' AND id=?)",
        args: [c.pdfId],
      });
      authDB.close();
    }
    let text = await seedDraft(c);
    const original = structuredClone(text.ocr[0]);
    // Draft creation is idempotent and does not put AI output in extracted pages.
    assert.equal((await c.owner(ocr, "POST", native)).text.ocr.length, 1);
    assert.equal((await c.owner(c.asset + "/text")).text.pages[1], "");
    let a = (await c.owner(c.root + "/analysis", "POST", { mode: "manual" }))
      .analysis;
    assert.deepEqual(a.pdfEvidence || [], []);
    a = (await c.owner(c.root + "/analysis", "PUT", { ...a, reviewed: true }))
      .analysis;
    const share = (await c.owner(c.root + "/share", "POST")).token;
    const other = await client();
    await other("auth/signup", "POST", {
      name: "Other",
      email: randomUUID() + "@example.test",
      password: "pdf-ocr-password",
    });
    assert.equal((await other(ocr, "PUT", {})).status, 404);
    const accept = {
      source: c.initial.source,
      digest: text.digest,
      page: 2,
      draftId: text.ocr[0].id,
      text: "Save draft before review.",
      attested: true,
      version: 0,
    };
    assert.equal(
      (await c.owner(ocr, "PUT", { ...accept, attested: false })).status,
      400,
    );
    assert.equal(
      (await c.owner(ocr, "PUT", { ...accept, text: " " })).status,
      400,
    );
    assert.equal(
      (await c.owner(ocr, "PUT", { ...accept, digest: "0".repeat(64) })).status,
      409,
    );
    assert.equal(
      (await c.owner(ocr, "PUT", { ...accept, version: 9 })).status,
      409,
    );
    assert.equal(
      (await c.owner(ocr, "PUT", { ...accept, draftId: randomUUID() })).status,
      409,
    );
    let originalPrompt = "";
    await seed(c.r, (i) => {
      originalPrompt = i.turns[0].prompt;
      i.turns[0].prompt = "Changed OCR source";
    });
    assert.equal((await c.owner(ocr, "PUT", accept)).status, 409);
    await seed(c.r, (i) => {
      i.turns[0].prompt = originalPrompt;
    });
    const results = await Promise.all([
      c.owner(ocr, "PUT", accept),
      c.owner(ocr, "PUT", accept),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    text = (await c.owner(c.asset + "/text")).text;
    assert.equal(text.pages[1], accept.text);
    assert.notEqual(text.digest, accept.digest);
    assert.equal(text.history[0].includeInReports, false);
    assert.equal(text.history[0].ocrPage, 2);
    assert.equal(text.ocr[0].draft, original.draft);
    assert.deepEqual(text.ocr[0].permission, original.permission);
    assert.equal(text.ocr[0].accepted.reviewer.name, "OCR reviewer");
    assert.equal((await c.owner(c.root + "/analysis")).analysis, null);
    assert.equal((await c.person("shared/" + share)).status, 404);
    const passage = {
      page: 2,
      start: 0,
      end: accept.text.length,
      quote: accept.text,
    };
    const input = {
      source: c.initial.source,
      digest: text.digest,
      version: 1,
      attested: true,
      includeInReports: true,
      passages: [passage],
    };
    assert.equal(
      (
        await c.owner(c.asset + "/text", "PUT", {
          ...input,
          passages: [{ ...passage, quote: original.draft }],
        })
      ).status,
      400,
    );
    assert.equal((await c.owner(c.asset + "/text", "PUT", input)).status, 200);
    a = (await c.owner(c.root + "/analysis", "POST", { mode: "manual" }))
      .analysis;
    assert.deepEqual(a.pdfEvidence[0].ocrPages, [2]);
    assert.equal(a.pdfEvidence[0].passages[0].quote, accept.text);
    a = (await c.owner(c.root + "/analysis", "PUT", { ...a, reviewed: true }))
      .analysis;
    const published = (await c.owner(c.root + "/share", "POST")).token;
    const memo = (await c.person("shared/" + published)).memo;
    assert.match(memo, /Researcher-verified OCR/);
    assert.ok(!memo.includes(original.draft));
    const publicResult = JSON.stringify(
      await c.person(c.ip, "GET", undefined, c.h),
    );
    assert.ok(!publicResult.includes(original.draft));
    assert.ok(!publicResult.includes("OCR reviewer"));
    assert.equal((await c.owner(c.asset, "DELETE")).status, 200);
    assert.equal((await c.person("shared/" + published)).status, 404);
    assert.equal((await c.owner(ocr, "PUT", accept)).status, 404);
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
test(
  "whole-response erasure removes OCR drafts and permission records",
  { timeout: 90000 },
  async () => {
    const c = await fixture();
    await seedDraft(c);
    assert.equal(
      (await c.owner(c.root + "/responses/" + c.r.interview.id, "DELETE"))
        .status,
      200,
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
