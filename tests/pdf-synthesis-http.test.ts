import { pdfSynthesisPromptVersion } from "../src/lib/pdf-synthesis";
import { analysisDto } from "../src/lib/external-api";
import JSZip from "jszip";
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
          ? 3192
          : 3191,
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
async function verify(c: any, includeInReports = false, passages?: any[]) {
  const r = await c.owner(c.url, "POST", {});
  return c.owner(c.url, "PUT", {
    source: r.source,
    digest: r.text.digest,
    version: r.text.history.at(-1)?.version || 0,
    attested: true,
    includeInReports,
    passages: passages || [
      {
        page: 2,
        start: 0,
        end: r.text.pages[1].length,
        quote: r.text.pages[1],
      },
    ],
  });
}
async function report(ctx: any) {
  let analysis = (
    await ctx.owner(ctx.root + "/analysis", "POST", { mode: "manual" })
  ).analysis;
  assert.ok(analysis);
  analysis = (
    await ctx.owner(ctx.root + "/analysis", "PUT", {
      ...analysis,
      reviewed: true,
    })
  ).analysis;
  const edition = (
    await ctx.owner(ctx.root + "/reporting/editions", "POST", {
      analysisId: analysis.id,
      title: "Verified PDF report",
    })
  ).edition;
  assert.ok(edition);
  const ready = (
    await ctx.owner(ctx.root + "/reporting/editions/" + edition.id, "PUT", {
      ...edition,
      reviewed: true,
    })
  ).edition;
  const share = (
    await ctx.owner(
      ctx.root + "/reporting/editions/" + edition.id + "/share",
      "POST",
    )
  ).token;
  const memoShare = (await ctx.owner(ctx.root + "/share", "POST")).token;
  return { analysis, edition: ready, share, memoShare };
}
async function fixture(included = true) {
  const c = await source();
  await verify(c, included);
  const a = (await c.owner(c.root + "/analysis", "POST", { mode: "manual" }))
    .analysis;
  return { ...c, a, endpoint: c.root + "/pdf-synthesis" };
}
async function seedDraft(ctx: any) {
  const e = ctx.a.pdfEvidence[0],
    p = e.passages[0],
    s = {
      findings: [
        {
          title: "Synthetic document page reference",
          description:
            "The selected document excerpt identifies a synthetic research PDF page.",
          citations: [
            {
              pdfId: e.pdfId,
              verificationVersion: e.verificationVersion,
              page: p.page,
              start: p.start,
              end: p.end,
              quote: p.quote,
            },
          ],
        },
      ],
      limitations:
        "Selected excerpts lack full document context and independent verification.",
      model: "synthetic-fixture",
      promptVersion: pdfSynthesisPromptVersion,
      generatedAt: new Date().toISOString(),
      reviewed: false,
    };
  const sql = createClient({
    url: "file:" + path.join(dataDirectory(), "research.sqlite"),
  });
  try {
    await sql.execute({
      sql: "UPDATE documents SET data=? WHERE kind='analysis' AND id=?",
      args: [JSON.stringify({ ...ctx.a, pdfSynthesis: s }), ctx.a.id],
    });
  } finally {
    sql.close();
  }
  return s;
}
test(
  "Draft synthesis blocks publication; exact-page human review, report exports and immutable source attribution survive editing and discard",
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
    assert.equal(a.pdfSynthesis.reviewedBy.name, "PDF reviewer");
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
    assert.equal(e.pdfSynthesis.reviewed, true);
    e = (
      await ctx.owner(ctx.root + "/reporting/editions/" + e.id, "PUT", {
        ...e,
        pdfSynthesis: { ...s, reviewed: true },
        reviewed: true,
      })
    ).edition;
    assert.equal(e.pdfSynthesis.reviewedBy.name, "PDF reviewer");
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
    assert.ok(text.includes("PDF page 2"));
    const deleted = await ctx.owner(ctx.endpoint, "DELETE", {
      id: a.id,
      version: a.version,
    });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.analysis.pdfSynthesis, undefined);
    assert.equal((await anonymous("shared/" + token)).status, 404);
    assert.equal(
      (await ctx.owner(ctx.root + "/reporting/editions/" + e.id)).status,
      404,
    );
    assert.equal(deleted.analysis.pdfEvidence.length, 1);
  },
);
test(
  "Missing/stale PDF evidence and unavailable providers cannot create drafts; withdrawal removes synthesis and reviewed reports",
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
    const c = await fixture(),
      input = { id: c.a.id, version: c.a.version };
    assert.equal((await c.owner(c.endpoint, "POST", input)).status, 503);
    assert.equal(
      (await c.owner(c.root + "/analysis")).analysis.version,
      c.a.version,
    );
    const s = await seedDraft(c);
    const old = await c.owner(c.url);
    await c.owner(c.url, "PUT", {
      source: old.source,
      digest: old.text.digest,
      version: old.text.history.at(-1).version,
      attested: true,
      passages: [],
      includeInReports: false,
    });
    assert.equal((await c.owner(c.root + "/analysis")).analysis, null);
    assert.equal(
      (
        await c.owner(c.endpoint, "PUT", {
          ...input,
          findings: s.findings,
          limitations: s.limitations,
          reviewed: true,
        })
      ).status,
      404,
    );
  },
);
