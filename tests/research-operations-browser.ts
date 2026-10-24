import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, base } from "./harness";
import { inboxSetup, feedbackAction } from "./team-review-inbox-fixture";
import { operationsLabels } from "../src/lib/research-operations";
import { actionLabels } from "../src/lib/research-action-center";
import { inboxLabels, defaultInboxFilters } from "../src/lib/team-review-inbox";
import { deadlineLabels } from "../src/lib/review-deadlines";
import { activityLabels } from "../src/lib/review-activity";
import {
  workloadLabels,
  defaultWorkloadFilters,
} from "../src/lib/review-workload";
import { handoffLabels } from "../src/lib/collection-handoff";
let browser: Browser | undefined;
try {
  await start({ port: 3407 });
  const c = await inboxSetup(),
    g = await c.create("Operations browser", [c.actor.id, c.person.id]);
  g.d = await c.owner(
    g.path + "/feedback",
    "POST",
    feedbackAction(g.d, {
      op: "deadline",
      reviewerId: c.actor.id,
      dueDate: "2028-02-27",
    }),
  );
  g.d = await c.owner(
    g.path + "/feedback",
    "POST",
    feedbackAction(g.d, {
      op: "comment",
      requestId: randomUUID(),
      body: "PRIVATE_OPERATIONS_COMMENT",
    }),
  );
  for (const [n, status, dueDate] of [
    [0, "open", "2028-02-27"],
    [1, "completed", "2028-02-26"],
    [2, "open", "2028-02-28"],
  ] as const) {
    assert.equal(
      (
        await c.owner(`library/collections/${g.collection.id}/tasks`, "POST", {
          requestId: randomUUID(),
          title: "Operations follow-up " + n,
          assigneeId: c.actor.id,
          dueDate,
          status,
          target: { kind: "interview", id: c.imports[0].interviewId },
        })
      ).status,
      201,
    );
  }
  const views: any[] = [];
  for (const config of [
    {
      kind: "requests",
      filters: {
        ...defaultInboxFilters,
        collectionId: g.collection.id,
        due: "overdue",
      },
    },
    {
      kind: "workload",
      filters: {
        ...defaultWorkloadFilters,
        collectionId: g.collection.id,
        load: "pending",
      },
      selected: c.actor.id,
    },
    {
      kind: "activity",
      filters: {
        packetId: g.d.packet.id,
        personId: c.actor.id,
        action: "deadline",
        from: "2020-01-01",
        to: "2030-12-31",
      },
    },
  ])
    views.push(
      (
        await c.owner("library/saved-review-views", "POST", {
          name: "Operations " + config.kind,
          visibility: "shared",
          config,
        })
      ).view,
    );
  await c.person.call("library/saved-review-views", "POST", {
    name: "PRIVATE_OTHER_OPERATIONS",
    visibility: "private",
    config: {
      kind: "requests",
      filters: { ...defaultInboxFilters, query: "PRIVATE_OTHER_QUERY" },
    },
  });
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
  await page.clock.setFixedTime(new Date("2028-02-28T20:00:00Z"));
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
  async function home(language: "en" | "es" | "fr" = "en") {
    await page
      .getByRole("button", { name: "Operations home", exact: true })
      .click();
    if (language !== "en")
      await page
        .getByLabel(operationsLabels.en.language, { exact: true })
        .selectOption(language);
    const panel = page.getByRole("region", {
      name: operationsLabels[language].title,
      exact: true,
    });
    await panel.getByRole("status").waitFor();
    return panel;
  }
  for (const language of ["en", "es", "fr"] as const) {
    const l = operationsLabels[language],
      il = inboxLabels[language],
      al = actionLabels[language],
      dl = deadlineLabels[language];
    let panel = await home(language);
    for (const title of [l.overdueTasks, l.overdueReviews, l.blocked, l.mine])
      assert.equal(
        await panel
          .getByRole("article", { name: title, exact: true })
          .locator(".operations-count")
          .textContent(),
        "1",
      );
    assert.equal(
      (await panel.textContent())!.includes("PRIVATE_OTHER_OPERATIONS"),
      false,
    );
    assert.equal(
      (await panel.textContent())!.includes("PRIVATE_OPERATIONS_COMMENT"),
      false,
    );
    await panel.screenshot({
      path: `test-results/operations-home-${language}.png`,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await panel.getByRole("button", { name: l.tasks, exact: true }).click();
    let action = page.getByRole("region", { name: al.title, exact: true });
    await action.getByLabel(al.due, { exact: true }).waitFor();
    assert.equal(
      await action.getByLabel(al.due, { exact: true }).inputValue(),
      "overdue",
    );
    await action.getByText("Operations follow-up 0", { exact: true }).waitFor();
    assert.equal(await action.locator("[data-action-task]").count(), 1);
    panel = await home(language);
    await panel
      .getByRole("region", { name: l.overdueTasks, exact: true })
      .getByRole("button", { name: l.openTask, exact: true })
      .click();
    action = page.getByRole("region", { name: al.title, exact: true });
    await action.getByLabel(al.collection, { exact: true }).waitFor();
    assert.equal(
      await action.getByLabel(al.collection, { exact: true }).inputValue(),
      g.collection.id,
    );
    panel = await home(language);
    await panel.getByRole("button", { name: l.reviews, exact: true }).click();
    let inbox = page.getByRole("region", { name: il.title, exact: true });
    await inbox.getByLabel(dl.window, { exact: true }).waitFor();
    assert.equal(
      await inbox.getByLabel(dl.window, { exact: true }).inputValue(),
      "overdue",
    );
    assert.equal(
      await inbox.getByLabel(il.reviewer, { exact: true }).inputValue(),
      "",
    );
    panel = await home(language);
    await panel.getByRole("button", { name: l.blockers, exact: true }).click();
    inbox = page.getByRole("region", { name: il.title, exact: true });
    await inbox.getByLabel(il.state, { exact: true }).waitFor();
    assert.equal(
      await inbox.getByLabel(il.state, { exact: true }).inputValue(),
      "blocked",
    );
    panel = await home(language);
    await panel
      .getByRole("region", { name: l.blocked, exact: true })
      .getByRole("button", { name: l.openPacket, exact: true })
      .click();
    await page
      .getByLabel(handoffLabels[language].name, { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByLabel(handoffLabels[language].name, { exact: true })
        .inputValue(),
      g.d.packet.title,
    );
    for (const v of views) {
      panel = await home(language);
      await panel.getByLabel(l.choose, { exact: true }).selectOption(v.id);
      await panel.getByRole("button", { name: l.apply, exact: true }).click();
      inbox = page.getByRole("region", { name: il.title, exact: true });
      if (v.config.kind === "requests") {
        await inbox.getByLabel(il.collection, { exact: true }).waitFor();
        assert.equal(
          await inbox.getByLabel(il.collection, { exact: true }).inputValue(),
          g.collection.id,
        );
        assert.equal(
          await inbox.getByLabel(dl.window, { exact: true }).inputValue(),
          "overdue",
        );
      }
      if (v.config.kind === "workload") {
        await inbox
          .getByLabel(inboxLabels[language].collection, { exact: true })
          .waitFor();
        assert.equal(
          await inbox
            .getByLabel(inboxLabels[language].collection, { exact: true })
            .inputValue(),
          g.collection.id,
        );
        assert.equal(
          await inbox
            .getByLabel(workloadLabels[language].load, { exact: true })
            .inputValue(),
          "pending",
        );
      }
      if (v.config.kind === "activity") {
        const region = inbox.getByRole("region", {
          name: activityLabels[language].title,
          exact: true,
        });
        await region
          .getByLabel(activityLabels[language].packet, { exact: true })
          .waitFor();
        assert.equal(
          await region
            .getByLabel(activityLabels[language].packet, { exact: true })
            .inputValue(),
          g.d.packet.id,
        );
        assert.equal(
          await region
            .getByLabel(activityLabels[language].action, { exact: true })
            .inputValue(),
          "deadline",
        );
      }
    }
  }
  let panel = await home();
  // Due-today tasks roll into overdue on the viewer's local midnight, not UTC midnight.
  await page.clock.setFixedTime(new Date("2028-02-29T07:59:00Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  assert.equal(
    await panel
      .getByRole("article", {
        name: operationsLabels.en.overdueTasks,
        exact: true,
      })
      .locator(".operations-count")
      .textContent(),
    "1",
  );
  await page.clock.setFixedTime(new Date("2028-02-29T08:01:00Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(
    (label) =>
      document.querySelector(`article[aria-label="${label}"] .operations-count`)
        ?.textContent === "2",
    operationsLabels.en.overdueTasks,
  );
  await page.clock.setFixedTime(new Date("2028-02-28T20:00:00Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  for (let n = 0; n < 6; n++)
    assert.equal(
      (
        await c.owner(`library/collections/${g.collection.id}/tasks`, "POST", {
          requestId: randomUUID(),
          title: "Additional overdue follow-up " + n,
          assigneeId: null,
          dueDate: "2028-02-25",
          status: "open",
          target: { kind: "interview", id: c.imports[0].interviewId },
        })
      ).status,
      201,
    );
  await panel
    .getByRole("button", { name: operationsLabels.en.refresh, exact: true })
    .click();
  await panel.getByRole("status").waitFor();
  assert.equal(
    await panel
      .getByRole("article", {
        name: operationsLabels.en.overdueTasks,
        exact: true,
      })
      .locator(".operations-count")
      .textContent(),
    "7",
  );
  assert.equal(
    await panel
      .getByRole("region", {
        name: operationsLabels.en.overdueTasks,
        exact: true,
      })
      .getByRole("article")
      .count(),
    5,
  );
  await panel
    .getByRole("button", { name: operationsLabels.en.tasks, exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll("[data-action-task]").length === 7,
  );
  panel = await home();

  await page.route("**/api/library/review-activity", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic unavailable queue" }),
    }),
  );
  await panel
    .getByRole("button", { name: operationsLabels.en.refresh, exact: true })
    .click();
  await panel.getByRole("alert").waitFor();
  assert.equal(await panel.locator(".operations-count").count(), 0);
  assert.equal(await panel.getByRole("status").count(), 0);
  await page.unroute("**/api/library/review-activity");
  await panel
    .getByRole("button", { name: operationsLabels.en.refresh, exact: true })
    .click();
  await panel.getByRole("status").waitFor();
  await c.owner("library/saved-review-views/" + views[0].id, "PUT", {
    name: "Changed while overview open",
    visibility: "private",
    config: views[0].config,
    version: 1,
  });
  await panel
    .getByLabel(operationsLabels.en.choose, { exact: true })
    .selectOption(views[0].id);
  await panel
    .getByRole("button", { name: operationsLabels.en.apply, exact: true })
    .click();
  await panel
    .getByText(operationsLabels.en.unavailable, { exact: true })
    .waitFor();
  assert.equal(await panel.locator(".operations-count").count(), 0);
  await panel
    .getByRole("button", { name: operationsLabels.en.refresh, exact: true })
    .click();
  await panel.getByRole("status").waitFor();
  // Erasure while the preview is open must not open a replacement or broaden filters.
  await c.owner(
    `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
    "DELETE",
  );
  await panel
    .getByRole("region", { name: operationsLabels.en.blocked, exact: true })
    .getByRole("button", { name: operationsLabels.en.openPacket, exact: true })
    .click();
  await page
    .getByText(activityLabels.en.unavailablePacket, { exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel(handoffLabels.en.name, { exact: true }).count(),
    0,
  );
  panel = await home();
  assert.equal(
    await panel
      .getByRole("article", {
        name: operationsLabels.en.overdueTasks,
        exact: true,
      })
      .locator(".operations-count")
      .textContent(),
    "0",
  );
  assert.equal(
    await panel
      .getByRole("article", { name: operationsLabels.en.blocked, exact: true })
      .locator(".operations-count")
      .textContent(),
    "0",
  );
  assert.deepEqual(errors, []);
  await context.close();
  // A separately authenticated reader sees shared views but never another person's private catalog.
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
  await rp
    .getByRole("button", { name: "Operations home", exact: true })
    .click();
  const rpanel = rp.getByRole("region", {
    name: operationsLabels.en.title,
    exact: true,
  });
  await rpanel.getByRole("status").waitFor();
  assert.equal(
    await rpanel
      .getByLabel(operationsLabels.en.choose, { exact: true })
      .locator("option")
      .filter({ hasText: "Changed while overview open" })
      .count(),
    0,
  );
  await reader.close();
  console.log(
    "Operations home EN/ES/FR mobile summaries, queue/packet navigation, all saved-view kinds, private reader catalog, atomic load failure/recovery and source-erasure refresh — passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
