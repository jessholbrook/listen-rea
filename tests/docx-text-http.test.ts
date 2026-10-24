import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { start, stop, dataDirectory, base } from "./harness";
import { client, seed } from "./image-review-fixture";
import {
  docxTextSetup,
  docxTextDB,
  docxVerificationInput,
} from "./docx-text-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3228 : 3227 }),
  { timeout: 90000 },
);
after(stop);

test(
  "DOCX exact paragraph verification, immutable optimistic history and private-only edits preserve published reports",
  { timeout: 90000 },
  async () => {
    const c = await docxTextSetup(),
      initial = await c.owner(c.textPath),
      input = docxVerificationInput(initial);
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.paragraphs, [
      "Synthetic DOCX research note",
      "Save draft before review.",
    ]);
    assert.equal(initial.verification, null);
    const invalid = [
      { ...input, attested: false },
      { ...input, attested: undefined },
      { ...input, reviewer: { name: "forged" } },
      { ...input, includeInReports: "yes" },
      { ...input, passages: [{ ...input.passages[0], paragraph: 1 }] },
      { ...input, passages: [{ ...input.passages[0], quote: "invented" }] },
      { ...input, passages: [{ ...input.passages[0], start: 1 }] },
      { ...input, passages: [{ ...input.passages[0], end: 999999 }] },
      { ...input, passages: [{ ...input.passages[0], paragraph: 0 }] },
      { ...input, passages: [{ ...input.passages[0], page: 1 }] },
      { ...input, passages: [input.passages[0], input.passages[0]] },
      { ...input, passages: Array(11).fill(input.passages[0]) },
      {
        ...input,
        passages: [{ ...input.passages[0], quote: "x".repeat(1001) }],
      },
    ];
    for (const v of invalid)
      assert.equal(
        (await c.owner(c.textPath, "PUT", v)).status,
        400,
        JSON.stringify(v),
      );
    for (const changed of [
      { source: "0".repeat(64) },
      { digest: "0".repeat(64) },
      { version: 99 },
    ])
      assert.equal(
        (await c.owner(c.textPath, "PUT", { ...input, ...changed })).status,
        409,
      );
    assert.equal((await c.owner(c.textPath)).verification, null);
    const concurrent = await Promise.all([
      c.owner(c.textPath, "PUT", input),
      c.owner(c.textPath, "PUT", input),
    ]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
    const first = (await c.owner(c.textPath)).verification;
    assert.equal(first.history[0].reviewer.name, "DOCX passage reviewer");
    assert.equal(
      first.turnId,
      (await c.person(c.ip, "GET", undefined, c.h)).interview.turns[0].id,
    );
    assert.deepEqual(first.history[0].passages, input.passages);
    assert.match(first.history[0].at, /^20/);
    await c.person(
      c.ip + "/answer",
      "POST",
      {
        version: 1,
        requestId: randomUUID(),
        answer: "Synthetic closing answer",
      },
      c.h,
    );
    let a = (await c.owner(c.root + "/analysis", "POST", { mode: "manual" }))
      .analysis;
    a = (await c.owner(c.root + "/analysis", "PUT", { ...a, reviewed: true }))
      .analysis;
    const shared = (await c.owner(c.root + "/share", "POST")).token,
      before = await c.owner(c.root);
    assert.equal(
      (await c.owner(c.textPath, "PUT", { ...input, version: 1, passages: [] }))
        .status,
      200,
    );
    const latest = await c.owner(c.textPath);
    assert.deepEqual(latest.verification.history[0], first.history[0]);
    assert.deepEqual(latest.verification.history[1].passages, []);
    assert.equal(latest.verification.history[1].version, 2);
    assert.deepEqual((await c.owner(c.root)).analysis, before.analysis);
    assert.equal(
      (await c.owner(c.root)).study.dataVersion,
      before.study.dataVersion,
    );
    const report = await c.person("shared/" + shared);
    assert.equal(report.status, 200);
    assert.ok(!report.memo.includes(input.passages[0].quote));
    const participant = await c.person(c.ip, "GET", undefined, c.h);
    assert.ok(!JSON.stringify(participant).includes("DOCX passage reviewer"));
    assert.equal(participant.interview.docxText, undefined);
    const { responseDto } = await import("../src/lib/external-api");
    assert.ok(
      !JSON.stringify(responseDto(participant.interview)).includes(c.id),
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
    await c.owner(c.asset, "DELETE");
    assert.equal((await c.owner(c.textPath)).status, 404);
    assert.equal(
      (await c.owner(c.textPath, "PUT", { ...input, version: 2 })).status,
      404,
    );
    assert.equal((await c.person("shared/" + shared)).status, 404);
    const after = await c.owner(c.root);
    assert.equal(
      after.interviews[0].turns[0].answer,
      "Synthetic written answer",
    );
    const check = docxTextDB();
    assert.equal(
      (
        await check.execute({
          sql: "SELECT id FROM documents WHERE kind='participantDOCXText' AND id=?",
          args: [c.id],
        })
      ).rows.length,
      0,
    );
    check.close();
  },
);

test(
  "DOCX verification rejects draft, role, workspace, participant and changed source access; revision limit preserves history",
  { timeout: 90000 },
  async () => {
    const draft = await docxTextSetup(false);
    assert.equal((await draft.owner(draft.textPath)).status, 409);
    const c = await docxTextSetup(),
      r = await c.owner(c.textPath),
      input = docxVerificationInput(r);
    const anon = await client(),
      other = await docxTextSetup();
    assert.equal((await anon(c.textPath)).status, 401);
    assert.equal((await other.owner(c.textPath)).status, 404);
    assert.equal(
      (
        await c.person(
          c.ip + "/participant-docx/" + c.id + "/text",
          "GET",
          undefined,
          c.h,
        )
      ).status,
      404,
    );
    assert.equal((await c.owner(c.textPath, "POST", {})).status, 405);
    const d = docxTextDB();
    try {
      await d.execute({
        sql: "UPDATE users SET role='viewer' WHERE workspace_id=?",
        args: [c.s.workspaceId],
      });
      assert.equal((await c.owner(c.textPath)).status, 200);
      assert.equal((await c.owner(c.textPath, "PUT", input)).status, 403);
    } finally {
      await d.execute({
        sql: "UPDATE users SET role='admin' WHERE workspace_id=?",
        args: [c.s.workspaceId],
      });
    }
    assert.equal((await c.owner(c.textPath, "PUT", input)).status, 200);
    const original = (await c.owner(c.root)).interviews.find(
      (i: any) => i.id === c.r.interview.id,
    );
    for (const key of ["prompt", "answer"] as const) {
      await seed(c.r, (i) => {
        i.turns[0][key] = "Changed source";
      });
      assert.equal((await c.owner(c.textPath)).status, 409);
      assert.equal(
        (await c.owner(c.textPath, "PUT", { ...input, version: 1 })).status,
        409,
      );
      await seed(c.r, (i) => {
        i.turns[0][key] = original.turns[0][key];
      });
    }
    const file = path.join(dataDirectory(), "media", c.id),
      bytes = await readFile(file);
    try {
      await writeFile(
        file,
        JSON.stringify({
          version: 1,
          paragraphs: ["Changed snapshot", "Save draft before review."],
        }),
      );
      assert.equal((await c.owner(c.textPath)).status, 409);
    } finally {
      await writeFile(file, bytes);
    }
    const saved = (await c.owner(c.textPath)).verification;
    const capped = {
      ...saved,
      history: Array.from({ length: 50 }, (_, n) => ({
        ...saved.history[0],
        version: n + 1,
      })),
    };
    await d.execute({
      sql: "UPDATE documents SET data=? WHERE kind='participantDOCXText' AND id=?",
      args: [JSON.stringify(capped), c.id],
    });
    assert.equal(
      (await c.owner(c.textPath, "PUT", { ...input, version: 50 })).status,
      409,
    );
    assert.equal((await c.owner(c.textPath)).verification.history.length, 50);
    d.close();
    const response = await fetch(
      base + "/api/" + c.ip + "/participant-docx/" + c.id,
      { headers: c.h },
    );
    assert.match(response.headers.get("cache-control") || "", /no-store/);
  },
);

test(
  "DOCX verification is cleared on related prompt redaction and whole-response purge",
  { timeout: 90000 },
  async () => {
    const c = await docxTextSetup(false);
    const { upload } = await import("./image-review-fixture");
    await seed(c.r, (i) => {
      i.guide.questions[0].participantImages = true;
    });
    const image = await upload(c.person, c.r, false);
    assert.equal(image.status, 201);
    assert.equal(
      (
        await c.person(
          c.ip + "/answer",
          "POST",
          {
            version: 0,
            requestId: randomUUID(),
            answer: "Synthetic answer with both files",
            participantDOCXId: c.id,
            participantImageId: image.image.id,
          },
          c.h,
        )
      ).status,
      200,
    );
    // Mark the source of a synthetic image-grounded prompt without a provider call.
    const d = docxTextDB();
    await seed(c.r, (i) => {
      i.turns[0].promptSourceImageId = image.image.id;
    });
    const r = await c.owner(c.textPath);
    await c.owner(c.textPath, "PUT", docxVerificationInput(r));
    assert.equal(
      (
        await c.owner(
          c.root + "/participant-images/" + image.image.id,
          "DELETE",
        )
      ).status,
      200,
    );
    const cleared = await c.owner(c.textPath);
    assert.equal(cleared.status, 200, JSON.stringify(cleared));
    assert.equal(cleared.verification, null);
    assert.notEqual(cleared.source, r.source);
    assert.equal(
      (
        await c.owner(c.textPath, "PUT", {
          ...docxVerificationInput(r),
          version: 1,
        })
      ).status,
      409,
    );
    assert.equal(
      (await c.owner(c.textPath, "PUT", docxVerificationInput(cleared))).status,
      200,
    );
    await c.owner(c.root + "/responses/" + c.r.interview.id, "DELETE");
    assert.equal((await c.owner(c.textPath)).status, 404);
    assert.equal(
      (
        await d.execute({
          sql: "SELECT id FROM documents WHERE kind='participantDOCXText' AND id=?",
          args: [c.id],
        })
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await d.execute({
          sql: "SELECT id FROM media WHERE id=?",
          args: [c.id],
        })
      ).rows.length,
      0,
    );
    d.close();
  },
);
