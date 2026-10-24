import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { start, stop, base } from "./harness";
import { optionImageGuide } from "./option-images-fixture";
import { timedGuide } from "./timed-concepts-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3160 : 3159 }),
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

import { rankingMaxdiffImageGuide } from "./ranking-maxdiff-images-fixture";
async function setup() {
  const owner = await requestor(),
    person = await requestor();
  await owner("auth/signup", "POST", {
    name: "Rank image admin",
    email: randomUUID() + "@example.test",
    password: "ranking-image-password",
  });
  let s = (await owner("studies", "POST", { title: "Ranking MaxDiff images" }))
    .study;
  const root = "studies/" + s.id,
    pub = "public/" + s.id,
    ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  for (const id of ids) {
    const bytes = await sharp({
      create: { width: 120, height: 70, channels: 3, background: "#25834d" },
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
  const g = rankingMaxdiffImageGuide(ids);
  s = (await owner(root, "PUT", { version: s.version, guide: g })).study;
  s = (await owner(root + "/publish", "POST", { version: s.version })).study;
  await owner(root + "/fielding", "POST", { state: "active" });
  const r = await person(pub, "POST", { consent: true });
  return {
    owner,
    person,
    root,
    pub,
    ids,
    g,
    r,
    path: "interviews/" + r.interview.id,
  };
}
const head = (r: any) => ({ "x-interview-token": r.token });
const answer = (person: any, r: any, version: number, value: string[]) =>
  person(
    "interviews/" + r.interview.id + "/answer",
    "POST",
    { version, value, requestId: randomUUID(), answer: "" },
    head(r),
  );
test(
  "Ranking images and per-task MaxDiff bytes remain private, frozen and current-only through retries, all tasks, completion and deletion",
  { timeout: 90000 },
  async () => {
    const { owner, person, root, ids, r, path } = await setup();
    for (const id of ids)
      assert.equal(
        (await person(path + "/option-images/" + id, "GET", undefined, head(r)))
          .status,
        200,
      );
    assert.equal((await person(path + "/option-images/" + ids[0])).status, 404);
    assert.equal(r.interview.guide.questions[1].maxdiff, undefined);
    assert.equal(
      (await answer(person, r, 0, ["0", "0", "1", "2"])).status,
      400,
    );
    let i = (await answer(person, r, 0, ["2", "0", "3", "1"])).interview;
    assert.deepEqual(i.turns[0].value, ["2", "0", "3", "1"]);
    const first = structuredClone(i.maxdiffPrompt);
    assert.deepEqual(
      (await person(path, "GET", undefined, head(r))).interview.maxdiffPrompt,
      first,
    );
    let s = (await owner(root)).study;
    const changed = structuredClone(s.draft);
    changed.questions[1].maxdiff.items.forEach((x: any) => {
      x.imageAssetId = null;
      x.imageAlt = "";
    });
    s = (await owner(root, "PUT", { version: s.version, guide: changed }))
      .study;
    await owner(root + "/publish", "POST", { version: s.version });
    assert.deepEqual(
      (await person(path, "GET", undefined, head(r))).interview.maxdiffPrompt,
      first,
    );
    assert.equal(
      (await owner(root + "/concept-images/" + ids[0], "DELETE")).status,
      409,
    );
    while (i.maxdiffPrompt) {
      const prompt = i.maxdiffPrompt;
      for (const [n, id] of ids.entries())
        assert.equal(
          (
            await person(
              path + "/option-images/" + id,
              "GET",
              undefined,
              head(r),
            )
          ).status,
          prompt.items.some((x: any) => x.id === String(n)) ? 200 : 404,
        );
      const requestId = randomUUID(),
        body = {
          version: i.version,
          requestId,
          answer: "",
          value: { best: prompt.items[0].id, worst: prompt.items[1].id },
        };
      const out = await person(path + "/answer", "POST", body, head(r));
      assert.equal(out.status, 200);
      assert.deepEqual(
        (await person(path + "/answer", "POST", body, head(r))).interview,
        out.interview,
      );
      i = out.interview;
    }
    for (const id of ids)
      assert.equal(
        (await person(path + "/option-images/" + id, "GET", undefined, head(r)))
          .status,
        404,
      );
    const source = (await owner(root)).interviews.find(
      (x: any) => x.id === r.interview.id,
    );
    assert.equal(source.turns.filter((t: any) => t.maxdiff).length, 4);
    assert.ok(
      source.guide.questions[1].maxdiff.items.every((x: any) => x.imageAssetId),
    );
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
  "MaxDiff asset validation rejects foreign/missing references and timing gates both ranking and task images",
  { timeout: 90000 },
  async () => {
    const { owner, person, root, pub, ids, g } = await setup();
    let s = (await owner(root)).study;
    for (const imageAssetId of [randomUUID(), "bad"]) {
      const bad = structuredClone(g);
      bad.questions[1].maxdiff!.items[0].imageAssetId = imageAssetId;
      assert.equal(
        (await owner(root, "PUT", { version: s.version, guide: bad })).status,
        400,
      );
      assert.equal((await owner(root)).study.version, s.version);
    }
    const stranger = await requestor();
    await stranger("auth/signup", "POST", {
      name: "Foreign",
      email: randomUUID() + "@example.test",
      password: "foreign-image-password",
    });
    const other = (await stranger("studies", "POST", { title: "Foreign" }))
      .study;
    assert.equal(
      (
        await stranger("studies/" + other.id, "PUT", {
          version: other.version,
          guide: g,
        })
      ).status,
      400,
    );
    g.conceptTest = {
      concepts: [
        {
          id: "timed",
          name: "Timed",
          headline: "Timed stimulus",
          description: "Review this package description",
          exposureSeconds: 1,
        },
      ],
      count: 2,
      randomizeOrder: false,
    };
    g.conceptTest.concepts.push({
      ...g.conceptTest.concepts[0],
      id: "other",
      name: "Other",
    });
    g.questions[0].conceptQuestion = true;
    g.questions[1].conceptQuestion = true;
    s = (await owner(root, "PUT", { version: s.version, guide: g })).study;
    assert.ok(s);
    await owner(root + "/publish", "POST", { version: s.version });
    const r = await person(pub, "POST", { consent: true }),
      path = "interviews/" + r.interview.id;
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
    await person(
      path + "/concept-presentation",
      "POST",
      { version: 0, conceptId: "timed", action: "start" },
      head(r),
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
    let out = await answer(person, r, 0, ["0", "1", "2", "3"]);
    assert.equal(out.status, 200);
    assert.equal(out.interview.conceptPresentation.state, "expired");
    const shown = out.interview.maxdiffPrompt.items[0];
    assert.equal(
      (
        await person(
          path + "/option-images/" + shown.imageAssetId,
          "GET",
          undefined,
          head(r),
        )
      ).status,
      200,
    );
  },
);
