import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { start, stop } from "./harness";
import { client, seed } from "./image-review-fixture";
import { pptxTextDB, pptxVerificationInput } from "./pptx-text-fixture";
import {
  pptxSynthesisSource,
  seedPPTXSynthesis,
} from "./pptx-synthesis-fixture";
import { analysisDto } from "../src/lib/external-api";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3294 : 3293 }),
  { timeout: 90000 },
);
after(stop);
const content = (s: any) => ({
  findings: s.findings,
  limitations: s.limitations,
});
async function publish(c: any, analysis: any) {
  const a = (
    await c.owner(c.root + "/analysis", "PUT", { ...analysis, reviewed: true })
  ).analysis;
  assert.ok(a);
  let e = (
    await c.owner(c.root + "/reporting/editions", "POST", {
      analysisId: a.id,
      title: "Reviewed PPTX synthesis report",
    })
  ).edition;
  assert.ok(e);
  e = (
    await c.owner(c.root + "/reporting/editions/" + e.id, "PUT", {
      ...e,
      reviewed: true,
      pptxSynthesis: { reviewed: true, model: "forged" },
    })
  ).edition;
  const share = (
    await c.owner(c.root + "/reporting/editions/" + e.id + "/share", "POST")
  ).token;
  const memoShare = (await c.owner(c.root + "/share", "POST")).token;
  return { a, e, share, memoShare };
}
test(
  "PPTX synthesis drafts require separate researcher and memo review, preserve exact citations/provenance, export only reviewed content and invalidate reports on edit/discard",
  { timeout: 90000 },
  async () => {
    const c = await pptxSynthesisSource(),
      draft = await seedPPTXSynthesis(c),
      input = { id: c.a.id, version: c.a.version };
    assert.equal(
      (await c.owner(c.root + "/analysis", "PUT", { ...c.a, reviewed: true }))
        .status,
      400,
    );
    assert.equal(
      (
        await c.owner(c.root + "/reporting/editions", "POST", {
          analysisId: c.a.id,
          title: "Blocked draft report",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await c.owner(c.endpoint, "PUT", {
          ...input,
          ...content(draft),
          reviewed: true,
          model: "forged",
        })
      ).status,
      400,
    );
    const invented = structuredClone(draft.findings);
    invented[0].citations[0].quote = "Invented text";
    assert.equal(
      (
        await c.owner(c.endpoint, "PUT", {
          ...input,
          findings: invented,
          limitations: draft.limitations,
          reviewed: true,
        })
      ).status,
      502,
    );
    let r = await c.owner(c.endpoint, "PUT", {
      ...input,
      ...content(draft),
      reviewed: true,
    });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(
      r.analysis.pptxSynthesis.reviewedBy.name,
      "PPTX passage reviewer",
    );
    assert.equal(r.analysis.pptxSynthesis.model, draft.model);
    assert.equal(r.analysis.pptxSynthesis.generatedAt, draft.generatedAt);
    assert.equal(r.analysis.reviewed, false);
    assert.deepEqual(r.analysis.themes, []);
    assert.equal((await c.owner(c.endpoint, "DELETE", input)).status, 409);
    const report = await publish(c, r.analysis);
    assert.equal(report.e.pptxSynthesis.model, draft.model);
    assert.equal(report.e.sampleSize, 1);
    for (const token of [report.share, report.memoShare]) {
      const shared = await c.person("shared/" + token);
      assert.equal(shared.status, 200);
      assert.ok(shared.memo.includes(draft.findings[0].title));
      assert.ok(shared.memo.includes("PPTX slide 2 · characters 1–25"));
      assert.ok(!shared.memo.includes("Synthetic PPTX research note"));
    }
    assert.ok(
      !JSON.stringify(analysisDto(report.a, true)).includes(
        draft.findings[0].title,
      ),
    );
    assert.ok(
      !JSON.stringify(await c.person(c.ip, "GET", undefined, c.h)).includes(
        draft.findings[0].title,
      ),
    );
    const deck = await c.owner(
      c.root + "/reporting/editions/" + report.e.id + "/deck",
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
    assert.ok(text.includes(draft.findings[0].title));
    assert.ok(text.includes("PPTX slide 2"));
    const changed = structuredClone(draft.findings);
    changed[0].title = "Privately revised draft instruction";
    r = await c.owner(c.endpoint, "PUT", {
      id: report.a.id,
      version: report.a.version,
      findings: changed,
      limitations: draft.limitations,
      reviewed: false,
    });
    assert.equal(r.analysis.pptxSynthesis.reviewed, false);
    assert.equal(r.analysis.pptxSynthesis.reviewedBy, undefined);
    assert.equal(r.analysis.reviewed, false);
    assert.equal((await c.person("shared/" + report.share)).status, 404);
    assert.equal((await c.person("shared/" + report.memoShare)).status, 404);
    assert.equal(
      (await c.owner(c.root + "/reporting/editions/" + report.e.id)).status,
      404,
    );
    assert.equal(
      (
        await c.owner(c.root + "/analysis", "PUT", {
          ...r.analysis,
          reviewed: true,
        })
      ).status,
      400,
    );
    const edits = await Promise.all([
      c.owner(c.endpoint, "DELETE", {
        id: r.analysis.id,
        version: r.analysis.version,
      }),
      c.owner(c.endpoint, "DELETE", {
        id: r.analysis.id,
        version: r.analysis.version,
      }),
    ]);
    assert.deepEqual(edits.map((e) => e.status).sort(), [200, 409]);
    const after = (await c.owner(c.root + "/analysis")).analysis;
    assert.equal(after.pptxSynthesis, undefined);
    assert.equal(after.pptxEvidence.length, 1);
  },
);
test(
  "PPTX synthesis protects role/workspace/source/scope/language/version and unavailable providers preserve reports",
  { timeout: 90000 },
  async () => {
    const empty = await pptxSynthesisSource(false);
    assert.equal(
      (
        await empty.owner(empty.endpoint, "POST", {
          id: empty.a.id,
          version: empty.a.version,
        })
      ).status,
      400,
    );
    const c = await pptxSynthesisSource(),
      input = { id: c.a.id, version: c.a.version },
      anon = await client(),
      other = await pptxSynthesisSource();
    assert.equal((await anon(c.endpoint, "POST", input)).status, 401);
    assert.equal((await other.owner(c.endpoint, "POST", input)).status, 404);
    assert.equal((await c.person(c.endpoint, "POST", input, c.h)).status, 401);
    assert.equal(
      (await c.owner(c.endpoint, "POST", { ...input, version: 99 })).status,
      409,
    );
    assert.equal(
      (await c.owner(c.endpoint, "POST", { ...input, id: randomUUID() }))
        .status,
      409,
    );
    assert.equal(
      (
        await c.owner(
          c.endpoint + "?concept=other&revision=other",
          "POST",
          input,
        )
      ).status,
      404,
    );
    const d = pptxTextDB();
    try {
      await d.execute({
        sql: "UPDATE users SET role='viewer' WHERE workspace_id=?",
        args: [c.s.workspaceId],
      });
      assert.equal((await c.owner(c.endpoint, "POST", input)).status, 403);
    } finally {
      await d.execute({
        sql: "UPDATE users SET role='admin' WHERE workspace_id=?",
        args: [c.s.workspaceId],
      });
    }
    const published = await publish(c, c.a),
      before = (await c.owner(c.root + "/analysis")).analysis;
    assert.equal(
      (
        await c.owner(c.endpoint, "POST", {
          id: before.id,
          version: before.version,
        })
      ).status,
      503,
    );
    assert.deepEqual((await c.owner(c.root + "/analysis")).analysis, before);
    assert.equal((await c.person("shared/" + published.share)).status, 200);
    assert.equal((await c.person("shared/" + published.memoShare)).status, 200);
    await seed(c.r, (i) => {
      i.turns[0].answer = "Changed PPTX source";
    });
    assert.equal(
      (
        await c.owner(c.endpoint, "POST", {
          id: before.id,
          version: before.version,
        })
      ).status,
      409,
    );
    await seed(c.r, (i) => {
      i.turns[0].answer = "Synthetic written answer";
    });
    const studyRow = (
        await d.execute({
          sql: "SELECT data FROM documents WHERE kind='study' AND id=?",
          args: [c.s.id],
        })
      ).rows[0],
      study = JSON.parse(String(studyRow.data));
    study.draft.localization = {
      sourceLanguage: "en",
      reportingLanguage: "fr",
      guidance: "",
      translations: [],
    };
    await d.execute({
      sql: "UPDATE documents SET data=? WHERE kind='study' AND id=?",
      args: [JSON.stringify(study), c.s.id],
    });
    assert.equal(
      (
        await c.owner(c.endpoint, "POST", {
          id: before.id,
          version: before.version,
        })
      ).status,
      409,
    );
    d.close();
  },
);
test(
  "PPTX source withdrawal, file deletion and whole-response purge erase synthesis and block late writes",
  { timeout: 90000 },
  async () => {
    for (const action of ["withdraw", "file", "response"] as const) {
      const c = await pptxSynthesisSource(),
        draft = await seedPPTXSynthesis(c),
        input = { id: c.a.id, version: c.a.version };
      const a = (
        await c.owner(c.endpoint, "PUT", {
          ...input,
          ...content(draft),
          reviewed: true,
        })
      ).analysis;
      const report = await publish(c, a);
      if (action === "withdraw") {
        const v = await c.owner(c.textPath);
        await c.owner(c.textPath, "PUT", {
          ...pptxVerificationInput(v),
          includeInReports: false,
        });
      } else
        await c.owner(
          action === "file"
            ? c.asset
            : c.root + "/responses/" + c.r.interview.id,
          "DELETE",
        );
      assert.equal((await c.owner(c.root + "/analysis")).analysis, null);
      assert.equal((await c.person("shared/" + report.share)).status, 404);
      assert.equal(
        (
          await c.owner(c.endpoint, "PUT", {
            ...input,
            ...content(draft),
            reviewed: true,
          })
        ).status,
        404,
      );
    }
  },
);
