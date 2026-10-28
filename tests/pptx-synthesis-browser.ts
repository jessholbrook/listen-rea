import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { participantPPTXGuide, samplePPTX } from "./participant-pptx-fixture";
import { pptxMime } from "../src/lib/participant-pptx";
import { pptxSynthesisLabels } from "../src/lib/pptx-synthesis";
import { seedPPTXSynthesis } from "./pptx-synthesis-fixture";
let browser: Browser | undefined;
try {
  await start({ port: 3295 });
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
    name: "PPTX synthesis browser reviewer",
    email: randomUUID() + "@example.test",
    password: "pptx-appendix-password",
  });
  for (const language of ["en", "es", "fr"] as const) {
    let s = (
      await call("studies", "POST", { title: "Verified PPTX " + language })
    ).study;
    const root = "studies/" + s.id,
      guide: any = participantPPTXGuide(),
      l = pptxSynthesisLabels[language];
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
    const textPath = root + "/participant-pptx/" + uploaded.pptx.id + "/text",
      prepared = await call(textPath);
    await call(textPath, "PUT", {
      source: prepared.source,
      digest: prepared.digest,
      version: 0,
      attested: true,
      includeInReports: true,
      passages: [
        {
          slide: 2,
          start: 0,
          end: prepared.slides[1].length,
          quote: prepared.slides[1],
        },
      ],
    });
    let a = (await call(root + "/analysis", "POST", { mode: "manual" }))
      .analysis;
    const draft = await seedPPTXSynthesis({ a });
    await page.goto(base + "/?study=" + s.id + "&tab=analysis");
    const controls = page.getByRole("region", {
        name: "PPTX synthesis controls",
        exact: true,
      }),
      view = page.getByRole("region", { name: l.title, exact: true }),
      checkbox = controls.getByRole("checkbox", {
        name: /I checked each interpretation/,
      });
    await view.getByText("Draft · review required", { exact: true }).waitFor();
    assert.equal(
      await controls
        .getByRole("button", { name: "Regenerate PPTX synthesis", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(await checkbox.isChecked(), false);
    await controls
      .getByLabel("PPTX synthesis finding 1 interpretation", { exact: true })
      .fill(
        "The selected excerpt instructs saving draft work before review; wider context remains unavailable.",
      );
    await checkbox.check();
    await controls
      .getByLabel("PPTX synthesis limitations", { exact: true })
      .fill(
        "Selected synthetic excerpts lack full context and independent verification.",
      );
    assert.equal(await checkbox.isChecked(), false);
    await checkbox.check();
    await controls
      .getByRole("button", { name: "Save PPTX synthesis review", exact: true })
      .click();
    await view.getByText("Reviewed", { exact: true }).waitFor();
    await view
      .getByRole("button", { name: l.citation + " 2", exact: true })
      .click();
    await view
      .locator("mark")
      .getByText("Save draft before review.", { exact: true })
      .waitFor();
    await view
      .getByText(new RegExp(l.citation + " 2 · " + l.characters + " 1–25"))
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    a = (await call(root + "/analysis")).analysis;
    assert.equal(a.pptxSynthesis.reviewed, true);
    assert.equal(a.reviewed, false);
    assert.equal(a.pptxSynthesis.model, draft.model);
    await view.getByRole("link").click();
    await page
      .getByText("Saved PPTX verification · revision 1", { exact: true })
      .waitFor();
    a = (await call(root + "/analysis", "PUT", { ...a, reviewed: true }))
      .analysis;
    let e = (
      await call(root + "/reporting/editions", "POST", {
        analysisId: a.id,
        title: "Reviewed PPTX synthesis report",
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
      const shared = await call("shared/" + token);
      assert.ok(shared.memo.includes(l.title));
      assert.ok(shared.memo.includes(draft.findings[0].title));
      assert.ok(
        shared.memo.includes(l.citation + " 2 · " + l.characters + " 1–25"),
      );
    }
    await page.goto(base + "/?study=" + s.id + "&tab=reporting");
    await view.getByText("Reviewed", { exact: true }).waitFor();
    await view
      .getByRole("button", { name: l.citation + " 2", exact: true })
      .click();
    await view
      .locator("mark")
      .getByText("Save draft before review.", { exact: true })
      .waitFor();
    assert.equal(e.sampleSize, 1);
    assert.deepEqual(a.themes, []);
    await page.goto(base + "/?study=" + s.id + "&tab=analysis");
    await controls
      .getByLabel("PPTX synthesis finding 1 title", { exact: true })
      .fill("Revised private interpretation");
    assert.equal(await checkbox.isChecked(), false);
    await controls
      .getByRole("button", { name: "Save PPTX synthesis review", exact: true })
      .click();
    await view.getByText("Draft · review required", { exact: true }).waitFor();
    for (const token of [share, memoShare])
      assert.equal(
        (await context.request.get(base + "/api/shared/" + token)).status(),
        404,
      );
    page.once("dialog", (d) => d.accept());
    await controls
      .getByRole("button", { name: "Discard PPTX synthesis", exact: true })
      .click();
    await view.waitFor({ state: "hidden" });
    const after = (await call(root + "/analysis")).analysis;
    assert.equal(after.pptxSynthesis, undefined);
    assert.equal(after.pptxEvidence.length, 1);
  }
  assert.deepEqual(errors, []);
  console.log(
    "Mobile EN/ES/FR PPTX synthesis draft/review edits, attestation reset, exact slide citations/context highlighting, provenance/source links, reviewed reports, private-edit share revocation and discard passed; generation used marked fixtures.",
  );
} finally {
  await browser?.close();
  await stop();
}
