import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient } from "@libsql/client";
import sharp from "sharp";
import { start, stop, base, dataDirectory } from "./harness";
import { participantImageGuide } from "./participant-images-fixture";
import {
  imageAIPermissionVersion,
  imageProbePromptVersion,
} from "../src/lib/participant-image-ai";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3170 : 3169 }),
  { timeout: 90000 },
);
after(stop);
async function client() {
  let cookie = "";
  return async (
    p: string,
    method = "GET",
    data?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const r = await fetch(base + "/api/" + p, {
      method,
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body:
        data === undefined
          ? undefined
          : Buffer.isBuffer(data)
            ? new Uint8Array(data)
            : JSON.stringify(data),
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie")!.split(";")[0];
    const bytes = Buffer.from(await r.arrayBuffer());
    return {
      status: r.status,
      bytes,
      ...(r.headers.get("content-type")?.includes("application/json")
        ? JSON.parse(bytes.toString())
        : {}),
    };
  };
}
async function setup(enabled = true) {
  const owner = await client(),
    person = await client();
  await owner("auth/signup", "POST", {
    name: "Image AI admin",
    email: randomUUID() + "@example.test",
    password: "image-ai-test-password",
  });
  let s = (await owner("studies", "POST", { title: "Image AI workflow" }))
    .study;
  const root = "studies/" + s.id,
    pub = "public/" + s.id,
    guide = participantImageGuide();
  guide.questions[0].participantImageAI = enabled;
  guide.questions[0].followUps = 2;
  s = (await owner(root, "PUT", { version: s.version, guide })).study;
  assert.ok(s);
  s = (await owner(root + "/publish", "POST", { version: s.version })).study;
  await owner(root + "/fielding", "POST", { state: "active" });
  const r = await person(pub, "POST", { consent: true });
  return { owner, person, root, pub, r, s };
}
const head = (r: any) => ({ "x-interview-token": r.token });
const png = () =>
  sharp({
    create: { width: 64, height: 32, channels: 3, background: "#2277bb" },
  })
    .png()
    .toBuffer();
const upload = async (
  c: any,
  r: any,
  allowed = true,
  id = randomUUID(),
  version = 0,
) =>
  c(
    "interviews/" + r.interview.id + "/participant-images",
    "POST",
    await png(),
    {
      ...head(r),
      "content-type": "image/png",
      "x-upload-id": id,
      "x-interview-version": String(version),
      "x-image-description": "The blue Save draft button",
      "x-image-consent": "yes",
      "x-image-ai-consent": allowed ? "yes" : "no",
    },
  );
const answer = (
  c: any,
  r: any,
  id?: string,
  version = 0,
  requestId = randomUUID(),
) =>
  c(
    "interviews/" + r.interview.id + "/answer",
    "POST",
    {
      version,
      requestId,
      participantImageId: id,
      answer: "The workflow made it easier to save the example research notes.",
    },
    head(r),
  );
async function seed(r: any, mutate: (i: any) => void) {
  const db = createClient({
    url: "file:" + path.join(dataDirectory(), "research.sqlite"),
  });
  try {
    const row = (
      await db.execute({
        sql: "SELECT data FROM documents WHERE kind='interview' AND id=?",
        args: [r.interview.id],
      })
    ).rows[0];
    const i = JSON.parse(String(row.data));
    mutate(i);
    await db.execute({
      sql: "UPDATE documents SET data=? WHERE kind='interview' AND id=?",
      args: [JSON.stringify(i), i.id],
    });
    return i;
  } finally {
    db.close();
  }
}
async function generatedState(ctx: any, history = false) {
  const saved = await upload(ctx.person, ctx.r);
  assert.equal(saved.status, 201);
  await answer(ctx.person, ctx.r, saved.image.id);
  const i = await seed(ctx.r, (i) => {
    i.turns[0].imageProbe = {
      imageId: saved.image.id,
      permissionVersion: imageAIPermissionVersion,
      promptVersion: imageProbePromptVersion,
      model: "synthetic-fixture",
      generatedAt: new Date().toISOString(),
      status: "asked",
      probe: "What does the blue Save draft button help you do?",
      visualAnchor: "blue Save draft button",
    };
    i.current = 0;
    i.strategy = "ai";
    i.prompt = i.turns[0].imageProbe.probe;
    i.promptImageId = saved.image.id;
    if (history) {
      i.turns.push({
        ...i.turns[0],
        id: randomUUID(),
        participantImage: undefined,
        imageProbe: undefined,
        promptSourceImageId: saved.image.id,
        prompt: i.prompt,
        answer: "I used it to keep my work.",
        followUp: true,
      });
      i.promptImageId = undefined;
      i.status = "complete";
      i.version = 2;
    }
  });
  return { saved, i };
}
test(
  "Image AI permission is separate, immutable per upload and unavailable on disabled questions; unavailable providers save answers without image probes",
  { timeout: 90000 },
  async () => {
    const ctx = await setup();
    const id = randomUUID(),
      saved = await upload(ctx.person, ctx.r, true, id);
    assert.equal(saved.status, 201);
    assert.equal(saved.image.aiPermission.version, imageAIPermissionVersion);
    assert.equal(saved.image.aiPermission.provider, "OpenAI");
    assert.ok(saved.image.aiPermission.grantedAt);
    assert.equal((await upload(ctx.person, ctx.r, false, id)).status, 409);
    const requestId = randomUUID(),
      joined = await answer(ctx.person, ctx.r, saved.image.id, 0, requestId);
    assert.equal(joined.status, 200);
    assert.equal(joined.interview.turns[0].imageProbe.status, "unavailable");
    assert.equal(joined.interview.current, 1);
    assert.equal(
      (await answer(ctx.person, ctx.r, saved.image.id, 0, requestId)).interview
        .turns.length,
      1,
    );
    const next = await ctx.person(ctx.pub, "POST", { consent: true });
    const noAI = await upload(ctx.person, next, false);
    assert.equal(noAI.image.aiPermission, undefined);
    const ordinary = await answer(ctx.person, next, noAI.image.id);
    assert.equal(ordinary.status, 200);
    assert.equal(ordinary.interview.turns[0].imageProbe, undefined);
    const disabled = await setup(false);
    assert.equal((await upload(disabled.person, disabled.r)).status, 400);
    let s = (await ctx.owner(ctx.root)).study;
    const invalid = structuredClone(s.draft);
    invalid.questions[0].followUps = 0;
    assert.equal(
      (await ctx.owner(ctx.root, "PUT", { version: s.version, guide: invalid }))
        .status,
      400,
    );
    const sql = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    try {
      assert.equal(
        Number(
          (
            await sql.execute(
              "SELECT COUNT(*) AS n FROM usage WHERE operation='image-probe'",
            )
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
  "Deleting an active image probe clears derived data/reports, replaces the pending question, preserves a later upload and rejects stale answers",
  { timeout: 90000 },
  async () => {
    const ctx = await setup(),
      { saved, i } = await generatedState(ctx);
    const later = await upload(ctx.person, ctx.r, true, randomUUID(), 1);
    assert.equal(later.status, 201);
    const sql = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    try {
      for (const kind of [
        "analysis",
        "reportEdition",
        "reportSnapshot",
        "mediaReel",
        "responseTranslation",
      ])
        await sql.execute({
          sql: "INSERT INTO documents(kind,id,workspace_id,study_id,data) VALUES(?,?,?,?,?)",
          args: [
            kind,
            randomUUID(),
            i.workspaceId,
            i.studyId,
            JSON.stringify({
              interviewId: i.id,
              secretDerived: "blue Save draft button",
            }),
          ],
        });
    } finally {
      sql.close();
    }
    assert.equal(
      (
        await ctx.owner(
          ctx.root + "/participant-images/" + saved.image.id,
          "DELETE",
        )
      ).status,
      200,
    );
    const current = (
      await ctx.person("interviews/" + i.id, "GET", undefined, head(ctx.r))
    ).interview;
    assert.equal(current.promptImageId, undefined);
    assert.equal(current.version, 2);
    assert.equal(current.strategy, "scripted");
    assert.equal(current.turns[0].imageProbe, undefined);
    assert.equal(current.turns[0].participantImage, undefined);
    assert.equal(current.participantImageDraft.image.id, later.image.id);
    assert.equal(current.participantImageDraft.version, 2);
    assert.equal(current.prompt.includes("blue Save draft"), false);
    assert.equal(
      (await answer(ctx.person, ctx.r, later.image.id, 1)).status,
      409,
    );
    assert.equal(
      (await answer(ctx.person, ctx.r, later.image.id, 2)).status,
      200,
    );
    const db = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    try {
      assert.equal(
        Number(
          (
            await db.execute({
              sql: "SELECT COUNT(*) AS n FROM documents WHERE workspace_id=? AND kind IN ('analysis','reportEdition','reportSnapshot','mediaReel','responseTranslation')",
              args: [i.workspaceId],
            })
          ).rows[0].n,
        ),
        0,
      );
    } finally {
      db.close();
    }
  },
);
test(
  "Historical image-derived prompts are redacted without deleting written answers; pending processing blocks individual erasure while whole-source deletion revokes access",
  { timeout: 90000 },
  async () => {
    const ctx = await setup(),
      { saved, i } = await generatedState(ctx, true);
    await ctx.owner(
      ctx.root + "/participant-images/" + saved.image.id,
      "DELETE",
    );
    const current = (await ctx.owner(ctx.root)).interviews.find(
      (x: any) => x.id === i.id,
    );
    assert.equal(current.turns[1].promptSourceImageId, undefined);
    assert.equal(current.turns[1].prompt.includes("blue Save draft"), false);
    assert.equal(current.turns[1].answer, "I used it to keep my work.");
    assert.equal(current.turns[0].imageProbe, undefined);
    const other = await setup(),
      up = await upload(other.person, other.r);
    await seed(other.r, (i) => {
      i.pending = { id: randomUUID(), at: Date.now() };
    });
    assert.equal(
      (
        await other.owner(
          other.root + "/participant-images/" + up.image.id,
          "DELETE",
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await other.owner(
          other.root + "/responses/" + other.r.interview.id,
          "DELETE",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await other.person(
          "interviews/" + other.r.interview.id,
          "GET",
          undefined,
          head(other.r),
        )
      ).status,
      404,
    );
    assert.equal((await other.owner("recordings/" + up.image.id)).status, 404);
  },
);
