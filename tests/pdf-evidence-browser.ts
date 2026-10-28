import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { participantPDFGuide, samplePDF } from "./participant-pdfs-fixture";
let browser: Browser | undefined;
try {
  await start({ port: 3190 });
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
    assert.ok(
      r.ok(),
      path + ":" + r.status() + " " + (r.ok() ? "" : await r.text()),
    );
    return r.json();
  };
  await call("auth/signup", "POST", {
    name: "PDF appendix reviewer",
    email: randomUUID() + "@example.test",
    password: "pdf-appendix-test-password",
  });
  let s = (
    await call("studies", "POST", { title: "Verified document feedback" })
  ).study;
  const root = "studies/" + s.id;
  s = (
    await call(root, "PUT", {
      version: s.version,
      guide: participantPDFGuide(),
    })
  ).study;
  s = (await call(root + "/publish", "POST", { version: s.version })).study;
  await call(root + "/fielding", "POST", { state: "active" });
  const r = await call("public/" + s.id, "POST", { consent: true }),
    ip = "interviews/" + r.interview.id,
    headers = { "x-interview-token": r.token };
  const saved = await call(
    ip + "/participant-pdfs",
    "POST",
    await samplePDF(2),
    {
      ...headers,
      "content-type": "application/pdf",
      "x-upload-id": randomUUID(),
      "x-interview-version": "0",
      "x-pdf-description": "Synthetic two-page evidence PDF",
      "x-pdf-consent": "yes",
    },
  );
  await call(
    ip + "/answer",
    "POST",
    {
      version: 0,
      requestId: randomUUID(),
      answer: "The document illustrates the workflow.",
      participantPDFId: saved.pdf.id,
    },
    headers,
  );
  await call(
    ip + "/answer",
    "POST",
    {
      version: 1,
      requestId: randomUUID(),
      answer: "That is all for this synthetic study.",
    },
    headers,
  );
  await page.goto(base + "/?study=" + s.id + "&tab=responses");
  await page
    .getByRole("button", { name: "Participant 1", exact: true })
    .click();
  const text = page.getByRole("region", {
      name: "PDF text and verified passages",
      exact: true,
    }),
    include = text.getByRole("checkbox", {
      name: /Include this verified passage selection/,
    }),
    attest = text.getByRole("checkbox", { name: /I checked these passages/ });
  await text
    .getByRole("button", { name: "Extract PDF text", exact: true })
    .click();
  assert.equal(await include.isChecked(), false);
  await text.getByLabel("Extracted page", { exact: true }).selectOption("2");
  await text
    .getByLabel("Extracted PDF text", { exact: true })
    .evaluate((el: HTMLTextAreaElement) => {
      el.focus();
      el.setSelectionRange(0, el.value.length);
    });
  await text
    .getByRole("button", { name: "Add selected passage", exact: true })
    .click();
  await include.check();
  assert.equal(await attest.isChecked(), false);
  await attest.check();
  await text
    .getByRole("button", { name: "Save verified passages", exact: true })
    .click();
  await text
    .getByText("Saved verification · revision 1", { exact: true })
    .waitFor();
  await page.goto(base + "/?study=" + s.id + "&tab=analysis");
  await page
    .getByRole("button", { name: "Create evidence memo", exact: true })
    .click();
  const appendix = page.getByRole("region", {
    name: "Verified PDF passages",
    exact: true,
  });
  await appendix
    .locator("blockquote")
    .getByText("Synthetic research PDF page 2", { exact: true })
    .waitFor();
  await appendix.getByText(/Verified by: PDF appendix reviewer/).waitFor();
  await appendix
    .getByRole("button", { name: "PDF page 2", exact: true })
    .click();
  await appendix.getByRole("img", { name: "Page 2", exact: true }).waitFor();
  await page.waitForFunction(() => {
    const c = document.querySelector(
      ".pdf-evidence canvas",
    ) as HTMLCanvasElement;
    return (
      c?.width > 0 &&
      c
        .getContext("2d")!
        .getImageData(0, 0, c.width, c.height)
        .data.some((v, n) => n % 4 === 0 && v < 200)
    );
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await appendix.getByRole("link").click();
  await text
    .getByText("Saved verification · revision 1", { exact: true })
    .waitFor();
  assert.equal(await include.isChecked(), true);
  let a = (await call(root + "/analysis")).analysis;
  a = (await call(root + "/analysis", "PUT", { ...a, reviewed: true }))
    .analysis;
  const e = (
    await call(root + "/reporting/editions", "POST", {
      analysisId: a.id,
      title: "Verified document report",
    })
  ).edition;
  await page.goto(base + "/?study=" + s.id + "&tab=reporting");
  await appendix
    .locator("blockquote")
    .getByText("Synthetic research PDF page 2", { exact: true })
    .waitFor();
  await appendix.getByRole("link").click();
  await text
    .getByText("Saved verification · revision 1", { exact: true })
    .waitFor();
  await include.uncheck();
  await attest.check();
  await text
    .getByRole("button", { name: "Save verified passages", exact: true })
    .click();
  await text
    .getByText("Saved verification · revision 2", { exact: true })
    .waitFor();
  assert.equal((await call(root + "/analysis")).analysis, null);
  assert.equal(
    (
      await context.request.get(
        base + "/api/" + root + "/reporting/editions/" + e.id,
      )
    ).status(),
    404,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Mobile explicit PDF inclusion, page-cited attributed analysis/report appendices, actual cited-page pixels, source links, persisted inclusion and withdrawal invalidation passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
