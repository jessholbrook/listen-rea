import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { participantPPTXGuide, samplePPTX } from "./participant-pptx-fixture";
import { pptxMime } from "../src/lib/participant-pptx";
import { pptxEvidenceLabels } from "../src/lib/pptx-evidence";
let browser: Browser | undefined;
try {
  await start({ port: 3266 });
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
    name: "PPTX appendix reviewer",
    email: randomUUID() + "@example.test",
    password: "pptx-appendix-password",
  });
  for (const language of ["en", "es", "fr"] as const) {
    let s = (
      await call("studies", "POST", { title: "Verified PPTX " + language })
    ).study;
    const root = "studies/" + s.id,
      guide: any = participantPPTXGuide(),
      l = pptxEvidenceLabels[language];
    guide.localization = {
      sourceLanguage: "en",
      reportingLanguage: language,
      guidance: "",
      translations: [],
    };
    s = (await call(root, "PUT", { version: s.version, guide })).study;
    s = (await call(root + "/publish", "POST", { version: s.version })).study;
    await call(root + "/fielding", "POST", { state: "active" });
    const r = await call("public/" + s.id, "POST", { consent: true }),
      ip = "interviews/" + r.interview.id,
      headers = { "x-interview-token": r.token };
    const uploaded = await call(
      ip + "/participant-pptx",
      "POST",
      await samplePPTX(),
      {
        ...headers,
        "content-type": pptxMime,
        "x-upload-id": randomUUID(),
        "x-interview-version": "0",
        "x-pptx-description": "Synthetic private document",
        "x-pptx-consent": "yes",
      },
    );
    await call(
      ip + "/answer",
      "POST",
      {
        version: 0,
        requestId: randomUUID(),
        answer: "The document illustrates the workflow.",
        participantPPTXId: uploaded.pptx.id,
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
        name: "PPTX text and verified passages",
        exact: true,
      }),
      include = text.getByRole("checkbox", {
        name: /Include this verified PPTX selection/,
      }),
      attest = text.getByRole("checkbox", { name: /I checked these passages/ }),
      save = text.getByRole("button", {
        name: "Save verified PPTX passages",
        exact: true,
      });
    await text
      .getByText("No PPTX passage verification saved", { exact: true })
      .waitFor();
    assert.equal(await include.isChecked(), false);
    await text
      .getByLabel("Prepared PPTX slide", { exact: true })
      .selectOption("2");
    await text
      .getByLabel("Prepared PPTX slide text", { exact: true })
      .evaluate((el) => {
        const t = el as HTMLTextAreaElement;
        t.focus();
        t.setSelectionRange(0, t.value.length);
      });
    await text
      .getByRole("button", { name: "Add selected PPTX passage", exact: true })
      .click();
    await attest.check();
    await include.check();
    assert.equal(await attest.isChecked(), false);
    assert.equal(await save.isDisabled(), true);
    await attest.check();
    await save.click();
    await text
      .getByText("Saved PPTX verification · revision 1", { exact: true })
      .waitFor();
    await page.goto(base + "/?study=" + s.id + "&tab=analysis");
    await page
      .getByRole("button", { name: "Create evidence memo", exact: true })
      .click();
    const appendix = page.getByRole("region", { name: l.title, exact: true });
    await appendix
      .locator("blockquote")
      .getByText("Save draft before review.", { exact: true })
      .waitFor();
    await appendix
      .getByText(new RegExp(l.reviewer + ": PPTX appendix reviewer"))
      .waitFor();
    await appendix
      .getByText(`${l.slide} 2 · ${l.characters} 1–25`, { exact: true })
      .waitFor();
    await appendix
      .getByRole("button", {
        name: `${l.view} · ${l.slide} 2`,
        exact: true,
      })
      .click();
    await appendix
      .locator("mark")
      .getByText("Save draft before review.", { exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await appendix.getByRole("link").click();
    await text
      .getByText("Saved PPTX verification · revision 1", { exact: true })
      .waitFor();
    assert.equal(await include.isChecked(), true);
    let a = (await call(root + "/analysis")).analysis;
    a = (await call(root + "/analysis", "PUT", { ...a, reviewed: true }))
      .analysis;
    let e = (
      await call(root + "/reporting/editions", "POST", {
        analysisId: a.id,
        title: "Verified document report",
      })
    ).edition;
    e = (
      await call(root + "/reporting/editions/" + e.id, "PUT", {
        ...e,
        reviewed: true,
      })
    ).edition;
    const share = (
        await call(root + "/reporting/editions/" + e.id + "/share", "POST")
      ).token,
      memoShare = (await call(root + "/share", "POST")).token;
    for (const token of [share, memoShare]) {
      const report = await call("shared/" + token);
      assert.ok(report.memo.includes(l.title));
      assert.ok(report.memo.includes(`${l.slide} 2 · ${l.characters} 1–25`));
      assert.ok(!report.memo.includes("Synthetic PPTX research note"));
    }
    await page.goto(base + "/?study=" + s.id + "&tab=reporting");
    await appendix
      .locator("blockquote")
      .getByText("Save draft before review.", { exact: true })
      .waitFor();
    await appendix
      .getByRole("button", {
        name: `${l.view} · ${l.slide} 2`,
        exact: true,
      })
      .click();
    await appendix
      .locator("mark")
      .getByText("Save draft before review.", { exact: true })
      .waitFor();
    await appendix.getByRole("link").click();
    await text
      .getByText("Saved PPTX verification · revision 1", { exact: true })
      .waitFor();
    await attest.check();
    await include.uncheck();
    assert.equal(await attest.isChecked(), false);
    await attest.check();
    await save.click();
    await text
      .getByText("Saved PPTX verification · revision 2", { exact: true })
      .waitFor();
    await page.reload();
    await text
      .getByText("Saved PPTX verification · revision 2", { exact: true })
      .waitFor();
    assert.equal(await include.isChecked(), false);
    assert.equal((await call(root + "/analysis")).analysis, null);
    for (const token of [share, memoShare])
      assert.equal(
        (await context.request.get(base + "/api/shared/" + token)).status(),
        404,
      );
    assert.equal(
      (
        await context.request.get(
          base + "/api/" + root + "/reporting/editions/" + e.id,
        )
      ).status(),
      404,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "Mobile EN/ES/FR explicit PPTX inclusion and attestation, exact localized slide citations, private context/highlighting, source links, analysis/report appendices, persisted withdrawal and share revocation passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
