import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { client } from "./image-review-fixture";
import { participantPPTXGuide, samplePPTX } from "./participant-pptx-fixture";
import { participantDOCXGuide, sampleDOCX } from "./participant-docx-fixture";
import { participantPDFGuide, samplePDF } from "./participant-pdfs-fixture";
import { participantImageGuide } from "./participant-images-fixture";
import { pptxMime } from "../src/lib/participant-pptx";
import { docxMime } from "../src/lib/participant-docx";
export async function libraryAttachmentFixture(
  owner: Awaited<ReturnType<typeof client>>,
  format: "pptx" | "docx" | "pdf" | "image",
  complete = true,
) {
  let s = (
    await owner("studies", "POST", {
      title: format.toUpperCase() + " draft workflow",
    })
  ).study;
  const root = "studies/" + s.id,
    person = await client();
  const guides = {
    pptx: participantPPTXGuide,
    docx: participantDOCXGuide,
    pdf: participantPDFGuide,
    image: participantImageGuide,
  };
  s = (
    await owner(root, "PUT", { version: s.version, guide: guides[format]() })
  ).study;
  s = (await owner(root + "/publish", "POST", { version: s.version })).study;
  await owner(root + "/fielding", "POST", { state: "active" });
  const r = await person("public/" + s.id, "POST", { consent: true }),
    ip = "interviews/" + r.interview.id,
    h = { "x-interview-token": r.token };
  const routes = {
    pptx: "participant-pptx",
    docx: "participant-docx",
    pdf: "participant-pdfs",
    image: "participant-images",
  };
  const singular = { pptx: "pptx", docx: "docx", pdf: "pdf", image: "image" };
  const bytes =
    format === "pptx"
      ? await samplePPTX()
      : format === "docx"
        ? await sampleDOCX()
        : format === "pdf"
          ? await samplePDF(2, true)
          : await sharp({
              create: {
                width: 64,
                height: 32,
                channels: 3,
                background: "#2277bb",
              },
            })
              .png()
              .toBuffer();
  const uploaded = await person(ip + "/" + routes[format], "POST", bytes, {
    ...h,
    "content-type":
      format === "pptx"
        ? pptxMime
        : format === "docx"
          ? docxMime
          : format === "pdf"
            ? "application/pdf"
            : "image/png",
    "x-upload-id": randomUUID(),
    "x-interview-version": "0",
    ["x-" + format + "-description"]: "Synthetic draft workflow",
    ["x-" + format + "-consent"]: "yes",
  });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded));
  const id = uploaded[singular[format]].id,
    asset = root + "/" + routes[format] + "/" + id;
  const attachKey = {
    pptx: "participantPPTXId",
    docx: "participantDOCXId",
    pdf: "participantPDFId",
    image: "participantImageId",
  };
  await person(
    ip + "/answer",
    "POST",
    {
      version: 0,
      requestId: randomUUID(),
      answer: "PRIVATE_PARTICIPANT_ANSWER",
      [attachKey[format]]: id,
    },
    h,
  );
  if (complete) {
    const done = await person(
      ip + "/answer",
      "POST",
      { version: 1, requestId: randomUUID(), answer: "PRIVATE_SECOND_ANSWER" },
      h,
    );
    assert.equal(done.status, 200, JSON.stringify(done));
  }
  let verification: any;
  if (format !== "image") {
    let text = await owner(
      asset + "/text",
      format === "pdf" ? "POST" : "GET",
      format === "pdf" ? {} : undefined,
    );
    assert.equal(text.status, 200, JSON.stringify(text));
    const view = format === "pdf" ? text.text : text,
      values =
        format === "pptx"
          ? view.slides
          : format === "docx"
            ? view.paragraphs
            : view.pages;
    const unit =
      format === "pptx" ? "slide" : format === "docx" ? "paragraph" : "page";
    verification = {
      source: text.source,
      digest: view.digest,
      version: 0,
      attested: true,
      includeInReports: true,
      passages: [
        { [unit]: 2, start: 0, end: values[1].length, quote: values[1] },
      ],
    };
    const saved = await owner(asset + "/text", "PUT", verification);
    assert.equal(saved.status, 200, JSON.stringify(saved));
  }
  const reviewView = await owner(asset + "/review");
  const review = {
    source: reviewView.source,
    ...(format !== "image" ? { probeSource: reviewView.probeSource } : {}),
    version: 0,
    quality: "usable",
    grounding: "not_applicable",
    notes: "Draft workflow researcher observation for " + format,
    correction: "",
    includeInReports: true,
  };
  const saved = await owner(asset + "/review", "PUT", review);
  assert.equal(saved.status, 200, JSON.stringify(saved));
  return { owner, person, s, root, r, ip, h, asset, id, review, verification };
}
