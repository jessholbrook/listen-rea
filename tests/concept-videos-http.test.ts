import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { fixtureVideo } from "./concept-videos-fixture";
import { mp4Duration } from "../src/lib/render";
import { start, stop, base } from "./harness";
import { videoGuide } from "./concept-videos-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3154 : 3153 }),
  { timeout: 90000 },
);
after(stop);
async function requestor() {
  let cookie = "";
  return async (
    path: string,
    method = "GET",
    data?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const r = await fetch(base + "/api/" + path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        "content-type": "application/json",
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
      headers: r.headers,
      bytes,
      ...(r.headers.get("content-type")?.includes("application/json")
        ? JSON.parse(bytes.toString())
        : {}),
    };
  };
}
async function setup() {
  const owner = await requestor(),
    anon = await requestor();
  await owner("auth/signup", "POST", {
    name: "Image admin",
    email: randomUUID() + "@example.test",
    password: "concept-image-password",
  });
  const s = (await owner("studies", "POST", { title: "Private concepts" }))
    .study;
  return { owner, anon, s, root: "studies/" + s.id, pub: "public/" + s.id };
}
const raster = async (color = "#bb4488", format = "mp4") =>
  fixtureVideo(format as "mp4" | "webm", 1, color);
const upload = (
  c: any,
  root: string,
  bytes: Buffer,
  id = randomUUID(),
  mime = "video/mp4",
) =>
  c(root + "/concept-videos", "POST", bytes, {
    "content-type": mime,
    "x-upload-id": id,
  });
const token = (r: any) => ({ "x-interview-token": r.token });
async function publish(owner: any, root: string, ids: string[]) {
  let s = (await owner(root)).study;
  s = (await owner(root, "PUT", { version: s.version, guide: videoGuide(ids) }))
    .study;
  assert.ok(s);
  s = (await owner(root + "/publish", "POST", { version: s.version })).study;
  await owner(root + "/fielding", "POST", { state: "active" });
  return s;
}
const answer = (
  c: any,
  r: any,
  version: number,
  value?: number,
  optionId?: string,
) =>
  c(
    "interviews/" + r.interview.id + "/answer",
    "POST",
    { requestId: randomUUID(), version, answer: "", value, optionId },
    token(r),
  );
test(
  "Private concept uploads normalize videos, reuse exact upload retries and restrict participant bytes to the current concept, including range/reload/deletion",
  { timeout: 90000 },
  async () => {
    const { owner, anon, s, root, pub } = await setup(),
      bytes = await raster(),
      id = randomUUID();
    const race = await Promise.all([
      upload(owner, root, bytes, id),
      upload(owner, root, bytes, id),
    ]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 201]);
    const first = race[0].video;
    assert.ok(first.width <= 1600 && first.height <= 1600);
    assert.equal(
      (await upload(owner, root, await raster("#000000"), id)).status,
      409,
    );
    const second = (await upload(owner, root, await raster("#334488"))).video;
    const info = await owner(root + "/concept-videos");
    assert.equal(info.videos.length, 2);
    assert.equal("digest" in info.videos[0], false);
    assert.equal("workspaceId" in info.videos[0], false);
    const cookieImage = await owner(root + "/concept-videos/" + id);
    assert.equal(cookieImage.status, 200);
    assert.ok(mp4Duration(cookieImage.bytes) > 900);
    assert.equal(cookieImage.headers.get("cache-control"), "private, no-store");
    assert.equal((await anon(root + "/concept-videos/" + id)).status, 401);
    await publish(owner, root, [id, second.id]);
    assert.equal("conceptTest" in (await anon(pub)), false);
    const r = await anon(pub, "POST", { consent: true });
    assert.equal(r.interview.guide.conceptTest.concepts.length, 0);
    const path = "interviews/" + r.interview.id + "/concept-videos/";
    assert.equal(
      (await anon(path + id, "GET", undefined, token(r))).status,
      404,
    );
    assert.equal((await anon(path + id)).status, 404);
    const next = await answer(anon, r, 0, undefined, "go");
    assert.equal(next.interview.guide.conceptTest.concepts[0].videoAssetId, id);
    const shown = await anon(path + id, "GET", undefined, token(r));
    assert.equal(shown.status, 200);
    assert.deepEqual(shown.bytes, cookieImage.bytes);
    assert.equal(
      (await anon(path + second.id, "GET", undefined, token(r))).status,
      404,
    );
    const range = await anon(path + id, "GET", undefined, {
      ...token(r),
      range: "bytes=0-7",
    });
    assert.equal(range.status, 206);
    assert.deepEqual(range.bytes, shown.bytes.subarray(0, 8));
    await answer(anon, r, 1, 4);
    assert.equal(
      (await anon(path + id, "GET", undefined, token(r))).status,
      404,
    );
    assert.equal(
      (await anon(path + second.id, "GET", undefined, token(r))).status,
      200,
    );
    const resumed = await anon(
      "interviews/" + r.interview.id,
      "GET",
      undefined,
      token(r),
    );
    assert.equal(
      resumed.interview.guide.conceptTest.concepts[0].videoAssetId,
      second.id,
    );
    assert.equal(
      (await owner(root + "/responses/" + r.interview.id, "DELETE")).status,
      200,
    );
    assert.equal(
      (await anon(path + second.id, "GET", undefined, token(r))).status,
      404,
    );
    assert.equal(
      (await owner(root + "/concept-videos/" + id, "DELETE")).status,
      409,
    );
  },
);
test(
  "Immutable video references survive replacement, history restore and copied guides; only unreferenced uploads can be deleted and deleted IDs cannot be reused",
  { timeout: 90000 },
  async () => {
    const { owner, anon, root, pub } = await setup(),
      a = (await upload(owner, root, await raster())).video,
      b = (await upload(owner, root, await raster("#112233"))).video;
    const old = await publish(owner, root, [a.id, b.id]),
      r = await anon(pub, "POST", { consent: true });
    await answer(anon, r, 0, undefined, "go");
    const replacement = (await upload(owner, root, await raster("#55aa33")))
      .video;
    await publish(owner, root, [replacement.id, b.id]);
    assert.equal(
      (await anon("interviews/" + r.interview.id, "GET", undefined, token(r)))
        .interview.guide.conceptTest.concepts[0].videoAssetId,
      a.id,
    );
    assert.equal(
      (
        await anon(
          "interviews/" + r.interview.id + "/concept-videos/" + a.id,
          "GET",
          undefined,
          token(r),
        )
      ).status,
      200,
    );
    assert.equal(
      (await owner(root + "/concept-videos/" + a.id, "DELETE")).status,
      409,
    );
    let s = (await owner(root)).study;
    const restored = await owner(root + "/restore", "POST", {
      version: s.version,
      id: old.revisionId,
      source: "revision",
    });
    assert.equal(restored.status, 200);
    assert.equal(
      restored.study.draft.conceptTest.concepts[0].videoAssetId,
      a.id,
    );
    // Workspace-authorized copied guides (including Pulse baselines) retain the same immutable asset references.
    const copy = (
      await owner("studies", "POST", { title: "Copied private concepts" })
    ).study;
    const saved = await owner("studies/" + copy.id, "PUT", {
      version: copy.version,
      guide: videoGuide([a.id, b.id]),
    });
    assert.equal(saved.status, 200);
    const png = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#abcdef" },
    })
      .png()
      .toBuffer();
    const imageId = randomUUID();
    const imageUpload = (id: string) =>
      owner(root + "/concept-images", "POST", png, {
        "content-type": "image/png",
        "x-upload-id": id,
      });
    assert.equal((await imageUpload(a.id)).status, 409);
    assert.equal((await imageUpload(imageId)).status, 201);
    assert.equal(
      (await upload(owner, root, await raster(), imageId)).status,
      409,
    );
    assert.equal(
      (await owner(root + "/concept-images/" + imageId, "DELETE")).status,
      200,
    );
    assert.equal(
      (await upload(owner, root, await raster(), imageId)).status,
      409,
    );
    const unusedId = randomUUID(),
      bytes = await raster("#112244");
    await upload(owner, root, bytes, unusedId);
    assert.equal(
      (await owner(root + "/concept-videos/" + unusedId, "DELETE")).status,
      200,
    );
    assert.equal(
      (await owner(root + "/concept-videos/" + unusedId)).status,
      404,
    );
    assert.equal((await upload(owner, root, bytes, unusedId)).status, 409);
    assert.equal((await imageUpload(unusedId)).status, 409);
    const races = (await upload(owner, root, await raster("#224488"))).video;
    s = (await owner(root)).study;
    const results = await Promise.all([
      owner(root, "PUT", {
        version: s.version,
        guide: videoGuide([races.id, b.id]),
      }),
      owner(root + "/concept-videos/" + races.id, "DELETE"),
    ]);
    assert.ok(
      (results[0].status === 200 && results[1].status === 409) ||
        (results[0].status === 400 && results[1].status === 200),
    );
  },
);
test(
  "Upload validation and guide attachment reject active/mismatched/malformed/oversized files and foreign assets without creating usable records",
  { timeout: 90000 },
  async () => {
    const { owner, anon, root } = await setup(),
      foreign = await setup(),
      bytes = await raster(),
      foreignId = (await upload(foreign.owner, foreign.root, bytes)).video.id;
    assert.equal((await upload(anon, root, bytes)).status, 401);
    assert.equal(
      (
        await upload(
          owner,
          root,
          Buffer.from("<svg/>"),
          randomUUID(),
          "video/svg+xml",
        )
      ).status,
      400,
    );
    assert.equal(
      (await upload(owner, root, Buffer.from("<svg/>"))).status,
      400,
    );
    assert.equal(
      (await upload(owner, root, bytes, randomUUID(), "video/webm")).status,
      400,
    );
    assert.equal(
      (await upload(owner, root, Buffer.alloc(3 * 1024 * 1024 + 1))).status,
      413,
    );
    for (const imageId of [randomUUID(), foreignId]) {
      const s = (await owner(root)).study;
      assert.equal(
        (
          await owner(root, "PUT", {
            version: s.version,
            guide: videoGuide([imageId]),
          })
        ).status,
        400,
      );
    }
    assert.equal(
      (await owner(root + "/concept-videos/" + foreignId)).status,
      404,
    );
    assert.equal(
      (await owner(root + "/concept-videos/" + foreignId, "DELETE")).status,
      404,
    );
    for (const format of ["mp4", "webm"])
      assert.equal(
        (
          await upload(
            owner,
            root,
            await raster("#223344", format),
            randomUUID(),
            "video/" + format,
          )
        ).status,
        201,
      );
  },
);
