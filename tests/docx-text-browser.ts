import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { sampleDOCX, participantDOCXGuide } from "./participant-docx-fixture";
import { translatedFields } from "./localization-fixture";
import { docxMime } from "../src/lib/participant-docx";
let browser: Browser | undefined;
try {
  await start({ port: 3229 });
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
  const call = async (
    path: string,
    method = "GET",
    data?: any,
    headers: Record<string, string> = {},
  ) => {
    const r = await context.request.fetch(base + "/api/" + path, {
      method,
      data,
      headers,
    });
    assert.ok(
      r.ok(),
      path + ": " + r.status() + " " + (r.ok() ? "" : await r.text()),
    );
    return r.json();
  };
  await call("auth/signup", "POST", {
    name: "DOCX passage browser reviewer",
    email: randomUUID() + "@example.test",
    password: "docx-passage-browser-password",
  });
  let s = (
    await call("studies", "POST", { title: "DOCX paragraph verification" })
  ).study;
  const root = "studies/" + s.id;
  s = (
    await call(root, "PUT", {
      version: s.version,
      guide: participantDOCXGuide(),
    })
  ).study;
  for (const language of ["es", "fr"] as const) {
    const meta = await call(root + "/localization");
    s = (
      await call(root + "/localization/guide/" + language, "PUT", {
        version: s.version,
        sourceFingerprint: meta.sourceFingerprint,
        fields: translatedFields(s.draft, language),
        reviewed: true,
      })
    ).study;
  }
  s = (await call(root + "/publish", "POST", { version: s.version })).study;
  await call(root + "/fielding", "POST", { state: "active" });
  const paragraphs = [
      "First prepared paragraph.",
      "Review 🧪 café then save. Review 🧪 café then save.",
    ],
    quote = "Review 🧪 café then save.",
    startOffset = paragraphs[1].lastIndexOf(quote),
    bytes = await sampleDOCX(
      paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join(""),
    );
  for (const [n, language] of ["en", "es", "fr"].entries()) {
    const r = await call("public/" + s.id, "POST", { consent: true, language }),
      ip = "interviews/" + r.interview.id,
      h = { "x-interview-token": r.token };
    const uploaded = await call(ip + "/participant-docx", "POST", bytes, {
      ...h,
      "content-type": docxMime,
      "x-upload-id": randomUUID(),
      "x-interview-version": "0",
      "x-docx-description": "Synthetic paragraph document " + language,
      "x-docx-consent": "yes",
    });
    await call(
      ip + "/answer",
      "POST",
      {
        version: 0,
        requestId: randomUUID(),
        answer: "Synthetic " + language + " answer",
        participantDOCXId: uploaded.docx.id,
      },
      h,
    );
    await page.goto(base + "/?study=" + s.id + "&tab=responses");
    await page
      .getByRole("button", { name: "Participant " + (n + 1), exact: true })
      .click();
    const panel = page.getByRole("region", {
        name: "DOCX text and verified passages",
        exact: true,
      }),
      attestation = panel.getByRole("checkbox", {
        name: /^I checked these passages/,
      }),
      save = panel.getByRole("button", {
        name: "Save verified DOCX passages",
        exact: true,
      }),
      text = panel.getByLabel("Prepared DOCX paragraph text", { exact: true });
    await panel
      .getByText("No DOCX passage verification saved", { exact: true })
      .waitFor();
    assert.equal(await attestation.isChecked(), false);
    assert.equal(await save.isDisabled(), true);
    await panel
      .getByLabel("Prepared DOCX paragraph", { exact: true })
      .selectOption("2");
    assert.equal(await text.inputValue(), paragraphs[1]);
    await attestation.check();
    await text.evaluate(
      (el, range) => {
        const t = el as HTMLTextAreaElement;
        t.focus();
        t.setSelectionRange(range[0], range[1]);
      },
      [startOffset, startOffset + quote.length],
    );
    await panel
      .getByRole("button", { name: "Add selected DOCX passage", exact: true })
      .click();
    assert.equal(await attestation.isChecked(), false);
    assert.equal(await save.isDisabled(), true);
    await panel
      .getByText(
        `DOCX paragraph 2 · characters ${startOffset + 1}–${startOffset + quote.length}`,
        { exact: true },
      )
      .waitFor();
    await panel
      .getByRole("button", { name: "Add selected DOCX passage", exact: true })
      .click();
    await panel
      .getByRole("alert")
      .getByText("That passage is already selected.", { exact: true })
      .waitFor();
    await attestation.check();
    await save.click();
    await panel
      .getByText("Saved DOCX verification · revision 1", { exact: true })
      .waitFor();
    assert.equal(await attestation.isChecked(), false);
    const path = root + "/participant-docx/" + uploaded.docx.id + "/text",
      first = await call(path);
    assert.deepEqual(first.verification.history[0].passages, [
      {
        paragraph: 2,
        start: startOffset,
        end: startOffset + quote.length,
        quote,
      },
    ]);
    await page.reload();
    await page
      .getByRole("button", { name: "Participant " + (n + 1), exact: true })
      .click();
    await panel
      .getByText("Saved DOCX verification · revision 1", { exact: true })
      .waitFor();
    await panel
      .getByRole("button", { name: "View cited paragraph 2", exact: true })
      .click();
    assert.equal(await text.inputValue(), paragraphs[1]);
    assert.deepEqual(
      await text.evaluate((el) => [
        (el as HTMLTextAreaElement).selectionStart,
        (el as HTMLTextAreaElement).selectionEnd,
      ]),
      [startOffset, startOffset + quote.length],
    );
    await attestation.check();
    await panel
      .getByRole("button", { name: "Remove DOCX passage 1", exact: true })
      .click();
    assert.equal(await attestation.isChecked(), false);
    await attestation.check();
    await save.click();
    await panel
      .getByText("Saved DOCX verification · revision 2", { exact: true })
      .waitFor();
    await panel
      .getByText("DOCX verification history (2)", { exact: true })
      .click();
    await panel
      .getByText(
        `DOCX paragraph 2 · characters ${startOffset + 1}–${startOffset + quote.length} · verification revision 1`,
        { exact: true },
      )
      .waitFor();
    const second = await call(path);
    await call(path, "PUT", {
      source: second.source,
      digest: second.digest,
      version: 2,
      attested: true,
      passages: first.verification.history[0].passages,
    });
    await attestation.check();
    await save.click();
    await panel.getByRole("alert").waitFor();
    await panel
      .getByRole("button", { name: "Reload DOCX verification", exact: true })
      .click();
    await panel
      .getByText("Saved DOCX verification · revision 3", { exact: true })
      .waitFor();
    assert.equal(await attestation.isChecked(), false);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    const final = await call(path);
    assert.deepEqual(
      final.verification.history[0],
      first.verification.history[0],
    );
    assert.deepEqual(final.verification.history[1].passages, []);
  }
  assert.deepEqual(errors, []);
  console.log(
    "Mobile DOCX selection/attestation reset, exact repeated Unicode paragraph citations, private revision history, cited-paragraph highlighting, reload/removal and stale-write recovery passed for EN/ES/FR responses.",
  );
} finally {
  await browser?.close();
  await stop();
}
