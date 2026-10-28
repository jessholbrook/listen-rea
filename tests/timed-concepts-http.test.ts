import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { start, stop, base } from "./harness";
import { timedGuide } from "./timed-concepts-fixture";
import { fixtureVideo } from "./concept-videos-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3156 : 3155 }),
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
async function setup(seconds = 1, media = false) {
  const owner = await requestor(),
    person = await requestor();
  await owner("auth/signup", "POST", {
    name: "Timing admin",
    email: randomUUID() + "@example.test",
    password: "timed-concept-password",
  });
  let s = (await owner("studies", "POST", { title: "Timed concept lifecycle" }))
    .study;
  const root = "studies/" + s.id,
    pub = "public/" + s.id,
    g = timedGuide(seconds);
  let imageId = "",
    videoId = "";
  if (media) {
    imageId = randomUUID();
    videoId = randomUUID();
    await owner(
      root + "/concept-images",
      "POST",
      await sharp({
        create: { width: 32, height: 32, channels: 3, background: "#aa5566" },
      })
        .png()
        .toBuffer(),
      { "content-type": "image/png", "x-upload-id": imageId },
    );
    await owner(root + "/concept-videos", "POST", await fixtureVideo(), {
      "content-type": "video/mp4",
      "x-upload-id": videoId,
    });
    Object.assign(g.conceptTest!.concepts[0], {
      imageAssetId: imageId,
      videoAssetId: videoId,
      videoTranscript: "A red screen and a tone.",
    });
  }
  s = (await owner(root, "PUT", { version: s.version, guide: g })).study;
  assert.ok(s);
  s = (await owner(root + "/publish", "POST", { version: s.version })).study;
  await owner(root + "/fielding", "POST", { state: "active" });
  const r = await person(pub, "POST", { consent: true });
  await person(
    "interviews/" + r.interview.id + "/answer",
    "POST",
    { version: 0, requestId: randomUUID(), answer: "", optionId: "go" },
    { "x-interview-token": r.token },
  );
  return { owner, person, root, pub, r, imageId, videoId, s };
}
const head = (r: any) => ({ "x-interview-token": r.token }),
  exposure = (
    c: any,
    r: any,
    action = "start",
    conceptId = "alpha",
    version = 1,
  ) =>
    c(
      "interviews/" + r.interview.id + "/concept-presentation",
      "POST",
      { version, conceptId, action },
      head(r),
    );
const answer = (c: any, r: any, version: number, requestId = randomUUID()) =>
  c(
    "interviews/" + r.interview.id + "/answer",
    "POST",
    { version, requestId, answer: "", value: 4 },
    head(r),
  );
test(
  "One atomic timed window survives reload/repeated questions, rejects early answers and hides image/video bytes before and after expiry",
  { timeout: 90000 },
  async () => {
    const { owner, person, root, r, imageId, videoId } = await setup(1, true),
      path = "interviews/" + r.interview.id;
    const waiting = await person(path, "GET", undefined, head(r));
    assert.equal(waiting.interview.conceptPresentation.state, "waiting");
    assert.equal(
      waiting.interview.guide.conceptTest.concepts[0].description,
      "",
    );
    assert.equal(
      (
        await person(
          path + "/concept-images/" + imageId,
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
          path + "/concept-videos/" + videoId,
          "GET",
          undefined,
          head(r),
        )
      ).status,
      404,
    );
    const requestId = randomUUID();
    assert.equal((await answer(person, r, 1, requestId)).status, 409);
    const race = await Promise.all([exposure(person, r), exposure(person, r)]);
    assert.deepEqual(
      race.map((x) => x.status),
      [200, 200],
    );
    const p = race[0].interview.conceptPresentation;
    assert.equal(p.endsAt, race[1].interview.conceptPresentation.endsAt);
    assert.equal(race[0].interview.version, 1);
    assert.equal(race[0].interview.turns.length, 1);
    assert.equal(
      (
        await person(
          path + "/concept-images/" + imageId,
          "GET",
          undefined,
          head(r),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await person(
          path + "/concept-videos/" + videoId,
          "GET",
          undefined,
          head(r),
        )
      ).status,
      200,
    );
    assert.equal((await answer(person, r, 1, requestId)).status, 409);
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, p.endsAt - Date.now() + 30)),
    );
    const expired = await person(
      path + "/concept-presentation",
      "GET",
      undefined,
      head(r),
    );
    assert.equal(expired.interview.conceptPresentation.state, "expired");
    assert.equal(
      expired.interview.guide.conceptTest.concepts[0].description,
      "",
    );
    assert.equal(
      (
        await person(
          path + "/concept-images/" + imageId,
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
          path + "/concept-videos/" + videoId,
          "GET",
          undefined,
          head(r),
        )
      ).status,
      404,
    );
    const next = await answer(person, r, 1, requestId);
    assert.equal(next.status, 200);
    assert.equal(next.interview.conceptPresentation.endsAt, p.endsAt);
    assert.equal(next.interview.conceptPresentation.state, "expired");
    assert.equal(
      (await exposure(person, r)).interview.conceptPresentation.endsAt,
      p.endsAt,
    );
    const beta = await answer(person, r, 2);
    assert.equal(beta.interview.conceptPresentation.conceptId, "beta");
    assert.equal(beta.interview.conceptPresentation.state, "waiting");
    assert.equal((await exposure(person, r, "start", "alpha", 3)).status, 409);
    const saved = (await owner(root)).interviews.find(
      (i: any) => i.id === r.interview.id,
    );
    assert.ok(saved.conceptExposures.alpha.startedAt);
    assert.equal(saved.conceptExposures.beta, undefined);
  },
);
test(
  "Untimed accessibility override is persistent/idempotent and visible to researchers; publication, stale/future requests and source deletion preserve boundaries",
  { timeout: 90000 },
  async () => {
    const { owner, person, root, r } = await setup(30);
    assert.equal((await exposure(person, r, "start", "beta")).status, 409);
    assert.equal((await exposure(person, r, "start", "alpha", 0)).status, 409);
    const started = await exposure(person, r),
      untimed = await exposure(person, r, "untimed");
    assert.equal(untimed.interview.conceptPresentation.state, "untimed");
    assert.equal(
      untimed.interview.conceptPresentation.endsAt,
      started.interview.conceptPresentation.endsAt,
    );
    assert.match(
      untimed.interview.guide.conceptTest.concepts[0].description,
      /fast summaries/,
    );
    assert.equal(
      (await exposure(person, r)).interview.conceptPresentation.state,
      "untimed",
    );
    assert.equal(
      (await exposure(person, r, "untimed")).interview.conceptPresentation
        .revision,
      untimed.interview.conceptPresentation.revision,
    );
    assert.equal((await answer(person, r, 1)).status, 200);
    const resumed = await person(
      "interviews/" + r.interview.id,
      "GET",
      undefined,
      head(r),
    );
    assert.equal(resumed.interview.conceptPresentation.state, "untimed");
    let s = (await owner(root)).study;
    s.draft.conceptTest.concepts[0].exposureSeconds = 5;
    s = (await owner(root, "PUT", { version: s.version, guide: s.draft }))
      .study;
    await owner(root + "/publish", "POST", { version: s.version });
    assert.equal(
      (await person("interviews/" + r.interview.id, "GET", undefined, head(r)))
        .interview.conceptPresentation.seconds,
      30,
    );
    const source = (await owner(root)).interviews.find(
      (i: any) => i.id === r.interview.id,
    );
    assert.ok(source.conceptExposures.alpha.untimedAt);
    assert.equal("conceptExposures" in resumed.interview, false);
    const stranger = await requestor();
    assert.equal(
      (await stranger("interviews/" + r.interview.id + "/concept-presentation"))
        .status,
      404,
    );
    await owner(root + "/responses/" + r.interview.id, "DELETE");
    assert.equal((await exposure(person, r, "untimed")).status, 404);
  },
);
