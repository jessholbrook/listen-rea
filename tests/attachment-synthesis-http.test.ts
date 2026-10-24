import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import path from "node:path";
import JSZip from "jszip";
import { start, stop, dataDirectory } from "./harness";
import { setup, upload, answer, head, client } from "./image-review-fixture";
import { attachmentSynthesisPromptVersion } from "../src/lib/attachment-synthesis";
import { analysisDto } from "../src/lib/external-api";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3178 : 3177 }),
  { timeout: 90000 },
);
after(stop);
async function fixture(included = true) {
  const ctx = await setup(false),
    image = await upload(ctx.person, ctx.r, false);
  await answer(ctx.person, ctx.r, image.image.id);
  await answer(ctx.person, ctx.r, undefined, 1);
  const url = ctx.root + "/participant-images/" + image.image.id + "/review",
    r = await ctx.owner(url);
  await ctx.owner(url, "PUT", {
    source: r.source,
    version: 0,
    quality: "usable",
    grounding: "not_applicable",
    notes: "The researcher could read Save, but the icon meaning was unclear.",
    correction: "",
    includeInReports: included,
  });
  const a = (
    await ctx.owner(ctx.root + "/analysis", "POST", { mode: "manual" })
  ).analysis;
  return {
    ...ctx,
    a,
    url,
    imageId: image.image.id,
    endpoint: ctx.root + "/attachment-synthesis",
  };
}
async function seedDraft(ctx: any) {
  const e = ctx.a.attachmentEvidence[0],
    s = {
      findings: [
        {
          title: "Icon meaning needs review",
          description:
            "A researcher observation describes uncertainty about icon meaning.",
          citations: [
            {
              imageId: e.imageId,
              reviewVersion: e.reviewVersion,
              quote: "the icon meaning was unclear",
            },
          ],
        },
      ],
      limitations:
        "Selected researcher notes are not independent verification of images.",
      model: "synthetic-fixture",
      promptVersion: attachmentSynthesisPromptVersion,
      generatedAt: new Date().toISOString(),
      reviewed: false,
    };
  const sql = createClient({
    url: "file:" + path.join(dataDirectory(), "research.sqlite"),
  });
  try {
    await sql.execute({
      sql: "UPDATE documents SET data=? WHERE kind='analysis' AND id=?",
      args: [JSON.stringify({ ...ctx.a, attachmentSynthesis: s }), ctx.a.id],
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
    const other = await setup(false);
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
    assert.equal(a.attachmentSynthesis.reviewedBy.name, "Image AI admin");
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
    assert.equal(e.attachmentSynthesis.reviewed, true);
    e = (
      await ctx.owner(ctx.root + "/reporting/editions/" + e.id, "PUT", {
        ...e,
        attachmentSynthesis: { ...s, reviewed: true },
        reviewed: true,
      })
    ).edition;
    assert.equal(e.attachmentSynthesis.reviewedBy.name, "Image AI admin");
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
    assert.equal(deleted.analysis.attachmentSynthesis, undefined);
    assert.equal((await anonymous("shared/" + token)).status, 404);
    assert.equal(
      (await ctx.owner(ctx.root + "/reporting/editions/" + e.id)).status,
      404,
    );
    assert.equal(deleted.analysis.attachmentEvidence.length, 1);
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
      version: r.version,
      quality: "usable",
      grounding: "not_applicable",
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
