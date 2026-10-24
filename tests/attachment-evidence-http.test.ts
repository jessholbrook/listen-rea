import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { start, stop, base, dataDirectory } from "./harness";
import {
  setup,
  upload,
  answer,
  seed,
  head,
  client,
} from "./image-review-fixture";
import { analysisDto } from "../src/lib/external-api";
import { createClient } from "@libsql/client";
import path from "node:path";
import JSZip from "jszip";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3175 : 3174 }),
  { timeout: 90000 },
);
after(stop);
const fields = {
  quality: "usable",
  grounding: "not_applicable",
  notes: "Researcher observation: the save control is readable.",
  correction: "",
};
async function source() {
  const ctx = await setup(false),
    image = await upload(ctx.person, ctx.r, false);
  await answer(ctx.person, ctx.r, image.image.id);
  await answer(ctx.person, ctx.r, undefined, 1);
  return {
    ...ctx,
    imageId: image.image.id,
    url: ctx.root + "/participant-images/" + image.image.id + "/review",
  };
}
async function review(ctx: any, changes: any = {}) {
  const current = await ctx.owner(ctx.url);
  return ctx.owner(ctx.url, "PUT", {
    ...fields,
    ...changes,
    version: current.version,
    source: current.source,
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
      title: "Reviewed observations report",
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
  "Explicit included review notes reach analysis and report appendices, preserve researcher attribution and cannot be forged as participant citations",
  { timeout: 90000 },
  async () => {
    const ctx = await source();
    await review(ctx);
    let a = (
      await ctx.owner(ctx.root + "/analysis", "POST", { mode: "manual" })
    ).analysis;
    assert.equal(a.attachmentEvidence, undefined);
    assert.equal(
      (
        await review(ctx, {
          includeInReports: true,
          quality: "privacy_concern",
        })
      ).status,
      400,
    );
    assert.equal(
      (await review(ctx, { includeInReports: true, notes: "" })).status,
      400,
    );
    assert.equal((await review(ctx, { includeInReports: true })).status, 200);
    const r = await report(ctx);
    assert.equal(r.analysis.attachmentEvidence.length, 1);
    const e = r.analysis.attachmentEvidence[0];
    assert.equal(e.notes, fields.notes);
    assert.equal(e.reviewerName, "Image AI admin");
    assert.equal(e.reviewVersion, 2);
    assert.equal(r.analysis.themes.length, 0);
    assert.equal(r.edition.sampleSize, 1);
    const outsider = await client(),
      publicReport = await outsider("shared/" + r.share);
    assert.equal(publicReport.status, 200);
    assert.ok(
      publicReport.memo.includes(
        "Researcher observations, not participant quotations",
      ),
    );
    assert.ok(publicReport.memo.includes(fields.notes));
    assert.ok(publicReport.memo.includes(ctx.imageId));
    assert.ok(
      (await outsider("shared/" + r.memoShare)).memo.includes(fields.notes),
    );
    const deck = await ctx.owner(
      ctx.root + "/reporting/editions/" + r.edition.id + "/deck",
    );
    assert.equal(deck.status, 200);
    const zip = await JSZip.loadAsync(deck.bytes);
    const slides = (
      await Promise.all(
        Object.keys(zip.files)
          .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
          .map((n) => zip.file(n)!.async("string")),
      )
    ).join(" ");
    assert.ok(slides.includes(fields.notes));
    assert.ok(
      slides.includes("Researcher observations, not participant quotations"),
    );
    assert.ok(slides.includes(ctx.imageId));
    const projection = analysisDto(r.analysis, true);
    assert.equal(JSON.stringify(projection).includes(fields.notes), false);
    assert.equal(
      JSON.stringify(
        await ctx.person(
          "interviews/" + ctx.r.interview.id,
          "GET",
          undefined,
          head(ctx.r),
        ),
      ).includes(fields.notes),
      false,
    );
    const forged = await ctx.owner(ctx.root + "/analysis", "PUT", {
      ...r.analysis,
      themes: [
        {
          title: "Invented participant claim",
          description: "Invalid note citation",
          citations: [
            {
              interviewId: e.interviewId,
              turnId: e.turnId,
              quote: fields.notes,
            },
          ],
        },
      ],
      reviewed: false,
    });
    assert.equal(forged.status, 502);
    const fake = { ...e, notes: "Forged note" };
    const update = await ctx.owner(
      ctx.root + "/reporting/editions/" + r.edition.id,
      "PUT",
      { ...r.edition, attachmentEvidence: [fake], reviewed: true },
    );
    assert.equal(update.edition.attachmentEvidence[0].notes, fields.notes);
    const revoked = await review(ctx, { includeInReports: false });
    assert.equal(revoked.status, 200);
    assert.equal((await ctx.owner(ctx.root + "/analysis")).analysis, null);
    assert.equal(
      (await ctx.owner(ctx.root + "/reporting/editions/" + r.edition.id))
        .status,
      404,
    );
    assert.equal((await outsider("shared/" + r.memoShare)).status, 404);
    assert.equal((await outsider("shared/" + r.share)).status, 404);
  },
);
test(
  "Evidence respects completed/included sources, source fingerprints and image deletion even without an AI question",
  { timeout: 90000 },
  async () => {
    const ctx = await source();
    await review(ctx, { includeInReports: true });
    let r = await report(ctx);
    await ctx.owner(ctx.root + "/responses/" + ctx.r.interview.id, "PATCH", {
      excluded: true,
      reason: "Synthetic exclusion",
    });
    assert.equal(
      (
        await ctx.owner(
          ctx.root + "/reporting/editions/" + r.edition.id + "/share",
          "POST",
        )
      ).status,
      409,
    );
    await ctx.owner(ctx.root + "/responses/" + ctx.r.interview.id, "PATCH", {
      excluded: false,
      reason: "",
    });
    await seed(ctx.r, (i) => {
      i.turns[0].answer = "A changed source answer.";
    });
    assert.equal(
      (await ctx.owner(ctx.root + "/analysis", "POST", { mode: "manual" }))
        .analysis.attachmentEvidence,
      undefined,
    );
    await seed(ctx.r, (i) => {
      i.turns[0].answer =
        "The workflow made it easier to save the example research notes.";
    });
    r = await report(ctx);
    assert.equal(r.analysis.attachmentEvidence.length, 1);
    await ctx.owner(ctx.root + "/participant-images/" + ctx.imageId, "DELETE");
    assert.equal((await ctx.owner(ctx.root + "/analysis")).analysis, null);
    assert.equal(
      (await ctx.owner(ctx.root + "/reporting/editions/" + r.edition.id))
        .status,
      404,
    );
    const sql = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    try {
      assert.equal(
        Number(
          (
            await sql.execute({
              sql: "SELECT COUNT(*) AS n FROM documents WHERE workspace_id=? AND kind IN ('analysis','reportEdition','reportSnapshot','imageReview')",
              args: [ctx.s.workspaceId],
            })
          ).rows[0].n,
        ),
        0,
      );
    } finally {
      sql.close();
    }
  },
);

test(
  "Attachment observations stay in their concept and revision scope and require eligible completed responses",
  { timeout: 90000 },
  async () => {
    const ctx = await source();
    await seed(ctx.r, (i) => {
      i.turns[0].conceptId = "concept-review";
    });
    await review(ctx, { includeInReports: true });
    const current = await ctx.owner(ctx.root),
      revision = current.interviews[0].revisionId;
    const shared = await ctx.owner(ctx.root + "/analysis", "POST", {
      mode: "manual",
    });
    assert.equal(shared.analysis.attachmentEvidence, undefined);
    const scoped = await ctx.owner(
      ctx.root + "/analysis?concept=concept-review&revision=" + revision,
      "POST",
      { mode: "manual" },
    );
    assert.equal(scoped.analysis.attachmentEvidence.length, 1);
    assert.equal(
      scoped.analysis.attachmentEvidence[0].conceptId,
      "concept-review",
    );
    assert.equal(
      (
        await ctx.owner(
          ctx.root + "/analysis?concept=concept-review&revision=other",
          "POST",
          { mode: "manual" },
        )
      ).status,
      400,
    );
    await seed(ctx.r, (i) => {
      i.status = "active";
    });
    assert.equal(
      (await ctx.owner(ctx.root + "/analysis", "POST", { mode: "manual" }))
        .status,
      400,
    );
    await seed(ctx.r, (i) => {
      i.status = "complete";
      i.preview = true;
    });
    assert.equal(
      (await ctx.owner(ctx.root + "/analysis", "POST", { mode: "manual" }))
        .status,
      400,
    );
    await seed(ctx.r, (i) => {
      i.preview = false;
      i.excluded = true;
    });
    assert.equal(
      (await ctx.owner(ctx.root + "/analysis", "POST", { mode: "manual" }))
        .status,
      400,
    );
  },
);
