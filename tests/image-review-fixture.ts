import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient } from "@libsql/client";
import sharp from "sharp";
import { base, dataDirectory } from "./harness";
import { participantImageGuide } from "./participant-images-fixture";
import {
  imageAIPermissionVersion,
  imageProbePromptVersion,
} from "../src/lib/participant-image-ai";
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
export { setup, upload, answer, seed, generatedState, head, client };
