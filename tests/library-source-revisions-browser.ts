import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { start, stop, base } from "./harness";
import { recordingSetup, recordingRoot } from "./library-recordings-fixture";
import { toneWav } from "./reporting-fixture";
import { sourceRevisionLabels } from "../src/lib/library-source-revisions";
import { sectionLabels } from "../src/lib/recording-sections";
let browser: Browser | undefined;
try {
  await start({ port: 3365 });
  const c = await recordingSetup(),
    sources: any[] = [];
  for (const language of ["en", "es", "fr"] as const) {
    const made = await c.create({
        language,
        title: "Synthetic revision source " + language,
      }),
      text =
        "Participant: Saving the draft preserves unfinished progress before review.";
    let r = await c.transcribe(
      await c.upload(made.recording, toneWav(5000)),
      async () => ({
        text,
        model: "marked-browser-revision-fixture",
        generatedAt: new Date().toISOString(),
      }),
    );
    r = (
      await c.owner(recordingRoot + "/" + r.id, "PUT", {
        version: r.version,
        text,
        sections: [
          {
            start: 0,
            end: text.length,
            speaker: "Participant",
            startMs: 0,
            endMs: 4000,
          },
        ],
        reviewed: true,
      })
    ).recording;
    const id = (
      await c.owner(recordingRoot + "/" + r.id + "/approve", "POST", {
        version: r.version,
        reviewed: true,
      })
    ).interviewId;
    sources.push({ language, id, text });
  }
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
  assert.ok(
    (
      await context.request.post(base + "/api/auth/login", {
        data: { email: c.email, password: "saved-library-password" },
      })
    ).ok(),
  );
  await page.goto(base);
  await page
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  for (const { language, id, text } of sources) {
    const l =
        sourceRevisionLabels[language as keyof typeof sourceRevisionLabels],
      sl = sectionLabels[language as keyof typeof sectionLabels];
    await page
      .getByRole("button", { name: "Search library", exact: true })
      .click();
    const row = page
      .locator(".library-result")
      .filter({ hasText: "Synthetic revision source " + language });
    await row.getByRole("button", { name: "View source", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: l.open, exact: true }).click();
    const editor = dialog.getByRole("region", { name: l.title, exact: true });
    await editor
      .getByLabel(l.text, { exact: true })
      .fill(
        "Participant: Corrected draft transcript for " +
          language +
          " preserves unfinished progress.",
      );
    await editor
      .getByLabel(l.reason, { exact: true })
      .fill("Correct transcript, speaker and timing");
    await editor.getByRole("button", { name: sl.create, exact: true }).click();
    await editor
      .getByLabel(sl.speaker + " 1", { exact: true })
      .fill("Participant A " + language);
    await editor.getByLabel(sl.start + " 1", { exact: true }).fill("1");
    await editor.getByLabel(sl.end + " 1", { exact: true }).fill("4.5");
    await editor.getByRole("button", { name: sl.play, exact: true }).click();
    assert.ok(
      await editor
        .locator("audio")
        .evaluate((el: any) => el.currentTime >= 0.99),
    );
    await editor.getByRole("button", { name: l.save, exact: true }).click();
    await editor.getByText(l.saved, { exact: true }).waitFor();
    assert.equal(
      (await c.owner("library/sources/" + id)).source.turns
        .map((t: any) => t.answer)
        .join(""),
      text,
    );
    assert.equal(
      await editor
        .getByRole("button", { name: l.publish, exact: true })
        .isDisabled(),
      true,
    );
    await editor
      .getByRole("checkbox", { name: l.reviewed, exact: true })
      .check();
    await editor.getByRole("button", { name: l.save, exact: true }).click();
    await editor.getByText(l.saved, { exact: true }).waitFor();
    if (language === "en") {
      const current = await c.local.get<any>(
        "interview",
        id,
        c.actor.workspaceId,
      );
      current.attributes = { revisionCheck: "source changed during review" };
      current.version++;
      await c.local.put("interview", current);
      await editor
        .getByRole("button", { name: l.refresh, exact: true })
        .click();
      await editor.getByText(l.stale, { exact: true }).waitFor();
      assert.equal(
        await editor
          .getByRole("checkbox", { name: l.reviewed, exact: true })
          .isChecked(),
        false,
      );
      assert.equal(
        await editor
          .getByRole("button", { name: l.publish, exact: true })
          .isDisabled(),
        true,
      );
      await editor
        .getByRole("checkbox", { name: l.reviewed, exact: true })
        .check();
      await editor.getByRole("button", { name: l.save, exact: true }).click();
      await editor.getByText(l.saved, { exact: true }).waitFor();
    }
    await editor.getByRole("button", { name: l.publish, exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    let source = (await c.owner("library/sources/" + id)).source;
    assert.ok(source.turns[0].answer.includes("Corrected draft"));
    assert.equal(
      source.turns[0].recordingSection.speaker,
      "Participant A " + language,
    );
    await page
      .getByRole("button", { name: "Search library", exact: true })
      .click();
    await page
      .locator(".library-result")
      .filter({ hasText: "Synthetic revision source " + language })
      .getByRole("button", { name: "View source", exact: true })
      .click();
    await dialog.getByRole("button", { name: l.open, exact: true }).click();
    await editor.getByLabel(l.text, { exact: true }).waitFor();
    await editor.getByText(l.history, { exact: true }).click();
    await editor
      .getByRole("button", { name: l.restore + " v1", exact: true })
      .click();
    await editor.getByText(l.saved, { exact: true }).waitFor();
    assert.equal(
      await editor.getByLabel(l.text, { exact: true }).inputValue(),
      text,
    );
    assert.equal(
      await editor
        .getByRole("checkbox", { name: l.reviewed, exact: true })
        .isChecked(),
      false,
    );
    assert.equal(
      await editor
        .getByRole("button", { name: l.publish, exact: true })
        .isDisabled(),
      true,
    );
    assert.ok(
      (await c.owner("library/sources/" + id)).source.turns[0].answer.includes(
        "Corrected draft",
      ),
    );
    await editor
      .getByRole("checkbox", { name: l.reviewed, exact: true })
      .check();
    await editor.getByRole("button", { name: l.save, exact: true }).click();
    await editor.getByText(l.saved, { exact: true }).waitFor();
    await editor.getByRole("button", { name: l.publish, exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    source = (await c.owner("library/sources/" + id)).source;
    assert.equal(source.turns.map((t: any) => t.answer).join(""), text);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "EN/ES/FR mobile imported-recording edits, private drafts, checked speaker timing/playback, explicit publication, current source refresh, private history and freshly reviewed restoration passed (marked transcription fixtures).",
  );
} finally {
  await browser?.close();
  await stop();
}
