import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dataDirectory as reviewDataDirectory } from "./harness";
import pathForReview from "node:path";
import { docxMime } from "../src/lib/participant-docx";
import {
  docxAIPermissionVersion,
  docxProbePromptVersion,
} from "../src/lib/participant-docx-ai";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, dataDirectory } from "./harness";
import { client, seed } from "./image-review-fixture";
import { sampleDOCX, participantDOCXGuide } from "./participant-docx-fixture";
import { createClient } from "@libsql/client";
import path from "node:path";
before(
  () =>
    start({
      port: process.env.RESEARCH_TEST_PORT
        ? Number(process.env.RESEARCH_TEST_PORT)
        : process.env.RESEARCH_TEST_PRODUCTION === "1"
          ? 3248
          : 3247,
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
async function generated(c: any, history = false) {
  const docx = await upload(c);
  await answer(c, docx.docx.id);
  const snapshotSha256 = createHash("sha256")
    .update(
      await readFile(
        pathForReview.join(reviewDataDirectory(), "media", docx.docx.id),
      ),
    )
    .digest("hex");
  await seed(c.r, (i) => {
    i.turns[0].docxProbe = {
      docxId: docx.docx.id,
      snapshotSha256,
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
const fields = {
  quality: "usable",
  grounding: "supported",
  notes: "Private quality annotation",
  correction: "Private researcher correction",
};
const route = (c: any, id: string) =>
  c.root + "/participant-docx/" + id + "/review";
const payload = (r: any, extra: any = {}) => ({
  source: r.source,
  probeSource: r.probeSource,
  version: r.version,
  ...fields,
  ...extra,
});
test(
  "DOCX grounding revisions bind to exact questions, preserve original citations and legacy quality reviews, reject stale edits and stay private",
  { timeout: 90000 },
  async () => {
    const c = await setup(),
      file = await generated(c, true),
      url = route(c, file.docx.id),
      initial = await c.owner(url);
    assert.equal(initial.asked, true);
    assert.equal(initial.probe.paragraph, 2);
    const legacy = await c.owner(url, "PUT", {
      source: initial.source,
      version: 0,
      quality: "unclear",
      notes: "Legacy quality-only annotation",
    });
    assert.equal(legacy.status, 200);
    assert.equal(legacy.history[0].grounding, undefined);
    const one = await c.owner(url, "PUT", payload(legacy));
    assert.equal(one.status, 200);
    assert.equal(one.history[1].reviewer.name, "DOCX reviewer");
    assert.deepEqual(one.history[1].originalProbe, initial.probe);
    assert.equal(one.history[1].grounding, "supported");
    const concurrent = await Promise.all([
      c.owner(
        url,
        "PUT",
        payload(one, {
          grounding: "unsupported",
          correction: "First correction",
        }),
      ),
      c.owner(
        url,
        "PUT",
        payload(one, {
          grounding: "uncertain",
          correction: "Second correction",
        }),
      ),
    ]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
    const latest = await c.owner(url);
    assert.equal(latest.version, 3);
    assert.deepEqual(latest.history.slice(0, 2), one.history);
    for (const changes of [
      { grounding: "not_applicable" },
      { correction: "x".repeat(1001) },
      { grounding: "automatic" },
      { originalProbe: initial.probe },
    ])
      assert.equal(
        (await c.owner(url, "PUT", payload(latest, changes))).status,
        400,
      );
    assert.equal(
      (await c.owner(url, "PUT", payload(latest, { probeSource: undefined })))
        .status,
      409,
    );
    const anon = await client();
    assert.equal((await anon(url)).status, 401);
    assert.equal(
      (await c.person(url, "GET", undefined, c.headers)).status,
      401,
    );
    const other = await setup();
    assert.equal((await other.owner(url)).status, 404);
    const participant = await c.person(c.ip, "GET", undefined, c.headers);
    assert.equal(participant.status, 200);
    assert.ok(!JSON.stringify(participant).includes(fields.notes));
    assert.ok(!JSON.stringify(participant).includes(fields.correction));
    const detail = await c.owner(c.root);
    assert.ok(!JSON.stringify(detail).includes(fields.correction));
    assert.deepEqual(
      detail.interviews.find((i: any) => i.id === c.r.interview.id).turns[0]
        .docxProbe,
      initial.probe,
    );
    await seed(c.r, (i) => {
      i.turns[0].docxProbe.probe = "Changed synthetic question?";
    });
    assert.equal((await c.owner(url, "PUT", payload(latest))).status, 409);
    const changed = await c.owner(url);
    assert.equal(changed.source, initial.source);
    assert.notEqual(changed.probeSource, initial.probeSource);
    assert.deepEqual(changed.history[1].originalProbe, initial.probe);
    await c.owner(c.root + "/participant-docx/" + file.docx.id, "DELETE");
    assert.equal((await c.owner(url)).status, 404);
    const sql = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    try {
      assert.equal(
        (
          await sql.execute({
            sql: "SELECT id FROM documents WHERE kind='participantDOCXReview' AND id=?",
            args: [file.docx.id],
          })
        ).rows.length,
        0,
      );
    } finally {
      sql.close();
    }
  },
);
test(
  "Unasked DOCXs cannot receive grounding or corrections; draft gating and response erasure cover review history",
  { timeout: 90000 },
  async () => {
    const c = await setup(),
      file = await upload(c),
      url = route(c, file.docx.id);
    assert.equal((await c.owner(url)).status, 409);
    await answer(c, file.docx.id);
    const initial = await c.owner(url);
    assert.equal(initial.asked, false);
    assert.equal((await c.owner(url, "PUT", payload(initial))).status, 400);
    assert.equal(
      (
        await c.owner(
          url,
          "PUT",
          payload(initial, { grounding: "not_applicable" }),
        )
      ).status,
      400,
    );
    const saved = await c.owner(
      url,
      "PUT",
      payload(initial, { grounding: "not_applicable", correction: "" }),
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.history[0].originalProbe, undefined);
    assert.equal(
      (await c.owner(c.root + "/responses/" + c.r.interview.id, "DELETE"))
        .status,
      200,
    );
    assert.equal((await c.owner(url)).status, 404);
    const sql = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    try {
      assert.equal(
        (
          await sql.execute({
            sql: "SELECT id FROM documents WHERE kind='participantDOCXReview' AND id=?",
            args: [file.docx.id],
          })
        ).rows.length,
        0,
      );
    } finally {
      sql.close();
    }
  },
);
