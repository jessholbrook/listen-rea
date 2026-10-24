import {
  pdfAIPermissionVersion,
  pdfProbePromptVersion,
} from "../src/lib/participant-pdf-ai";
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
          ? 3195
          : 3194,
    }),
  { timeout: 90000 },
);
after(stop);
async function setup(enabled = true) {
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
      guide: (() => {
        const g = participantPDFGuide();
        g.questions[0].participantPDFAI = enabled;
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
      "x-pdf-ai-consent": "yes",
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
test(
  "PDF AI permission is immutable, frozen and optional; unavailable providers preserve answers, exact retries and attachments",
  { timeout: 90000 },
  async () => {
    const c = await setup(),
      id = randomUUID(),
      pdf = await upload(c, id);
    assert.equal(pdf.status, 201);
    assert.equal(pdf.pdf.aiPermission.version, pdfAIPermissionVersion);
    assert.equal(pdf.pdf.aiPermission.provider, "OpenAI");
    assert.equal(
      (await upload(c, id, undefined, 0, { "x-pdf-ai-consent": "no" })).status,
      409,
    );
    const request = randomUUID(),
      r = await answer(c, pdf.pdf.id, 0, request);
    assert.equal(r.status, 200);
    assert.equal(r.interview.turns[0].pdfProbe.status, "unavailable");
    assert.equal(r.interview.current, 1);
    assert.equal(
      (await answer(c, pdf.pdf.id, 0, request)).interview.turns.length,
      1,
    );
    const no = await setup(),
      plain = await upload(no, undefined, undefined, 0, {
        "x-pdf-ai-consent": "no",
      });
    assert.equal(plain.pdf.aiPermission, undefined);
    assert.equal(
      (await answer(no, plain.pdf.id)).interview.turns[0].pdfProbe,
      undefined,
    );
    const refusal = await setup(),
      refusalPDF = await upload(refusal);
    const refused = await refusal.person(
      refusal.ip + "/answer",
      "POST",
      {
        version: 0,
        requestId: randomUUID(),
        answer: "I prefer not to answer.",
        participantPDFId: refusalPDF.pdf.id,
      },
      refusal.headers,
    );
    assert.equal(refused.status, 200);
    assert.equal(refused.interview.turns[0].pdfProbe, undefined);
    const off = await setup(false);
    assert.equal((await upload(off)).status, 400);
    const permitted = await upload(off, undefined, undefined, 0, {
      "x-pdf-ai-consent": "no",
    });
    assert.equal(permitted.status, 201);
    let s = (await off.owner(off.root)).study;
    const g = structuredClone(s.draft);
    g.questions[0].participantPDFAI = true;
    await off.owner(off.root, "PUT", { version: s.version, guide: g });
    assert.equal(
      (await off.person(off.ip, "GET", undefined, off.headers)).interview.guide
        .questions[0].participantPDFAI,
      false,
    );
  },
);
async function generated(c: any, history = false) {
  const pdf = await upload(c);
  await answer(c, pdf.pdf.id);
  await seed(c.r, (i) => {
    i.turns[0].pdfProbe = {
      pdfId: pdf.pdf.id,
      permissionVersion: pdfAIPermissionVersion,
      promptVersion: pdfProbePromptVersion,
      model: "synthetic-fixture",
      generatedAt: new Date().toISOString(),
      status: "asked",
      probe: "How does Synthetic research PDF page 2 help you?",
      page: 2,
      quote: "Synthetic research PDF page 2",
    };
    i.current = 0;
    i.strategy = "ai";
    i.status = "active";
    i.prompt = i.turns[0].pdfProbe.probe;
    i.promptPDFId = pdf.pdf.id;
    if (history) {
      i.turns.push({
        ...i.turns[0],
        id: randomUUID(),
        pdfProbe: undefined,
        participantPDF: undefined,
        promptSourcePDFId: pdf.pdf.id,
        prompt: i.prompt,
        answer: "I used it to retain my notes.",
        followUp: true,
      });
      i.promptPDFId = undefined;
      i.status = "complete";
      i.version = 2;
    }
  });
  return pdf;
}
test(
  "PDF question erasure replaces active prompts, rejects stale answers, rebinds later image/PDF drafts and clears derived data",
  { timeout: 90000 },
  async () => {
    const c = await setup(),
      pdf = await generated(c);
    await seed(c.r, (i) => {
      i.guide.questions[0].participantImages = true;
    });
    const image = await imageUpload(c.person, c.r, false, undefined, 1),
      later = await upload(c, undefined, "Later independent PDF", 1, {
        "x-pdf-ai-consent": "no",
      });
    assert.equal(later.status, 201);
    assert.equal(image.status, 201);
    await seed(c.r, (i) => {
      i.pending = { id: randomUUID(), at: Date.now() };
    });
    assert.equal(
      (await c.owner(c.root + "/participant-pdfs/" + pdf.pdf.id, "DELETE"))
        .status,
      409,
    );
    await seed(c.r, (i) => {
      delete i.pending;
    });
    assert.equal(
      (await c.owner(c.root + "/participant-pdfs/" + pdf.pdf.id, "DELETE"))
        .status,
      200,
    );
    const i = (await c.person(c.ip, "GET", undefined, c.headers)).interview;
    assert.equal(i.promptPDFId, undefined);
    assert.equal(i.turns[0].pdfProbe, undefined);
    assert.equal(i.strategy, "scripted");
    assert.equal(i.version, 2);
    assert.equal(i.participantPDFDraft.version, 2);
    assert.equal(i.participantImageDraft.version, 2);
    assert.equal((await answer(c, later.pdf.id, 1)).status, 409);
    const joined = await c.person(
      c.ip + "/answer",
      "POST",
      {
        version: 2,
        requestId: randomUUID(),
        answer: "Written work is preserved.",
        participantPDFId: later.pdf.id,
        participantImageId: image.image.id,
      },
      c.headers,
    );
    assert.equal(joined.status, 200);
    assert.equal(joined.interview.turns.at(-1).pdfProbe, undefined);
  },
);
test(
  "Erasing historical PDF questions preserves written answers and independent files but removes contextual reviews and derived reports",
  { timeout: 90000 },
  async () => {
    const c = await setup(),
      pdf = await generated(c, true);
    await seed(c.r, (i) => {
      i.current = 1;
    });
    const a = (await c.owner(c.root + "/analysis", "POST", { mode: "manual" }))
      .analysis;
    assert.ok(a);
    await c.owner(c.root + "/participant-pdfs/" + pdf.pdf.id, "DELETE");
    const i = (await c.person(c.ip, "GET", undefined, c.headers)).interview;
    assert.equal(i.turns[1].answer, "I used it to retain my notes.");
    assert.equal(i.turns[1].promptSourcePDFId, undefined);
    assert.equal(
      i.turns[1].prompt,
      "The PDF-based question was removed after its source PDF was deleted.",
    );
    assert.equal((await c.owner(c.root + "/analysis")).analysis, null);
    const db = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    assert.equal(
      Number(
        (
          await db.execute(
            "SELECT COUNT(*) AS n FROM usage WHERE operation='pdf-probe'",
          )
        ).rows[0].n,
      ),
      0,
    );
    db.close();
  },
);
