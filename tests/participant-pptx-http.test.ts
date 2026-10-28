import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import {
  pptxTextSetup,
  pptxTextDB,
  pptxVerificationInput,
} from "./pptx-text-fixture";
import { client, seed } from "./image-review-fixture";
import { samplePPTX } from "./participant-pptx-fixture";
import { pptxMime } from "../src/lib/participant-pptx";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3262 : 3261 }),
  { timeout: 90000 },
);
after(stop);
async function upload(
  c: any,
  id = randomUUID(),
  headers: any = {},
  data?: Buffer,
) {
  return c.person(
    c.ip + "/participant-pptx",
    "POST",
    data || (await samplePPTX()),
    {
      ...c.h,
      "content-type": pptxMime,
      "x-upload-id": id,
      "x-interview-version": "0",
      "x-pptx-description": "Synthetic prepared PPTX",
      "x-pptx-consent": "yes",
      ...headers,
    },
  );
}
const answer = (
  c: any,
  pptxId?: string,
  version = 0,
  requestId = randomUUID(),
) =>
  c.person(
    c.ip + "/answer",
    "POST",
    {
      version,
      requestId,
      answer: "Synthetic written answer",
      participantPPTXId: pptxId,
    },
    c.h,
  );
test(
  "PPTX uploads bind exact retries to answer versions, remain private and can be erased without losing written answers",
  { timeout: 90000 },
  async () => {
    const c = await pptxTextSetup(false),
      id = c.id;
    const retryId = randomUUID();
    assert.equal((await upload(c, retryId)).status, 409);
    assert.equal((await answer(c)).status, 409);
    assert.equal((await answer(c, randomUUID())).status, 409);
    const anon = await client(),
      other = await pptxTextSetup(false),
      privateAsset = c.ip + "/participant-pptx/" + id;
    assert.equal((await anon(c.asset)).status, 401);
    assert.equal((await anon(privateAsset)).status, 404);
    assert.equal((await other.owner(c.asset)).status, 404);
    assert.deepEqual(
      (await c.person(privateAsset, "GET", undefined, c.h)).slides,
      ["Synthetic PPTX research note", "Save draft before review."],
    );
    const d = pptxTextDB();
    const media = (
      await d.execute({
        sql: "SELECT mime,bytes FROM media WHERE id=?",
        args: [id],
      })
    ).rows[0];
    assert.equal(media.mime, "application/json");
    d.close();
    await seed(c.r, (i) => {
      i.pending = { id: randomUUID() } as any;
    });
    assert.equal((await c.owner(c.asset, "DELETE")).status, 409);
    await seed(c.r, (i) => {
      i.pending = undefined;
    });
    const requestId = randomUUID(),
      submitted = await answer(c, id, 0, requestId);
    assert.equal(submitted.status, 200);
    assert.equal(submitted.interview.participantPPTXDraft, undefined);
    assert.equal(submitted.interview.turns[0].participantPPTX.id, id);
    assert.equal((await answer(c, id, 0, requestId)).interview.turns.length, 1);
    assert.equal(
      (
        await c.person(privateAsset, "DELETE", undefined, {
          ...c.h,
          "x-interview-version": "1",
        })
      ).status,
      409,
    );
    const { responseDto } = await import("../src/lib/external-api");
    assert.ok(!JSON.stringify(responseDto(submitted.interview)).includes(id));
    const r = await c.owner(c.textPath);
    assert.equal(
      (await c.owner(c.textPath, "PUT", pptxVerificationInput(r))).status,
      200,
    );
    await c.owner(c.asset, "DELETE");
    assert.equal((await c.owner(c.asset)).status, 404);
    assert.equal((await c.owner(c.textPath)).status, 404);
    const detail = (await c.owner(c.root)).interviews[0];
    assert.equal(detail.turns[0].answer, "Synthetic written answer");
    assert.equal(detail.turns[0].participantPPTX, undefined);
    assert.ok(detail.turns[0].participantPPTXRemovedAt);
  },
);
test(
  "PPTX consent, MIME/body, publication/version/pending gates, tombstones and exact upload retries preserve source identity",
  { timeout: 90000 },
  async () => {
    const c = await pptxTextSetup(false);
    await c.person(c.ip + "/participant-pptx/" + c.id, "DELETE", undefined, {
      ...c.h,
      "x-interview-version": "0",
    });
    for (const headers of [
      { "x-pptx-consent": "no" },
      { "content-type": "application/zip" },
      { "x-pptx-description": "%" },
    ])
      assert.equal((await upload(c, randomUUID(), headers)).status, 400);
    assert.equal(
      (await upload(c, randomUUID(), { "x-interview-version": "99" })).status,
      409,
    );
    assert.equal(
      (await upload(c, randomUUID(), {}, Buffer.from("bad"))).status,
      400,
    );
    await seed(c.r, (i) => {
      i.guide.questions[i.current].participantPPTX = false;
    });
    assert.equal((await upload(c)).status, 409);
    await seed(c.r, (i) => {
      i.guide.questions[i.current].participantPPTX = true;
    });
    const attempt = randomUUID(),
      saved = await upload(c, attempt);
    assert.equal(saved.status, 201);
    assert.equal((await upload(c, attempt)).pptx.id, saved.pptx.id);
    assert.equal(
      (await upload(c, attempt, { "x-pptx-description": "Changed source" }))
        .status,
      409,
    );
    assert.equal(
      (await upload(c, attempt, {}, await samplePPTX(["Different text"])))
        .status,
      409,
    );
    const asset = c.ip + "/participant-pptx/" + saved.pptx.id;
    await c.person(asset, "DELETE", undefined, {
      ...c.h,
      "x-interview-version": "0",
    });
    assert.equal((await upload(c, attempt)).status, 409);
    const final = await upload(c);
    assert.equal(final.status, 201);
    await answer(c, final.pptx.id);
    const r = await c.owner(
      c.root + "/participant-pptx/" + final.pptx.id + "/text",
    );
    await c.owner(
      c.root + "/participant-pptx/" + final.pptx.id + "/text",
      "PUT",
      pptxVerificationInput(r),
    );
    await c.owner(c.root + "/responses/" + c.r.interview.id, "DELETE");
    const d = pptxTextDB();
    for (const sql of [
      "SELECT id FROM media WHERE interview_id=?",
      "SELECT id FROM documents WHERE kind='participantPPTXText' AND json_extract(data,'$.interviewId')=?",
    ])
      assert.equal(
        (await d.execute({ sql, args: [c.r.interview.id] })).rows.length,
        0,
      );
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
  },
);

test(
  "Erasing active image, PDF or DOCX questions preserves independent PPTX drafts, rebinds versions and rejects stale answers",
  { timeout: 90000 },
  async () => {
    for (const kind of ["image", "pdf", "docx"] as const) {
      const c = await pptxTextSetup(false);
      await c.person(c.ip + "/participant-pptx/" + c.id, "DELETE", undefined, {
        ...c.h,
        "x-interview-version": "0",
      });
      await seed(c.r, (i) => {
        i.guide.questions[0].participantDOCX = true;
        i.guide.questions[0].participantPDFs = true;
        i.guide.questions[0].participantImages = true;
      });
      let sourceId: string;
      if (kind === "image") {
        const { upload: uploadImage } = await import("./image-review-fixture");
        const file = await uploadImage(c.person, c.r, false);
        assert.equal(file.status, 201);
        sourceId = file.image.id;
      } else {
        const bytes =
          kind === "pdf"
            ? await (await import("./participant-pdfs-fixture")).samplePDF(2)
            : await (await import("./participant-docx-fixture")).sampleDOCX();
        const mime =
          kind === "pdf"
            ? "application/pdf"
            : (await import("../src/lib/participant-docx")).docxMime;
        const file = await c.person(
          c.ip + (kind === "pdf" ? "/participant-pdfs" : "/participant-docx"),
          "POST",
          bytes,
          {
            ...c.h,
            "content-type": mime,
            "x-upload-id": randomUUID(),
            "x-interview-version": "0",
            ["x-" + kind + "-description"]: "Synthetic source",
            ["x-" + kind + "-consent"]: "yes",
          },
        );
        assert.equal(file.status, 201);
        sourceId = file[kind].id;
      }
      const field =
        kind === "image"
          ? "participantImageId"
          : kind === "pdf"
            ? "participantPDFId"
            : "participantDOCXId";
      assert.equal(
        (
          await c.person(
            c.ip + "/answer",
            "POST",
            {
              version: 0,
              requestId: randomUUID(),
              answer: "Synthetic source response",
              [field]: sourceId,
            },
            c.h,
          )
        ).status,
        200,
      );
      await seed(c.r, (i) => {
        i.current = 0;
        i.prompt = "Synthetic source-derived question?";
        i.strategy = "ai";
        i[
          kind === "image"
            ? "promptImageId"
            : kind === "pdf"
              ? "promptPDFId"
              : "promptDOCXId"
        ] = sourceId;
      });
      const draft = await upload(c, randomUUID(), {
        "x-interview-version": "1",
      });
      assert.equal(draft.status, 201);
      const root =
        kind === "image"
          ? "participant-images"
          : kind === "pdf"
            ? "participant-pdfs"
            : "participant-docx";
      assert.equal(
        (await c.owner(c.root + "/" + root + "/" + sourceId, "DELETE")).status,
        200,
      );
      const updated = (await c.person(c.ip, "GET", undefined, c.h)).interview;
      assert.equal(updated.version, 2);
      assert.equal(updated.participantPPTXDraft.pptx.id, draft.pptx.id);
      assert.equal(updated.participantPPTXDraft.version, 2);
      assert.equal((await answer(c, draft.pptx.id, 1)).status, 409);
      const saved = await answer(c, draft.pptx.id, 2);
      assert.equal(saved.status, 200);
      assert.equal(saved.interview.turns[1].participantPPTX.id, draft.pptx.id);
      assert.equal(
        saved.interview.turns[0].answer,
        "Synthetic source response",
      );
    }
  },
);
