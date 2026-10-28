import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { start, stop, base } from "./harness";
import { translatedFields } from "./localization-fixture";
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
      name: "Localization Browser",
      email: "locale-browser@example.test",
      password: "locale-browser-password",
    },
  });
  let study = (
    await (
      await context.request.post(base + "/api/studies", {
        data: { title: "From feedback to decisions" },
      })
    ).json()
  ).study;
  study.draft.questions = [
    {
      ...study.draft.questions[1],
      id: "recent",
      text: "Tell me about your recent research.",
      followUps: 0,
    },
  ];
  study = (
    await (
      await context.request.put(base + `/api/studies/${study.id}`, {
        data: { guide: study.draft, version: study.version },
      })
    ).json()
  ).study;
  await page.goto(base + `/?study=${study.id}&tab=languages`);
  await page
    .getByRole("heading", {
      name: "Interview and reporting languages",
      exact: true,
    })
    .waitFor();
  await page
    .getByLabel("Reporting language", { exact: true })
    .selectOption("fr");
  await page
    .getByLabel("Translation guidance", { exact: true })
    .fill("Preserve product names.");
  await page
    .getByRole("button", { name: "Save language settings", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Language settings saved" })
    .waitFor();
  let meta = await (
    await context.request.get(base + `/api/studies/${study.id}/localization`)
  ).json();
  study = (
    await (await context.request.get(base + `/api/studies/${study.id}`)).json()
  ).study;
  const fields = translatedFields(study.draft, "es");
  for (const [n, f] of meta.fields.entries())
    await page
      .getByLabel(`Translation ${n + 1}: ${f.label}`, { exact: true })
      .fill(fields.find((x) => x.key === f.key)!.text);
  await page
    .getByRole("button", { name: "Save guide translation", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Guide translation saved" })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Preview saved language", exact: true })
      .isEnabled(),
    false,
  );
  await page
    .getByLabel(
      "I reviewed the meaning, neutral wording, terminology and all translated fields.",
      { exact: true },
    )
    .check();
  await page
    .getByRole("button", { name: "Save guide translation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Preview saved language", exact: true })
    .waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Preview saved language",
    );
    return b && !b.disabled;
  });
  meta = await (
    await context.request.get(base + `/api/studies/${study.id}/localization`)
  ).json();
  study = (
    await (await context.request.get(base + `/api/studies/${study.id}`)).json()
  ).study;
  study = (
    await (
      await context.request.put(
        base + `/api/studies/${study.id}/localization/guide/fr`,
        {
          data: {
            version: study.version,
            sourceFingerprint: meta.sourceFingerprint,
            fields: translatedFields(study.draft, "fr"),
            reviewed: true,
          },
        },
      )
    ).json()
  ).study;
  study = (
    await (
      await context.request.post(base + `/api/studies/${study.id}/publish`, {
        data: { version: study.version },
      })
    ).json()
  ).study;
  await context.request.post(base + `/api/studies/${study.id}/fielding`, {
    data: { state: "active" },
  });
  const es = await browser.newContext({
      locale: "es-ES",
      viewport: { width: 390, height: 844 },
    }),
    participant = await es.newPage();
  participant.on("pageerror", (e) => errors.push(e.message));
  await participant.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        cancel() {},
        speak(s: { lang: string }) {
          (window as any).__spokenLanguage = s.lang;
        },
      },
    });
    (window as any).SpeechSynthesisUtterance = function (
      this: any,
      text: string,
    ) {
      this.text = text;
    };
  });
  await participant.goto(base + `/s/${study.id}`);
  await participant
    .getByRole("heading", { name: "De comentarios a decisiones", exact: true })
    .waitFor();
  await participant.getByRole("checkbox").check();
  await participant.getByRole("combobox").selectOption("fr");
  assert.equal(await participant.getByRole("checkbox").isChecked(), false);
  await participant.getByRole("combobox").selectOption("es");
  await participant.getByRole("checkbox").check();
  await participant
    .getByRole("button", { name: "Empezar", exact: true })
    .click();
  await participant
    .getByRole("heading", {
      name: "Cuéntame sobre tu investigación reciente.",
      exact: true,
    })
    .waitFor();
  await participant
    .getByRole("button", { name: "Leer pregunta en voz alta", exact: true })
    .click();
  assert.equal(
    await participant.evaluate(() => (window as any).__spokenLanguage),
    "es",
  );
  await participant
    .getByRole("button", { name: "Parar lectura", exact: true })
    .click();
  await participant
    .getByLabel("Tu respuesta", { exact: true })
    .fill("Revisé las notas antes de decidir.");
  await participant
    .getByRole("button", { name: "Continuar", exact: true })
    .click();
  await participant
    .getByRole("heading", {
      name: "Tu perspectiva marca la diferencia.",
      exact: true,
    })
    .waitFor();
  const fr = await browser.newContext({ locale: "fr-FR" }),
    french = await fr.newPage();
  await french.goto(base + `/s/${study.id}`);
  await french.getByRole("checkbox").check();
  await french.getByRole("button", { name: "Commençons", exact: true }).click();
  await french
    .getByRole("heading", {
      name: "Parlez-moi de votre dernière recherche.",
      exact: true,
    })
    .waitFor();
  await french
    .getByRole("button", { name: "Lire la question à voix haute", exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole("heading", {
      name: "Original responses and translations",
      exact: true,
    })
    .waitFor();
  await page
    .getByLabel("Response translation language", { exact: true })
    .selectOption("en");
  await page
    .getByText("Revisé las notas antes de decidir.", { exact: true })
    .waitFor();
  await page
    .getByLabel("Translated response", { exact: true })
    .fill("I reviewed the notes before deciding.");
  await page
    .getByLabel(
      "I reviewed this translation against the original, including speaker labels and uncertainty.",
      { exact: true },
    )
    .check();
  await page
    .getByRole("button", { name: "Save response translation", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Response translation saved separately" })
    .waitFor();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("link", {
      name: "Export reviewed translations CSV",
      exact: true,
    })
    .click();
  const download = await downloadPromise,
    text = readFileSync((await download.path())!, "utf8");
  assert.ok(text.includes("Revisé las notas"));
  assert.ok(text.includes("I reviewed the notes"));
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/localization-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/localization-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await participant.screenshot({
    path: "test-results/localization-participant-es.png",
    fullPage: true,
  });
  await french.screenshot({
    path: "test-results/localization-participant-fr.png",
    fullPage: true,
  });
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "Localization browser passed: reviewed guide versions, Spanish/French consent and interviews, locale switching, frozen source text, read-aloud language, bilingual export and mobile layout.",
  );
} catch (e) {
  if (debug) {
    mkdirSync("test-results", { recursive: true });
    await debug
      .screenshot({
        path: "test-results/localization-failure.png",
        fullPage: true,
      })
      .catch(() => {});
  }
  throw e;
} finally {
  await browser?.close();
  await stop();
}
