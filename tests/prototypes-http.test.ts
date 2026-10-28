import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, client } from "./harness";
import {
  prototypeGuide,
  alphaPrototype,
  betaPrototype,
} from "./prototypes-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3152 : 3151 }),
  { timeout: 90000 },
);
after(stop);
async function setup() {
  const owner = await client(),
    person = await client();
  await owner("auth/signup", "POST", {
    name: "Prototype admin",
    email: randomUUID() + "@example.test",
    password: "prototype-test-password",
  });
  let s = (await owner("studies", "POST", { title: "Prototype concepts" }))
    .study;
  const root = "studies/" + s.id,
    pub = "public/" + s.id;
  s = (
    await owner(root, "PUT", { version: s.version, guide: prototypeGuide() })
  ).study;
  s = (await owner(root + "/publish", "POST", { version: s.version })).study;
  await owner(root + "/fielding", "POST", { state: "active" });
  return { owner, person, root, pub, s };
}
const head = (r: any) => ({ "x-interview-token": r.token });
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
    head(r),
  );
test(
  "Prototype URLs/tasks are current-concept-only, frozen through draft/publication/reload, and preserve original guide history",
  { timeout: 90000 },
  async () => {
    const { owner, person, root, pub, s } = await setup();
    assert.equal(
      JSON.stringify(await person(pub)).includes(alphaPrototype),
      false,
    );
    const r = await person(pub, "POST", { consent: true });
    assert.equal(r.interview.guide.conceptTest.concepts.length, 0);
    const shown = await answer(person, r, 0, undefined, "go");
    assert.equal(
      shown.interview.guide.conceptTest.concepts[0].prototypeUrl,
      alphaPrototype,
    );
    assert.equal(JSON.stringify(shown).includes(betaPrototype), false);
    let current = (await owner(root)).study;
    const next = structuredClone(current.draft);
    next.conceptTest.concepts[0].prototypeUrl =
      "https://changed.example.test/new";
    next.conceptTest.concepts[0].taskInstructions =
      "Changed task instructions.";
    current = (
      await owner(root, "PUT", { version: current.version, guide: next })
    ).study;
    const preview = await owner(root + "/preview", "POST", {});
    assert.equal(
      (await answer(person, preview, 0, undefined, "go")).interview.guide
        .conceptTest.concepts[0].prototypeUrl,
      "https://changed.example.test/new",
    );
    const draftAdmission = await person(pub, "POST", { consent: true });
    assert.equal(
      (await answer(person, draftAdmission, 0, undefined, "go")).interview.guide
        .conceptTest.concepts[0].prototypeUrl,
      alphaPrototype,
    );
    current = (
      await owner(root + "/publish", "POST", { version: current.version })
    ).study;
    const fresh = await person(pub, "POST", { consent: true });
    assert.equal(
      (await answer(person, fresh, 0, undefined, "go")).interview.guide
        .conceptTest.concepts[0].prototypeUrl,
      "https://changed.example.test/new",
    );
    const resumed = await person(
      "interviews/" + r.interview.id,
      "GET",
      undefined,
      head(r),
    );
    assert.equal(
      resumed.interview.guide.conceptTest.concepts[0].prototypeUrl,
      alphaPrototype,
    );
    assert.match(
      resumed.interview.guide.conceptTest.concepts[0].taskInstructions,
      /Create a summary/,
    );
    const beta = await answer(person, r, 1, 4);
    assert.equal(
      beta.interview.guide.conceptTest.concepts[0].prototypeUrl,
      betaPrototype,
    );
    assert.equal(JSON.stringify(beta).includes(alphaPrototype), false);
    const restored = await owner(root + "/restore", "POST", {
      version: current.version,
      id: s.revisionId,
      source: "revision",
    });
    assert.equal(
      restored.study.draft.conceptTest.concepts[0].prototypeUrl,
      alphaPrototype,
    );
  },
);
test(
  "Prototype task/link validation rejects bad saves without changing the draft; workspace isolation and source deletion remain enforced",
  { timeout: 90000 },
  async () => {
    const { owner, person, root, pub } = await setup();
    const original = (await owner(root)).study;
    for (const patch of [
      { prototypeUrl: "http://example.test" },
      { prototypeUrl: "https://u:p@example.test" },
      { taskInstructions: "" },
      { taskInstructions: "x".repeat(4001) },
    ]) {
      const guide = prototypeGuide();
      Object.assign(guide.conceptTest!.concepts[0], patch);
      assert.equal(
        (await owner(root, "PUT", { version: original.version, guide })).status,
        400,
      );
    }
    assert.equal((await owner(root)).study.version, original.version);
    const stranger = await client();
    await stranger("auth/signup", "POST", {
      name: "Other",
      email: randomUUID() + "@example.test",
      password: "prototype-test-password",
    });
    assert.equal((await stranger(root)).status, 404);
    const r = await person(pub, "POST", { consent: true });
    await answer(person, r, 0, undefined, "go");
    await owner(root + "/responses/" + r.interview.id, "DELETE");
    assert.equal(
      (await person("interviews/" + r.interview.id, "GET", undefined, head(r)))
        .status,
      404,
    );
  },
);
