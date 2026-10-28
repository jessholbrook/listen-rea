import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { start, stop, client } from "./harness";
import { emotionInterview } from "./emotion-fixture";
import { defaultBranding } from "../src/lib/branding";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3148 : 3147 }),
  { timeout: 90000 },
);
after(stop);
async function setup() {
  const owner = await client(),
    anon = await client();
  await owner("auth/signup", "POST", {
    name: "Brand admin",
    email: randomUUID() + "@example.test",
    password: "branding-test-password",
  });
  let s = (await owner("studies", "POST", { title: "Branded study" })).study;
  s = (
    await owner("studies/" + s.id, "PUT", {
      version: s.version,
      guide: { ...emotionInterview().guide, limit: 20 },
    })
  ).study;
  s = (
    await owner("studies/" + s.id + "/publish", "POST", { version: s.version })
  ).study;
  await owner("studies/" + s.id + "/fielding", "POST", { state: "active" });
  return { owner, anon, root: "studies/" + s.id, pub: "public/" + s.id };
}
const config = {
  ...defaultBranding,
  version: 0,
  enabled: true,
  name: "Acme Research",
  accent: "#ffcc00",
  background: "#101820",
  text: "#ffffff",
};
const head = (r: any) => ({ "x-interview-token": r.token });
const logo = async () =>
  "data:image/png;base64," +
  (
    await sharp({
      create: { width: 1000, height: 400, channels: 4, background: "#ffcc00" },
    })
      .png()
      .toBuffer()
  ).toString("base64");
test(
  "Branding is independent of guide publication; public/previews/new interviews get normalized snapshots and existing sessions keep their original theme through completion",
  { timeout: 90000 },
  async () => {
    const { owner, anon, root, pub } = await setup(),
      before = (await owner(root)).study;
    assert.equal((await anon(pub)).participantBranding.enabled, false);
    const legacy = await anon(pub, "POST", { consent: true });
    const saved = await owner(root + "/branding", "PUT", {
      ...config,
      logoDataUrl: await logo(),
      logoAlt: "Acme mark",
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.settings.version, 1);
    const meta = await sharp(
      Buffer.from(saved.settings.logoDataUrl.split(",")[1], "base64"),
    ).metadata();
    assert.equal(meta.format, "png");
    assert.ok(meta.width! <= 640 && meta.height! <= 160);
    const info = await anon(pub);
    assert.equal(info.participantBranding.name, "Acme Research");
    assert.equal("updatedBy" in info.participantBranding, false);
    assert.equal("workspaceId" in info.participantBranding, false);
    const admitted = await anon(pub, "POST", { consent: true }),
      preview = await owner(root + "/preview", "POST", {});
    assert.deepEqual(
      admitted.interview.participantBranding,
      info.participantBranding,
    );
    assert.deepEqual(
      preview.interview.participantBranding,
      info.participantBranding,
    );
    assert.equal((await owner(root)).study.version, before.version);
    assert.equal((await owner(root)).study.revisionId, before.revisionId);
    assert.equal(
      (
        await owner(root + "/branding", "PUT", {
          ...config,
          version: 1,
          enabled: false,
        })
      ).status,
      200,
    );
    assert.equal((await anon(pub)).participantBranding.enabled, false);
    assert.equal(
      (await anon(pub, "POST", { consent: true })).interview.participantBranding
        .enabled,
      false,
    );
    assert.equal(
      (
        await anon(
          "interviews/" + legacy.interview.id,
          "GET",
          undefined,
          head(legacy),
        )
      ).interview.participantBranding.enabled,
      false,
    );
    const resumed = await anon(
      "interviews/" + admitted.interview.id,
      "GET",
      undefined,
      head(admitted),
    );
    assert.deepEqual(
      resumed.interview.participantBranding,
      info.participantBranding,
    );
    const complete = await anon(
      "interviews/" + admitted.interview.id + "/answer",
      "POST",
      {
        version: 0,
        requestId: randomUUID(),
        answer: "",
        value: ["happy", "", ""],
      },
      head(admitted),
    );
    assert.equal(complete.status, 200);
    assert.equal(complete.interview.status, "complete");
    assert.deepEqual(
      complete.interview.participantBranding,
      info.participantBranding,
    );
  },
);
test(
  "Branding rejects malformed/oversized/active-content logos and inaccessible settings; concurrent saves reject stale writes without partial updates",
  { timeout: 90000 },
  async () => {
    const { owner, root } = await setup();
    for (const patch of [
      { text: "#101820" },
      { logoDataUrl: "https://tracker.example.test/logo.png", logoAlt: "Logo" },
      {
        logoDataUrl:
          "data:image/svg+xml;base64," +
          Buffer.from("<svg/>").toString("base64"),
        logoAlt: "Logo",
      },
      {
        logoDataUrl:
          "data:image/png;base64," + Buffer.from("<svg/>").toString("base64"),
        logoAlt: "Logo",
      },
      { accent: "red" },
      { name: "a".repeat(81) },
      { unknown: true },
    ])
      assert.equal(
        (await owner(root + "/branding", "PUT", { ...config, ...patch }))
          .status,
        400,
      );
    assert.equal((await owner(root + "/branding", "PUT", null)).status, 400);
    assert.equal(
      (
        await owner(root + "/branding", "PUT", {
          ...config,
          logoDataUrl:
            "data:image/png;base64," + Buffer.alloc(131073).toString("base64"),
          logoAlt: "Logo",
        })
      ).status,
      413,
    );
    assert.equal((await owner(root + "/branding")).settings.version, 0);
    const race = await Promise.all([
      owner(root + "/branding", "PUT", config),
      owner(root + "/branding", "PUT", { ...config, name: "Other name" }),
    ]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
    const saved = (await owner(root + "/branding")).settings;
    assert.equal(saved.version, 1);
    assert.ok(["Acme Research", "Other name"].includes(saved.name));
    const jpeg =
      "data:image/jpeg;base64," +
      (
        await sharp({
          create: { width: 10, height: 10, channels: 3, background: "#000000" },
        })
          .jpeg()
          .toBuffer()
      ).toString("base64");
    assert.equal(
      (
        await owner(root + "/branding", "PUT", {
          ...config,
          version: 1,
          logoDataUrl: jpeg,
          logoAlt: "JPEG logo",
        })
      ).status,
      200,
    );
    assert.match(
      (await owner(root + "/branding")).settings.logoDataUrl,
      /^data:image\/png;base64,/,
    );
  },
);
test(
  "Branding settings require workspace membership and researcher/admin writes",
  { timeout: 90000 },
  async () => {
    const { owner, anon, root } = await setup();
    assert.equal((await anon(root + "/branding")).status, 401);
    await anon("auth/signup", "POST", {
      name: "Other workspace",
      email: randomUUID() + "@example.test",
      password: "branding-test-password",
    });
    assert.equal((await anon(root + "/branding")).status, 404);
    assert.equal((await anon(root + "/branding", "PUT", config)).status, 404);
    const email = randomUUID() + "@example.test",
      inv = await owner("invites", "POST", {
        email,
        role: "collaborator",
      }),
      collab = await client();
    const result = await collab("auth/signup", "POST", {
      name: "Read only",
      email,
      password: "branding-test-password",
      invite: inv.invite,
    });
    assert.equal(result.status, 200);
    assert.equal((await collab(root + "/branding")).canManage, false);
    assert.equal((await collab(root + "/branding", "PUT", config)).status, 403);
  },
);
