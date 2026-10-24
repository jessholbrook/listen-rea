import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { start, stop, dataDirectory } from "./harness";
import { seed } from "./image-review-fixture";
import {
  docxTextSetup,
  docxTextDB,
  docxVerificationInput,
} from "./docx-text-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3231 : 3230 }),
  { timeout: 90000 },
);
after(stop);
async function source() {
  const c = await docxTextSetup();
  assert.equal(
    (
      await c.person(
        c.ip + "/answer",
        "POST",
        {
          version: 1,
          requestId: randomUUID(),
          answer: "Synthetic closing answer",
        },
        c.h,
      )
    ).status,
    200,
  );
  return c;
}
async function verify(c: any, includeInReports = false, passages?: any[]) {
  const r = await c.owner(c.textPath);
  return c.owner(c.textPath, "PUT", {
    ...docxVerificationInput(r),
    includeInReports,
    ...(passages ? { passages } : {}),
  });
}
async function report(c: any, query = "") {
  let a = (
    await c.owner(c.root + "/analysis" + query, "POST", { mode: "manual" })
  ).analysis;
  assert.ok(a);
  a = (
    await c.owner(c.root + "/analysis" + query, "PUT", { ...a, reviewed: true })
  ).analysis;
  let e = (
    await c.owner(c.root + "/reporting/editions", "POST", {
      analysisId: a.id,
      title: "Verified DOCX report",
    })
  ).edition;
  assert.ok(e);
  e = (
    await c.owner(c.root + "/reporting/editions/" + e.id, "PUT", {
      ...e,
      reviewed: true,
    })
  ).edition;
  const share = (
      await c.owner(c.root + "/reporting/editions/" + e.id + "/share", "POST")
    ).token,
    memoShare = (await c.owner(c.root + "/share" + query, "POST")).token;
  return { a, e, share, memoShare };
}
async function slideText(bytes: Buffer) {
  const { default: JSZip } = await import("jszip"),
    zip = await JSZip.loadAsync(bytes);
  return (
    await Promise.all(
      Object.keys(zip.files)
        .filter((n) =>
          /^ppt\/(slides|notesSlides)\/(slide|notesSlide)\d+\.xml$/.test(n),
        )
        .map((n) => zip.file(n)!.async("string")),
    )
  ).join(" ");
}
test(
  "DOCX report inclusion is explicit, latest-only, attributed and paragraph cited across memo/report/deck, with private history and source integrity",
  { timeout: 90000 },
  async () => {
    const c = await source();
    await verify(c);
    assert.equal(
      (await c.owner(c.root + "/analysis", "POST", { mode: "manual" })).analysis
        .docxEvidence,
      undefined,
    );
    const privateReport = await report(c);
    const bad = await verify(c, true, []);
    assert.equal(bad.status, 400);
    assert.equal(
      (await c.person("shared/" + privateReport.memoShare)).status,
      200,
    );
    const v = await verify(c, true);
    assert.equal(v.status, 200);
    assert.equal(
      (await c.person("shared/" + privateReport.memoShare)).status,
      404,
    );
    const quality = await c.owner(c.asset + "/review");
    await c.owner(c.asset + "/review", "PUT", {
      source: quality.source,
      version: 0,
      quality: "usable",
      notes: "Private DOCX quality notes sentinel",
    });
    const r = await report(c),
      evidence = r.a.docxEvidence[0];
    assert.equal(evidence.docxId, c.id);
    assert.equal(evidence.verificationVersion, 2);
    assert.deepEqual(evidence.passages, [
      { paragraph: 2, start: 0, end: 25, quote: "Save draft before review." },
    ]);
    assert.equal(evidence.reviewerName, "DOCX passage reviewer");
    assert.equal(r.e.sampleSize, 1);
    assert.deepEqual(r.a.themes, []);
    assert.deepEqual(r.e.docxEvidence, r.a.docxEvidence);
    assert.equal(evidence.history, undefined);
    for (const token of [r.share, r.memoShare]) {
      const shared = await c.person("shared/" + token);
      assert.equal(shared.status, 200);
      assert.ok(
        shared.memo.includes(
          "DOCX paragraph 2 · characters 1–25: “Save draft before review.”",
        ),
      );
      assert.ok(shared.memo.includes("Verified by: DOCX passage reviewer"));
      assert.ok(shared.memo.includes("not interview quotations"));
      assert.ok(!shared.memo.includes("Synthetic DOCX research note"));
      assert.ok(!shared.memo.includes("Private DOCX quality notes sentinel"));
    }
    const deck = await c.owner(
      c.root + "/reporting/editions/" + r.e.id + "/deck",
    );
    assert.equal(deck.status, 200);
    const slides = await slideText(deck.bytes);
    assert.ok(slides.includes("DOCX paragraph 2"));
    assert.ok(slides.includes("Save draft before review."));
    assert.ok(slides.includes("verified-docx-passages"));
    assert.ok(!slides.includes("Synthetic DOCX research note"));
    const { analysisDto } = await import("../src/lib/external-api");
    assert.ok(
      !JSON.stringify(analysisDto(r.a, true)).includes(
        evidence.passages[0].quote,
      ),
    );
    assert.ok(
      !JSON.stringify(await c.person(c.ip, "GET", undefined, c.h)).includes(
        evidence.passages[0].quote,
      ),
    );
    const forged = [
      {
        ...evidence,
        reviewerName: "forged",
        passages: [{ ...evidence.passages[0], quote: "forged" }],
      },
    ];
    const edit = await c.owner(c.root + "/analysis", "PUT", {
      ...r.a,
      docxEvidence: forged,
    });
    assert.deepEqual(edit.analysis.docxEvidence, r.a.docxEvidence);
    const edition = await c.owner(
      c.root + "/reporting/editions/" + r.e.id,
      "PUT",
      { ...r.e, docxEvidence: forged },
    );
    assert.deepEqual(edition.edition.docxEvidence, r.e.docxEvidence);
    assert.equal(
      (
        await c.owner(c.root + "/analysis", "PUT", {
          ...edit.analysis,
          themes: [
            {
              title: "Forged interview claim",
              description: "Document text is separate",
              citations: [
                {
                  interviewId: evidence.interviewId,
                  turnId: evidence.turnId,
                  quote: evidence.passages[0].quote,
                },
              ],
            },
          ],
        })
      ).status,
      502,
    );
    const d = docxTextDB();
    assert.equal(
      (
        await d.execute({
          sql: "SELECT id FROM usage WHERE workspace_id=?",
          args: [c.s.workspaceId],
        })
      ).rows.length,
      0,
    );
    d.close();
    await verify(c, false);
    assert.equal((await c.owner(c.root + "/analysis")).analysis, null);
    assert.equal(
      (await c.owner(c.root + "/reporting/editions/" + r.e.id)).status,
      404,
    );
    assert.equal((await c.person("shared/" + r.share)).status, 404);
    assert.equal((await c.person("shared/" + r.memoShare)).status, 404);
    const next = await report(c);
    assert.equal(next.a.docxEvidence, undefined);
    assert.equal((await c.owner(c.textPath)).verification.history.length, 3);
  },
);
test(
  "DOCX evidence respects concept/revision and eligible responses, revalidates source/snapshot on sharing and exports, and erases derived reports",
  { timeout: 90000 },
  async () => {
    const c = await source();
    await seed(c.r, (i) => {
      i.turns[0].conceptId = "docx-concept";
    });
    await verify(c, true);
    assert.equal(
      (await c.owner(c.root + "/analysis", "POST", { mode: "manual" })).analysis
        .docxEvidence,
      undefined,
    );
    const revision = (await c.owner(c.root)).interviews[0].revisionId,
      query = "?concept=docx-concept&revision=" + revision;
    const scoped = await c.owner(c.root + "/analysis" + query, "POST", {
      mode: "manual",
    });
    assert.equal(scoped.analysis.docxEvidence[0].conceptId, "docx-concept");
    assert.equal(
      (
        await c.owner(
          c.root + "/analysis?concept=docx-concept&revision=other",
          "POST",
          { mode: "manual" },
        )
      ).status,
      400,
    );
    for (const field of ["preview", "excluded"] as const) {
      await seed(c.r, (i) => {
        i[field] = true;
      });
      assert.equal(
        (
          await c.owner(c.root + "/analysis" + query, "POST", {
            mode: "manual",
          })
        ).status,
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
      (await c.owner(c.root + "/analysis" + query, "POST", { mode: "manual" }))
        .status,
      400,
    );
    await seed(c.r, (i) => {
      i.status = "complete";
      delete i.turns[0].conceptId;
    });
    const r = await report(c);
    await seed(c.r, (i) => {
      i.turns[0].answer = "Changed written answer";
    });
    assert.equal((await c.person("shared/" + r.memoShare)).status, 409);
    assert.equal((await c.person("shared/" + r.share)).status, 404);
    assert.equal(
      (await c.owner(c.root + "/reporting/editions/" + r.e.id + "/deck"))
        .status,
      409,
    );
    assert.equal(
      (await c.owner(c.root + "/analysis", "POST", { mode: "manual" })).analysis
        .docxEvidence,
      undefined,
    );
    await seed(c.r, (i) => {
      i.turns[0].answer = "Synthetic written answer";
    });
    const next = await report(c),
      file = path.join(dataDirectory(), "media", c.id),
      original = await readFile(file);
    try {
      await writeFile(
        file,
        JSON.stringify({
          version: 1,
          paragraphs: ["Changed source", "Save draft before review."],
        }),
      );
      assert.equal((await c.person("shared/" + next.memoShare)).status, 409);
      assert.equal(
        (await c.owner(c.root + "/reporting/editions/" + next.e.id + "/deck"))
          .status,
        409,
      );
    } finally {
      await writeFile(file, original);
    }
    await c.owner(c.asset, "DELETE");
    assert.equal((await c.owner(c.root + "/analysis")).analysis, null);
    assert.equal((await c.person("shared/" + next.share)).status, 404);
    const d = docxTextDB();
    assert.equal(
      (
        await d.execute({
          sql: "SELECT id FROM documents WHERE kind='participantDOCXText' AND id=?",
          args: [c.id],
        })
      ).rows.length,
      0,
    );
    d.close();
  },
);
test(
  "DOCX included edits revoke reports, private later edits preserve reports, and response purge removes verification and report history",
  { timeout: 90000 },
  async () => {
    const c = await source();
    await verify(c, true);
    const old = await report(c),
      view = await c.owner(c.textPath),
      selected = docxVerificationInput(view, 1).passages;
    assert.equal((await verify(c, true, selected)).status, 200);
    assert.equal((await c.person("shared/" + old.share)).status, 404);
    const latest = await report(c);
    assert.equal(latest.a.docxEvidence[0].passages[0].paragraph, 1);
    assert.equal(latest.a.docxEvidence[0].verificationVersion, 2);
    await verify(c, false, selected);
    const privateReport = await report(c);
    await verify(c, false);
    assert.equal(
      (await c.person("shared/" + privateReport.memoShare)).status,
      200,
    );
    assert.equal((await c.person("shared/" + privateReport.share)).status, 200);
    await verify(c, true);
    const final = await report(c);
    await c.owner(c.root + "/responses/" + c.r.interview.id, "DELETE");
    assert.equal((await c.person("shared/" + final.share)).status, 404);
    assert.equal((await c.owner(c.textPath)).status, 404);
    const d = docxTextDB();
    assert.equal(
      (
        await d.execute({
          sql: "SELECT id FROM documents WHERE workspace_id=? AND kind IN ('participantDOCXText','reportEdition','reportSnapshot')",
          args: [c.s.workspaceId],
        })
      ).rows.length,
      0,
    );
    d.close();
  },
);
