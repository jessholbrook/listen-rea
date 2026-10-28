import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { start, stop, base } from "./harness";
import { optionImageGuide } from "./option-images-fixture";
import { timedGuide } from "./timed-concepts-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3164 : 3163 }),
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

import { onceGuide } from "./video-once-fixture";
import { fixtureVideo } from "./concept-videos-fixture";
async function setup() {
  const owner = await requestor(),
    person = await requestor();
  await owner("auth/signup", "POST", {
    name: "Video once owner",
    email: randomUUID() + "@example.test",
    password: "video-once-password",
  });
  let s = (await owner("studies", "POST", { title: "Single video view" }))
    .study;
  const root = "studies/" + s.id,
    pub = "public/" + s.id,
    ids = [randomUUID(), randomUUID()];
  for (const id of ids)
    assert.equal(
      (
        await owner(root + "/concept-videos", "POST", await fixtureVideo(), {
          "content-type": "video/mp4",
          "x-upload-id": id,
        })
      ).status,
      201,
    );
  s = (await owner(root, "PUT", { version: s.version, guide: onceGuide(ids) }))
    .study;
  s = (await owner(root + "/publish", "POST", { version: s.version })).study;
  await owner(root + "/fielding", "POST", { state: "active" });
  const r = await person(pub, "POST", { consent: true });
  await person(
    "interviews/" + r.interview.id + "/answer",
    "POST",
    { requestId: randomUUID(), version: 0, answer: "", optionId: "go" },
    { "x-interview-token": r.token },
  );
  return {
    owner,
    person,
    root,
    pub,
    ids,
    r,
    path: "interviews/" + r.interview.id,
  };
}
const head = (r: any, lease?: string) => ({
  "x-interview-token": r.token,
  ...(lease ? { "x-video-view-token": lease } : {}),
});
const act = (
  person: any,
  r: any,
  action: string,
  version = 1,
  conceptId = "alpha",
  requestId?: string,
  lease?: string,
) =>
  person(
    "interviews/" + r.interview.id + "/video-presentation",
    "POST",
    { action, version, conceptId, ...(requestId ? { requestId } : {}) },
    head(r, lease),
  );
const answer = (person: any, r: any, version: number) =>
  person(
    "interviews/" + r.interview.id + "/answer",
    "POST",
    { version, requestId: randomUUID(), answer: "", value: 4 },
    head(r),
  );
test(
  "One atomic video start grants a bounded private player, resumes only the same request, blocks early answers and retains used state across repeated questions",
  { timeout: 90000 },
  async () => {
    const { owner, person, root, ids, r, path } = await setup();
    assert.equal(
      (await person(path, "GET", undefined, head(r))).interview
        .videoPresentation.state,
      "ready",
    );
    assert.equal(
      (
        await person(
          path + "/concept-videos/" + ids[0],
          "GET",
          undefined,
          head(r),
        )
      ).status,
      404,
    );
    assert.equal((await answer(person, r, 1)).status, 409);
    const requestId = randomUUID(),
      [a, b] = await Promise.all([
        act(person, r, "start", 1, "alpha", requestId),
        act(person, r, "start", 1, "alpha", requestId),
      ]);
    assert.equal(a.status, 200);
    assert.equal(a.viewToken, b.viewToken);
    assert.equal(
      a.interview.videoPresentation.endsAt,
      b.interview.videoPresentation.endsAt,
    );
    assert.ok(
      a.interview.videoPresentation.endsAt -
        a.interview.videoPresentation.serverNow >
        120000,
    );
    assert.equal(
      (
        await person(
          path + "/concept-videos/" + ids[0],
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
          path + "/concept-videos/" + ids[0],
          "GET",
          undefined,
          head(r, "0".repeat(64)),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await person(path + "/concept-videos/" + ids[0], "GET", undefined, {
          ...head(r, a.viewToken),
          range: "bytes=0-31",
        })
      ).status,
      206,
    );
    assert.equal(
      (
        await person(
          path + "/concept-videos/" + ids[1],
          "GET",
          undefined,
          head(r, a.viewToken),
        )
      ).status,
      404,
    );
    assert.equal(
      (await act(person, r, "start", 1, "alpha", randomUUID())).status,
      409,
    );
    assert.equal((await answer(person, r, 1)).status, 409);
    assert.equal((await act(person, r, "finish")).status, 409);
    const ended = await act(
      person,
      r,
      "finish",
      1,
      "alpha",
      undefined,
      a.viewToken,
    );
    assert.equal(ended.interview.videoPresentation.state, "used");
    assert.equal(
      (await act(person, r, "finish", 1, "alpha", undefined, a.viewToken))
        .interview.videoPresentation.revision,
      ended.interview.videoPresentation.revision,
    );
    assert.equal(
      (
        await person(
          path + "/concept-videos/" + ids[0],
          "GET",
          undefined,
          head(r, a.viewToken),
        )
      ).status,
      404,
    );
    let next = await answer(person, r, 1);
    assert.equal(next.interview.videoPresentation.state, "used");
    assert.equal(
      (await act(person, r, "start", 2, "alpha", requestId)).status,
      409,
    );
    next = await answer(person, r, 2);
    assert.equal(next.interview.videoPresentation.conceptId, "beta");
    assert.equal(next.interview.videoPresentation.state, "ready");
    assert.equal((await act(person, r, "skip", 3, "alpha")).status, 409);
    assert.equal(
      (await act(person, r, "skip", 3, "beta")).interview.videoPresentation
        .state,
      "used",
    );
    const source = (await owner(root)).interviews.find(
      (i: any) => i.id === r.interview.id,
    );
    assert.ok(source.videoViews.alpha.endedAt);
    assert.ok(source.videoViews.beta.skippedAt);
  },
);
test(
  "Recorded replayable viewing survives reload and frozen publication, respects source deletion and never grants future concepts or anonymous callers",
  { timeout: 90000 },
  async () => {
    const { owner, person, root, ids, r, path } = await setup();
    assert.equal((await person(path + "/video-presentation")).status, 404);
    assert.equal((await act(person, r, "alternative", 99)).status, 409);
    const alt = await act(person, r, "alternative");
    assert.equal(alt.interview.videoPresentation.state, "alternative");
    assert.equal(
      (await act(person, r, "alternative")).interview.videoPresentation
        .revision,
      alt.interview.videoPresentation.revision,
    );
    assert.equal(
      (
        await person(
          path + "/concept-videos/" + ids[0],
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
          path + "/concept-videos/" + ids[1],
          "GET",
          undefined,
          head(r),
        )
      ).status,
      404,
    );
    let s = (await owner(root)).study;
    const g = structuredClone(s.draft);
    g.conceptTest.concepts[0].videoOnce = false;
    s = (await owner(root, "PUT", { version: s.version, guide: g })).study;
    await owner(root + "/publish", "POST", { version: s.version });
    const resumed = (await person(path, "GET", undefined, head(r))).interview;
    assert.equal(resumed.guide.conceptTest.concepts[0].videoOnce, true);
    assert.equal(resumed.videoPresentation.state, "alternative");
    assert.equal("videoViews" in resumed, false);
    assert.equal((await answer(person, r, 1)).status, 200);
    const source = (await owner(root)).interviews.find(
      (i: any) => i.id === r.interview.id,
    );
    assert.ok(source.videoViews.alpha.alternativeAt);
    assert.equal(source.videoViews.alpha.nonce, undefined);
    const imageId = randomUUID();
    await owner(
      root + "/concept-images",
      "POST",
      await sharp({
        create: { width: 32, height: 32, channels: 3, background: "#558844" },
      })
        .png()
        .toBuffer(),
      { "content-type": "image/png", "x-upload-id": imageId },
    );
    let current = (await owner(root)).study;
    const choiceGuide = onceGuide(ids);
    choiceGuide.questions[1].type = "choice";
    choiceGuide.questions[1].options = [
      {
        id: "a",
        text: "Design A",
        rejects: false,
        imageAssetId: imageId,
        imageAlt: "A green design",
      },
      { id: "b", text: "Design B", rejects: false },
    ];
    current = (
      await owner(root, "PUT", { version: current.version, guide: choiceGuide })
    ).study;
    await owner(root + "/publish", "POST", { version: current.version });
    const choice = await person("public/" + current.id, "POST", {
        consent: true,
      }),
      choicePath = "interviews/" + choice.interview.id;
    const ready = await person(
      choicePath + "/answer",
      "POST",
      { version: 0, requestId: randomUUID(), answer: "", optionId: "go" },
      head(choice),
    );
    assert.equal(JSON.stringify(ready.interview).includes(imageId), false);
    assert.equal(
      (
        await person(
          choicePath + "/option-images/" + imageId,
          "GET",
          undefined,
          head(choice),
        )
      ).status,
      404,
    );
    await act(person, choice, "alternative");
    assert.equal(
      (
        await person(
          choicePath + "/option-images/" + imageId,
          "GET",
          undefined,
          head(choice),
        )
      ).status,
      200,
    );
    await person(path + "/stop", "POST", {}, head(r));
    assert.equal(
      (
        await person(
          path + "/concept-videos/" + ids[0],
          "GET",
          undefined,
          head(r),
        )
      ).status,
      404,
    );
    await owner(root + "/responses/" + r.interview.id, "DELETE");
    assert.equal((await act(person, r, "alternative")).status, 404);
    assert.equal(
      (
        await person(
          path + "/concept-videos/" + ids[0],
          "GET",
          undefined,
          head(r),
        )
      ).status,
      404,
    );
  },
);
