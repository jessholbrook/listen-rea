import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { inboxSetup } from "./team-review-inbox-fixture";
import { triageLabels } from "../src/lib/operations-triage";
import { actionLabels } from "../src/lib/research-action-center";
let browser: Browser | undefined;
try {
  await start({ port: 3409 });
  const c = await inboxSetup(),
    groups: any[] = [];
  async function task(g: any, title: string) {
    const r = await c.owner(
      `library/collections/${g.collection.id}/tasks`,
      "POST",
      {
        requestId: randomUUID(),
        title,
        assigneeId: c.actor.id,
        dueDate: "2028-02-27",
        status: "open",
        target: { kind: "interview", id: c.imports[0].interviewId },
      },
    );
    assert.equal(r.status, 201);
    return r.task;
  }
  const read = async (t: any) =>
    (await c.owner(`library/collections/${t.collectionId}/tasks`)).tasks.find(
      (r: any) => r.id === t.id,
    );
  const edit = async (t: any, extra: any) =>
    c.owner(`library/collections/${t.collectionId}/tasks/${t.id}`, "PUT", {
      version: t.version,
      title: t.title,
      status: t.status,
      assigneeId: t.assigneeId,
      dueDate: t.dueDate,
      ...extra,
    });
  for (const language of ["en", "es", "fr"] as const) {
    const g: any = await c.create("Triage browser " + language);
    g.tasks = [
      await task(g, "Triage first " + language),
      await task(g, "Triage second " + language),
    ];
    groups.push({ ...g, language });
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      timezoneId: "America/Los_Angeles",
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
  async function open(g: any) {
    const language = g.language as "en",
      l = triageLabels[language],
      al = actionLabels[language];
    await page.goto(base);
    await page
      .getByRole("button", { name: "Research library", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Action center", exact: true })
      .click();
    if (language !== "en")
      await page
        .getByLabel(actionLabels.en.language, { exact: true })
        .selectOption(language);
    const panel = page.getByRole("region", { name: al.title, exact: true });
    await panel
      .getByLabel(al.collection, { exact: true })
      .selectOption(g.collection.id);
    await panel.getByRole("button", { name: l.title, exact: true }).click();
    return {
      panel,
      triage: panel.getByRole("region", { name: l.title, exact: true }),
      l,
      al,
    };
  }
  async function select(triage: any, t: any) {
    await triage
      .locator(`[data-triage-task="${t.id}"]`)
      .getByRole("checkbox")
      .check();
  }
  async function settings(triage: any, l: any) {
    await triage.getByLabel(l.assignee, { exact: true }).selectOption("set");
    await triage
      .getByLabel(l.member, { exact: true })
      .selectOption(c.person.id);
    await triage.getByLabel(l.due, { exact: true }).selectOption("set");
    await triage.getByLabel(l.date, { exact: true }).fill("2028-02-29");
  }
  for (const g of groups) {
    let { panel, triage, l, al } = await open(g);
    await select(triage, g.tasks[0]);
    await select(triage, g.tasks[1]);
    await page.waitForFunction(
      (label) =>
        (
          document.querySelector(
            `select[aria-label="${label}"]`,
          ) as HTMLSelectElement
        )?.disabled,
      al.language,
    );
    await panel.getByLabel(al.query, { exact: true }).fill("not a task");
    await triage
      .getByText(`${l.selected}: 2/25 · ${l.hidden}: 2`, { exact: true })
      .waitFor();
    await panel.getByLabel(al.query, { exact: true }).fill("");
    await settings(triage, l);
    await triage.getByRole("button", { name: l.preview, exact: true }).click();
    await triage.getByText(l.ready, { exact: true }).first().waitFor();
    assert.equal(
      await panel.getByLabel(al.collection, { exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await triage
        .getByRole("button", { name: l.apply, exact: true })
        .isDisabled(),
      true,
    );
    await triage.getByText(l.reviewWarning, { exact: true }).waitFor();
    await triage.screenshot({
      path: `test-results/triage-preview-${g.language}.png`,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await triage.getByRole("button", { name: l.cancel, exact: true }).click();
    await panel.locator(`[data-action-task="${g.tasks[0].id}"]`).waitFor();
    assert.deepEqual(await read(g.tasks[0]), g.tasks[0]);
    ({ panel, triage, l, al } = await open(g));
    for (const t of g.tasks) await select(triage, t);
    await settings(triage, l);
    await triage.getByRole("button", { name: l.preview, exact: true }).click();
    await triage.getByText(l.ready, { exact: true }).first().waitFor();
    const concurrent = await edit(g.tasks[1], { dueDate: "2028-03-10" });
    assert.equal(concurrent.status, 200);
    await triage.getByLabel(l.ack, { exact: true }).check();
    await triage.getByRole("button", { name: l.apply, exact: true }).click();
    await triage
      .getByRole("heading", { name: l.results, exact: true })
      .waitFor();
    await triage
      .locator(`[data-triage-result="${g.tasks[0].id}"]`)
      .getByText(l.applied, { exact: true })
      .waitFor();
    await triage
      .locator(`[data-triage-result="${g.tasks[1].id}"]`)
      .getByText(l.conflict, { exact: true })
      .waitFor();
    assert.equal((await read(g.tasks[0])).dueDate, "2028-02-29");
    assert.equal((await read(g.tasks[1])).dueDate, "2028-03-10");
    await triage.getByRole("button", { name: l.finish, exact: true }).click();
    await panel.locator(`[data-action-task="${g.tasks[0].id}"]`).waitFor();
    ({ panel, triage, l, al } = await open(g));
    await select(triage, g.tasks[0]);
    await triage.getByLabel(l.assignee, { exact: true }).selectOption("clear");
    await triage.getByLabel(l.due, { exact: true }).selectOption("clear");
    await triage.getByRole("button", { name: l.preview, exact: true }).click();
    await triage.getByText(l.ready, { exact: true }).waitFor();
    await triage.getByLabel(l.ack, { exact: true }).check();
    await triage.getByRole("button", { name: l.apply, exact: true }).click();
    await triage
      .getByRole("heading", { name: l.results, exact: true })
      .waitFor();
    const cleared = await read(g.tasks[0]);
    assert.equal(cleared.assigneeId, null);
    assert.equal(cleared.dueDate, null);
    await triage.getByRole("button", { name: l.finish, exact: true }).click();
  }
  // Selections span pages, remain explicit across filters, and stop at 25.
  const cap: any = await c.create("Triage selection limit");
  cap.language = "en";
  cap.tasks = [];
  for (let n = 0; n < 26; n++)
    cap.tasks.push(await task(cap, "Capacity " + String(n).padStart(2, "0")));
  let { panel, triage, l, al } = await open(cap);
  for (const t of cap.tasks.slice(0, 20)) await select(triage, t);
  await triage.getByRole("button", { name: al.next, exact: true }).click();
  for (const t of cap.tasks.slice(20, 25)) await select(triage, t);
  assert.equal(
    await triage
      .locator(`[data-triage-task="${cap.tasks[25].id}"]`)
      .getByRole("checkbox")
      .isDisabled(),
    true,
  );
  await panel.getByLabel(al.query, { exact: true }).fill("absent task");
  await triage
    .getByText(`${l.selected}: 25/25 · ${l.hidden}: 25`, { exact: true })
    .waitFor();
  await triage.getByRole("button", { name: l.clear, exact: true }).click();
  await triage.getByRole("button", { name: l.close, exact: true }).click();
  // Drop the response after the server actually commits; the client must not retry.
  const g = groups[0];
  ({ panel, triage, l, al } = await open(g));
  await select(triage, g.tasks[0]);
  await triage.getByLabel(l.due, { exact: true }).selectOption("set");
  await triage.getByLabel(l.date, { exact: true }).fill("2028-03-05");
  await triage.getByRole("button", { name: l.preview, exact: true }).click();
  await triage.getByText(l.ready, { exact: true }).waitFor();
  let applyCalls = 0;
  await page.route("**/api/library/operations-triage/apply", async (route) => {
    applyCalls++;
    await route.fetch();
    await route.abort("failed");
  });
  await triage.getByLabel(l.ack, { exact: true }).check();
  await triage.getByRole("button", { name: l.apply, exact: true }).click();
  await triage.getByRole("alert").waitFor();
  assert.equal(applyCalls, 1);
  assert.equal((await read(g.tasks[0])).dueDate, "2028-03-05");
  assert.equal(
    await triage.getByRole("button", { name: l.apply, exact: true }).count(),
    0,
  );
  await page.unroute("**/api/library/operations-triage/apply");
  await triage.getByRole("button", { name: l.finish, exact: true }).click();
  // A task erased between preview and apply cannot be recreated.
  ({ panel, triage, l, al } = await open(g));
  await select(triage, g.tasks[0]);
  await triage.getByLabel(l.due, { exact: true }).selectOption("clear");
  await triage.getByRole("button", { name: l.preview, exact: true }).click();
  await triage.getByText(l.ready, { exact: true }).waitFor();
  await c.owner(
    `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
    "DELETE",
  );
  await triage.getByLabel(l.ack, { exact: true }).check();
  await triage.getByRole("button", { name: l.apply, exact: true }).click();
  await triage.getByRole("heading", { name: l.results, exact: true }).waitFor();
  await triage.getByText(l.unavailable, { exact: true }).waitFor();
  await triage.getByRole("button", { name: l.finish, exact: true }).click();
  await panel.getByText(al.empty, { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
  await c.local.db
    .prepare("UPDATE users SET role='viewer' WHERE id=?")
    .run(c.person.id);
  const reader = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await reader.request.post(base + "/api/auth/login", {
    data: { email: c.person.email, password: c.person.password },
  });
  const rp = await reader.newPage();
  await rp.goto(base);
  await rp
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  await rp.getByRole("button", { name: "Action center", exact: true }).click();
  await rp
    .getByRole("region", { name: actionLabels.en.title, exact: true })
    .getByText(actionLabels.en.empty, { exact: true })
    .waitFor();
  assert.equal(
    await rp
      .getByRole("button", { name: triageLabels.en.title, exact: true })
      .count(),
    0,
  );
  await reader.close();
  console.log(
    "EN/ES/FR mobile triage: explicit cross-filter/page selection, 25-task cap, before/after previews, cancel, acknowledgement, partial conflicts, clear values, dropped-response recovery without retries, reader gates and source erasure passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
