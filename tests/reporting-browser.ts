import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { start, stop, base } from "./harness";
import { toneWav } from "./reporting-fixture";
import JSZip from "jszip";
let browser: Browser | undefined, debug: Page | undefined;
try {
  await start();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
    }),
    page = await context.newPage(),
    errors: string[] = [];
  debug = page;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await context.request.post(base + "/api/auth/signup", {
    data: {
      name: "Reporting Browser",
      email: "report-browser@example.test",
      password: "report-browser-password",
    },
  });
  let s = (
    await (
      await context.request.post(base + "/api/studies", {
        data: { title: "Reporting browser study" },
      })
    ).json()
  ).study;
  s.draft.questions = [{ ...s.draft.questions[1], followUps: 0 }];
  s = (
    await (
      await context.request.put(base + `/api/studies/${s.id}`, {
        data: { guide: s.draft, version: s.version },
      })
    ).json()
  ).study;
  s = (
    await (
      await context.request.post(base + `/api/studies/${s.id}/publish`, {
        data: { version: s.version },
      })
    ).json()
  ).study;
  await context.request.post(base + `/api/studies/${s.id}/fielding`, {
    data: { state: "active" },
  });
  const person = await browser.newContext(),
    r = await (
      await person.request.post(base + `/api/public/${s.id}`, {
        data: { consent: true },
      })
    ).json(),
    id = randomUUID(),
    headers = { "x-interview-token": r.token };
  await person.request.post(
    base + `/api/interviews/${r.interview.id}/recording`,
    {
      headers: {
        ...headers,
        "content-type": "audio/wav",
        "x-recording-consent": "yes",
        "x-recording-id": id,
        "x-recording-duration": "3000",
      },
      data: toneWav(),
    },
  );
  const answer = "We keep the original evidence close to each decision.";
  const completed = await (
    await person.request.post(
      base + `/api/interviews/${r.interview.id}/answer`,
      {
        headers,
        data: {
          requestId: randomUUID(),
          version: 0,
          answer,
          audioId: id,
          durationMs: 3000,
        },
      },
    )
  ).json();
  let a = (
    await (
      await context.request.post(base + `/api/studies/${s.id}/analysis`, {
        data: { mode: "manual" },
      })
    ).json()
  ).analysis;
  a = (
    await (
      await context.request.put(base + `/api/studies/${s.id}/analysis`, {
        data: {
          ...a,
          summary: "Tentative finding from a synthetic response.",
          themes: [
            {
              id: "theme",
              title: "Keep evidence close",
              description:
                "This participant connects decisions to original evidence.",
              citations: [
                {
                  interviewId: r.interview.id,
                  turnId: completed.interview.turns[0].id,
                  quote: answer,
                },
              ],
            },
          ],
          reviewed: true,
        },
      })
    ).json()
  ).analysis;
  await page.goto(base + `/?study=${s.id}&tab=reporting`);
  await page
    .getByRole("heading", { name: "Reports & media", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Presentation styles", exact: true })
    .click();
  await page.getByLabel("Style name", { exact: true }).fill("Team deck");
  await page.getByLabel("Brand name", { exact: true }).fill("Research Team");
  await page
    .getByLabel("Slide footer", { exact: true })
    .fill("Internal research only");
  await page
    .getByRole("button", { name: "Save presentation style", exact: true })
    .click();
  await page.getByText("Presentation style saved.", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Report editions", exact: true })
    .click();
  await page
    .getByLabel("Edition title", { exact: true })
    .fill("Executive readout");
  await page
    .getByLabel("Presentation style", { exact: true })
    .selectOption({ label: "Team deck" });
  await page
    .getByRole("button", { name: "Create report edition", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Edit report edition", exact: true })
    .waitFor();
  await page
    .getByRole("textbox", { name: "Block 1 text", exact: true })
    .fill("A revised and carefully qualified interpretation.");
  await page
    .getByLabel(
      "I reviewed this edition’s interpretation, visible blocks and source citations.",
    )
    .check();
  await page.getByRole("button", { name: "Save edition", exact: true }).click();
  await page
    .getByText("Edition saved as a new version.", { exact: true })
    .waitFor();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Export editable PowerPoint", exact: true })
    .click();
  const download = await downloadPromise;
  const path = await download.path();
  assert.ok(path);
  const zip = await JSZip.loadAsync(readFileSync(path!));
  const text = (
    await Promise.all(
      Object.entries(zip.files)
        .filter(([n]) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .map(([, f]) => f.async("string")),
    )
  ).join("\n");
  assert.ok(text.includes(answer));
  assert.ok(text.includes("Research Team"));
  await page
    .getByRole("button", { name: "Share reviewed edition", exact: true })
    .click();
  await page.getByLabel("View-only share link", { exact: true }).waitFor();
  const link = await page
    .getByLabel("View-only share link", { exact: true })
    .inputValue();
  const shared = await person.newPage();
  await shared.goto(link);
  await shared
    .getByRole("heading", { name: "Executive readout", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Edition history", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Edition history" })
    .getByRole("button", { name: "Restore this version", exact: true })
    .last()
    .click();
  await page
    .getByText("Edition restored as a new version; review required.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page
      .getByRole("link", { name: "Export editable PowerPoint", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "Clips & reels", exact: true })
    .click();
  await page.getByLabel("Clip name", { exact: true }).fill("Evidence clip");
  await page.getByLabel("Start (seconds)", { exact: true }).fill("0.2");
  await page.getByLabel("End (seconds)", { exact: true }).fill("1.2");
  await page
    .getByRole("textbox", { name: "Researcher caption", exact: true })
    .fill("Keep the source close");
  await page
    .getByLabel(
      "I checked the selected media range, evidence quote and caption.",
    )
    .check();
  await page.getByRole("button", { name: "Save clip", exact: true }).click();
  await page.getByText("Clip saved.", { exact: true }).waitFor();
  await page
    .getByLabel("Reel name", { exact: true })
    .fill("Evidence highlight");
  await page
    .getByLabel("Add reviewed clip", { exact: true })
    .selectOption({ label: "Evidence clip" });
  await page
    .getByLabel("I reviewed this reel’s clip selection, order and context.")
    .check();
  await page.getByRole("button", { name: "Save reel", exact: true }).click();
  await page.getByText("Reel saved.", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Create render job", exact: true })
    .click();
  await page.getByRole("button", { name: "Render now", exact: true }).click();
  await page
    .getByText("Render completed.", { exact: true })
    .waitFor({ timeout: 60000 });
  await page
    .getByRole("button", { name: "Share reviewed reel", exact: true })
    .click();
  await page.getByLabel("View-only share link", { exact: true }).waitFor();
  const reelLink = await page
    .getByLabel("View-only share link", { exact: true })
    .inputValue();
  await shared.goto(reelLink);
  await shared
    .getByRole("heading", { name: "Evidence highlight", exact: true })
    .waitFor();
  await shared.locator("video").evaluate(async (v: HTMLVideoElement) => {
    await v.play();
  });
  await shared.waitForTimeout(200);
  assert.ok(
    await shared
      .locator("video")
      .evaluate((v: HTMLVideoElement) => v.currentTime > 0),
  );
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/reporting-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/reporting-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page
    .getByRole("button", { name: "Revoke all study share links", exact: true })
    .click();
  await page
    .getByText("All study share links revoked.", { exact: true })
    .waitFor();
  await shared.reload();
  await shared.getByText(/unavailable|expired|changed/i).waitFor();
  assert.deepEqual(errors, []);
  assert.equal(
    (
      await (
        await context.request.get(base + `/api/studies/${s.id}/analysis`)
      ).json()
    ).analysis.memo,
    a.memo,
  );
  console.log(
    "Reporting browser passed: copied styles, edition edit/review/history, editable deck citations, clips, reviewed reels, real MP4 rendering, sharing/revocation and mobile layout. Media is synthetic.",
  );
} catch (e) {
  mkdirSync("test-results", { recursive: true });
  await debug?.screenshot({
    path: "test-results/reporting-failure.png",
    fullPage: true,
  });
  console.error((await debug?.locator("body").innerText())?.slice(-6500));
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop();
}
