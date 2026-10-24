import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import path from "node:path";
import { start, stop, dataDirectory } from "./harness";
import { client, seed } from "./image-review-fixture";
import { sampleDOCX, participantDOCXGuide } from "./participant-docx-fixture";
import { docxMime } from "../src/lib/participant-docx";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3225 : 3224 }),
  { timeout: 90000 },
);
after(stop);
async function setup(enabled = true) {
  const owner = await client(),
    person = await client();
  await owner("auth/signup", "POST", {
    name: "DOCX reviewer",
    email: randomUUID() + "@example.test",
    password: "docx-test-password",
  });
  let s = (await owner("studies", "POST", { title: "Private DOCX study" }))
    .study;
  const root = "studies/" + s.id,
    guide = participantDOCXGuide();
  guide.questions[0].participantDOCX = enabled;
  s = (await owner(root, "PUT", { version: s.version, guide })).study;
  s = (await owner(root + "/publish", "POST", { version: s.version })).study;
  await owner(root + "/fielding", "POST", { state: "active" });
  const r = await person("public/" + s.id, "POST", { consent: true });
  return {
    owner,
    person,
    root,
    s,
    r,
    ip: "interviews/" + r.interview.id,
    h: { "x-interview-token": r.token },
  };
}
async function upload(
  c: any,
  id = randomUUID(),
  headers: any = {},
  data?: Buffer,
) {
  return c.person(
    c.ip + "/participant-docx",
    "POST",
    data || (await sampleDOCX()),
    {
      ...c.h,
      "content-type": docxMime,
      "x-upload-id": id,
      "x-interview-version": "0",
      "x-docx-description": "Synthetic DOCX description",
      "x-docx-consent": "yes",
      ...headers,
    },
  );
}
async function answer(
  c: any,
  id?: string,
  version = 0,
  requestId = randomUUID(),
) {
  return c.person(
    c.ip + "/answer",
    "POST",
    {
      version,
      requestId,
      answer: "Synthetic written answer",
      participantDOCXId: id,
    },
    c.h,
  );
}
async function sql() {
  return createClient({
    url: "file:" + path.join(dataDirectory(), "research.sqlite"),
  });
}
test(
  "DOCX draft retries and exact answer binding, private text access, attributed optimistic reviews and erasure preserve written answers",
  { timeout: 90000 },
  async () => {
    const c = await setup(),
      attempt = randomUUID(),
      saved = await upload(c, attempt);
    assert.equal(saved.status, 201, JSON.stringify(saved));
    assert.equal(saved.docx.paragraphs, 2);
    assert.equal(saved.docx.characters, 53);
    const asset = c.root + "/participant-docx/" + saved.docx.id,
      privateAsset = c.ip + "/participant-docx/" + saved.docx.id;
    assert.equal((await upload(c, attempt)).docx.id, saved.docx.id);
    assert.equal(
      (
        await upload(c, attempt, {
          "x-docx-description": "Changed description",
        })
      ).status,
      409,
    );
    assert.equal((await upload(c)).status, 409);
    assert.equal((await c.owner(asset + "/review", "PUT", {})).status, 400);
    assert.equal((await c.owner(asset + "/review")).status, 409);
    const anon = await client();
    assert.equal((await anon(asset)).status, 401);
    assert.equal((await anon(privateAsset)).status, 404);
    assert.equal(
      (await c.person(privateAsset, "GET", undefined, c.h)).paragraphs[0],
      "Synthetic DOCX research note",
    );
    assert.equal((await answer(c)).status, 409);
    assert.equal((await answer(c, randomUUID())).status, 409);
    const submitted = await answer(c, saved.docx.id);
    assert.equal(submitted.status, 200);
    assert.equal(
      submitted.interview.turns[0].participantDOCX.id,
      saved.docx.id,
    );
    assert.equal(submitted.interview.participantDOCXDraft, undefined);
    assert.equal(
      (
        await c.person(privateAsset, "DELETE", undefined, {
          ...c.h,
          "x-interview-version": "1",
        })
      ).status,
      409,
    );
    assert.equal(
      (await c.person(privateAsset + "/review", "GET", undefined, c.h)).status,
      404,
    );
    let r = await c.owner(asset + "/review");
    const review = {
      source: r.source,
      version: r.version,
      quality: "usable",
      notes: "Private DOCX review sentinel",
    };
    assert.equal(
      (
        await c.owner(asset + "/review", "PUT", {
          ...review,
          includeInReports: true,
        })
      ).status,
      400,
    );
    const concurrent = await Promise.all([
      c.owner(asset + "/review", "PUT", review),
      c.owner(asset + "/review", "PUT", review),
    ]);
    assert.deepEqual(concurrent.map((x) => x.status).sort(), [200, 409]);
    r = await c.owner(asset + "/review");
    assert.equal(r.history[0].reviewer.name, "DOCX reviewer");
    assert.equal(
      (
        await c.owner(asset + "/review", "PUT", {
          ...review,
          version: 1,
          quality: "privacy_concern",
          notes: "Second private review sentinel",
        })
      ).status,
      200,
    );
    assert.equal((await c.owner(asset + "/review")).history.length, 2);
    const other = await setup();
    assert.equal((await other.owner(asset)).status, 404);
    const d = await sql();
    try {
      await d.execute({
        sql: "UPDATE users SET role='viewer' WHERE workspace_id=(SELECT workspace_id FROM documents WHERE kind='study' AND id=?)",
        args: [c.s.id],
      });
      assert.equal(
        (await c.owner(asset + "/review", "PUT", { ...review, version: 2 }))
          .status,
        403,
      );
    } finally {
      await d.execute({
        sql: "UPDATE users SET role='admin' WHERE workspace_id=(SELECT workspace_id FROM documents WHERE kind='study' AND id=?)",
        args: [c.s.id],
      });
      d.close();
    }
    await answer(c, undefined, 1);
    let a = (await c.owner(c.root + "/analysis", "POST", { mode: "manual" }))
      .analysis;
    a = (await c.owner(c.root + "/analysis", "PUT", { ...a, reviewed: true }))
      .analysis;
    const share = (await c.owner(c.root + "/share", "POST")).token;
    assert.ok(
      !(await c.person("shared/" + share)).memo.includes(
        "Private DOCX review sentinel",
      ),
    );
    assert.ok(
      !JSON.stringify(await c.person(c.ip, "GET", undefined, c.h)).includes(
        "Private DOCX review sentinel",
      ),
    );
    const { responseDto } = await import("../src/lib/external-api");
    assert.ok(
      !JSON.stringify(responseDto(submitted.interview)).includes(saved.docx.id),
    );
    assert.equal((await c.owner(asset, "DELETE")).status, 200);
    assert.equal((await c.owner(asset)).status, 404);
    assert.equal((await c.owner(asset + "/review")).status, 404);
    assert.equal((await c.person("shared/" + share)).status, 404);
    const detail = (await c.owner(c.root)).interviews[0];
    assert.equal(detail.turns[0].answer, "Synthetic written answer");
    assert.equal(detail.turns[0].participantDOCX, undefined);
    assert.ok(detail.turns[0].participantDOCXRemovedAt);
    const verify = await sql();
    assert.equal(
      (
        await verify.execute({
          sql: "SELECT id FROM media WHERE id=?",
          args: [saved.docx.id],
        })
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await verify.execute({
          sql: "SELECT id FROM documents WHERE kind='participantDOCXReview' AND id=?",
          args: [saved.docx.id],
        })
      ).rows.length,
      0,
    );
    verify.close();
  },
);
test(
  "DOCX consent, file/guide/version gates, draft removal tombstones, stale review sources and whole-response purge",
  { timeout: 90000 },
  async () => {
    const disabled = await setup(false);
    assert.equal((await upload(disabled)).status, 409);
    const c = await setup();
    for (const headers of [
      { "x-docx-consent": "no" },
      { "content-type": "application/zip" },
      { "x-docx-ai-consent": "yes" },
    ])
      assert.equal((await upload(c, randomUUID(), headers)).status, 400);
    assert.equal(
      (await upload(c, randomUUID(), { "x-interview-version": "99" })).status,
      409,
    );
    assert.equal(
      (await upload(c, randomUUID(), {}, Buffer.from("bad"))).status,
      400,
    );
    const id = randomUUID(),
      draft = await upload(c, id),
      asset = c.ip + "/participant-docx/" + draft.docx.id;
    assert.equal(
      (
        await c.person(asset, "DELETE", undefined, {
          ...c.h,
          "x-interview-version": "0",
        })
      ).status,
      200,
    );
    assert.equal((await upload(c, id)).status, 409);
    const saved = await upload(c);
    await answer(c, saved.docx.id);
    const reviewPath =
        c.root + "/participant-docx/" + saved.docx.id + "/review",
      r = await c.owner(reviewPath);
    await c.owner(reviewPath, "PUT", {
      source: r.source,
      version: 0,
      quality: "usable",
      notes: "Saved private note",
    });
    let prompt = "";
    await seed(c.r, (i) => {
      prompt = i.turns[0].prompt;
      i.turns[0].prompt = "Changed DOCX source";
    });
    assert.equal((await c.owner(reviewPath)).status, 409);
    await seed(c.r, (i) => {
      i.turns[0].prompt = prompt;
    });
    assert.equal(
      (await c.owner(c.root + "/responses/" + c.r.interview.id, "DELETE"))
        .status,
      200,
    );
    const d = await sql();
    assert.equal(
      (
        await d.execute({
          sql: "SELECT id FROM media WHERE interview_id=?",
          args: [c.r.interview.id],
        })
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await d.execute({
          sql: "SELECT id FROM documents WHERE kind='participantDOCXReview' AND id=?",
          args: [saved.docx.id],
        })
      ).rows.length,
      0,
    );
    d.close();
  },
);
