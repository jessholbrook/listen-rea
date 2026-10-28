import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { start, stop, client } from "./harness";
import { prototypeGuide } from "./prototypes-fixture";
import { translatedFields } from "./localization-fixture";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3166 : 3165 }),
  { timeout: 90000 },
);
after(stop);
async function setup(required = true) {
  const owner = await client(),
    person = await client();
  await owner("auth/signup", "POST", {
    name: "Acknowledgement admin",
    email: randomUUID() + "@example.test",
    password: "test-confidentiality-password",
  });
  let s = (await owner("studies", "POST", { title: "Confidentiality study" }))
    .study;
  const root = "studies/" + s.id,
    pub = "public/" + s.id,
    guide = prototypeGuide();
  if (required)
    guide.confidentiality = {
      title: "Confidential study materials",
      text: "Keep the study concepts private. Do not distribute screenshots or recordings.",
    };
  s = (await owner(root, "PUT", { version: s.version, guide })).study;
  s = (await owner(root + "/publish", "POST", { version: s.version })).study;
  await owner(root + "/fielding", "POST", { state: "active" });
  return { owner, person, s, root, pub };
}
const ack = (n: any) => ({ accepted: true, version: n.version });
const headers = (r: any) => ({ "x-interview-token": r.token });
test(
  "Confidentiality admission rejects missing/false/forged/stale versions, freezes exact text, and bypasses previews without an attestation",
  { timeout: 90000 },
  async () => {
    const { owner, person, root, pub } = await setup();
    const notice = (await person(pub)).confidentiality;
    for (const data of [
      { consent: true },
      {
        consent: true,
        confidentiality: { accepted: false, version: notice.version },
      },
      {
        consent: true,
        confidentiality: { accepted: true, version: "0".repeat(64) },
      },
    ])
      assert.ok([400, 409].includes((await person(pub, "POST", data)).status));
    assert.equal((await owner(root)).interviews.length, 0);
    const r = await person(pub, "POST", {
      consent: true,
      confidentiality: ack(notice),
    });
    assert.equal(r.status, 201);
    assert.deepEqual(
      { ...r.interview.confidentialityAcknowledgement, acceptedAt: undefined },
      { ...notice, acceptedAt: undefined },
    );
    assert.ok(
      Date.parse(r.interview.confidentialityAcknowledgement.acceptedAt),
    );
    let s = (await owner(root)).study;
    const guide = structuredClone(s.draft);
    guide.confidentiality.text =
      "Revised confidentiality terms for new participants only.";
    s = (await owner(root, "PUT", { version: s.version, guide })).study;
    const draftNotice = (await person(pub)).confidentiality;
    assert.equal(draftNotice.version, notice.version);
    const preview = await owner(root + "/preview", "POST", {});
    assert.equal(preview.status, 201);
    assert.equal(preview.interview.confidentialityAcknowledgement, undefined);
    s = (await owner(root + "/publish", "POST", { version: s.version })).study;
    assert.equal(
      (
        await person(pub, "POST", {
          consent: true,
          confidentiality: ack(notice),
        })
      ).status,
      409,
    );
    const newNotice = (await person(pub)).confidentiality;
    assert.notEqual(newNotice.version, notice.version);
    const fresh = await person(pub, "POST", {
      consent: true,
      confidentiality: ack(newNotice),
    });
    assert.equal(fresh.status, 201);
    assert.deepEqual(
      (
        await person(
          "interviews/" + r.interview.id,
          "GET",
          undefined,
          headers(r),
        )
      ).interview.confidentialityAcknowledgement,
      r.interview.confidentialityAcknowledgement,
    );
    assert.equal(
      (await owner(root)).interviews.find((i: any) => i.id === r.interview.id)
        .confidentialityAcknowledgement.text,
      notice.text,
    );
    await owner(root + "/responses/" + r.interview.id, "DELETE");
    assert.equal(
      (
        await person(
          "interviews/" + r.interview.id,
          "GET",
          undefined,
          headers(r),
        )
      ).status,
      404,
    );
  },
);
test(
  "Reviewed EN/ES/FR text is bound to language; stale handoff recovery preserves original acknowledgement and consumes no extra places",
  { timeout: 90000 },
  async () => {
    const { owner, person, root, pub } = await setup();
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
    const en = (await person(pub + "?language=en")).confidentiality;
    for (const language of ["es", "fr"]) {
      const n = (await person(pub + "?language=" + language)).confidentiality;
      assert.notEqual(n.version, en.version);
      assert.match(n.text, language === "es" ? /^ES / : /^FR /);
      assert.equal(
        (
          await person(pub, "POST", {
            consent: true,
            language,
            confidentiality: ack(en),
          })
        ).status,
        409,
      );
      const r = await person(pub, "POST", {
        consent: true,
        language,
        confidentiality: ack(n),
      });
      assert.equal(r.status, 201);
      assert.equal(
        r.interview.confidentialityAcknowledgement.language,
        language,
      );
    }
    await owner(root + "/survey-handoff", "PUT", {
      version: 0,
      enabled: true,
      routes: { complete: "", screened_out: "", withdrawn: "" },
      reviewed: true,
    });
    const request = {
      consent: true,
      language: "en",
      surveyHandoff: {
        responseId: "R_" + randomUUID(),
        secret: randomBytes(32).toString("hex"),
      },
      confidentiality: ack(en),
    };
    const rejected = { ...request, confidentiality: undefined };
    assert.equal((await person(pub, "POST", rejected)).status, 409);
    const joined = await person(pub, "POST", request);
    assert.equal(joined.status, 201);
    s = (await owner(root)).study;
    s = (await owner(root + "/publish", "POST", { version: s.version })).study;
    const recovered = await person(pub, "POST", request);
    assert.equal(recovered.interview.id, joined.interview.id);
    assert.deepEqual(
      recovered.interview.confidentialityAcknowledgement,
      joined.interview.confidentialityAcknowledgement,
    );
    assert.equal(
      (await owner(root)).interviews.filter((i: any) => !i.preview).length,
      3,
    );
  },
);
test(
  "Legacy optional studies admit without acknowledgement and invalid confidentiality drafts are rejected",
  { timeout: 90000 },
  async () => {
    const { owner, person, root, pub } = await setup(false);
    assert.equal((await person(pub)).confidentiality, null);
    const r = await person(pub, "POST", { consent: true });
    assert.equal(r.status, 201);
    assert.equal(r.interview.confidentialityAcknowledgement, undefined);
    const s = (await owner(root)).study;
    assert.equal(
      (
        await owner(root, "PUT", {
          version: s.version,
          guide: { ...s.draft, confidentiality: { title: "Terms", text: "" } },
        })
      ).status,
      400,
    );
  },
);
