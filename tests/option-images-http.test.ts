import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { start, stop, base } from "./harness";
import { optionImageGuide } from "./option-images-fixture";
import { timedGuide } from "./timed-concepts-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3158 : 3157 }),
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
    person = await requestor();
  await owner("auth/signup", "POST", {
    name: "Answer image admin",
    email: randomUUID() + "@example.test",
    password: "option-image-password",
  });
  let s = (await owner("studies", "POST", { title: "Image answer lifecycle" }))
    .study;
  const root = "studies/" + s.id,
    pub = "public/" + s.id,
    ids: string[] = [];
  for (const color of ["#228844", "#9944aa", "#2266aa"]) {
    const id = randomUUID();
    ids.push(id);
    const bytes = await sharp({
      create: { width: 80, height: 50, channels: 3, background: color },
    })
      .png()
      .toBuffer();
    assert.equal(
      (
        await owner(root + "/concept-images", "POST", bytes, {
          "content-type": "image/png",
          "x-upload-id": id,
        })
      ).status,
      201,
    );
  }
  const publish = async (guide: any) => {
    s = (await owner(root)).study;
    s = (await owner(root, "PUT", { version: s.version, guide })).study;
    assert.ok(s);
    s = (await owner(root + "/publish", "POST", { version: s.version })).study;
    await owner(root + "/fielding", "POST", { state: "active" });
    return (await owner(root)).study;
  };
  return { owner, person, root, pub, ids, publish };
}
const head = (r: any) => ({ "x-interview-token": r.token });
const answer = (person: any, r: any, version: number, data: object) =>
  person(
    "interviews/" + r.interview.id + "/answer",
    "POST",
    { version, requestId: randomUUID(), answer: "", ...data },
    head(r),
  );
test(
  "Private answer images follow saved randomized and carried choices, publication/history boundaries, source revocation and protected deletion",
  { timeout: 90000 },
  async () => {
    const { owner, person, root, pub, ids, publish } = await setup();
    await publish(optionImageGuide(ids));
    assert.equal(JSON.stringify(await person(pub)).includes(ids[0]), false);
    const r = await person(pub, "POST", { consent: true }),
      path = "interviews/" + r.interview.id;
    assert.equal(r.status, 201);
    assert.equal(
      r.interview.guide.questions[3].options[0].imageAssetId,
      undefined,
    );
    for (const id of ids.slice(0, 2)) {
      const image = await person(
        path + "/option-images/" + id,
        "GET",
        undefined,
        head(r),
      );
      assert.equal(image.status, 200);
      assert.equal((await sharp(image.bytes).metadata()).width, 80);
      assert.match(image.headers.get("cache-control"), /no-store/);
    }
    assert.equal(
      (
        await person(
          path + "/option-images/" + ids[2],
          "GET",
          undefined,
          head(r),
        )
      ).status,
      404,
    );
    assert.equal((await person(path + "/option-images/" + ids[0])).status, 404);
    assert.equal(
      (
        await person(
          path + "/concept-images/" + ids[0],
          "GET",
          undefined,
          head(r),
        )
      ).status,
      404,
    );
    const savedOrder = r.interview.optionAssignments.pick.map((o: any) => o.id);
    assert.deepEqual(
      (
        await person(path, "GET", undefined, head(r))
      ).interview.optionAssignments.pick.map((o: any) => o.id),
      savedOrder,
    );
    const changed = optionImageGuide(ids);
    changed.questions[0].options[0].imageAssetId = ids[2];
    await publish(changed);
    const fresh = await person(pub, "POST", { consent: true });
    assert.equal(
      fresh.interview.guide.questions[0].options[0].imageAssetId,
      ids[2],
    );
    assert.equal(
      (await person(path, "GET", undefined, head(r))).interview.guide
        .questions[0].options[0].imageAssetId,
      ids[0],
    );
    let out = await answer(person, r, 0, { optionId: "a" });
    assert.equal(out.status, 200);
    assert.equal(
      out.interview.optionAssignments.remaining[0].imageAssetId,
      ids[1],
    );
    assert.equal(
      out.interview.optionAssignments.pick[0].imageAssetId,
      undefined,
    );
    assert.equal(
      (
        await person(
          path + "/option-images/" + ids[0],
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
          path + "/option-images/" + ids[1],
          "GET",
          undefined,
          head(r),
        )
      ).status,
      200,
    );
    out = await answer(person, r, 1, { value: ["b"] });
    assert.equal(out.status, 200);
    assert.equal(out.interview.optionAssignments.rank[0].imageAssetId, ids[1]);
    assert.equal(
      (
        await person(
          path + "/option-images/" + ids[1],
          "GET",
          undefined,
          head(r),
        )
      ).status,
      200,
    );
    out = await answer(person, r, 2, { value: ["b"] });
    assert.equal(out.status, 200);
    assert.equal(
      (
        await person(
          path + "/option-images/" + ids[2],
          "GET",
          undefined,
          head(r),
        )
      ).status,
      200,
    );
    out = await answer(person, r, 3, { value: ["c"] });
    assert.equal(out.status, 200);
    assert.equal(
      (
        await person(
          path + "/option-images/" + ids[2],
          "GET",
          undefined,
          head(r),
        )
      ).status,
      404,
    );
    assert.equal(
      (await owner(root + "/concept-images/" + ids[0], "DELETE")).status,
      409,
    );
    const original = (await owner(root)).interviews.find(
      (i: any) => i.id === r.interview.id,
    );
    assert.equal(original.guide.questions[0].options[0].imageAssetId, ids[0]);
    assert.equal(original.turns[0].answer, "Green design");
    await owner(root + "/responses/" + r.interview.id, "DELETE");
    assert.equal(
      (
        await person(
          path + "/option-images/" + ids[0],
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
  "Answer image validation is workspace bound, rolls back invalid saves, and timed concept answer images stay hidden until answers open",
  { timeout: 90000 },
  async () => {
    const { owner, person, root, pub, ids, publish } = await setup();
    let s = await publish(optionImageGuide(ids));
    for (const patch of [{ imageAlt: " " }, { imageAssetId: randomUUID() }]) {
      const g = optionImageGuide(ids);
      Object.assign(g.questions[0].options[0], patch);
      assert.equal(
        (await owner(root, "PUT", { version: s.version, guide: g })).status,
        400,
      );
      assert.equal((await owner(root)).study.version, s.version);
    }
    const other = await requestor();
    await other("auth/signup", "POST", {
      name: "Other",
      email: randomUUID() + "@example.test",
      password: "other-option-password",
    });
    const foreign = (
      await other("studies", "POST", { title: "Other workspace" })
    ).study;
    assert.equal(
      (
        await other("studies/" + foreign.id, "PUT", {
          version: foreign.version,
          guide: optionImageGuide(ids),
        })
      ).status,
      400,
    );
    const g = timedGuide(1);
    g.questions[1] = {
      ...g.questions[1],
      type: "choice",
      options: optionImageGuide(ids).questions[0].options,
    };
    await publish(g);
    const r = await person(pub, "POST", { consent: true }),
      path = "interviews/" + r.interview.id;
    let out = await answer(person, r, 0, { optionId: "go" });
    assert.equal(
      out.interview.guide.questions[1].options[0].imageAssetId,
      undefined,
    );
    assert.equal(
      (
        await person(
          path + "/option-images/" + ids[0],
          "GET",
          undefined,
          head(r),
        )
      ).status,
      404,
    );
    out = await person(
      path + "/concept-presentation",
      "POST",
      { version: 1, conceptId: "alpha", action: "start" },
      head(r),
    );
    assert.equal(out.interview.conceptPresentation.state, "viewing");
    assert.equal(
      out.interview.optionAssignments[g.questions[1].id + "::alpha"]?.[0]
        ?.imageAssetId,
      undefined,
    );
    assert.equal(
      (
        await person(
          path + "/option-images/" + ids[0],
          "GET",
          undefined,
          head(r),
        )
      ).status,
      404,
    );
    await new Promise((resolve) => setTimeout(resolve, 1100));
    out = await person(path, "GET", undefined, head(r));
    assert.equal(out.interview.conceptPresentation.state, "expired");
    assert.equal(
      (
        await person(
          path + "/option-images/" + ids[0],
          "GET",
          undefined,
          head(r),
        )
      ).status,
      200,
    );
    out = await person(
      path + "/concept-presentation",
      "POST",
      { version: 1, conceptId: "alpha", action: "untimed" },
      head(r),
    );
    assert.equal(out.interview.conceptPresentation.state, "untimed");
    assert.equal(
      (
        await person(
          path + "/option-images/" + ids[0],
          "GET",
          undefined,
          head(r),
        )
      ).status,
      200,
    );
  },
);
