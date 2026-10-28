import { chromium, type Browser, type Locator } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { inboxSetup } from "./team-review-inbox-fixture";
import { operationsWorkspaceLabels as labels } from "../src/lib/operations-workspace";
import { operationsLabels } from "../src/lib/research-operations";
import {
  actionLabels,
  defaultActionFilters,
} from "../src/lib/research-action-center";
import { operationsReportLabels } from "../src/lib/operations-report";
import { followUpWorkloadLabels } from "../src/lib/follow-up-workload";
async function idsAre(l: Locator, ids: string[]) {
  for (let n = 0; n < 100; n++) {
    const actual = await l
      .locator("[data-operation-pin]")
      .evaluateAll((es) => es.map((e) => e.getAttribute("data-operation-pin")));
    if (JSON.stringify(actual) === JSON.stringify(ids)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.deepEqual(
    await l
      .locator("[data-operation-pin]")
      .evaluateAll((es) => es.map((e) => e.getAttribute("data-operation-pin"))),
    ids,
  );
}
let browser: Browser | undefined;
try {
  await start({ port: 3421 });
  const c = await inboxSetup(),
    g = await c.create("Workspace browser");
  const tasks = [];
  for (const [assigneeId, status, dueDate] of [
    [c.actor.id, "open", "2028-02-29"],
    [null, "in_progress", "2028-02-29"],
    [null, "completed", "2028-02-29"],
  ])
    tasks.push(
      (
        await c.owner(`library/collections/${g.collection.id}/tasks`, "POST", {
          requestId: randomUUID(),
          title: "Workspace follow-up",
          assigneeId,
          status,
          dueDate,
          target: { kind: "interview", id: c.imports[0].interviewId },
        })
      ).task,
    );
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
  await page.clock.setFixedTime(new Date("2028-02-29T20:00:00Z"));
  await context.request.post(base + "/api/auth/login", {
    data: { email: c.email, password: "saved-library-password" },
  });
  const records: any[] = [];
  async function home(language: "en" | "es" | "fr" = "en") {
    await page.goto(base);
    await page
      .getByRole("button", { name: "Research library", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Operations home", exact: true })
      .click();
    if (language !== "en")
      await page
        .getByLabel(operationsLabels.en.language, { exact: true })
        .selectOption(language);
    const p = page.getByRole("region", {
      name: operationsLabels[language].title,
      exact: true,
    });
    await p
      .getByRole("region", { name: labels[language].title, exact: true })
      .waitFor();
    return p;
  }
  for (const language of ["en", "es", "fr"] as const) {
    const existing = await c.owner("library/operations-pins");
    for (const scope of ["private", "shared"])
      await c.owner("library/operations-pins/" + scope, "PUT", {
        version: existing[scope].version,
        viewIds: [],
      });
    const personal = (
      await c.owner("library/saved-review-views", "POST", {
        name: "Personal report " + language,
        visibility: "private",
        config: {
          kind: "report_workload",
          report: {
            kind: "workload",
            filters: {
              collectionId: g.collection.id,
              query: "Workspace",
              show: "active",
            },
            language,
            timeZone: "UTC",
          },
        },
      })
    ).view;
    const shared = (
      await c.owner("library/saved-review-views", "POST", {
        name: "Team follow-ups " + language,
        visibility: "shared",
        config: {
          kind: "tasks",
          filters: { ...defaultActionFilters, collectionId: g.collection.id },
        },
      })
    ).view;
    records.push({ personal, shared });
    const w = labels[language],
      l = operationsLabels[language];
    let p = await home(language),
      mine = p.getByRole("region", { name: w.personal, exact: true }),
      team = p.getByRole("region", { name: w.team, exact: true });
    await p.getByLabel(l.choose, { exact: true }).selectOption(personal.id);
    assert.equal(
      await p
        .getByRole("button", { name: w.pinTeam, exact: true })
        .isDisabled(),
      true,
    );
    await p.getByRole("button", { name: w.pinPersonal, exact: true }).click();
    await idsAre(mine, [personal.id]);
    await p.getByLabel(l.choose, { exact: true }).selectOption(shared.id);
    await p.getByRole("button", { name: w.pinPersonal, exact: true }).click();
    await idsAre(mine, [personal.id, shared.id]);
    await p.getByLabel(l.choose, { exact: true }).selectOption(shared.id);
    await p.getByRole("button", { name: w.pinTeam, exact: true }).click();
    await idsAre(team, [shared.id]);
    await mine
      .locator(`[data-operation-pin="${personal.id}"]`)
      .getByRole("button", { name: w.down, exact: true })
      .click();
    await idsAre(mine, [shared.id, personal.id]);
    p = await home(language);
    mine = p.getByRole("region", { name: w.personal, exact: true });
    await idsAre(mine, [shared.id, personal.id]);
    await mine
      .locator(`[data-operation-pin="${shared.id}"]`)
      .getByRole("button", { name: w.remove, exact: true })
      .click();
    await idsAre(mine, [personal.id]);
    const priorities = p.getByRole("region", {
      name: w.priorities,
      exact: true,
    });
    for (const [kind, count] of [
      ["today", 2],
      ["unassigned", 1],
      ["mine", 1],
    ] as const)
      assert.equal(
        await priorities
          .getByRole("article", { name: w[kind], exact: true })
          .locator("strong")
          .innerText(),
        String(count),
      );
    await p.getByRole("region", { name: w.title, exact: true }).screenshot({
      path: `test-results/operations-workspace-${language}.png`,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await priorities
      .getByRole("article", { name: w.unassigned, exact: true })
      .getByRole("button", { name: w.queue, exact: true })
      .click();
    await page.locator(`[data-action-task="${tasks[1].id}"]`).waitFor();
    assert.equal(
      await page
        .getByLabel(actionLabels[language].assignee, { exact: true })
        .inputValue(),
      "unassigned",
    );
    assert.equal(await page.locator("[data-action-task]").count(), 1);
    p = await home(language);
    await p
      .getByRole("region", { name: w.personal, exact: true })
      .getByRole("button", { name: w.open, exact: true })
      .click();
    const report = page.getByRole("region", {
      name: operationsReportLabels[language].title,
      exact: true,
    });
    await report
      .getByRole("button", {
        name: operationsReportLabels[language].generate,
        exact: true,
      })
      .waitFor();
    assert.equal(await report.getByRole("checkbox").count(), 0);
    assert.equal(
      await page
        .getByLabel(followUpWorkloadLabels[language].query, { exact: true })
        .inputValue(),
      "Workspace",
    );
    for (const quick of [w.workload, w.activity]) {
      p = await home(language);
      await p.getByRole("button", { name: quick, exact: true }).click();
      const r = page.getByRole("region", {
        name: operationsReportLabels[language].title,
        exact: true,
      });
      await r
        .getByRole("button", {
          name: operationsReportLabels[language].generate,
          exact: true,
        })
        .waitFor();
      assert.equal(await r.getByRole("checkbox").count(), 0);
    }
  }
  // Reader has the team board but no team-management actions, and cannot see personal pins.
  await c.local.db
    .prepare("UPDATE users SET role='viewer' WHERE id=?")
    .run(c.person.id);
  const reader = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    rp = await reader.newPage();
  rp.on("pageerror", (e) => errors.push(e.message));
  await reader.request.post(base + "/api/auth/login", {
    data: { email: c.person.email, password: c.person.password },
  });
  await rp.goto(base);
  await rp
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  await rp
    .getByRole("button", { name: "Operations home", exact: true })
    .click();
  const readerTeam = rp.getByRole("region", {
    name: labels.en.team,
    exact: true,
  });
  await readerTeam
    .locator(`[data-operation-pin="${records[2].shared.id}"]`)
    .waitFor();
  assert.equal(
    await readerTeam
      .getByRole("button", { name: labels.en.remove, exact: true })
      .count(),
    0,
  );
  assert.equal(
    await rp
      .getByRole("region", { name: labels.en.personal, exact: true })
      .locator("[data-operation-pin]")
      .count(),
    0,
  );
  // A stale displayed view never opens after being unshared; explicit refresh prunes team pins.
  await c.owner("library/saved-review-views/" + records[2].shared.id, "PUT", {
    version: 1,
    name: records[2].shared.name,
    visibility: "private",
    config: records[2].shared.config,
  });
  await readerTeam
    .getByRole("button", { name: labels.en.open, exact: true })
    .click();
  await rp.getByRole("alert").waitFor();
  await rp
    .getByRole("button", { name: operationsLabels.en.refresh, exact: true })
    .click();
  await rp
    .getByRole("region", { name: labels.en.team, exact: true })
    .getByText(labels.en.empty, { exact: true })
    .waitFor();
  // Pin failures clear the launchpad; refresh recovers actual saved order without retry.
  let p = await home();
  await page.route("**/api/library/operations-pins/private", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic pin conflict" }),
    }),
  );
  await p
    .getByRole("region", { name: labels.en.personal, exact: true })
    .getByRole("button", { name: labels.en.remove, exact: true })
    .click();
  await p
    .getByRole("alert")
    .filter({ hasText: "Synthetic pin conflict" })
    .waitFor();
  assert.equal(
    await p.getByRole("region", { name: labels.en.title, exact: true }).count(),
    0,
  );
  await page.unroute("**/api/library/operations-pins/private");
  await p
    .getByRole("button", { name: operationsLabels.en.refresh, exact: true })
    .click();
  await p
    .getByRole("region", { name: labels.en.personal, exact: true })
    .locator(`[data-operation-pin="${records[2].personal.id}"]`)
    .waitFor();
  await c.owner(
    `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
    "DELETE",
  );
  await p
    .getByRole("button", { name: operationsLabels.en.refresh, exact: true })
    .click();
  await p
    .getByRole("region", { name: labels.en.priorities, exact: true })
    .getByRole("article", { name: labels.en.unassigned, exact: true })
    .getByText("0", { exact: true })
    .waitFor();
  assert.equal(
    await p
      .getByRole("region", { name: labels.en.personal, exact: true })
      .locator("[data-operation-pin]")
      .count(),
    1,
  );
  assert.deepEqual(errors, []);
  await reader.close();
  await context.close();
  console.log(
    "Operations workspace EN/ES/FR mobile: personal/team pin permissions, ordering/persistence, private-view protection, current priority queues, report shortcuts without approval, stale unsharing, conflict recovery and source erasure passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
