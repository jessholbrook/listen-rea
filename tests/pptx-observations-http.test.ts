import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dataDirectory as reviewDataDirectory } from "./harness";
import pathForReview from "node:path";
import { pptxMime } from "../src/lib/participant-pptx";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { client, seed } from "./image-review-fixture";
import { samplePPTX, participantPPTXGuide } from "./participant-pptx-fixture";
before(
  () =>
    start({
      port: process.env.RESEARCH_TEST_PORT
        ? Number(process.env.RESEARCH_TEST_PORT)
        : process.env.RESEARCH_TEST_PRODUCTION === "1"
          ? 3316
          : 3315,
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
  description = "Synthetic two-page research PPTX",
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
      title: "Verified PPTX report",
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
const fields = {
  quality: "usable",
  grounding: "not_applicable",
  notes: "Researcher annotation: page layout is readable.",
  correction: "",
};
const url = (c: any) => c.root + "/participant-pptx/" + c.pptxId + "/review";
async function review(c: any, changes: any = {}) {
  const v = await c.owner(url(c));
  return c.owner(url(c), "PUT", {
    source: v.source,
    probeSource: v.probeSource,
    version: v.version,
    ...fields,
    ...changes,
  });
}
async function asked(c: any) {
  const snapshotSha256 = createHash("sha256")
    .update(
      await readFile(
        pathForReview.join(reviewDataDirectory(), "media", c.pptxId),
      ),
    )
    .digest("hex");
  await seed(c.r, (i) => {
    i.turns[0].pptxProbe = {
      pptxId: c.pptxId,
      snapshotSha256,
      status: "asked",
      probe: "How does Save draft before review. help?",
      slide: 2,
      quote: "Save draft before review.",
      model: "synthetic-fixture",
      permissionVersion: "synthetic-fixture",
      promptVersion: "synthetic-fixture",
      generatedAt: new Date().toISOString(),
    };
  });
}
test(
  "PPTX annotations are opt-in, separately attributed in analysis/memo/report/deck, preserve question context and cannot forge participant citations",
  { timeout: 90000 },
  async () => {
    const c = await source();
    await asked(c);
    const internal = await review(c, {
      grounding: "unsupported",
      correction: "Private earlier correction",
    });
    assert.equal(internal.status, 200);
    assert.equal(
      (await c.owner(c.root + "/analysis", "POST", { mode: "manual" })).analysis
        .pptxObservations,
      undefined,
    );
    for (const extra of [
      { quality: "privacy_concern" },
      { quality: "uncertain" },
      { notes: "", correction: "" },
    ])
      assert.equal(
        (
          await review(c, {
            ...extra,
            grounding: "unsupported",
            includeInReports: true,
          })
        ).status,
        400,
      );
    const saved = await review(c, {
      grounding: "unsupported",
      correction: "Researcher correction: the question overstates the page.",
      includeInReports: true,
    });
    assert.equal(saved.status, 200);
    const r = await report(c),
      e = r.analysis.pptxObservations[0];
    assert.equal(e.pptxId, c.pptxId);
    assert.equal(e.reviewerName, "PPTX reviewer");
    assert.equal(e.reviewVersion, 2);
    assert.equal(e.grounding, "unsupported");
    assert.equal(e.question.slide, 2);
    assert.equal(e.question.quote, "Save draft before review.");
    assert.equal(r.analysis.pptxEvidence, undefined);
    assert.deepEqual(r.analysis.themes, []);
    assert.equal(r.edition.sampleSize, 1);
    assert.deepEqual(r.edition.pptxObservations, r.analysis.pptxObservations);
    for (const token of [r.share, r.memoShare]) {
      const shared = await c.person("shared/" + token);
      assert.equal(shared.status, 200);
      assert.ok(shared.memo.includes(e.notes));
      assert.ok(shared.memo.includes(e.correction));
      assert.ok(
        shared.memo.includes(
          "not participant quotations or verified PPTX passages",
        ),
      );
      assert.ok(
        shared.memo.includes("Original asked question: " + e.question.text),
      );
      assert.ok(!shared.memo.includes("Private earlier correction"));
    }
    const { analysisDto } = await import("../src/lib/external-api");
    assert.ok(!JSON.stringify(analysisDto(r.analysis, true)).includes(e.notes));
    assert.ok(
      !JSON.stringify(
        await c.person(c.ip, "GET", undefined, c.headers),
      ).includes(e.correction),
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
    assert.ok(slides.includes(e.correction));
    assert.ok(slides.includes("Researcher PPTX observations"));
    assert.ok(slides.includes("PPTX slide 2"));
    const updated = await c.owner(
      c.root + "/reporting/editions/" + r.edition.id,
      "PUT",
      { ...r.edition, pptxObservations: [{ ...e, notes: "forged" }] },
    );
    assert.deepEqual(
      updated.edition.pptxObservations,
      r.edition.pptxObservations,
    );
    const edited = await c.owner(c.root + "/analysis", "PUT", {
      ...r.analysis,
      pptxObservations: [{ ...e, notes: "forged" }],
    });
    assert.deepEqual(
      edited.analysis.pptxObservations,
      r.analysis.pptxObservations,
    );
    const forged = await c.owner(c.root + "/analysis", "PUT", {
      ...edited.analysis,
      themes: [
        {
          title: "Forged",
          description: "Not participant evidence",
          citations: [
            { interviewId: e.interviewId, turnId: e.turnId, quote: e.notes },
          ],
        },
      ],
    });
    assert.equal(forged.status, 502);
  },
);
test(
  "Editing or withdrawing included PPTX annotations revokes derived analyses, editions and shares; private-only edits preserve existing reports",
  { timeout: 90000 },
  async () => {
    const c = await source();
    await review(c);
    const original = await report(c);
    await review(c, { notes: "Another private note" });
    assert.equal((await c.person("shared/" + original.memoShare)).status, 200);
    await review(c, { includeInReports: true });
    assert.equal((await c.person("shared/" + original.share)).status, 404);
    const first = await report(c);
    await review(c, {
      includeInReports: true,
      notes: "Updated included observation",
    });
    assert.equal((await c.owner(c.root + "/analysis")).analysis, null);
    assert.equal((await c.person("shared/" + first.memoShare)).status, 404);
    assert.equal((await c.person("shared/" + first.share)).status, 404);
    const second = await report(c);
    const off = await review(c, { includeInReports: false });
    assert.equal(off.status, 200);
    assert.equal((await c.person("shared/" + second.share)).status, 404);
    assert.equal(
      (await c.owner(c.root + "/reporting/editions/" + second.edition.id))
        .status,
      404,
    );
    assert.equal(
      (await c.owner(c.root + "/analysis", "POST", { mode: "manual" })).analysis
        .pptxObservations,
      undefined,
    );
  },
);
test(
  "PPTX observations obey revision/concept scope, eligibility, exact probe fingerprints and source erasure",
  { timeout: 90000 },
  async () => {
    const c = await source();
    await asked(c);
    await seed(c.r, (i) => {
      i.turns[0].conceptId = "pptx-concept";
    });
    await review(c, { grounding: "supported", includeInReports: true });
    assert.equal(
      (await c.owner(c.root + "/analysis", "POST", { mode: "manual" })).analysis
        .pptxObservations,
      undefined,
    );
    const revision = (await c.owner(c.root)).interviews[0].revisionId;
    const scoped = await c.owner(
      c.root + "/analysis?concept=pptx-concept&revision=" + revision,
      "POST",
      { mode: "manual" },
    );
    assert.equal(scoped.analysis.pptxObservations[0].conceptId, "pptx-concept");
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
      delete i.turns[0].conceptId;
    });
    const r = await report(c);
    await seed(c.r, (i) => {
      i.turns[0].pptxProbe.probe = "Changed question?";
    });
    assert.equal((await c.person("shared/" + r.memoShare)).status, 409);
    assert.equal(
      (await c.owner(c.root + "/reporting/editions/" + r.edition.id + "/deck"))
        .status,
      409,
    );
    assert.equal(
      (await c.owner(c.root + "/analysis", "POST", { mode: "manual" })).analysis
        .pptxObservations,
      undefined,
    );
    await review(c, { grounding: "supported", includeInReports: true });
    const fresh = await report(c);
    await c.owner(c.root + "/participant-pptx/" + c.pptxId, "DELETE");
    assert.equal((await c.person("shared/" + fresh.share)).status, 404);
    assert.equal((await c.owner(c.root + "/analysis")).analysis, null);
    assert.equal((await c.owner(url(c))).status, 404);
  },
);
test(
  "PPTX annotations and verified passages remain separate; correction-only inclusion is supported and labels localize without rewriting source text",
  { timeout: 90000 },
  async () => {
    const c = await source();
    await asked(c);
    assert.equal(
      (
        await review(c, {
          notes: "",
          correction: "Exact researcher wording",
          grounding: "uncertain",
          includeInReports: true,
        })
      ).status,
      200,
    );
    const text = await c.owner(c.url),
      quote = text.slides[1];
    await c.owner(c.url, "PUT", {
      source: text.source,
      digest: text.digest,
      version: 0,
      attested: true,
      includeInReports: true,
      passages: [{ slide: 2, start: 0, end: quote.length, quote }],
    });
    const a = (await c.owner(c.root + "/analysis", "POST", { mode: "manual" }))
      .analysis;
    assert.equal(a.pptxObservations.length, 1);
    assert.equal(a.pptxEvidence.length, 1);
    assert.deepEqual(a.themes, []);
    const { pptxObservationsText } =
      await import("../src/lib/pptx-observations");
    assert.ok(
      pptxObservationsText(a.pptxObservations, "es").includes(
        "Diapositiva del PPTX 2",
      ),
    );
    assert.ok(
      pptxObservationsText(a.pptxObservations, "fr").includes(
        "Correction du chercheur: Exact researcher wording",
      ),
    );
    assert.ok(
      pptxObservationsText(a.pptxObservations, "fr").includes("Incertaine"),
    );
    assert.equal(pptxObservationsText(undefined), "");
  },
);
