import {
  pptxAIPermissionVersion,
  pptxProbePromptVersion,
} from "../src/lib/participant-pptx-ai";
import { pptxMime } from "../src/lib/participant-pptx";
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
import { samplePPTX, participantPPTXGuide } from "./participant-pptx-fixture";
import { createClient } from "@libsql/client";
import path from "node:path";
before(
  () =>
    start({
      port: process.env.RESEARCH_TEST_PORT
        ? Number(process.env.RESEARCH_TEST_PORT)
        : process.env.RESEARCH_TEST_PRODUCTION === "1"
          ? 3313
          : 3312,
    }),
  { timeout: 90000 },
);
after(stop);
async function setup(enabled = true) {
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
      guide: (() => {
        const g = participantPPTXGuide();
        g.questions[0].participantPPTXAI = enabled;
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
  description = "Synthetic two-slide research PPTX",
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
    "x-pptx-ai-consent": "yes",
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
test(
  "PPTX AI permission is immutable, frozen and optional; unavailable providers preserve answers, exact retries and attachments",
  { timeout: 90000 },
  async () => {
    const c = await setup(),
      id = randomUUID(),
      pptx = await upload(c, id);
    assert.equal(pptx.status, 201);
    assert.equal(pptx.pptx.aiPermission.version, pptxAIPermissionVersion);
    assert.equal(pptx.pptx.aiPermission.provider, "OpenAI");
    assert.equal(
      (await upload(c, id, undefined, 0, { "x-pptx-ai-consent": "no" })).status,
      409,
    );
    const request = randomUUID(),
      r = await answer(c, pptx.pptx.id, 0, request);
    assert.equal(r.status, 200);
    assert.equal(r.interview.turns[0].pptxProbe.status, "unavailable");
    assert.equal(r.interview.current, 1);
    assert.equal(
      (await answer(c, pptx.pptx.id, 0, request)).interview.turns.length,
      1,
    );
    const no = await setup(),
      plain = await upload(no, undefined, undefined, 0, {
        "x-pptx-ai-consent": "no",
      });
    assert.equal(plain.pptx.aiPermission, undefined);
    assert.equal(
      (await answer(no, plain.pptx.id)).interview.turns[0].pptxProbe,
      undefined,
    );
    const refusal = await setup(),
      refusalPPTX = await upload(refusal);
    const refused = await refusal.person(
      refusal.ip + "/answer",
      "POST",
      {
        version: 0,
        requestId: randomUUID(),
        answer: "I prefer not to answer.",
        participantPPTXId: refusalPPTX.pptx.id,
      },
      refusal.headers,
    );
    assert.equal(refused.status, 200);
    assert.equal(refused.interview.turns[0].pptxProbe, undefined);
    const off = await setup(false);
    assert.equal((await upload(off)).status, 400);
    const permitted = await upload(off, undefined, undefined, 0, {
      "x-pptx-ai-consent": "no",
    });
    assert.equal(permitted.status, 201);
    let s = (await off.owner(off.root)).study;
    const g = structuredClone(s.draft);
    g.questions[0].participantPPTXAI = true;
    await off.owner(off.root, "PUT", { version: s.version, guide: g });
    assert.equal(
      (await off.person(off.ip, "GET", undefined, off.headers)).interview.guide
        .questions[0].participantPPTXAI,
      false,
    );
  },
);
async function generated(c: any, history = false) {
  const pptx = await upload(c);
  await answer(c, pptx.pptx.id);
  await seed(c.r, (i) => {
    i.turns[0].pptxProbe = {
      pptxId: pptx.pptx.id,
      permissionVersion: pptxAIPermissionVersion,
      promptVersion: pptxProbePromptVersion,
      model: "synthetic-fixture",
      generatedAt: new Date().toISOString(),
      status: "asked",
      probe: "How does Save draft before review. help you?",
      slide: 2,
      quote: "Save draft before review.",
    };
    i.current = 0;
    i.strategy = "ai";
    i.status = "active";
    i.prompt = i.turns[0].pptxProbe.probe;
    i.promptPPTXId = pptx.pptx.id;
    if (history) {
      i.turns.push({
        ...i.turns[0],
        id: randomUUID(),
        pptxProbe: undefined,
        participantPPTX: undefined,
        promptSourcePPTXId: pptx.pptx.id,
        prompt: i.prompt,
        answer: "I used it to retain my notes.",
        followUp: true,
      });
      i.promptPPTXId = undefined;
      i.status = "complete";
      i.version = 2;
    }
  });
  return pptx;
}
test(
  "PPTX question erasure replaces active prompts, rejects stale answers, rebinds later image/PDF/DOCX/PPTX drafts and clears derived data",
  { timeout: 90000 },
  async () => {
    const c = await setup(),
      pptx = await generated(c);
    await seed(c.r, (i) => {
      i.guide.questions[0].participantImages = true;
      i.guide.questions[0].participantPDFs = true;
      i.guide.questions[0].participantDOCX = true;
    });
    const image = await imageUpload(c.person, c.r, false, undefined, 1),
      later = await upload(c, undefined, "Later independent PPTX", 1, {
        "x-pptx-ai-consent": "no",
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
    const { sampleDOCX } = await import("./participant-docx-fixture");
    const { docxMime } = await import("../src/lib/participant-docx");
    const independentDOCX = await c.person(
      c.ip + "/participant-docx",
      "POST",
      await sampleDOCX(),
      {
        ...c.headers,
        "content-type": docxMime,
        "x-upload-id": randomUUID(),
        "x-interview-version": "1",
        "x-docx-description": "Independent DOCX draft",
        "x-docx-consent": "yes",
      },
    );
    assert.equal(independentDOCX.status, 201);
    assert.equal(independentPDF.status, 201);
    assert.equal(later.status, 201);
    assert.equal(image.status, 201);
    await seed(c.r, (i) => {
      i.pending = { id: randomUUID(), at: Date.now() };
    });
    assert.equal(
      (await c.owner(c.root + "/participant-pptx/" + pptx.pptx.id, "DELETE"))
        .status,
      409,
    );
    await seed(c.r, (i) => {
      delete i.pending;
    });
    assert.equal(
      (await c.owner(c.root + "/participant-pptx/" + pptx.pptx.id, "DELETE"))
        .status,
      200,
    );
    const i = (await c.person(c.ip, "GET", undefined, c.headers)).interview;
    assert.equal(i.promptPPTXId, undefined);
    assert.equal(i.turns[0].pptxProbe, undefined);
    assert.equal(i.strategy, "scripted");
    assert.equal(i.version, 2);
    assert.equal(i.participantPPTXDraft.version, 2);
    assert.equal(i.participantImageDraft.version, 2);
    assert.equal(i.participantPDFDraft.version, 2);
    assert.equal(i.participantDOCXDraft.version, 2);
    assert.equal((await answer(c, later.pptx.id, 1)).status, 409);
    const joined = await c.person(
      c.ip + "/answer",
      "POST",
      {
        version: 2,
        requestId: randomUUID(),
        answer: "Written work is preserved.",
        participantPPTXId: later.pptx.id,
        participantImageId: image.image.id,
        participantPDFId: independentPDF.pdf.id,
        participantDOCXId: independentDOCX.docx.id,
      },
      c.headers,
    );
    assert.equal(joined.status, 200);
    assert.equal(
      joined.interview.turns.at(-1).participantDOCX.id,
      independentDOCX.docx.id,
    );
    assert.equal(joined.interview.turns.at(-1).pptxProbe, undefined);
  },
);
test(
  "Erasing historical PPTX questions preserves written answers and independent files but removes contextual reviews and derived reports",
  { timeout: 90000 },
  async () => {
    const c = await setup(),
      pptx = await generated(c, true);
    await seed(c.r, (i) => {
      i.current = 1;
    });
    const a = (await c.owner(c.root + "/analysis", "POST", { mode: "manual" }))
      .analysis;
    assert.ok(a);
    await c.owner(c.root + "/participant-pptx/" + pptx.pptx.id, "DELETE");
    const i = (await c.person(c.ip, "GET", undefined, c.headers)).interview;
    assert.equal(i.turns[1].answer, "I used it to retain my notes.");
    assert.equal(i.turns[1].promptSourcePPTXId, undefined);
    assert.equal(
      i.turns[1].prompt,
      "The PPTX-based question was removed after its source PPTX was deleted.",
    );
    assert.equal((await c.owner(c.root + "/analysis")).analysis, null);
    const db = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    assert.equal(
      Number(
        (
          await db.execute(
            "SELECT COUNT(*) AS n FROM usage WHERE operation='pptx-probe'",
          )
        ).rows[0].n,
      ),
      0,
    );
    db.close();
  },
);
