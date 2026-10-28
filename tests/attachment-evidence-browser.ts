import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { start, stop, base } from "./harness";
import { participantImageGuide } from "./participant-images-fixture";
let browser: Browser | undefined;
try {
  await start({ port: 3176 });
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
  const appendix = page.getByRole("region", {
    name: "Reviewed attachment observations",
    exact: true,
  });
  await appendix
    .getByText("Researcher notes: The researcher can read the save control.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await appendix.getByRole("link").click();
  await review
    .getByText("Saved review · revision 1", { exact: true })
    .waitFor();
  assert.equal(await inclusion.isChecked(), true);
  let analysis = (await call(root + "/analysis")).analysis;
  analysis = (
    await call(root + "/analysis", "PUT", { ...analysis, reviewed: true })
  ).analysis;
  const edition = (
    await call(root + "/reporting/editions", "POST", {
      analysisId: analysis.id,
      title: "Image observations report",
    })
  ).edition;
  await page.goto(base + "/?study=" + s.id + "&tab=reporting");
  await appendix
    .getByText("Researcher notes: The researcher can read the save control.", {
      exact: true,
    })
    .waitFor();
  await appendix.getByRole("link").click();
  await review
    .getByText("Saved review · revision 1", { exact: true })
    .waitFor();
  await inclusion.uncheck();
  await review
    .getByRole("button", { name: "Save image review", exact: true })
    .click();
  await review.getByText("Image review saved.", { exact: true }).waitFor();
  assert.equal((await call(root + "/analysis")).analysis, null);
  const missing = await context.request.get(
    base + "/api/" + root + "/reporting/editions/" + edition.id,
  );
  assert.equal(missing.status(), 404);
  assert.deepEqual(errors, []);
  console.log(
    "Mobile explicit inclusion, attributed analysis/report appendices, source deep links, persisted inclusion and withdrawal invalidation passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
