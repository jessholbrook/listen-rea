import { dataDirectory } from "./harness";
import path from "node:path";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pptxMime } from "../src/lib/participant-pptx";
import { start, stop } from "./harness";
import { client, seed } from "./image-review-fixture";
import { samplePPTX, participantPPTXGuide } from "./participant-pptx-fixture";
before(
  () =>
    start({
      port: process.env.RESEARCH_TEST_PORT
        ? Number(process.env.RESEARCH_TEST_PORT)
        : process.env.RESEARCH_TEST_PRODUCTION === "1"
          ? 3333
          : 3332,
    }),
  { timeout: 90000 },
);
after(stop);
async function setup() {
  const owner = await client(),
    person = await client();
  await owner("auth/signup", "POST", {
    name: "PPTX reviewer",
    email: randomUUID() + "@example.test",
    password: "pptx-test-password",
  });
  let s = (await owner("studies", "POST", { title: "PPTX workflow" })).study;
  const root = "studies/" + s.id;
  s = (
    await owner(root, "PUT", {
      version: s.version,
      guide: participantPPTXGuide(),
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
  description = "Synthetic two-slide research PPTX",
  version = 0,
  changes: any = {},
) {
  return ctx.person(ctx.ip + "/participant-pptx", "POST", await samplePPTX(), {
    ...ctx.headers,
    "content-type": pptxMime,
    "x-upload-id": id,
    "x-interview-version": String(version),
    "x-pptx-description": encodeURIComponent(description),
    "x-pptx-consent": "yes",
    ...changes,
  });
}
async function answer(
  ctx: any,
  pptxId?: string,
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
      participantPPTXId: pptxId,
    },
    ctx.headers,
  );
}

async function source() {
  const c = await setup(),
    pptx = await upload(c);
  await answer(c, pptx.pptx.id);
  await answer(c, undefined, 1);
  return {
    ...c,
    pptxId: pptx.pptx.id,
    url: c.root + "/participant-pptx/" + pptx.pptx.id + "/text",
  };
}
async function fixture(included = true) {
  const ctx = await source();
  const snapshotSha256 = createHash("sha256")
    .update(await readFile(path.join(dataDirectory(), "media", ctx.pptxId)))
    .digest("hex");
  await seed(ctx.r, (i) => {
    i.turns[0].pptxProbe = {
      pptxId: ctx.pptxId,
      status: "asked",
      probe: "What does Save draft before review. mean?",
      slide: 2,
      quote: "Save draft before review.",
      model: "synthetic-fixture",
      snapshotSha256,
      permissionVersion: "synthetic-fixture",
      promptVersion: "synthetic-fixture",
      generatedAt: new Date().toISOString(),
    };
  });
  const url = ctx.root + "/participant-pptx/" + ctx.pptxId + "/review",
    r = await ctx.owner(url);
  const saved = await ctx.owner(url, "PUT", {
    source: r.source,
    probeSource: r.probeSource,
    version: 0,
    quality: "usable",
    grounding: "unsupported",
    notes: "The researcher could read Save, but the icon meaning was unclear.",
    correction: "Ask without assuming success.",
    includeInReports: included,
  });
  assert.equal(saved.status, 200);
  const a = (
    await ctx.owner(ctx.root + "/analysis", "POST", { mode: "manual" })
  ).analysis;
  return { ...ctx, a, url, endpoint: ctx.root + "/pptx-observation-qa" };
}
const ask = (c: any, changes: any = {}) => ({
  id: c.a.id,
  version: c.a.version,
  question: "What concern did the reviewer identify?",
  ...changes,
});
test(
  "PPTX annotation Q&A requires edit authority, exact analysis identity/version and server-derived sources; unavailable providers preserve reports",
  { timeout: 90000 },
  async () => {
    const c = await fixture();
    const anon = await client();
    assert.equal((await anon(c.endpoint, "POST", ask(c))).status, 401);
    assert.equal(
      (await c.person(c.endpoint, "POST", ask(c), c.headers)).status,
      401,
    );
    const other = await setup();
    assert.equal((await other.owner(c.endpoint, "POST", ask(c))).status, 404);
    for (const patch of [{ version: 99 }, { id: randomUUID() }])
      assert.equal(
        (await c.owner(c.endpoint, "POST", ask(c, patch))).status,
        409,
      );
    for (const patch of [
      { question: "x" },
      { question: "x".repeat(2001) },
      { sources: c.a.pptxObservations },
    ])
      assert.equal(
        (await c.owner(c.endpoint, "POST", ask(c, patch))).status,
        400,
      );
    c.a = (
      await c.owner(c.root + "/analysis", "PUT", { ...c.a, reviewed: true })
    ).analysis;
    const token = (await c.owner(c.root + "/share", "POST")).token;
    const before = structuredClone(c.a);
    assert.equal((await c.owner(c.endpoint, "POST", ask(c))).status, 503);
    assert.deepEqual((await c.owner(c.root + "/analysis")).analysis, before);
    assert.equal((await anon("shared/" + token)).status, 200);
    assert.ok(
      !JSON.stringify(await c.owner(c.root)).includes("pptxObservationQA"),
    );
  },
);
test(
  "Empty, excluded, stale and out-of-scope annotation sources cannot be used; withdrawal/erasure prevent later questions",
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
      i.turns[0].pptxProbe.probe = "Changed source question?";
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
      study = (await language.owner(language.root)).study;
    const guide = structuredClone(study.draft);
    guide.localization = {
      sourceLanguage: "en",
      reportingLanguage: "fr",
      guidance: "",
      translations: [],
    };
    assert.equal(
      (
        await language.owner(language.root, "PUT", {
          version: study.version,
          guide,
        })
      ).status,
      200,
    );
    assert.equal(
      (await language.owner(language.endpoint, "POST", ask(language))).status,
      409,
    );
    const deleted = await fixture();
    await deleted.owner(
      deleted.root + "/participant-pptx/" + deleted.pptxId,
      "DELETE",
    );
    assert.equal(
      (await deleted.owner(deleted.endpoint, "POST", ask(deleted))).status,
      404,
    );
    const withdrawn = await fixture(),
      r = await withdrawn.owner(withdrawn.url);
    await withdrawn.owner(withdrawn.url, "PUT", {
      source: r.source,
      probeSource: r.probeSource,
      version: r.version,
      quality: "usable",
      grounding: "unsupported",
      notes: "Withdraw this annotation",
      correction: "",
      includeInReports: false,
    });
    assert.equal(
      (await withdrawn.owner(withdrawn.endpoint, "POST", ask(withdrawn)))
        .status,
      404,
    );
  },
);
