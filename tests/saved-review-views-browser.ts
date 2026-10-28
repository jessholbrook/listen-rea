import { chromium, type Browser, type Locator } from "playwright";
import assert from "node:assert/strict";
import { start, stop, base } from "./harness";
import { inboxSetup, feedbackAction } from "./team-review-inbox-fixture";
import { savedViewLabels } from "../src/lib/saved-review-views";
import { inboxLabels } from "../src/lib/team-review-inbox";
import { workloadLabels } from "../src/lib/review-workload";
import { activityLabels } from "../src/lib/review-activity";
import { deadlineLabels } from "../src/lib/review-deadlines";
async function disabled(l: Locator) {
  for (let n = 0; n < 50; n++) {
    if (await l.isDisabled()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(await l.isDisabled(), true);
}
let browser: Browser | undefined;
try {
  await start({ port: 3405 });
  const c = await inboxSetup(),
    groups = [],
    presets: any[] = [];
  for (const language of ["en", "es", "fr"] as const) {
    const g = await c.create(
      "Saved preset " + language,
      [c.actor.id, c.person.id],
      language,
    );
    g.d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(g.d, {
        op: "deadline",
        reviewerId: c.person.id,
        dueDate: "2028-02-27",
      }),
    );
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
  await page.clock.setFixedTime(new Date("2028-02-28T20:00:00Z"));
  assert.ok(
    (
      await context.request.post(base + "/api/auth/login", {
        data: { email: c.email, password: "saved-library-password" },
      })
    ).ok(),
  );
  async function open() {
    await page.goto(base);
    await page
      .getByRole("button", { name: "Research library", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review inbox", exact: true })
      .click();
  }
  await open();
  let previous: "en" | "es" | "fr" = "en";
  for (const g of groups) {
    const language = g.language,
      l = savedViewLabels[language],
      il = inboxLabels[language],
      wl = workloadLabels[language],
      al = activityLabels[language],
      dl = deadlineLabels[language];
    await page
      .getByLabel(inboxLabels[previous].language, { exact: true })
      .selectOption(language);
    previous = language;
    const inbox = page.getByRole("region", { name: il.title, exact: true });
    await inbox.getByRole("button", { name: wl.requests, exact: true }).click();
    const saved = inbox.getByRole("region", { name: l.title, exact: true });
    async function save(name: string, kind: string) {
      await saved.getByRole("button", { name: l.save, exact: true }).click();
      await disabled(
        inbox.getByRole("button", { name: il.refresh, exact: true }),
      );
      await disabled(inbox.getByRole("button", { name: wl.tab, exact: true }));
      await saved.getByLabel(l.name, { exact: true }).fill(name);
      await saved
        .getByLabel(l.visibility, { exact: true })
        .selectOption(language === "es" ? "shared" : "private");
      await saved.screenshot({
        path: `test-results/saved-view-form-${kind}-${language}.png`,
      });
      await saved.getByRole("button", { name: l.save, exact: true }).click();
      await saved.getByText(l.saved, { exact: true }).waitFor();
      const v = (await c.owner("library/saved-review-views")).views.find(
        (v: any) => v.name === name,
      );
      assert.equal(v.config.kind, kind);
      presets.push(v);
      return v;
    }
    async function apply(v: any) {
      await saved.getByLabel(l.choose, { exact: true }).selectOption(v.id);
      await saved.getByRole("button", { name: l.apply, exact: true }).click();
      await inbox.getByText(l.applied, { exact: true }).waitFor();
    }
    await inbox
      .getByLabel(il.collection, { exact: true })
      .selectOption(g.collection.id);
    await inbox
      .getByLabel(il.reviewer, { exact: true })
      .selectOption(c.person.id);
    await inbox.getByLabel(dl.window, { exact: true }).selectOption("overdue");
    await inbox
      .getByLabel(il.query, { exact: true })
      .fill("Saved preset " + language);
    if (language === "en") {
      await saved.getByRole("button", { name: l.save, exact: true }).click();
      await saved.getByLabel(l.name, { exact: true }).fill("Discarded draft");
      await disabled(inbox.getByLabel(il.collection, { exact: true }));
      await saved.getByRole("button", { name: l.cancel, exact: true }).click();
      assert.equal(
        (await c.owner("library/saved-review-views")).views.length,
        0,
      );
    }
    const requests = await save("Requests " + language, "requests");
    await inbox.getByRole("button", { name: il.reset, exact: true }).click();
    await apply(requests);
    assert.equal(
      await inbox.getByLabel(il.collection, { exact: true }).inputValue(),
      g.collection.id,
    );
    assert.equal(
      await inbox.getByLabel(il.reviewer, { exact: true }).inputValue(),
      c.person.id,
    );
    assert.equal(
      await inbox.getByLabel(dl.window, { exact: true }).inputValue(),
      "overdue",
    );
    if (language === "en") {
      await open();
      await apply(requests);
      assert.equal(
        await inbox.getByLabel(il.query, { exact: true }).inputValue(),
        "Saved preset en",
      );
      await saved
        .getByLabel(l.choose, { exact: true })
        .selectOption(requests.id);
      await saved.getByRole("button", { name: l.copy, exact: true }).click();
      await saved.getByText(l.copied, { exact: true }).waitFor();
      const copy = (await c.owner("library/saved-review-views")).views.find(
        (v: any) => v.name === l.copyPrefix + requests.name,
      );
      assert.equal(copy.visibility, "private");
      page.once("dialog", (d) => d.accept());
      await saved.getByRole("button", { name: l.remove, exact: true }).click();
      await saved.getByText(l.saved, { exact: true }).waitFor();
      assert.equal(
        (await c.owner("library/saved-review-views/" + copy.id)).status,
        404,
      );
    }
    await inbox.getByRole("button", { name: wl.tab, exact: true }).click();
    const workload = inbox.getByRole("region", { name: wl.title, exact: true });
    await workload
      .getByLabel(il.collection, { exact: true })
      .selectOption(g.collection.id);
    await workload
      .getByLabel(il.query, { exact: true })
      .fill("Saved preset " + language);
    await workload.getByLabel(wl.load, { exact: true }).selectOption("overdue");
    await workload
      .locator(`[data-workload-member="${c.person.id}"]`)
      .getByRole("button", { name: wl.show, exact: true })
      .click();
    const w = await save("Workload " + language, "workload");
    assert.equal(w.config.selected, c.person.id);
    await workload.getByRole("button", { name: il.reset, exact: true }).click();
    await apply(w);
    assert.equal(
      await workload.getByLabel(il.collection, { exact: true }).inputValue(),
      g.collection.id,
    );
    assert.equal(
      await workload.getByLabel(wl.load, { exact: true }).inputValue(),
      "overdue",
    );
    await workload
      .locator(`[data-workload-request="${g.d.packet.id}"]`)
      .waitFor();
    await inbox.getByRole("button", { name: al.title, exact: true }).click();
    const activity = inbox.getByRole("region", { name: al.title, exact: true });
    await activity
      .getByLabel(al.packet, { exact: true })
      .selectOption(g.d.packet.id);
    await activity
      .getByLabel(al.person, { exact: true })
      .selectOption(c.person.id);
    await activity
      .getByLabel(al.action, { exact: true })
      .selectOption("deadline");
    await activity.getByLabel(al.from, { exact: true }).fill("2026-01-01");
    await activity.getByLabel(al.to, { exact: true }).fill("2029-12-31");
    const a = await save("Activity " + language, "activity");
    assert.equal("page" in a.config.filters, false);
    await activity.getByRole("button", { name: il.reset, exact: true }).click();
    await apply(a);
    assert.equal(
      await activity.getByLabel(al.packet, { exact: true }).inputValue(),
      g.d.packet.id,
    );
    assert.equal(
      await activity.getByLabel(al.from, { exact: true }).inputValue(),
      "2026-01-01",
    );
    await activity.locator("[data-review-event]").first().waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  }
  const l = savedViewLabels.fr,
    il = inboxLabels.fr,
    al = activityLabels.fr,
    inbox = page.getByRole("region", { name: il.title, exact: true }),
    saved = inbox.getByRole("region", { name: l.title, exact: true }),
    activity = inbox.getByRole("region", { name: al.title, exact: true });
  let v = presets.find((v) => v.name === "Activity fr");
  await saved.getByLabel(l.choose, { exact: true }).selectOption(v.id);
  await saved.getByRole("button", { name: l.update, exact: true }).click();
  await saved.getByLabel(l.name, { exact: true }).fill("Activity fr updated");
  await saved.getByLabel(l.visibility, { exact: true }).selectOption("shared");
  await saved.getByRole("button", { name: l.update, exact: true }).click();
  await saved.getByText(l.saved, { exact: true }).waitFor();
  v = (await c.owner("library/saved-review-views/" + v.id)).view;
  assert.equal(v.version, 2);
  assert.equal(v.visibility, "shared");
  const newer = await c.owner("library/saved-review-views/" + v.id, "PUT", {
    name: v.name,
    visibility: v.visibility,
    config: { ...v.config, filters: { ...v.config.filters, action: "" } },
    version: 2,
  });
  assert.equal(newer.status, 200);
  await saved.getByRole("button", { name: l.apply, exact: true }).click();
  await saved.getByRole("alert").waitFor();
  assert.equal(
    await activity.getByLabel(al.action, { exact: true }).inputValue(),
    "deadline",
  );
  await saved.getByRole("button", { name: l.refresh, exact: true }).click();
  await saved.getByLabel(l.choose, { exact: true }).selectOption(v.id);
  await saved.getByRole("button", { name: l.apply, exact: true }).click();
  await inbox.getByText(l.applied, { exact: true }).waitFor();
  assert.equal(
    await activity.getByLabel(al.action, { exact: true }).inputValue(),
    "",
  );
  // A separate reader session sees shared views, can keep a personal copy, and cannot load a newly private update.
  await c.local.db
    .prepare("UPDATE users SET role='viewer' WHERE id=?")
    .run(c.person.id);
  const other = await browser.newContext({
      viewport: { width: 390, height: 844 },
      timezoneId: "America/Los_Angeles",
    }),
    rp = await other.newPage();
  rp.on("pageerror", (e) => errors.push(e.message));
  await rp.clock.setFixedTime(new Date("2028-02-28T20:00:00Z"));
  assert.ok(
    (
      await other.request.post(base + "/api/auth/login", {
        data: { email: c.person.email, password: c.person.password },
      })
    ).ok(),
  );
  await rp.goto(base);
  await rp
    .getByRole("button", { name: "Research library", exact: true })
    .click();
  await rp.getByRole("button", { name: "Review inbox", exact: true }).click();
  const rs = rp.getByRole("region", {
      name: savedViewLabels.en.title,
      exact: true,
    }),
    rl = savedViewLabels.en,
    shared = presets.find((v) => v.name === "Requests es");
  await rs.getByLabel(rl.choose, { exact: true }).selectOption(shared.id);
  assert.equal(
    await rs.getByRole("button", { name: rl.update, exact: true }).count(),
    0,
  );
  await rs.getByRole("button", { name: rl.apply, exact: true }).click();
  await rp.getByText(rl.applied, { exact: true }).waitFor();
  assert.equal(
    await rp
      .getByLabel(inboxLabels.en.collection, { exact: true })
      .inputValue(),
    groups[1].collection.id,
  );
  await rs.getByLabel(rl.choose, { exact: true }).selectOption(shared.id);
  await rs.getByRole("button", { name: rl.copy, exact: true }).click();
  await rs.getByText(rl.copied, { exact: true }).waitFor();
  const ownCopy = (
    await c.person.call("library/saved-review-views")
  ).views.find((v: any) => v.name === rl.copyPrefix + shared.name);
  assert.equal(
    (await c.owner("library/saved-review-views/" + ownCopy.id)).status,
    404,
  );
  await rs.getByLabel(rl.choose, { exact: true }).selectOption(shared.id);
  await c.owner("library/saved-review-views/" + shared.id, "PUT", {
    name: "PRIVATE_UPDATED_VIEW",
    visibility: "private",
    config: {
      ...shared.config,
      filters: { ...shared.config.filters, query: "PRIVATE_UPDATED_FILTER" },
    },
    version: shared.version,
  });
  await rs.getByRole("button", { name: rl.apply, exact: true }).click();
  await rs.getByRole("alert").waitFor();
  assert.equal(
    await rp.getByLabel(inboxLabels.en.query, { exact: true }).inputValue(),
    "Saved preset es",
  );
  assert.equal(
    await rp.getByText("PRIVATE_UPDATED_FILTER", { exact: true }).count(),
    0,
  );
  await other.close();
  // Erased scopes remain exact filter IDs; applying them yields empty current history.
  await c.owner(
    `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
    "DELETE",
  );
  await saved.getByLabel(l.choose, { exact: true }).selectOption(v.id);
  await saved.getByRole("button", { name: l.apply, exact: true }).click();
  await inbox.getByText(l.applied, { exact: true }).waitFor();
  await activity.getByText(al.empty, { exact: true }).waitFor();
  assert.equal(
    await activity.getByLabel(al.packet, { exact: true }).inputValue(),
    groups[2].d.packet.id,
  );
  assert.equal(
    await activity.getByText(groups[2].d.packet.title, { exact: true }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "EN/ES/FR mobile saved views: save/apply all three filter kinds, draft guards/cancel, reload persistence, current workload selection, activity date restoration, private copies, update/delete, stale-version recovery, separate-reader sharing/privacy and erased-scope retention passed.",
  );
} finally {
  await browser?.close();
  await stop();
}
