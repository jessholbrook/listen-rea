import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import path from "node:path";
import { start, stop, base, dataDirectory } from "./harness";
import { participantPDFGuide } from "./participant-pdfs-fixture";
import { scannedPDF } from "./pdf-ocr-fixture";
import {
  pdfOCRPermissionText,
  pdfOCRPermissionVersion,
} from "../src/lib/pdf-ocr";
let browser: Browser | undefined;
try {
  await start({ port: 3214 });
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
  page.setDefaultTimeout(30000);
  const call = async (p: string, method = "GET", data?: any, headers?: any) => {
    const r = await context.request.fetch(base + "/api/" + p, {
      method,
      data,
      headers,
    });
    assert.ok(
      r.ok(),
      p + ":" + r.status() + " " + (r.ok() ? "" : await r.text()),
    );
    return r.json();
  };
  await call("auth/signup", "POST", {
    name: "Mobile OCR reviewer",
    email: randomUUID() + "@example.test",
    password: "ocr-browser-password",
  });
  let s = (await call("studies", "POST", { title: "Scanned PDF workflow" }))
    .study;
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
    h = { "x-interview-token": r.token };
  const file = await call(
    ip + "/participant-pdfs",
    "POST",
    await scannedPDF(),
    {
      ...h,
      "content-type": "application/pdf",
      "x-upload-id": randomUUID(),
      "x-interview-version": "0",
      "x-pdf-description": "Synthetic scanned research page",
      "x-pdf-consent": "yes",
    },
  );
  await call(
    ip + "/answer",
    "POST",
    {
      version: 0,
      requestId: randomUUID(),
      answer: "Synthetic scan",
      participantPDFId: file.pdf.id,
    },
    h,
  );
  const asset = root + "/participant-pdfs/" + file.pdf.id;
  let generations = 0;
  await page.route("**/api/" + asset + "/ocr", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const input = route.request().postDataJSON();
    assert.equal(input.permission, true);
    assert.equal(input.permissionVersion, pdfOCRPermissionVersion);
    assert.equal(input.page, 2);
    generations++;
    const d = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    try {
      const row = (
          await d.execute({
            sql: "SELECT data FROM documents WHERE kind='participantPDFText' AND id=?",
            args: [file.pdf.id],
          })
        ).rows[0],
        text = JSON.parse(String(row.data));
      text.ocr = [
        {
          id: randomUUID(),
          page: 2,
          draft: "Save draft befor review.",
          model: "synthetic-browser",
          promptVersion: pdfOCRPermissionVersion,
          generatedAt: new Date().toISOString(),
          permission: {
            version: pdfOCRPermissionVersion,
            text: pdfOCRPermissionText,
            provider: "OpenAI",
            grantedAt: new Date().toISOString(),
            actor: { id: "fixture", name: "Mobile OCR reviewer" },
          },
        },
      ];
      await d.execute({
        sql: "UPDATE documents SET data=? WHERE kind='participantPDFText' AND id=?",
        args: [JSON.stringify(text), file.pdf.id],
      });
      await route.fulfill({ json: { source: text.source, text } });
    } finally {
      d.close();
    }
  });
  await page.goto(base + "/?study=" + s.id + "&tab=responses");
  await page
    .getByRole("button", { name: "Participant 1", exact: true })
    .click();
  const panel = page.getByRole("region", {
    name: "PDF text and verified passages",
    exact: true,
  });
  await panel
    .getByRole("button", { name: "Extract PDF text", exact: true })
    .click();
  await panel.getByLabel("Extracted page", { exact: true }).selectOption("2");
  const ocr = panel.getByRole("region", {
      name: "OCR for PDF page 2",
      exact: true,
    }),
    transcribe = ocr.getByRole("button", {
      name: "Transcribe this page with AI",
      exact: true,
    });
  assert.equal(await transcribe.isDisabled(), true);
  await ocr
    .getByRole("checkbox", { name: pdfOCRPermissionText, exact: true })
    .check();
  await transcribe.click();
  const correction = ocr.getByLabel("Corrected OCR text", { exact: true });
  await correction.waitFor();
  assert.equal(await correction.inputValue(), "Save draft befor review.");
  assert.equal(
    await panel.getByLabel("Extracted PDF text", { exact: true }).count(),
    0,
  );
  await ocr
    .getByRole("button", { name: "Compare OCR with PDF page 2", exact: true })
    .click();
  await panel.getByRole("img", { name: "Page 2", exact: true }).waitFor();
  await page.waitForFunction(() => {
    const c = document.querySelector(".pdf-text canvas") as HTMLCanvasElement;
    return (
      c?.width > 0 &&
      c
        .getContext("2d")!
        .getImageData(0, 0, c.width, c.height)
        .data.some((v, n) => n % 4 === 0 && v < 150)
    );
  });
  const attest = ocr.getByRole("checkbox", {
      name: /I compared this transcription/,
    }),
    save = ocr.getByRole("button", {
      name: "Save verified OCR text",
      exact: true,
    });
  assert.equal(await save.isDisabled(), true);
  await attest.check();
  await correction.fill("Save draft before review.");
  assert.equal(await attest.isChecked(), false);
  await attest.check();
  await save.click();
  await ocr.getByRole("status").waitFor();
  assert.equal(
    await panel.getByLabel("Extracted PDF text", { exact: true }).inputValue(),
    "Save draft before review.",
  );
  await ocr
    .getByText("Original OCR draft and permission", { exact: true })
    .click();
  await ocr.getByText("Save draft befor review.", { exact: true }).waitFor();
  const area = panel.getByLabel("Extracted PDF text", { exact: true });
  await area.evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(0, el.value.length);
  });
  await panel
    .getByRole("button", { name: "Add selected passage", exact: true })
    .click();
  assert.equal(
    await panel
      .getByRole("checkbox", {
        name: /Include this verified passage selection/,
      })
      .isChecked(),
    false,
  );
  await panel
    .getByRole("checkbox", { name: /I checked these passages/ })
    .check();
  await panel
    .getByRole("button", { name: "Save verified passages", exact: true })
    .click();
  await panel
    .getByText("Saved verification · revision 2", { exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole("button", { name: "Participant 1", exact: true })
    .click();
  await panel.getByLabel("Extracted page", { exact: true }).selectOption("2");
  await ocr.getByRole("status").waitFor();
  assert.equal(
    await panel.locator("blockquote").innerText(),
    "Save draft before review.",
  );
  assert.equal(generations, 1);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  await ocr.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "test-results/pdf-ocr-mobile.png",
    fullPage: true,
  });
  console.log(
    "Mobile OCR permission, private draft, page pixels, correction resets attestation, verification, immutable original, separate passage inclusion and reload passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
