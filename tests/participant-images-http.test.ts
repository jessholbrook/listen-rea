import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { start, stop, base, dataDirectory } from "./harness";
import { participantImageGuide } from "./participant-images-fixture";
import { translatedFields } from "./localization-fixture";
import { timedGuide } from "./timed-concepts-fixture";
import type { Guide } from "../src/lib/domain";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3168 : 3167 }),
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
      headers: r.headers,
      bytes,
      ...(r.headers.get("content-type")?.includes("application/json")
        ? JSON.parse(bytes.toString())
        : {}),
    };
  };
}
async function setup(guide = participantImageGuide()) {
  const owner = await client(),
    person = await client();
  await owner("auth/signup", "POST", {
    name: "Image admin",
    email: randomUUID() + "@example.test",
    password: "participant-image-password",
  });
  let s = (
    await owner("studies", "POST", { title: "Participant image feedback" })
  ).study;
  const root = "studies/" + s.id,
    pub = "public/" + s.id;
  s = (await owner(root, "PUT", { version: s.version, guide })).study;
  assert.ok(s);
  s = (await owner(root + "/publish", "POST", { version: s.version })).study;
  await owner(root + "/fielding", "POST", { state: "active" });
  const r = await person(pub, "POST", { consent: true });
  assert.equal(r.status, 201);
  return { owner, person, root, pub, r, s };
}
const head = (r: any) => ({ "x-interview-token": r.token });
const uploadHeaders = (
  r: any,
  version = 0,
  id = randomUUID(),
  description = "A screenshot of the example workflow",
) => ({
  ...head(r),
  "content-type": "image/png",
  "x-upload-id": id,
  "x-interview-version": String(version),
  "x-image-description": encodeURIComponent(description),
  "x-image-consent": "yes",
});
const image = () =>
  sharp({
    create: { width: 2000, height: 60, channels: 3, background: "#219675" },
  })
    .withExif({ IFD0: { Artist: "private-test-author" } })
    .png()
    .toBuffer();
const answer = (
  c: any,
  r: any,
  version: number,
  participantImageId?: string,
  requestId = randomUUID(),
) =>
  c(
    "interviews/" + r.interview.id + "/answer",
    "POST",
    {
      version,
      requestId,
      answer: "This workflow made it easier to organize the example notes.",
      participantImageId,
    },
    head(r),
  );
test(
  "Private images normalize/strip metadata, bind exact retries and answers, enforce workspace/token boundaries and disappear with source deletion",
  { timeout: 90000 },
  async () => {
    const { owner, person, root, pub, r } = await setup(),
      bytes = await image(),
      headers = uploadHeaders(r),
      up = "interviews/" + r.interview.id + "/participant-images";
    const saved = await person(up, "POST", bytes, headers);
    assert.equal(saved.status, 201);
    assert.equal(saved.image.width, 1600);
    assert.equal(saved.image.height, 48);
    assert.notEqual(saved.image.id, headers["x-upload-id"]);
    const retry = await person(up, "POST", bytes, headers);
    assert.equal(retry.status, 200);
    assert.equal(retry.image.id, saved.image.id);
    assert.equal(
      (
        await person(up, "POST", bytes, {
          ...headers,
          "x-image-description": "Changed description",
        })
      ).status,
      409,
    );
    const resource = up + "/" + saved.image.id;
    assert.equal((await person(resource)).status, 404);
    assert.equal(
      (await person(resource, "GET", undefined, head(r))).status,
      200,
    );
    const viewed = await owner(root + "/participant-images/" + saved.image.id);
    assert.equal(viewed.status, 200);
    assert.equal(viewed.headers.get("cache-control"), "private, no-store");
    const metadata = await sharp(viewed.bytes).metadata();
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    const second = await person(pub, "POST", { consent: true });
    assert.equal(
      (
        await person(
          "interviews/" +
            second.interview.id +
            "/participant-images/" +
            saved.image.id,
          "GET",
          undefined,
          head(second),
        )
      ).status,
      404,
    );
    assert.equal((await answer(person, second, 0, saved.image.id)).status, 409);
    const other = await client();
    await other("auth/signup", "POST", {
      name: "Other admin",
      email: randomUUID() + "@example.test",
      password: "participant-image-password",
    });
    assert.equal((await other("recordings/" + saved.image.id)).status, 404);
    assert.equal((await answer(person, r, 0)).status, 409);
    const requestId = randomUUID(),
      joined = await answer(person, r, 0, saved.image.id, requestId);
    assert.equal(joined.status, 200);
    assert.equal(joined.interview.turns[0].participantImage.id, saved.image.id);
    assert.equal(joined.interview.participantImageDraft, undefined);
    assert.equal(
      (await answer(person, r, 0, saved.image.id, requestId)).interview.turns
        .length,
      1,
    );
    assert.equal(
      (await person(up, "POST", bytes, uploadHeaders(r, 1))).status,
      409,
    );
    await owner(root + "/responses/" + r.interview.id, "DELETE");
    assert.equal((await owner("recordings/" + saved.image.id)).status, 404);
    assert.equal(
      (await person(resource, "GET", undefined, head(r))).status,
      404,
    );
    assert.equal(
      existsSync(path.join(dataDirectory(), "media", saved.image.id)),
      false,
    );
  },
);
test(
  "Draft resume/removal/replacement and researcher erasure cannot resurrect bytes or attach to a different turn; answer/delete races remain consistent",
  { timeout: 90000 },
  async () => {
    const { owner, person, root, r } = await setup(),
      bytes = await image(),
      up = "interviews/" + r.interview.id + "/participant-images",
      headers = uploadHeaders(r);
    const first = await person(up, "POST", bytes, headers);
    const id = first.image.id;
    assert.equal(
      (await person("interviews/" + r.interview.id, "GET", undefined, head(r)))
        .interview.participantImageDraft.image.id,
      id,
    );
    assert.equal(
      (await person(up, "POST", bytes, uploadHeaders(r))).status,
      409,
    );
    assert.equal(
      (
        await person(up + "/" + id, "DELETE", undefined, {
          ...head(r),
          "x-interview-version": "0",
        })
      ).status,
      200,
    );
    assert.equal((await person(up, "POST", bytes, headers)).status, 409);
    assert.equal(
      (
        await owner(root + "/concept-images", "POST", bytes, {
          "content-type": "image/png",
          "x-upload-id": id,
        })
      ).status,
      409,
    );
    const second = await person(up, "POST", bytes, uploadHeaders(r));
    assert.equal(second.status, 201);
    assert.notEqual(second.image.id, id);
    const committed = await answer(person, r, 0, second.image.id);
    assert.equal(committed.status, 200);
    assert.equal(
      (
        await person(up + "/" + second.image.id, "DELETE", undefined, {
          ...head(r),
          "x-interview-version": "1",
        })
      ).status,
      409,
    );
    await owner(root + "/participant-images/" + second.image.id, "DELETE");
    const read = (await owner(root)).interviews.find(
      (i: any) => i.id === r.interview.id,
    );
    assert.equal(read.turns[0].participantImage, undefined);
    assert.ok(read.turns[0].participantImageRemovedAt);
    assert.equal(read.turns[0].answer, committed.interview.turns[0].answer);
    assert.equal((await owner("recordings/" + second.image.id)).status, 404);
    assert.equal(
      existsSync(path.join(dataDirectory(), "media", second.image.id)),
      false,
    );
    const again = await person("public/" + r.interview.studyId, "POST", {
      consent: true,
    });
    const uploaded = await person(
      "interviews/" + again.interview.id + "/participant-images",
      "POST",
      bytes,
      uploadHeaders(again),
    );
    const raced = await Promise.all([
      answer(person, again, 0, uploaded.image.id),
      person(
        "interviews/" +
          again.interview.id +
          "/participant-images/" +
          uploaded.image.id,
        "DELETE",
        undefined,
        { ...head(again), "x-interview-version": "0" },
      ),
    ]);
    assert.ok(raced.every((r) => [200, 409].includes(r.status)));
    const current = (
      await person(
        "interviews/" + again.interview.id,
        "GET",
        undefined,
        head(again),
      )
    ).interview;
    if (current.turns.length) {
      assert.equal(current.turns[0].participantImage.id, uploaded.image.id);
      assert.equal(raced[1].status, 409);
    } else {
      assert.equal(current.participantImageDraft, undefined);
      assert.equal(raced[0].status, 409);
      assert.equal(
        (
          await person(
            "interviews/" +
              again.interview.id +
              "/recording/" +
              uploaded.image.id,
            "GET",
            undefined,
            head(again),
          )
        ).status,
        404,
      );
    }
  },
);
test(
  "Uploads reject unsupported, mismatched, oversized or malformed images, absent consent/version, invalid descriptions, disabled questions and timed gates",
  { timeout: 90000 },
  async () => {
    const { owner, person, root, r } = await setup(),
      bytes = await image(),
      up = "interviews/" + r.interview.id + "/participant-images",
      h = uploadHeaders(r);
    for (const patch of [
      { "x-image-consent": "no" },
      { "x-interview-version": "" },
      { "x-interview-version": "3" },
      { "x-image-description": "%ZZ" },
      { "x-image-description": "ab" },
      { "content-type": "image/svg+xml" },
      { "content-type": "image/jpeg" },
    ])
      assert.ok(
        [400, 409].includes(
          (await person(up, "POST", bytes, { ...h, ...patch })).status,
        ),
      );
    assert.equal(
      (await person(up, "POST", Buffer.from('<svg onload="alert(1)"/>'), h))
        .status,
      400,
    );
    assert.equal(
      (await person(up, "POST", Buffer.alloc(2 * 1024 * 1024 + 1), h)).status,
      413,
    );
    assert.equal(
      (await person("interviews/" + r.interview.id, "GET", undefined, head(r)))
        .interview.participantImageDraft,
      undefined,
    );
    const s = (await owner(root)).study;
    const invalid = participantImageGuide();
    invalid.questions[0].type = "statement";
    assert.equal(
      (await owner(root, "PUT", { version: s.version, guide: invalid })).status,
      400,
    );
    const g = timedGuide(60);
    g.questions = [
      { ...participantImageGuide().questions[0], conceptQuestion: true },
    ];
    const timed = await setup(g);
    const target = "interviews/" + timed.r.interview.id + "/participant-images";
    assert.equal(
      (await timed.person(target, "POST", bytes, uploadHeaders(timed.r)))
        .status,
      409,
    );
    assert.equal(
      (
        await timed.person(
          "interviews/" + timed.r.interview.id + "/concept-presentation",
          "POST",
          { version: 0, conceptId: "alpha", action: "untimed" },
          head(timed.r),
        )
      ).status,
      200,
    );
    assert.equal(
      (await timed.person(target, "POST", bytes, uploadHeaders(timed.r)))
        .status,
      201,
    );
  },
);
test(
  "Published attachment settings stay frozen per session; EN/ES/FR descriptions, preview isolation and optional no-image answers work",
  { timeout: 90000 },
  async () => {
    const { owner, person, root, pub, r } = await setup();
    let s = (await owner(root)).study;
    for (const language of ["es", "fr"] as const) {
      const meta = await owner(root + "/localization");
      s = (
        await owner(root + "/localization/guide/" + language, "PUT", {
          version: s.version,
          sourceFingerprint: meta.sourceFingerprint,
          fields: translatedFields(s.draft, language),
          reviewed: true,
        })
      ).study;
    }
    s = (await owner(root + "/publish", "POST", { version: s.version })).study;
    for (const language of ["es", "fr"]) {
      const local = await person(pub, "POST", { consent: true, language });
      const desc =
        language === "es"
          ? "Captura del flujo de investigación"
          : "Capture du parcours de recherche";
      const saved = await person(
        "interviews/" + local.interview.id + "/participant-images",
        "POST",
        await image(),
        uploadHeaders(local, 0, randomUUID(), desc),
      );
      assert.equal(saved.status, 201);
      assert.equal(saved.image.description, desc);
      assert.equal(
        (await answer(person, local, 0, saved.image.id)).interview.language,
        language,
      );
    }
    const changed: Guide = structuredClone(s.draft);
    changed.questions[0].participantImages = false;
    s = (await owner(root, "PUT", { version: s.version, guide: changed }))
      .study;
    const preview = await owner(root + "/preview", "POST", {});
    assert.equal(preview.interview.guide.questions[0].participantImages, false);
    s = (await owner(root + "/publish", "POST", { version: s.version })).study;
    const fresh = await person(pub, "POST", { consent: true });
    assert.equal(
      (
        await person(
          "interviews/" + fresh.interview.id + "/participant-images",
          "POST",
          await image(),
          uploadHeaders(fresh),
        )
      ).status,
      409,
    );
    assert.equal((await answer(person, fresh, 0)).status, 200);
    assert.equal(
      (
        await person(
          "interviews/" + r.interview.id + "/participant-images",
          "POST",
          await image(),
          uploadHeaders(r),
        )
      ).status,
      201,
    );
  },
);
