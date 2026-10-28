import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import path from "node:path";
import { dataDirectory } from "./harness";
import { client } from "./image-review-fixture";
import { participantPPTXGuide, samplePPTX } from "./participant-pptx-fixture";
import { pptxMime } from "../src/lib/participant-pptx";
export const pptxTextDB = () =>
  createClient({
    url: "file:" + path.join(dataDirectory(), "research.sqlite"),
  });
export async function pptxTextSetup(submit = true) {
  const owner = await client(),
    person = await client();
  await owner("auth/signup", "POST", {
    name: "PPTX passage reviewer",
    email: randomUUID() + "@example.test",
    password: "pptx-passages-password",
  });
  let s = (
    await owner("studies", "POST", { title: "Private PPTX passage study" })
  ).study;
  const root = "studies/" + s.id;
  s = (
    await owner(root, "PUT", {
      version: s.version,
      guide: participantPPTXGuide(),
    })
  ).study;
  s = (await owner(root + "/publish", "POST", { version: s.version })).study;
  await owner(root + "/fielding", "POST", { state: "active" });
  const r = await person("public/" + s.id, "POST", { consent: true }),
    ip = "interviews/" + r.interview.id,
    h = { "x-interview-token": r.token };
  const uploaded = await person(
    ip + "/participant-pptx",
    "POST",
    await samplePPTX(),
    {
      ...h,
      "content-type": pptxMime,
      "x-upload-id": randomUUID(),
      "x-interview-version": "0",
      "x-pptx-description": "Synthetic prepared PPTX",
      "x-pptx-consent": "yes",
    },
  );
  const asset = root + "/participant-pptx/" + uploaded.pptx.id;
  if (submit)
    await person(
      ip + "/answer",
      "POST",
      {
        version: 0,
        requestId: randomUUID(),
        answer: "Synthetic written answer",
        participantPPTXId: uploaded.pptx.id,
      },
      h,
    );
  return {
    owner,
    person,
    s,
    root,
    r,
    ip,
    h,
    asset,
    id: uploaded.pptx.id,
    textPath: asset + "/text",
  };
}
export const pptxVerificationInput = (r: any, slide = 2) => ({
  source: r.source,
  digest: r.digest,
  version: r.verification?.history.at(-1)?.version || 0,
  attested: true,
  passages: [
    {
      slide,
      start: 0,
      end: r.slides[slide - 1].length,
      quote: r.slides[slide - 1],
    },
  ],
});
