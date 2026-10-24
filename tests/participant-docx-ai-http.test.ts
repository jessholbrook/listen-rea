import {
  docxAIPermissionVersion,
  docxProbePromptVersion,
} from "../src/lib/participant-docx-ai";
import { docxMime } from "../src/lib/participant-docx";
import { samplePDF } from "./participant-pdfs-fixture";
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
import { sampleDOCX, participantDOCXGuide } from "./participant-docx-fixture";
import { createClient } from "@libsql/client";
import path from "node:path";
before(
  () =>
    start({
      port: process.env.RESEARCH_TEST_PORT
        ? Number(process.env.RESEARCH_TEST_PORT)
        : process.env.RESEARCH_TEST_PRODUCTION === "1"
          ? 3243
          : 3242,
    }),
  { timeout: 90000 },
);
after(stop);
async function setup(enabled = true) {
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
      guide: (() => {
        const g = participantDOCXGuide();
        g.questions[0].participantDOCXAI = enabled;
        g.questions[0].followUps = 1;
        return g;
      })(),
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
  description = "Synthetic two-paragraph research DOCX",
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
    "x-docx-ai-consent": "yes",
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
test(
  "DOCX AI permission is immutable, frozen and optional; unavailable providers preserve answers, exact retries and attachments",
  { timeout: 90000 },
  async () => {
    const c = await setup(),
      id = randomUUID(),
      docx = await upload(c, id);
    assert.equal(docx.status, 201);
    assert.equal(docx.docx.aiPermission.version, docxAIPermissionVersion);
    assert.equal(docx.docx.aiPermission.provider, "OpenAI");
    assert.equal(
      (await upload(c, id, undefined, 0, { "x-docx-ai-consent": "no" })).status,
      409,
    );
    const request = randomUUID(),
      r = await answer(c, docx.docx.id, 0, request);
    assert.equal(r.status, 200);
    assert.equal(r.interview.turns[0].docxProbe.status, "unavailable");
    assert.equal(r.interview.current, 1);
    assert.equal(
      (await answer(c, docx.docx.id, 0, request)).interview.turns.length,
      1,
    );
    const no = await setup(),
      plain = await upload(no, undefined, undefined, 0, {
        "x-docx-ai-consent": "no",
      });
    assert.equal(plain.docx.aiPermission, undefined);
    assert.equal(
      (await answer(no, plain.docx.id)).interview.turns[0].docxProbe,
      undefined,
    );
    const refusal = await setup(),
      refusalDOCX = await upload(refusal);
    const refused = await refusal.person(
      refusal.ip + "/answer",
      "POST",
      {
        version: 0,
        requestId: randomUUID(),
        answer: "I prefer not to answer.",
        participantDOCXId: refusalDOCX.docx.id,
      },
      refusal.headers,
    );
    assert.equal(refused.status, 200);
    assert.equal(refused.interview.turns[0].docxProbe, undefined);
    const off = await setup(false);
    assert.equal((await upload(off)).status, 400);
    const permitted = await upload(off, undefined, undefined, 0, {
      "x-docx-ai-consent": "no",
    });
    assert.equal(permitted.status, 201);
    let s = (await off.owner(off.root)).study;
    const g = structuredClone(s.draft);
    g.questions[0].participantDOCXAI = true;
    await off.owner(off.root, "PUT", { version: s.version, guide: g });
    assert.equal(
      (await off.person(off.ip, "GET", undefined, off.headers)).interview.guide
        .questions[0].participantDOCXAI,
      false,
    );
  },
);
async function generated(c: any, history = false) {
  const docx = await upload(c);
  await answer(c, docx.docx.id);
  await seed(c.r, (i) => {
    i.turns[0].docxProbe = {
      docxId: docx.docx.id,
      permissionVersion: docxAIPermissionVersion,
      promptVersion: docxProbePromptVersion,
      model: "synthetic-fixture",
      generatedAt: new Date().toISOString(),
      status: "asked",
      probe: "How does Save draft before review. help you?",
      paragraph: 2,
      quote: "Save draft before review.",
    };
    i.current = 0;
    i.strategy = "ai";
    i.status = "active";
    i.prompt = i.turns[0].docxProbe.probe;
    i.promptDOCXId = docx.docx.id;
    if (history) {
      i.turns.push({
        ...i.turns[0],
        id: randomUUID(),
        docxProbe: undefined,
        participantDOCX: undefined,
        promptSourceDOCXId: docx.docx.id,
        prompt: i.prompt,
        answer: "I used it to retain my notes.",
        followUp: true,
      });
      i.promptDOCXId = undefined;
      i.status = "complete";
      i.version = 2;
    }
  });
  return docx;
}
test(
  "DOCX question erasure replaces active prompts, rejects stale answers, rebinds later image/DOCX drafts and clears derived data",
  { timeout: 90000 },
  async () => {
    const c = await setup(),
      docx = await generated(c);
    await seed(c.r, (i) => {
      i.guide.questions[0].participantImages = true;
      i.guide.questions[0].participantPDFs = true;
    });
    const image = await imageUpload(c.person, c.r, false, undefined, 1),
      later = await upload(c, undefined, "Later independent DOCX", 1, {
        "x-docx-ai-consent": "no",
      });
    const independentPDF = await c.person(
      c.ip + "/participant-pdfs",
      "POST",
      await samplePDF(),
      {
        ...c.headers,
        "content-type": "application/pdf",
        "x-upload-id": randomUUID(),
        "x-interview-version": "1",
        "x-pdf-description": "Independent PDF draft",
        "x-pdf-consent": "yes",
      },
    );
    assert.equal(independentPDF.status, 201);
    assert.equal(later.status, 201);
    assert.equal(image.status, 201);
    await seed(c.r, (i) => {
      i.pending = { id: randomUUID(), at: Date.now() };
    });
    assert.equal(
      (await c.owner(c.root + "/participant-docx/" + docx.docx.id, "DELETE"))
        .status,
      409,
    );
    await seed(c.r, (i) => {
      delete i.pending;
    });
    assert.equal(
      (await c.owner(c.root + "/participant-docx/" + docx.docx.id, "DELETE"))
        .status,
      200,
    );
    const i = (await c.person(c.ip, "GET", undefined, c.headers)).interview;
    assert.equal(i.promptDOCXId, undefined);
    assert.equal(i.turns[0].docxProbe, undefined);
    assert.equal(i.strategy, "scripted");
    assert.equal(i.version, 2);
    assert.equal(i.participantDOCXDraft.version, 2);
    assert.equal(i.participantImageDraft.version, 2);
    assert.equal(i.participantPDFDraft.version, 2);
    assert.equal((await answer(c, later.docx.id, 1)).status, 409);
    const joined = await c.person(
      c.ip + "/answer",
      "POST",
      {
        version: 2,
        requestId: randomUUID(),
        answer: "Written work is preserved.",
        participantDOCXId: later.docx.id,
        participantImageId: image.image.id,
        participantPDFId: independentPDF.pdf.id,
      },
      c.headers,
    );
    assert.equal(joined.status, 200);
    assert.equal(joined.interview.turns.at(-1).docxProbe, undefined);
  },
);
test(
  "Erasing historical DOCX questions preserves written answers and independent files but removes contextual reviews and derived reports",
  { timeout: 90000 },
  async () => {
    const c = await setup(),
      docx = await generated(c, true);
    await seed(c.r, (i) => {
      i.current = 1;
    });
    const a = (await c.owner(c.root + "/analysis", "POST", { mode: "manual" }))
      .analysis;
    assert.ok(a);
    await c.owner(c.root + "/participant-docx/" + docx.docx.id, "DELETE");
    const i = (await c.person(c.ip, "GET", undefined, c.headers)).interview;
    assert.equal(i.turns[1].answer, "I used it to retain my notes.");
    assert.equal(i.turns[1].promptSourceDOCXId, undefined);
    assert.equal(
      i.turns[1].prompt,
      "The DOCX-based question was removed after its source DOCX was deleted.",
    );
    assert.equal((await c.owner(c.root + "/analysis")).analysis, null);
    const db = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    assert.equal(
      Number(
        (
          await db.execute(
            "SELECT COUNT(*) AS n FROM usage WHERE operation='docx-probe'",
          )
        ).rows[0].n,
      ),
      0,
    );
    db.close();
  },
);
