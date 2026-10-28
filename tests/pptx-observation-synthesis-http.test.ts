import { createClient } from "@libsql/client";
import path from "node:path";
import JSZip from "jszip";
import { dataDirectory } from "./harness";
import { pptxObservationSynthesisPromptVersion } from "../src/lib/pptx-observation-synthesis";
import { analysisDto } from "../src/lib/external-api";
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
          ? 3331
          : 3330,
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
  return { ...ctx, a, url, endpoint: ctx.root + "/pptx-observation-synthesis" };
}
async function seedDraft(ctx: any) {
  const e = ctx.a.pptxObservations[0],
    s = {
      findings: [
        {
          title: "Icon meaning needs review",
          description:
            "A researcher observation describes uncertainty about icon meaning.",
          citations: [
            {
              pptxId: e.pptxId,
              reviewVersion: e.reviewVersion,
              field: "notes" as const,
              quote: "the icon meaning was unclear",
            },
          ],
        },
      ],
      limitations:
        "Selected researcher notes are not independent verification of images.",
      model: "synthetic-fixture",
      promptVersion: pptxObservationSynthesisPromptVersion,
      generatedAt: new Date().toISOString(),
      reviewed: false,
    };
  const sql = createClient({
    url: "file:" + path.join(dataDirectory(), "research.sqlite"),
  });
  try {
    await sql.execute({
      sql: "UPDATE documents SET data=? WHERE kind='analysis' AND id=?",
      args: [
        JSON.stringify({ ...ctx.a, pptxObservationSynthesis: s }),
        ctx.a.id,
      ],
    });
  } finally {
    sql.close();
  }
  return s;
}
test(
  "Draft synthesis blocks publication; exact-note human review, report exports and immutable source attribution survive editing and discard",
  { timeout: 90000 },
  async () => {
    const ctx = await fixture(),
      s = await seedDraft(ctx),
      input = { id: ctx.a.id, version: ctx.a.version };
    assert.equal(
      (
        await ctx.owner(ctx.root + "/analysis", "PUT", {
          ...ctx.a,
          reviewed: true,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await ctx.owner(ctx.root + "/reporting/editions", "POST", {
          analysisId: ctx.a.id,
          title: "Draft observations report",
        })
      ).status,
      400,
    );
    const anonymous = await client();
    assert.equal(
      (await anonymous(ctx.endpoint, "PUT", { ...input, ...s })).status,
      401,
    );
    const other = await setup();
    assert.equal(
      (await other.owner(ctx.endpoint, "DELETE", input)).status,
      404,
    );
    const bad = structuredClone(s.findings);
    bad[0].citations[0].quote = "Invented observation";
    assert.equal(
      (
        await ctx.owner(ctx.endpoint, "PUT", {
          ...input,
          findings: bad,
          limitations: s.limitations,
          reviewed: true,
        })
      ).status,
      502,
    );
    const reviewed = await ctx.owner(ctx.endpoint, "PUT", {
      ...input,
      findings: s.findings,
      limitations: s.limitations,
      reviewed: true,
    });
    assert.equal(reviewed.status, 200);
    let a = reviewed.analysis;
    assert.equal(a.pptxObservationSynthesis.reviewedBy.name, "PPTX reviewer");
    assert.equal(a.reviewed, false);
    assert.equal(a.themes.length, 0);
    assert.equal((await ctx.owner(ctx.endpoint, "DELETE", input)).status, 409);
    a = (
      await ctx.owner(ctx.root + "/analysis", "PUT", { ...a, reviewed: true })
    ).analysis;
    const token = (await ctx.owner(ctx.root + "/share", "POST")).token;
    assert.ok(
      (await anonymous("shared/" + token)).memo.includes(s.findings[0].title),
    );
    assert.equal(
      JSON.stringify(analysisDto(a, true)).includes(s.findings[0].title),
      false,
    );
    let e = (
      await ctx.owner(ctx.root + "/reporting/editions", "POST", {
        analysisId: a.id,
        title: "Reviewed synthesis report",
      })
    ).edition;
    assert.equal(e.pptxObservationSynthesis.reviewed, true);
    e = (
      await ctx.owner(ctx.root + "/reporting/editions/" + e.id, "PUT", {
        ...e,
        pptxObservationSynthesis: { ...s, reviewed: true },
        reviewed: true,
      })
    ).edition;
    assert.equal(e.pptxObservationSynthesis.reviewedBy.name, "PPTX reviewer");
    const deck = await ctx.owner(
      ctx.root + "/reporting/editions/" + e.id + "/deck",
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
    assert.ok(text.includes(s.findings[0].title));
    assert.ok(text.includes("Researcher note"));
    const deleted = await ctx.owner(ctx.endpoint, "DELETE", {
      id: a.id,
      version: a.version,
    });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.analysis.pptxObservationSynthesis, undefined);
    assert.equal((await anonymous("shared/" + token)).status, 404);
    assert.equal(
      (await ctx.owner(ctx.root + "/reporting/editions/" + e.id)).status,
      404,
    );
    assert.equal(deleted.analysis.pptxObservations.length, 1);
  },
);
test(
  "Empty or stale sources and unavailable providers cannot save a synthesis; source withdrawal erases drafts",
  { timeout: 90000 },
  async () => {
    const empty = await fixture(false);
    assert.equal(
      (
        await empty.owner(empty.endpoint, "POST", {
          id: empty.a.id,
          version: empty.a.version,
        })
      ).status,
      400,
    );
    const ctx = await fixture(),
      input = { id: ctx.a.id, version: ctx.a.version };
    assert.equal((await ctx.owner(ctx.endpoint, "POST", input)).status, 503);
    assert.equal(
      (await ctx.owner(ctx.root + "/analysis")).analysis.version,
      ctx.a.version,
    );
    await seedDraft(ctx);
    const r = await ctx.owner(ctx.url);
    await ctx.owner(ctx.url, "PUT", {
      source: r.source,
      probeSource: r.probeSource,
      version: r.version,
      quality: "usable",
      grounding: "unsupported",
      notes: "Changed human notes",
      correction: "",
      includeInReports: false,
    });
    assert.equal((await ctx.owner(ctx.root + "/analysis")).analysis, null);
    assert.equal(
      (
        await ctx.owner(ctx.endpoint, "PUT", {
          ...input,
          findings: [],
          limitations: "Old source",
          reviewed: true,
        })
      ).status,
      404,
    );
  },
);
