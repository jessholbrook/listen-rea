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
          ? 3216
          : 3215,
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
const ask = (c: any, changes: any = {}) => ({
  id: c.a.id,
  version: c.a.version,
  question: "What should happen before review?",
  ...changes,
});
test(
  "Passage Q&A enforces edit authority, exact analysis and server-only verified native/OCR excerpts; failures preserve reports",
  { timeout: 90000 },
  async () => {
    const c = await fixture();
    assert.deepEqual(c.a.pdfEvidence[0].ocrPages, [2]);
    assert.equal(
      c.a.pdfEvidence[0].passages[0].quote,
      "Save draft before review.",
    );
    const anon = await client();
    assert.equal((await anon(c.endpoint, "POST", ask(c))).status, 401);
    assert.equal(
      (await c.person(c.endpoint, "POST", ask(c), c.headers)).status,
      401,
    );
    const other = await setup();
    assert.equal((await other.owner(c.endpoint, "POST", ask(c))).status, 404);
    const d = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    try {
      await d.execute({
        sql: "UPDATE users SET role='viewer' WHERE workspace_id=(SELECT workspace_id FROM documents WHERE kind='study' AND id=?)",
        args: [c.s.id],
      });
      assert.equal((await c.owner(c.endpoint, "POST", ask(c))).status, 403);
    } finally {
      await d.execute({
        sql: "UPDATE users SET role='admin' WHERE workspace_id=(SELECT workspace_id FROM documents WHERE kind='study' AND id=?)",
        args: [c.s.id],
      });
      d.close();
    }
    for (const patch of [{ version: 99 }, { id: randomUUID() }])
      assert.equal(
        (await c.owner(c.endpoint, "POST", ask(c, patch))).status,
        409,
      );
    for (const patch of [
      { question: "x" },
      { question: "x".repeat(2001) },
      { sources: c.a.pdfEvidence },
      { saveDraft: "invalid" },
      { model: "forged" },
    ])
      assert.equal(
        (await c.owner(c.endpoint, "POST", ask(c, patch))).status,
        400,
      );
    c.a = (
      await c.owner(c.root + "/analysis", "PUT", { ...c.a, reviewed: true })
    ).analysis;
    const token = (await c.owner(c.root + "/share", "POST")).token,
      before = structuredClone(c.a);
    assert.equal((await c.owner(c.endpoint, "POST", ask(c))).status, 503);
    assert.deepEqual((await c.owner(c.root + "/analysis")).analysis, before);
    assert.equal((await anon("shared/" + token)).status, 200);
    const native = await fixture(true, false);
    assert.equal(native.a.pdfEvidence[0].ocrPages, undefined);
    assert.equal(
      (await native.owner(native.endpoint, "POST", ask(native))).status,
      503,
    );
  },
);
test(
  "Unincluded, excluded, stale, changed-page and out-of-scope sources cannot answer; withdrawal and erasure block later Q&A",
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
    await seed(c.r, (i) => {
      i.turns[0].answer = "Changed source answer";
    });
    assert.equal((await c.owner(c.endpoint, "POST", ask(c))).status, 409);
    const fresh = await fixture();
    await seed(fresh.r, (i) => {
      i.excluded = true;
    });
    assert.equal(
      (await fresh.owner(fresh.endpoint, "POST", ask(fresh))).status,
      409,
    );
    const language = await fixture(),
      study = (await language.owner(language.root)).study,
      guide = structuredClone(study.draft);
    guide.localization = {
      sourceLanguage: "en",
      reportingLanguage: "fr",
      guidance: "",
      translations: [],
    };
    await language.owner(language.root, "PUT", {
      version: study.version,
      guide,
    });
    assert.equal(
      (await language.owner(language.endpoint, "POST", ask(language))).status,
      409,
    );
    const changed = await fixture(),
      d = createClient({
        url: "file:" + path.join(dataDirectory(), "research.sqlite"),
      });
    const row = (
        await d.execute({
          sql: "SELECT data FROM documents WHERE kind='participantPDFText' AND id=?",
          args: [changed.pdfId],
        })
      ).rows[0],
      text = JSON.parse(String(row.data));
    text.pages[1] = "Changed OCR text";
    await d.execute({
      sql: "UPDATE documents SET data=? WHERE kind='participantPDFText' AND id=?",
      args: [JSON.stringify(text), changed.pdfId],
    });
    d.close();
    assert.equal(
      (await changed.owner(changed.endpoint, "POST", ask(changed))).status,
      409,
    );
    const withdrawn = await fixture(),
      r = await withdrawn.owner(withdrawn.url);
    await withdrawn.owner(withdrawn.url, "PUT", {
      source: r.source,
      digest: r.text.digest,
      version: r.text.history.at(-1).version,
      attested: true,
      includeInReports: false,
      passages: [],
    });
    assert.equal(
      (await withdrawn.owner(withdrawn.endpoint, "POST", ask(withdrawn)))
        .status,
      404,
    );
    const deleted = await fixture();
    await deleted.owner(
      deleted.root + "/participant-pdfs/" + deleted.pdfId,
      "DELETE",
    );
    assert.equal(
      (await deleted.owner(deleted.endpoint, "POST", ask(deleted))).status,
      404,
    );
  },
);
