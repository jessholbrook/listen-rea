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
          ? 3189
          : 3188,
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
test(
  "PDF passages are opt-in, attributed and page cited in analysis, shared memo/report and deck; client metadata cannot replace sources",
  { timeout: 90000 },
  async () => {
    const c = await source();
    await verify(c);
    let a = (await c.owner(c.root + "/analysis", "POST", { mode: "manual" }))
      .analysis;
    assert.equal(a.pdfEvidence, undefined);
    assert.equal((await verify(c, true, [])).status, 400);
    const v = await verify(c, true);
    assert.equal(v.status, 200);
    const r = await report(c),
      e = r.analysis.pdfEvidence[0];
    assert.equal(e.pdfId, c.pdfId);
    assert.equal(e.passages[0].page, 2);
    assert.equal(e.reviewerName, "PDF reviewer");
    assert.equal(e.verificationVersion, 2);
    assert.deepEqual(r.analysis.themes, []);
    assert.equal(r.edition.sampleSize, 1);
    assert.deepEqual(r.edition.pdfEvidence, r.analysis.pdfEvidence);
    for (const token of [r.share, r.memoShare]) {
      const publicReport = await c.person("shared/" + token);
      assert.equal(publicReport.status, 200);
      assert.ok(
        publicReport.memo.includes(
          "PDF page 2: “Synthetic research PDF page 2”",
        ),
      );
      assert.ok(publicReport.memo.includes("Verified by: PDF reviewer"));
      assert.ok(publicReport.memo.includes("not interview quotations"));
    }
    const { analysisDto } = await import("../src/lib/external-api");
    assert.equal(
      JSON.stringify(analysisDto(r.analysis, true)).includes(
        e.passages[0].quote,
      ),
      false,
    );
    assert.equal(
      JSON.stringify(
        await c.person(c.ip, "GET", undefined, c.headers),
      ).includes(e.passages[0].quote),
      false,
    );
    const deck = await c.owner(
      c.root + "/reporting/editions/" + r.edition.id + "/deck",
    );
    assert.equal(deck.status, 200);
    const { default: JSZip } = await import("jszip"),
      zip = await JSZip.loadAsync(deck.bytes);
    const slides = (
      await Promise.all(
        Object.keys(zip.files)
          .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
          .map((n) => zip.file(n)!.async("string")),
      )
    ).join(" ");
    assert.ok(slides.includes("Synthetic research PDF page 2"));
    assert.ok(slides.includes("PDF page 2"));
    const updated = await c.owner(
      c.root + "/reporting/editions/" + r.edition.id,
      "PUT",
      {
        ...r.edition,
        pdfEvidence: [
          { ...e, passages: [{ ...e.passages[0], quote: "forged" }] },
        ],
      },
    );
    assert.deepEqual(updated.edition.pdfEvidence, r.edition.pdfEvidence);
    const forged = await c.owner(c.root + "/analysis", "PUT", {
      ...r.analysis,
      themes: [
        {
          title: "Forged interview quote",
          description: "PDF cannot become a participant answer",
          citations: [
            {
              interviewId: e.interviewId,
              turnId: e.turnId,
              quote: e.passages[0].quote,
            },
          ],
        },
      ],
    });
    assert.equal(forged.status, 502);
    await verify(c, false);
    assert.equal((await c.owner(c.root + "/analysis")).analysis, null);
    assert.equal(
      (await c.owner(c.root + "/reporting/editions/" + r.edition.id)).status,
      404,
    );
    assert.equal((await c.person("shared/" + r.share)).status, 404);
    assert.equal((await c.person("shared/" + r.memoShare)).status, 404);
  },
);
test(
  "PDF evidence respects scope, eligible respondents and stale fingerprints; file erasure revokes derived documents and links",
  { timeout: 90000 },
  async () => {
    const c = await source();
    await seed(c.r, (i) => {
      i.turns[0].conceptId = "pdf-concept";
    });
    await verify(c, true);
    assert.equal(
      (await c.owner(c.root + "/analysis", "POST", { mode: "manual" })).analysis
        .pdfEvidence,
      undefined,
    );
    const revision = (await c.owner(c.root)).interviews[0].revisionId,
      scoped = await c.owner(
        c.root + "/analysis?concept=pdf-concept&revision=" + revision,
        "POST",
        { mode: "manual" },
      );
    assert.equal(scoped.analysis.pdfEvidence[0].conceptId, "pdf-concept");
    assert.equal(
      (
        await c.owner(
          c.root + "/analysis?concept=pdf-concept&revision=other",
          "POST",
          { mode: "manual" },
        )
      ).status,
      400,
    );
    for (const field of ["preview", "excluded"]) {
      await seed(c.r, (i) => {
        i[field] = true;
      });
      assert.equal(
        (await c.owner(c.root + "/analysis", "POST", { mode: "manual" }))
          .status,
        400,
      );
      await seed(c.r, (i) => {
        i[field] = false;
      });
    }
    await seed(c.r, (i) => {
      i.status = "active";
    });
    assert.equal(
      (await c.owner(c.root + "/analysis", "POST", { mode: "manual" })).status,
      400,
    );
    await seed(c.r, (i) => {
      i.status = "complete";
      delete i.turns[0].conceptId;
    });
    const r = await report(c);
    await seed(c.r, (i) => {
      i.turns[0].answer = "Changed answer";
    });
    assert.equal((await c.person("shared/" + r.memoShare)).status, 409);
    assert.equal(
      (await c.owner(c.root + "/reporting/editions/" + r.edition.id + "/deck"))
        .status,
      409,
    );
    assert.equal(
      (await c.owner(c.root + "/analysis", "POST", { mode: "manual" })).analysis
        .pdfEvidence,
      undefined,
    );
    await seed(c.r, (i) => {
      i.turns[0].answer = "The synthetic document shows the workflow.";
    });
    const next = await report(c);
    await c.owner(c.root + "/participant-pdfs/" + c.pdfId, "DELETE");
    assert.equal((await c.owner(c.root + "/analysis")).analysis, null);
    assert.equal(
      (await c.owner(c.root + "/reporting/editions/" + next.edition.id)).status,
      404,
    );
    assert.equal((await c.person("shared/" + next.share)).status, 404);
  },
);
test("PDF appendix text localizes labels while retaining exact source quotes", async () => {
  const { pdfEvidenceText } = await import("../src/lib/pdf-evidence");
  const entry: any = {
    pdfId: "pdf",
    interviewId: "i",
    turnId: "t",
    reviewerName: "Researcher",
    reviewedAt: "now",
    verificationVersion: 1,
    passages: [{ page: 2, start: 0, end: 5, quote: "exact" }],
  };
  assert.ok(
    pdfEvidenceText([entry], "es").includes("Página del PDF 2: “exact”"),
  );
  assert.ok(pdfEvidenceText([entry], "fr").includes("Page PDF 2: “exact”"));
  assert.equal(pdfEvidenceText(undefined), "");
});

test(
  "erasing a related image question resets included PDF evidence and revokes its reports while preserving the PDF",
  { timeout: 90000 },
  async () => {
    const c = await setup();
    await seed(c.r, (i) => {
      i.guide.questions[0].participantImages = true;
    });
    const image = await imageUpload(c.person, c.r, false),
      pdf = await upload(c);
    await c.person(
      c.ip + "/answer",
      "POST",
      {
        version: 0,
        requestId: randomUUID(),
        answer: "The synthetic document shows the workflow.",
        participantImageId: image.image.id,
        participantPDFId: pdf.pdf.id,
      },
      c.headers,
    );
    await answer(c, undefined, 1);
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
    const ctx = {
      ...c,
      pdfId: pdf.pdf.id,
      url: c.root + "/participant-pdfs/" + pdf.pdf.id + "/text",
    };
    await verify(ctx, true);
    const r = await report(ctx);
    await c.owner(c.root + "/participant-images/" + image.image.id, "DELETE");
    assert.equal((await c.owner(ctx.url)).text, null);
    assert.equal(
      (await c.owner(c.root + "/participant-pdfs/" + pdf.pdf.id)).status,
      200,
    );
    assert.equal((await c.owner(c.root + "/analysis")).analysis, null);
    assert.equal((await c.person("shared/" + r.share)).status, 404);
  },
);
