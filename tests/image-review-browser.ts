import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { start, stop, base, dataDirectory } from "./harness";
import { createClient } from "@libsql/client";
import path from "node:path";
import { participantImageGuide } from "./participant-images-fixture";
let browser: Browser | undefined;
try {
  await start({ port: 3173 });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const call = async (
    path: string,
    method = "GET",
    data?: any,
    headers?: any,
  ) => {
    const r = await context.request.fetch(base + "/api/" + path, {
      method,
      data,
      headers,
    });
    assert.ok(r.ok(), path + ":" + r.status());
    return r.json();
  };
  await call("auth/signup", "POST", {
    name: "Review browser",
    email: randomUUID() + "@example.test",
    password: "review-browser-test-password",
  });
  let s = (await call("studies", "POST", { title: "Review images" })).study;
  const root = "studies/" + s.id;
  s = (
    await call(root, "PUT", {
      version: s.version,
      guide: participantImageGuide(),
    })
  ).study;
  s = (await call(root + "/publish", "POST", { version: s.version })).study;
  await call(root + "/fielding", "POST", { state: "active" });
  const r = await call("public/" + s.id, "POST", { consent: true }),
    ip = "interviews/" + r.interview.id,
    headers = { "x-interview-token": r.token };
  const image = await call(
    ip + "/participant-images",
    "POST",
    await sharp({
      create: { width: 64, height: 32, channels: 3, background: "#2277bb" },
    })
      .png()
      .toBuffer(),
    {
      ...headers,
      "content-type": "image/png",
      "x-upload-id": randomUUID(),
      "x-interview-version": "0",
      "x-image-description": "Synthetic blue control",
      "x-image-consent": "yes",
    },
  );
  await call(
    ip + "/answer",
    "POST",
    {
      version: 0,
      requestId: randomUUID(),
      answer: "The sample control helped me save.",
      participantImageId: image.image.id,
    },
    headers,
  );
  await page.goto(base + "/?study=" + s.id + "&tab=responses");
  await page
    .getByRole("button", { name: "Participant 1", exact: true })
    .click();
  const panel = page.getByRole("region", {
    name: "Researcher image review",
    exact: true,
  });
  await panel.getByText("Not reviewed", { exact: true }).waitFor();
  assert.equal(await panel.getByLabel("AI question grounding").count(), 0);
  await panel
    .getByLabel("Image quality", { exact: true })
    .selectOption("unclear");
  await panel
    .getByLabel("Review notes", { exact: true })
    .fill("The label is difficult to read.");
  await panel
    .getByRole("button", { name: "Save image review", exact: true })
    .click();
  await panel.getByText("Image review saved.", { exact: true }).waitFor();
  await panel
    .getByLabel("Image quality", { exact: true })
    .selectOption("usable");
  await panel
    .getByLabel("Review notes", { exact: true })
    .fill("On enlargement the label is readable.");
  await panel
    .getByRole("button", { name: "Save image review", exact: true })
    .click();
  await panel.getByText("Saved review · revision 2", { exact: true }).waitFor();
  await panel.getByText("Correction history (2)", { exact: true }).click();
  await panel
    .getByText("Notes: The label is difficult to read.", { exact: true })
    .waitFor();
  const reviewURL = root + "/participant-images/" + image.image.id + "/review",
    current = await call(reviewURL);
  await call(reviewURL, "PUT", {
    quality: "privacy_concern",
    grounding: "not_applicable",
    notes: "Concurrent reviewer change.",
    correction: "",
    source: current.source,
    version: current.version,
  });
  await panel
    .getByLabel("Review notes", { exact: true })
    .fill("Stale unsaved edit");
  await panel
    .getByRole("button", { name: "Save image review", exact: true })
    .click();
  await panel
    .getByRole("alert")
    .filter({ hasText: "Another researcher" })
    .waitFor();
  assert.equal(
    await panel.getByLabel("Review notes", { exact: true }).inputValue(),
    "Stale unsaved edit",
  );
  page.once("dialog", (d) => d.accept());
  await panel
    .getByRole("button", { name: "Reload saved review", exact: true })
    .click();
  await panel.getByText("Saved review · revision 3", { exact: true }).waitFor();
  assert.equal(
    await panel.getByLabel("Review notes", { exact: true }).inputValue(),
    "Concurrent reviewer change.",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Participant 1", exact: true })
    .click();
  await panel.getByText("Saved review · revision 3", { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  // Seed a generated question to exercise review controls without making a model request.
  const second = await call("public/" + s.id, "POST", { consent: true });
  const secondPath = "interviews/" + second.interview.id,
    secondHeaders = { "x-interview-token": second.token };
  const secondImage = await call(
    secondPath + "/participant-images",
    "POST",
    await sharp({
      create: { width: 64, height: 32, channels: 3, background: "#2277bb" },
    })
      .png()
      .toBuffer(),
    {
      ...secondHeaders,
      "content-type": "image/png",
      "x-upload-id": randomUUID(),
      "x-interview-version": "0",
      "x-image-description": "Synthetic blue button",
      "x-image-consent": "yes",
    },
  );
  await call(
    secondPath + "/answer",
    "POST",
    {
      version: 0,
      requestId: randomUUID(),
      answer: "I used the blue button.",
      participantImageId: secondImage.image.id,
    },
    secondHeaders,
  );
  const sql = createClient({
    url: "file:" + path.join(dataDirectory(), "research.sqlite"),
  });
  try {
    const row = (
      await sql.execute({
        sql: "SELECT data FROM documents WHERE kind='interview' AND id=?",
        args: [second.interview.id],
      })
    ).rows[0];
    const i = JSON.parse(String(row.data));
    i.turns[0].imageProbe = {
      imageId: secondImage.image.id,
      status: "asked",
      model: "synthetic-fixture",
      promptVersion: "synthetic-fixture",
      permissionVersion: "synthetic-fixture",
      generatedAt: new Date().toISOString(),
      probe: "How do you use the blue button?",
      visualAnchor: "blue button",
    };
    await sql.execute({
      sql: "UPDATE documents SET data=? WHERE kind='interview' AND id=?",
      args: [JSON.stringify(i), i.id],
    });
  } finally {
    sql.close();
  }
  const detail = await call(root),
    number =
      detail.interviews.length -
      detail.interviews.findIndex((i: any) => i.id === second.interview.id);
  await page.reload();
  await page
    .getByRole("button", { name: "Participant " + number, exact: true })
    .click();
  await panel
    .getByLabel("AI question grounding", { exact: true })
    .selectOption("unsupported");
  await panel
    .getByLabel("Suggested question correction", { exact: true })
    .fill("Which button did you mean?");
  await panel
    .getByRole("button", { name: "Save image review", exact: true })
    .click();
  await panel.getByText("Saved review · revision 1", { exact: true }).waitFor();
  const final = await call(
    root + "/participant-images/" + secondImage.image.id + "/review",
  );
  assert.equal(final.history[0].grounding, "unsupported");
  assert.equal(final.history[0].correction, "Which button did you mean?");
  assert.deepEqual(errors, []);
  console.log(
    "Mobile image reviews: first judgment, correction history, concurrent-edit recovery and reload persistence passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
