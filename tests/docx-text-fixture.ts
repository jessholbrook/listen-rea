import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import path from "node:path";
import { dataDirectory } from "./harness";
import { client } from "./image-review-fixture";
import { participantDOCXGuide, sampleDOCX } from "./participant-docx-fixture";
import { docxMime } from "../src/lib/participant-docx";
export const docxTextDB = () =>
  createClient({
    url: "file:" + path.join(dataDirectory(), "research.sqlite"),
  });
export async function docxTextSetup(submit = true) {
  const owner = await client(),
    person = await client();
  await owner("auth/signup", "POST", {
    name: "DOCX passage reviewer",
    email: randomUUID() + "@example.test",
    password: "docx-passages-password",
  });
  let s = (
    await owner("studies", "POST", { title: "Private DOCX passage study" })
  ).study;
  const root = "studies/" + s.id;
  s = (
    await owner(root, "PUT", {
      version: s.version,
      guide: participantDOCXGuide(),
    })
  ).study;
  s = (await owner(root + "/publish", "POST", { version: s.version })).study;
  await owner(root + "/fielding", "POST", { state: "active" });
  const r = await person("public/" + s.id, "POST", { consent: true }),
    ip = "interviews/" + r.interview.id,
    h = { "x-interview-token": r.token };
  const uploaded = await person(
    ip + "/participant-docx",
    "POST",
    await sampleDOCX(),
    {
      ...h,
      "content-type": docxMime,
      "x-upload-id": randomUUID(),
      "x-interview-version": "0",
      "x-docx-description": "Synthetic prepared DOCX",
      "x-docx-consent": "yes",
    },
  );
  const asset = root + "/participant-docx/" + uploaded.docx.id;
  if (submit)
    await person(
      ip + "/answer",
      "POST",
      {
        version: 0,
        requestId: randomUUID(),
        answer: "Synthetic written answer",
        participantDOCXId: uploaded.docx.id,
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
    id: uploaded.docx.id,
    textPath: asset + "/text",
  };
}
export const docxVerificationInput = (r: any, paragraph = 2) => ({
  source: r.source,
  digest: r.digest,
  version: r.verification?.history.at(-1)?.version || 0,
  attested: true,
  passages: [
    {
      paragraph,
      start: 0,
      end: r.paragraphs[paragraph - 1].length,
      quote: r.paragraphs[paragraph - 1],
    },
  ],
});
