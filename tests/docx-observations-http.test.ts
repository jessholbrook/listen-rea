import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dataDirectory as reviewDataDirectory } from "./harness";
import pathForReview from "node:path";
import { docxMime } from "../src/lib/participant-docx";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { client, seed } from "./image-review-fixture";
import { sampleDOCX, participantDOCXGuide } from "./participant-docx-fixture";
before(
  () =>
    start({
      port: process.env.RESEARCH_TEST_PORT
        ? Number(process.env.RESEARCH_TEST_PORT)
        : process.env.RESEARCH_TEST_PRODUCTION === "1"
          ? 3246
          : 3245,
    }),
  { timeout: 90000 },
);
after(stop);
async function setup() {
  const owner = await client(),
    person = await client();
  await owner("auth/signup", "POST", {
    name: "DOCX reviewer",
    email: randomUUID() + "@example.test",
    password: "docx-test-password",
  });
  let s = (await owner("studies", "POST", { title: "DOCX workflow" })).study;
  const root = "studies/" + s.id;
  s = (
    await owner(root, "PUT", {
      version: s.version,
      guide: participantDOCXGuide(),
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
  description = "Synthetic two-page research DOCX",
  version = 0,
  changes: any = {},
) {
  return ctx.person(ctx.ip + "/participant-docx", "POST", await sampleDOCX(), {
    ...ctx.headers,
    "content-type": docxMime,
    "x-upload-id": id,
    "x-interview-version": String(version),
    "x-docx-description": encodeURIComponent(description),
    "x-docx-consent": "yes",
    ...changes,
  });
}
async function answer(
  ctx: any,
  docxId?: string,
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
      participantDOCXId: docxId,
    },
    ctx.headers,
  );
}

async function source() {
  const c = await setup(),
    docx = await upload(c);
  await answer(c, docx.docx.id);
  await answer(c, undefined, 1);
  return {
    ...c,
    docxId: docx.docx.id,
    url: c.root + "/participant-docx/" + docx.docx.id + "/text",
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
      title: "Verified DOCX report",
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
const url = (c: any) => c.root + "/participant-docx/" + c.docxId + "/review";
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
        pathForReview.join(reviewDataDirectory(), "media", c.docxId),
      ),
    )
    .digest("hex");
  await seed(c.r, (i) => {
    i.turns[0].docxProbe = {
      docxId: c.docxId,
      snapshotSha256,
      status: "asked",
      probe: "How does Save draft before review. help?",
      paragraph: 2,
      quote: "Save draft before review.",
      model: "synthetic-fixture",
      permissionVersion: "synthetic-fixture",
      promptVersion: "synthetic-fixture",
      generatedAt: new Date().toISOString(),
    };
  });
}
test(
  "DOCX annotations are opt-in, separately attributed in analysis/memo/report/deck, preserve question context and cannot forge participant citations",
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
        .docxObservations,
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
      e = r.analysis.docxObservations[0];
    assert.equal(e.docxId, c.docxId);
    assert.equal(e.reviewerName, "DOCX reviewer");
    assert.equal(e.reviewVersion, 2);
    assert.equal(e.grounding, "unsupported");
    assert.equal(e.question.paragraph, 2);
    assert.equal(e.question.quote, "Save draft before review.");
    assert.equal(r.analysis.docxEvidence, undefined);
    assert.deepEqual(r.analysis.themes, []);
    assert.equal(r.edition.sampleSize, 1);
    assert.deepEqual(r.edition.docxObservations, r.analysis.docxObservations);
    for (const token of [r.share, r.memoShare]) {
      const shared = await c.person("shared/" + token);
      assert.equal(shared.status, 200);
      assert.ok(shared.memo.includes(e.notes));
      assert.ok(shared.memo.includes(e.correction));
      assert.ok(
        shared.memo.includes(
          "not participant quotations or verified DOCX passages",
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
    assert.ok(slides.includes("Researcher DOCX observations"));
    assert.ok(slides.includes("DOCX paragraph 2"));
    const updated = await c.owner(
      c.root + "/reporting/editions/" + r.edition.id,
      "PUT",
      { ...r.edition, docxObservations: [{ ...e, notes: "forged" }] },
    );
    assert.deepEqual(
      updated.edition.docxObservations,
      r.edition.docxObservations,
    );
    const edited = await c.owner(c.root + "/analysis", "PUT", {
      ...r.analysis,
      docxObservations: [{ ...e, notes: "forged" }],
    });
    assert.deepEqual(
      edited.analysis.docxObservations,
      r.analysis.docxObservations,
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
  "Editing or withdrawing included DOCX annotations revokes derived analyses, editions and shares; private-only edits preserve existing reports",
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
        .docxObservations,
      undefined,
    );
  },
);
test(
  "DOCX observations obey revision/concept scope, eligibility, exact probe fingerprints and source erasure",
  { timeout: 90000 },
  async () => {
    const c = await source();
    await asked(c);
    await seed(c.r, (i) => {
      i.turns[0].conceptId = "docx-concept";
    });
    await review(c, { grounding: "supported", includeInReports: true });
    assert.equal(
      (await c.owner(c.root + "/analysis", "POST", { mode: "manual" })).analysis
        .docxObservations,
      undefined,
    );
    const revision = (await c.owner(c.root)).interviews[0].revisionId;
    const scoped = await c.owner(
      c.root + "/analysis?concept=docx-concept&revision=" + revision,
      "POST",
      { mode: "manual" },
    );
    assert.equal(scoped.analysis.docxObservations[0].conceptId, "docx-concept");
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
      i.turns[0].docxProbe.probe = "Changed question?";
    });
    assert.equal((await c.person("shared/" + r.memoShare)).status, 409);
    assert.equal(
      (await c.owner(c.root + "/reporting/editions/" + r.edition.id + "/deck"))
        .status,
      409,
    );
    assert.equal(
      (await c.owner(c.root + "/analysis", "POST", { mode: "manual" })).analysis
        .docxObservations,
      undefined,
    );
    await review(c, { grounding: "supported", includeInReports: true });
    const fresh = await report(c);
    await c.owner(c.root + "/participant-docx/" + c.docxId, "DELETE");
    assert.equal((await c.person("shared/" + fresh.share)).status, 404);
    assert.equal((await c.owner(c.root + "/analysis")).analysis, null);
    assert.equal((await c.owner(url(c))).status, 404);
  },
);
test(
  "DOCX annotations and verified passages remain separate; correction-only inclusion is supported and labels localize without rewriting source text",
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
      quote = text.paragraphs[1];
    await c.owner(c.url, "PUT", {
      source: text.source,
      digest: text.digest,
      version: 0,
      attested: true,
      includeInReports: true,
      passages: [{ paragraph: 2, start: 0, end: quote.length, quote }],
    });
    const a = (await c.owner(c.root + "/analysis", "POST", { mode: "manual" }))
      .analysis;
    assert.equal(a.docxObservations.length, 1);
    assert.equal(a.docxEvidence.length, 1);
    assert.deepEqual(a.themes, []);
    const { docxObservationsText } =
      await import("../src/lib/docx-observations");
    assert.ok(
      docxObservationsText(a.docxObservations, "es").includes(
        "Párrafo del DOCX 2",
      ),
    );
    assert.ok(
      docxObservationsText(a.docxObservations, "fr").includes(
        "Correction du chercheur: Exact researcher wording",
      ),
    );
    assert.ok(
      docxObservationsText(a.docxObservations, "fr").includes("Incertaine"),
    );
    assert.equal(docxObservationsText(undefined), "");
  },
);
