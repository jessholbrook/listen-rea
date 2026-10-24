import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, dataDirectory, base } from "./harness";
import {
  client,
  seed,
  upload as imageUpload,
  answer as imageAnswer,
} from "./image-review-fixture";
import { samplePDF, participantPDFGuide } from "./participant-pdfs-fixture";
import { createClient } from "@libsql/client";
import path from "node:path";
before(
  () =>
    start({
      port: process.env.RESEARCH_TEST_PORT
        ? Number(process.env.RESEARCH_TEST_PORT)
        : process.env.RESEARCH_TEST_PRODUCTION === "1"
          ? 3186
          : 3185,
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
  return ctx.person(
    ctx.ip + "/participant-pdfs",
    "POST",
    await samplePDF(2, true),
    {
      ...ctx.headers,
      "content-type": "application/pdf",
      "x-upload-id": id,
      "x-interview-version": String(version),
      "x-pdf-description": encodeURIComponent(description),
      "x-pdf-consent": "yes",
      ...changes,
    },
  );
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
test(
  "extraction gates, page-bound verification, optimistic history, participant isolation and erasure",
  { timeout: 90000 },
  async () => {
    const c = await setup(),
      saved = await upload(c),
      asset = c.root + "/participant-pdfs/" + saved.pdf.id,
      textPath = asset + "/text";
    assert.equal((await c.owner(textPath, "POST", {})).status, 409);
    await answer(c, saved.pdf.id);
    assert.equal(
      (
        await c.person(
          c.ip + "/participant-pdfs/" + saved.pdf.id + "/text",
          "GET",
          undefined,
          c.headers,
        )
      ).status,
      404,
    );
    const other = await client();
    await other("auth/signup", "POST", {
      name: "Other workspace",
      email: randomUUID() + "@example.test",
      password: "pdf-test-password",
    });
    assert.equal((await other(textPath)).status, 404);
    assert.equal((await c.owner(textPath)).text, null);
    let r = await c.owner(textPath, "POST", {});
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.deepEqual(r.text.pages, [
      "Synthetic research PDF page 1",
      "Synthetic research PDF page 2",
    ]);
    assert.deepEqual((await c.owner(textPath, "POST", {})).text, r.text);
    const p = {
        page: 2,
        start: 0,
        end: r.text.pages[1].length,
        quote: r.text.pages[1],
      },
      input = {
        source: r.source,
        digest: r.text.digest,
        version: 0,
        attested: true,
        passages: [p],
      };
    assert.equal(
      (await c.owner(textPath, "PUT", { ...input, attested: false })).status,
      400,
    );
    assert.equal(
      (
        await c.owner(textPath, "PUT", {
          ...input,
          passages: [{ ...p, page: 1 }],
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await c.owner(textPath, "PUT", {
          ...input,
          passages: [{ ...p, quote: "invented quotation" }],
        })
      ).status,
      400,
    );
    assert.equal(
      (await c.owner(textPath, "PUT", { ...input, digest: "0".repeat(64) }))
        .status,
      409,
    );
    r = await c.owner(textPath, "PUT", input);
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.text.history[0].reviewer.name, "PDF reviewer");
    assert.equal(r.text.history[0].passages[0].page, 2);
    const edits = await Promise.all([
      c.owner(textPath, "PUT", { ...input, version: 1, passages: [] }),
      c.owner(textPath, "PUT", { ...input, version: 1, passages: [] }),
    ]);
    assert.deepEqual(edits.map((x) => x.status).sort(), [200, 409]);
    assert.equal((await c.owner(textPath)).text.history.length, 2);
    const publicResponse = await c.person(c.ip, "GET", undefined, c.headers);
    assert.equal(
      JSON.stringify(publicResponse).includes("participantPDFText"),
      false,
    );
    assert.equal(publicResponse.interview.pdfText, undefined);
    await c.owner(asset, "DELETE");
    assert.equal((await c.owner(textPath)).status, 404);
    const db = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    assert.equal(
      (
        await db.execute({
          sql: "SELECT id FROM documents WHERE kind='participantPDFText' AND id=?",
          args: [saved.pdf.id],
        })
      ).rows.length,
      0,
    );
    db.close();
  },
);
test(
  "whole-response purge erases extracted pages and verification history",
  { timeout: 90000 },
  async () => {
    const c = await setup(),
      saved = await upload(c);
    await answer(c, saved.pdf.id);
    const asset = c.root + "/participant-pdfs/" + saved.pdf.id;
    assert.equal((await c.owner(asset + "/text", "POST", {})).status, 200);
    assert.equal(
      (await c.owner(c.root + "/responses/" + c.r.interview.id, "DELETE"))
        .status,
      200,
    );
    assert.equal((await c.owner(asset + "/text")).status, 404);
    const db = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    assert.equal(
      (
        await db.execute({
          sql: "SELECT id FROM documents WHERE kind='participantPDFText' AND id=?",
          args: [saved.pdf.id],
        })
      ).rows.length,
      0,
    );
    db.close();
  },
);

test(
  "changed prompt fingerprints reject verification and related image erasure resets PDF text without removing the PDF",
  { timeout: 90000 },
  async () => {
    const c = await setup();
    await seed(c.r, (i) => {
      i.guide.questions[0].participantImages = true;
    });
    const image = await imageUpload(c.person, c.r, false),
      pdf = await upload(c);
    const joined = await c.person(
      c.ip + "/answer",
      "POST",
      {
        version: 0,
        requestId: randomUUID(),
        answer: "Synthetic answer with both files",
        participantImageId: image.image.id,
        participantPDFId: pdf.pdf.id,
      },
      c.headers,
    );
    assert.equal(joined.status, 200);
    await seed(c.r, (i) => {
      i.turns[0].imageProbe = {
        imageId: image.image.id,
        status: "asked",
        probe: "Synthetic question",
        model: "fixture",
        permissionVersion: "fixture",
        promptVersion: "fixture",
        generatedAt: new Date().toISOString(),
      };
    });
    const asset = c.root + "/participant-pdfs/" + pdf.pdf.id,
      textPath = asset + "/text",
      extracted = await c.owner(textPath, "POST", {}),
      prompt = joined.interview.turns[0].prompt;
    assert.equal(extracted.status, 200);
    const input = {
      source: extracted.source,
      digest: extracted.text.digest,
      version: 0,
      attested: true,
      passages: [
        {
          page: 1,
          start: 0,
          end: extracted.text.pages[0].length,
          quote: extracted.text.pages[0],
        },
      ],
    };
    assert.equal((await c.owner(textPath, "PUT", input)).status, 200);
    await seed(c.r, (i) => {
      i.turns[0].prompt = "Changed source prompt";
    });
    assert.equal((await c.owner(textPath)).status, 409);
    assert.equal(
      (await c.owner(textPath, "PUT", { ...input, version: 1 })).status,
      409,
    );
    await seed(c.r, (i) => {
      i.turns[0].prompt = prompt;
    });
    assert.equal((await c.owner(textPath)).text.history.length, 1);
    assert.equal(
      (
        await c.owner(
          c.root + "/participant-images/" + image.image.id,
          "DELETE",
        )
      ).status,
      200,
    );
    assert.equal((await c.owner(textPath)).text, null);
    assert.equal((await c.owner(asset)).status, 200);
    assert.equal((await c.owner(textPath, "POST", {})).text.history.length, 0);
  },
);
