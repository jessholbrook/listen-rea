import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { start, stop, base } from "./harness";
import { transcriptSetup } from "./library-transcript-answers-fixture";
import { answerEdit } from "./library-briefs-fixture";
import { collectionLabels } from "../src/lib/library-collections";
import { dashboardLabels } from "../src/lib/collection-review";
import { handoffLabels } from "../src/lib/collection-handoff";
import { taskLabels } from "../src/lib/collection-tasks";
let browser: Browser | undefined;
try {
  await start({ port: 3384 });
  const c = await transcriptSetup(),
    groups: any[] = [];
  for (const language of ["en", "es", "fr"] as const) {
    const collection = (
      await c.owner("library/collections", "POST", {
        requestId: randomUUID(),
        title: "Synthetic handoff " + language,
        interviewIds: c.imports.map((i) => i.interviewId),
        briefIds: [],
      })
    ).collection;
    const asked = await c.ask({ collectionId: collection.id });
    let answer = (
      await c.owner("library/answers/" + asked.result.savedAnswerId)
    ).answer;
    answer = (
      await c.owner(
        "library/answers/" + answer.id,
        "PUT",
        answerEdit(answer, { answer: "SYNTHETIC_REVIEWED_HANDOFF" }),
      )
    ).answer;
    const task = (
      await c.owner(`library/collections/${collection.id}/tasks`, "POST", {
        requestId: randomUUID(),
        title: "Synthetic handoff follow-up " + language,
        assigneeId: c.actor.id,
        dueDate: "2028-02-29",
        status: "open",
        target: { kind: "interview", id: c.imports[0].interviewId },
      })
    ).task;
    groups.push({ collection, language, answer, task });
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
  await page.getByRole("button", { name: "Collections", exact: true }).click();
  let previous = "en" as "en" | "es" | "fr";
  for (const g of groups) {
    const l = handoffLabels[g.language as "en"],
      d = dashboardLabels[g.language as "en"],
      t = taskLabels[g.language as "en"];
    await page
      .getByLabel(collectionLabels[previous].language, { exact: true })
      .selectOption(g.language);
    previous = g.language;
    await page
      .locator(`[data-collection-id="${g.collection.id}"]`)
      .getByRole("button", { name: d.open, exact: true })
      .click();
    const dashboard = page.getByRole("region", { name: d.title, exact: true }),
      panel = page.getByRole("region", { name: l.title, exact: true });
    await panel.getByLabel(l.name, { exact: true }).waitFor();
    const form = panel.getByRole("form", { name: l.title, exact: true });
    await form
      .getByLabel(l.summary, { exact: true })
      .fill("SYNTHETIC_HANDOFF_SUMMARY " + g.language);
    await form
      .getByRole("checkbox", {
        name: new RegExp(
          g.answer.original.question.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        ),
      })
      .check();
    await form
      .getByRole("checkbox", { name: new RegExp(g.task.title) })
      .check();
    await form.getByRole("button", { name: l.create, exact: true }).click();
    await panel.getByText(l.saved, { exact: true }).waitFor();
    assert.equal(
      await panel.getByRole("button", { name: l.md, exact: true }).isDisabled(),
      true,
    );
    assert.ok(
      (await panel.locator("pre").innerText()).includes(
        "SYNTHETIC_REVIEWED_HANDOFF",
      ),
    );
    await panel.getByRole("checkbox", { name: l.attest, exact: true }).check();
    await panel.getByRole("button", { name: l.approve, exact: true }).click();
    await panel.getByText(l.reviewed, { exact: true }).waitFor();
    assert.equal(
      await panel.getByRole("button", { name: l.md, exact: true }).isDisabled(),
      false,
    );
    for (const format of ["md", "csv"] as const) {
      const download = page.waitForEvent("download");
      await panel.getByRole("button", { name: l[format], exact: true }).click();
      const file = await download;
      const path = await file.path();
      assert.ok(path);
      const text = readFileSync(path!, "utf8");
      assert.ok(text.includes("SYNTHETIC_HANDOFF_SUMMARY"));
      assert.ok(text.includes(g.answer.id));
      assert.ok(text.includes(g.task.id));
      assert.ok(text.includes(g.collection.id));
      await panel
        .getByRole("button", { name: l.md, exact: true })
        .waitFor({ state: "visible" });
    }
    await panel
      .getByLabel(l.summary, { exact: true })
      .fill("SYNTHETIC_EDITED_SUMMARY " + g.language);
    assert.equal(
      await panel.getByRole("button", { name: l.md, exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await panel
        .getByRole("checkbox", { name: l.attest, exact: true })
        .isChecked(),
      false,
    );
    await panel.getByRole("button", { name: l.save, exact: true }).click();
    await panel.getByText(l.saved, { exact: true }).waitFor();
    await panel.getByRole("checkbox", { name: l.attest, exact: true }).check();
    if (g.language === "en") {
      const current = (
        await c.owner(`library/collections/${g.collection.id}/tasks`)
      ).tasks[0];
      await c.owner(
        `library/collections/${g.collection.id}/tasks/${current.id}`,
        "PUT",
        {
          version: current.version,
          title: current.title + " changed",
          assigneeId: current.assigneeId,
          dueDate: current.dueDate,
          status: current.status,
        },
      );
      await panel.getByRole("button", { name: l.approve, exact: true }).click();
      await panel.getByRole("alert").waitFor();
      assert.equal(
        await panel.getByRole("button", { name: l.md, exact: true }).count(),
        0,
      );
      await panel.getByRole("button", { name: l.refresh, exact: true }).click();
      await panel
        .getByRole("checkbox", { name: l.attest, exact: true })
        .check();
    }
    await panel.getByRole("button", { name: l.approve, exact: true }).click();
    await panel.getByText(l.reviewed, { exact: true }).waitFor();
    // Actual collection-task mutation refreshes the adjacent packet and blocks export.
    const tasks = page.getByRole("region", { name: t.title, exact: true });
    await tasks.getByRole("button", { name: t.refresh, exact: true }).click();
    await tasks
      .locator(`[data-collection-task="${g.task.id}"]`)
      .getByRole("button", { name: t.edit, exact: true })
      .click();
    const taskForm = tasks.getByRole("form", { name: t.edit, exact: true });
    await taskForm
      .getByLabel(t.status, { exact: true })
      .selectOption("completed");
    await taskForm.getByRole("button", { name: t.save, exact: true }).click();
    await tasks.getByText(t.saved, { exact: true }).waitFor();
    await panel.getByText(l.changed, { exact: true }).waitFor();
    assert.equal(
      await panel.getByRole("button", { name: l.md, exact: true }).isDisabled(),
      true,
    );
    await panel
      .getByRole("checkbox", { name: new RegExp(g.task.title) })
      .uncheck();
    await panel.getByRole("button", { name: l.save, exact: true }).click();
    await panel.getByText(l.saved, { exact: true }).waitFor();
    await panel.getByRole("checkbox", { name: l.attest, exact: true }).check();
    await panel.getByRole("button", { name: l.approve, exact: true }).click();
    await panel.getByText(l.reviewed, { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    await page.screenshot({
      path: `test-results/collection-handoff-${g.language}.png`,
      fullPage: true,
    });
    page.once("dialog", (dialog) => void dialog.accept());
    await panel.getByRole("button", { name: l.remove, exact: true }).click();
    await panel.getByText(l.deleted, { exact: true }).waitFor();
    assert.equal(
      (await c.owner(`library/collections/${g.collection.id}/handoff`)).packet,
      null,
    );
    await dashboard.getByRole("button", { name: d.close, exact: true }).click();
  }
  assert.deepEqual(errors, []);
  console.log(
    "EN/ES/FR mobile handoff drafting, current cited preview, explicit approval, real text/CSV downloads, dirty/stale approval rejection, task-change refresh, reselection, deletion and viewport layout passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
