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
          ? 3181
          : 3180,
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
  "PDFs require consent/current admission, persist drafts and exact retries, bind answer submissions and revoke participant deletion after submission",
  { timeout: 90000 },
  async () => {
    const c = await setup(),
      id = randomUUID();
    assert.equal(
      (await upload(c, id, undefined, 0, { "x-pdf-consent": "no" })).status,
      400,
    );
    assert.equal(
      (await upload(c, id, undefined, 0, { "content-type": "text/html" }))
        .status,
      400,
    );
    const saved = await upload(c, id);
    assert.equal(saved.status, 201);
    assert.equal(saved.pdf.pages, 2);
    const retry = await upload(c, id);
    assert.equal(retry.status, 200, JSON.stringify(retry.error));
    assert.equal(retry.pdf.id, saved.pdf.id);
    assert.equal((await upload(c, id, "Changed description")).status, 409);
    assert.equal(
      (await c.person(c.ip, "GET", undefined, c.headers)).interview
        .participantPDFDraft.pdf.id,
      saved.pdf.id,
    );
    assert.equal((await answer(c)).status, 409);
    const request = randomUUID(),
      joined = await answer(c, saved.pdf.id, 0, request);
    assert.equal(joined.status, 200);
    assert.equal(joined.interview.turns[0].participantPDF.id, saved.pdf.id);
    assert.equal(
      (await answer(c, saved.pdf.id, 0, request)).interview.turns.length,
      1,
    );
    assert.equal(joined.interview.participantPDFDraft, undefined);
    assert.equal(
      (
        await c.person(
          c.ip + "/participant-pdfs/" + saved.pdf.id,
          "DELETE",
          undefined,
          { ...c.headers, "x-interview-version": "1" },
        )
      ).status,
      409,
    );
  },
);
test(
  "PDF bytes and review history enforce session/workspace boundaries, secure headers, optimistic corrections and individual erasure",
  { timeout: 90000 },
  async () => {
    const c = await setup(),
      saved = await upload(c),
      pathPDF = c.root + "/participant-pdfs/" + saved.pdf.id;
    const anonymous = await client();
    assert.equal(
      (await anonymous(c.ip + "/participant-pdfs/" + saved.pdf.id)).status,
      404,
    );
    const other = await setup();
    assert.equal((await other.owner(pathPDF)).status, 404);
    const different = await c.person("public/" + c.s.id, "POST", {
      consent: true,
    });
    assert.equal(
      (
        await c.person(
          "interviews/" +
            different.interview.id +
            "/participant-pdfs/" +
            saved.pdf.id,
          "GET",
          undefined,
          { "x-interview-token": different.token },
        )
      ).status,
      404,
    );
    assert.equal((await c.owner(pathPDF + "/review")).status, 409);
    await answer(c, saved.pdf.id);
    let review = await c.owner(pathPDF + "/review");
    const input = {
      source: review.source,
      version: 0,
      quality: "usable",
      notes: "The PDF pages are readable.",
    };
    assert.equal(
      (await c.owner(pathPDF + "/review", "PUT", input)).status,
      200,
    );
    review = await c.owner(pathPDF + "/review");
    const racing = await Promise.all([
      c.owner(pathPDF + "/review", "PUT", {
        ...input,
        version: 1,
        notes: "One correction",
      }),
      c.owner(pathPDF + "/review", "PUT", {
        ...input,
        version: 1,
        notes: "Another correction",
      }),
    ]);
    assert.deepEqual(racing.map((r) => r.status).sort(), [200, 409]);
    const history = await c.owner(pathPDF + "/review");
    assert.equal(history.history.length, 2);
    assert.equal(history.history[0].notes, input.notes);
    assert.equal(history.history[0].reviewer.name, "PDF reviewer");
    assert.equal(
      JSON.stringify(
        await c.person(c.ip, "GET", undefined, c.headers),
      ).includes(input.notes),
      false,
    );
    assert.equal((await anonymous(pathPDF + "/review")).status, 401);
    for (const route of [
      c.ip + "/participant-pdfs/" + saved.pdf.id,
      c.ip + "/recording/" + saved.pdf.id,
    ]) {
      const response = await fetch(base + "/api/" + route, {
        headers: { ...c.headers, range: "bytes=0-9" },
      });
      assert.equal(response.status, 206);
      assert.equal(response.headers.get("content-type"), "application/pdf");
      assert.ok(
        response.headers.get("content-disposition")?.startsWith("attachment"),
      );
      assert.ok(
        response.headers.get("content-security-policy")?.includes("sandbox"),
      );
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal((await response.arrayBuffer()).byteLength, 10);
    }
    await c.owner(pathPDF, "DELETE");
    assert.equal((await c.owner(pathPDF)).status, 404);
    assert.equal((await c.owner(pathPDF + "/review")).status, 404);
    const current = (await c.person(c.ip, "GET", undefined, c.headers))
      .interview;
    assert.equal(current.turns[0].participantPDF, undefined);
    assert.ok(current.turns[0].participantPDFRemovedAt);
    assert.ok(current.turns[0].answer);
    const sql = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    try {
      assert.equal(
        (
          await sql.execute({
            sql: "SELECT id FROM documents WHERE kind='participantPDFReview' AND id=?",
            args: [saved.pdf.id],
          })
        ).rows.length,
        0,
      );
    } finally {
      sql.close();
    }
  },
);
test(
  "PDF draft removal tombstones retry IDs and whole-response deletion clears file/reviews without AI calls",
  { timeout: 90000 },
  async () => {
    const c = await setup(),
      id = randomUUID(),
      saved = await upload(c, id);
    await c.person(
      c.ip + "/participant-pdfs/" + saved.pdf.id,
      "DELETE",
      undefined,
      { ...c.headers, "x-interview-version": "0" },
    );
    assert.equal((await upload(c, id)).status, 409);
    const next = await upload(c);
    await answer(c, next.pdf.id);
    const review = await c.owner(
      c.root + "/participant-pdfs/" + next.pdf.id + "/review",
    );
    await c.owner(
      c.root + "/participant-pdfs/" + next.pdf.id + "/review",
      "PUT",
      {
        source: review.source,
        version: 0,
        quality: "privacy_concern",
        notes: "Private review",
      },
    );
    await c.owner(c.root + "/responses/" + c.r.interview.id, "DELETE");
    assert.equal(
      (await c.owner(c.root + "/participant-pdfs/" + next.pdf.id)).status,
      404,
    );
    const sql = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    try {
      for (const query of [
        "SELECT COUNT(*) AS n FROM usage",
        "SELECT COUNT(*) AS n FROM documents WHERE kind='participantPDFReview'",
      ]) {
        assert.equal(Number((await sql.execute(query)).rows[0].n), 0);
      }
    } finally {
      sql.close();
    }
  },
);

test(
  "Erasing an image-based question preserves and rebinds an independently uploaded PDF draft; pending saves and stale answers remain blocked",
  { timeout: 90000 },
  async () => {
    const c = await setup();
    await seed(c.r, (i) => {
      i.guide.questions[0].participantImages = true;
      i.guide.questions[0].participantImageAI = true;
      i.guide.questions[0].followUps = 1;
    });
    const image = await imageUpload(c.person, c.r, false);
    assert.equal(image.status, 201);
    await imageAnswer(c.person, c.r, image.image.id);
    await seed(c.r, (i) => {
      i.current = 0;
      i.prompt = "Synthetic image question?";
      i.promptImageId = image.image.id;
      i.strategy = "ai";
      i.turns[0].imageProbe = {
        imageId: image.image.id,
        status: "asked",
        probe: i.prompt,
        model: "synthetic-fixture",
        permissionVersion: "synthetic-fixture",
        promptVersion: "synthetic-fixture",
        generatedAt: new Date().toISOString(),
      };
    });
    const pdf = await upload(c, randomUUID(), "A later synthetic PDF", 1);
    assert.equal(pdf.status, 201);
    await seed(c.r, (i) => {
      i.pending = { id: randomUUID(), at: Date.now() };
    });
    assert.equal(
      (await c.owner(c.root + "/participant-pdfs/" + pdf.pdf.id, "DELETE"))
        .status,
      409,
    );
    await seed(c.r, (i) => {
      delete i.pending;
    });
    await c.owner(c.root + "/participant-images/" + image.image.id, "DELETE");
    const current = (await c.person(c.ip, "GET", undefined, c.headers))
      .interview;
    assert.equal(current.version, 2);
    assert.equal(current.participantPDFDraft.version, 2);
    assert.equal(current.participantPDFDraft.pdf.id, pdf.pdf.id);
    assert.equal((await answer(c, pdf.pdf.id, 1)).status, 409);
    assert.equal((await answer(c, pdf.pdf.id, 2)).status, 200);
    const related = await setup();
    await seed(related.r, (i) => {
      i.guide.questions[0].participantImages = true;
    });
    const secondImage = await imageUpload(related.person, related.r, false),
      secondPDF = await upload(related);
    assert.equal(
      (
        await related.person(
          related.ip + "/answer",
          "POST",
          {
            version: 0,
            requestId: randomUUID(),
            answer: "A synthetic answer with both attachments.",
            participantImageId: secondImage.image.id,
            participantPDFId: secondPDF.pdf.id,
          },
          related.headers,
        )
      ).status,
      200,
    );
    await seed(related.r, (i) => {
      i.turns[0].imageProbe = {
        imageId: secondImage.image.id,
        status: "asked",
        probe: "Synthetic image prompt?",
        model: "synthetic-fixture",
        permissionVersion: "synthetic-fixture",
        promptVersion: "synthetic-fixture",
        generatedAt: new Date().toISOString(),
      };
    });
    const pdfReviewPath =
        related.root + "/participant-pdfs/" + secondPDF.pdf.id + "/review",
      review = await related.owner(pdfReviewPath);
    await related.owner(pdfReviewPath, "PUT", {
      source: review.source,
      version: 0,
      quality: "usable",
      notes: "A review in the old image question context.",
    });
    await related.owner(
      related.root + "/participant-images/" + secondImage.image.id,
      "DELETE",
    );
    assert.equal((await related.owner(pdfReviewPath)).version, 0);
    assert.equal(
      (
        await related.owner(
          related.root + "/participant-pdfs/" + secondPDF.pdf.id,
        )
      ).status,
      200,
    );
  },
);
