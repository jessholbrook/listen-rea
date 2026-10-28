import { createClient } from "@libsql/client";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { start, stop, base, dataDirectory } from "./harness";
import { participantImageGuide } from "./participant-images-fixture";
let browser: Browser | undefined;
try {
  await start({ port: 3179 });
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

  await call(
    ip + "/answer",
    "POST",
    { version: 1, requestId: randomUUID(), answer: "The workflow was clear." },
    headers,
  );
  await page.goto(base + "/?study=" + s.id + "&tab=responses");
  await page
    .getByRole("button", { name: "Participant 1", exact: true })
    .click();
  const review = page.getByRole("region", {
    name: "Researcher image review",
    exact: true,
  });
  await review.getByText("Not reviewed", { exact: true }).waitFor();
  const inclusion = review.getByRole("checkbox", {
    name: "Include these researcher notes in analysis and reports",
    exact: true,
  });
  assert.equal(await inclusion.isChecked(), false);
  await review
    .getByLabel("Image quality", { exact: true })
    .selectOption("usable");
  await review
    .getByLabel("Review notes", { exact: true })
    .fill("The researcher can read the save control.");
  await inclusion.check();
  await review
    .getByRole("button", { name: "Save image review", exact: true })
    .click();
  await review.getByText("Image review saved.", { exact: true }).waitFor();

  await page.goto(base + "/?study=" + s.id + "&tab=analysis");
  await page
    .getByRole("button", { name: "Create evidence memo", exact: true })
    .click();
  const controls = page.getByRole("region", {
    name: "Observation synthesis controls",
    exact: true,
  });
  await controls.waitFor();
  assert.equal(
    await controls
      .getByRole("button", {
        name: "Synthesize observations with AI",
        exact: true,
      })
      .isDisabled(),
    true,
  );
  let a = (await call(root + "/analysis")).analysis;
  const entry = a.attachmentEvidence[0];
  const draft = {
    findings: [
      {
        title: "Readable save control",
        description: "A researcher observed a readable save control.",
        citations: [
          {
            imageId: entry.imageId,
            reviewVersion: entry.reviewVersion,
            quote: "read the save control",
          },
        ],
      },
    ],
    limitations:
      "Selected human observations are not verified participant claims.",
    model: "synthetic-browser-fixture",
    promptVersion: "synthetic-browser-fixture",
    generatedAt: new Date().toISOString(),
    reviewed: false,
  };
  const sql = createClient({
    url: "file:" + path.join(dataDirectory(), "research.sqlite"),
  });
  try {
    await sql.execute({
      sql: "UPDATE documents SET data=? WHERE kind='analysis' AND id=?",
      args: [JSON.stringify({ ...a, attachmentSynthesis: draft }), a.id],
    });
  } finally {
    sql.close();
  }
  await page.reload();
  const view = page.getByRole("region", {
    name: "Synthesis of researcher observations",
    exact: true,
  });
  await view.getByText("Draft · review required", { exact: true }).waitFor();
  const checkbox = controls.getByRole("checkbox", {
    name: "I checked each interpretation against its cited researcher notes and reviewed the limitations.",
    exact: true,
  });
  assert.equal(await checkbox.isChecked(), false);
  await controls
    .getByLabel("Synthesis finding 1 interpretation", { exact: true })
    .fill(
      "The reviewer described a readable label; this needs confirmation in a real study.",
    );
  await checkbox.check();
  await controls
    .getByRole("button", { name: "Save synthesis review", exact: true })
    .click();
  await view.getByText("Reviewed", { exact: true }).waitFor();
  a = (await call(root + "/analysis")).analysis;
  assert.equal(a.attachmentSynthesis.reviewed, true);
  assert.equal(a.reviewed, false);
  await view.getByRole("link").first().click();
  await review
    .getByText("Saved review · revision 1", { exact: true })
    .waitFor();
  await page.goto(base + "/?study=" + s.id + "&tab=analysis");
  await view.getByText("Reviewed", { exact: true }).waitFor();

  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  page.once("dialog", (d) => d.accept());
  await controls
    .getByRole("button", { name: "Discard observation synthesis", exact: true })
    .click();
  await view.waitFor({ state: "hidden" });
  await page
    .getByRole("region", {
      name: "Reviewed attachment observations",
      exact: true,
    })
    .waitFor();
  assert.equal(
    (await call(root + "/analysis")).analysis.attachmentSynthesis,
    undefined,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Mobile seeded synthesis draft, disabled missing-key generation, exact-note review edits, saved attribution, source links and discard passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
