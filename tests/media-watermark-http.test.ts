import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { start, stop, base } from "./harness";
import { optionImageGuide } from "./option-images-fixture";
import { timedGuide } from "./timed-concepts-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3162 : 3161 }),
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

import { videoGuide, fixtureVideo } from "./concept-videos-fixture";
async function setup() {
  const owner = await requestor(),
    person = await requestor();
  await owner("auth/signup", "POST", {
    name: "Watermark admin",
    email: randomUUID() + "@example.test",
    password: "watermark-password",
  });
  const s = (await owner("studies", "POST", { title: "Watermark lifecycle" }))
    .study;
  return { owner, person, s, root: "studies/" + s.id, pub: "public/" + s.id };
}
const imageBytes = () =>
  sharp({
    create: { width: 640, height: 360, channels: 3, background: "#228844" },
  })
    .png()
    .toBuffer();
async function upload(owner: any, root: string, video = false) {
  const id = randomUUID();
  assert.equal(
    (
      await owner(
        root + (video ? "/concept-videos" : "/concept-images"),
        "POST",
        video ? await fixtureVideo() : await imageBytes(),
        {
          "content-type": video ? "video/mp4" : "image/png",
          "x-upload-id": id,
        },
      )
    ).status,
    201,
  );
  return id;
}
const mark = (
  owner: any,
  root: string,
  id: string,
  enabled = true,
  video = false,
) =>
  owner(
    root +
      (video ? "/concept-videos/" : "/concept-images/") +
      id +
      "/watermark",
    "POST",
    { enabled },
  );
const head = (r: any) => ({ "x-interview-token": r.token });
test(
  "Private marked copies are reused atomically, restored to originals, frozen in guides and constrained by participant/timing gates",
  { timeout: 90000 },
  async () => {
    const { owner, person, root, pub } = await setup(),
      original = await upload(owner, root),
      video = await upload(owner, root, true);
    const [one, two] = await Promise.all([
      mark(owner, root, original),
      mark(owner, root, original),
    ]);
    assert.equal(one.status, 200);
    assert.equal(one.asset.id, two.asset.id);
    const marked = one.asset.id;
    assert.notEqual(marked, original);
    assert.equal((await mark(owner, root, marked)).asset.id, marked);
    assert.equal((await mark(owner, root, marked, false)).asset.id, original);
    const markedVideo = (await mark(owner, root, video, true, true)).asset.id;
    assert.ok(markedVideo);
    assert.equal(
      (await owner(root + "/concept-videos/" + markedVideo + "/watermark"))
        .enabled,
      true,
    );
    const raw = (await owner(root + "/concept-images/" + original)).bytes,
      prepared = (await owner(root + "/concept-images/" + marked)).bytes;
    assert.notDeepEqual(raw, prepared);
    assert.deepEqual(
      (await owner(root + "/concept-images/" + original)).bytes,
      raw,
    );
    let s = (await owner(root)).study;
    const guide = videoGuide([markedVideo]);
    guide.conceptTest!.concepts[0].imageAssetId = marked;
    s = (await owner(root, "PUT", { version: s.version, guide })).study;
    s = (await owner(root + "/publish", "POST", { version: s.version })).study;
    await owner(root + "/fielding", "POST", { state: "active" });
    const r = await person(pub, "POST", { consent: true }),
      path = "interviews/" + r.interview.id;
    assert.equal(
      (
        await person(
          path + "/concept-images/" + marked,
          "GET",
          undefined,
          head(r),
        )
      ).status,
      404,
    );
    await person(
      path + "/answer",
      "POST",
      { requestId: randomUUID(), version: 0, answer: "", optionId: "go" },
      head(r),
    );
    assert.deepEqual(
      (
        await person(
          path + "/concept-images/" + marked,
          "GET",
          undefined,
          head(r),
        )
      ).bytes,
      prepared,
    );
    assert.equal(
      (
        await person(
          path + "/concept-images/" + original,
          "GET",
          undefined,
          head(r),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await person(
          path + "/concept-videos/" + video,
          "GET",
          undefined,
          head(r),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await person(
          path + "/concept-videos/" + markedVideo,
          "GET",
          undefined,
          { ...head(r), range: "bytes=0-31" },
        )
      ).status,
      206,
    );
    s = (await owner(root)).study;
    guide.conceptTest!.concepts[0].imageAssetId = original;
    guide.conceptTest!.concepts[0].videoAssetId = video;
    s = (await owner(root, "PUT", { version: s.version, guide })).study;
    await owner(root + "/publish", "POST", { version: s.version });
    assert.equal(
      (await person(path, "GET", undefined, head(r))).interview.guide
        .conceptTest.concepts[0].imageAssetId,
      marked,
    );
    assert.equal(
      (await owner(root + "/concept-images/" + marked, "DELETE")).status,
      409,
    );
    assert.equal(
      (await owner(root + "/concept-images/" + original, "DELETE")).status,
      409,
    );
    s = (await owner(root)).study;
    const timed = structuredClone(s.draft);
    timed.conceptTest.concepts[0].imageAssetId = marked;
    timed.conceptTest.concepts[0].videoAssetId = markedVideo;
    timed.conceptTest.concepts[0].exposureSeconds = 1;
    s = (await owner(root, "PUT", { version: s.version, guide: timed })).study;
    await owner(root + "/publish", "POST", { version: s.version });
    const t = await person(pub, "POST", { consent: true }),
      tp = "interviews/" + t.interview.id;
    await person(
      tp + "/answer",
      "POST",
      { requestId: randomUUID(), version: 0, answer: "", optionId: "go" },
      head(t),
    );
    assert.equal(
      (
        await person(
          tp + "/concept-images/" + marked,
          "GET",
          undefined,
          head(t),
        )
      ).status,
      404,
    );
    await person(
      tp + "/concept-presentation",
      "POST",
      { version: 1, conceptId: "alpha", action: "start" },
      head(t),
    );
    assert.equal(
      (
        await person(
          tp + "/concept-images/" + marked,
          "GET",
          undefined,
          head(t),
        )
      ).status,
      200,
    );
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(
      (
        await person(
          tp + "/concept-videos/" + markedVideo,
          "GET",
          undefined,
          head(t),
        )
      ).status,
      404,
    );
    await person(
      tp + "/concept-presentation",
      "POST",
      { version: 1, conceptId: "alpha", action: "untimed" },
      head(t),
    );
    assert.equal(
      (
        await person(
          tp + "/concept-videos/" + markedVideo,
          "GET",
          undefined,
          head(t),
        )
      ).status,
      200,
    );
    await owner(root + "/responses/" + r.interview.id, "DELETE");
    assert.equal(
      (
        await person(
          path + "/concept-images/" + marked,
          "GET",
          undefined,
          head(r),
        )
      ).status,
      404,
    );
  },
);
test(
  "Marking obeys workspace/edit authority, malformed-body denial, private copy deletion order and fresh IDs after a marked copy is deleted",
  { timeout: 90000 },
  async () => {
    const { owner, person, root } = await setup(),
      original = await upload(owner, root),
      marked = (await mark(owner, root, original)).asset.id;
    assert.equal((await mark(person, root, original)).status, 401);
    assert.equal(
      (
        await owner(
          root + "/concept-images/" + original + "/watermark",
          "POST",
          { enabled: "yes" },
        )
      ).status,
      400,
    );
    const other = await setup();
    assert.equal((await mark(other.owner, other.root, original)).status, 404);
    assert.equal(
      (await owner(root + "/concept-images/" + original, "DELETE")).status,
      409,
    );
    assert.equal(
      (await owner(root + "/concept-images/" + marked, "DELETE")).status,
      200,
    );
    assert.equal((await owner(root + "/concept-images/" + marked)).status, 404);
    const regenerated = (await mark(owner, root, original)).asset.id;
    assert.notEqual(regenerated, marked);
    assert.equal(
      (await owner(root + "/concept-images/" + regenerated, "DELETE")).status,
      200,
    );
    assert.equal(
      (await owner(root + "/concept-images/" + original, "DELETE")).status,
      200,
    );
    assert.equal((await mark(owner, root, original)).status, 404);
  },
);
