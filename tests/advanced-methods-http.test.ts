import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { client } from "./image-review-fixture";
import {
  advancedSetup,
  hierarchicalFixture,
  flexibleFixture,
  scheduledFixture,
} from "./advanced-methods-fixture";
before(() => start({ port: 3434 }), { timeout: 90000 });
after(stop);
test(
  "hierarchical model previews/individual and portfolio exports bind current sources, settings, actors and explicit review",
  { timeout: 120000 },
  async () => {
    const c = await hierarchicalFixture(),
      preview = await c.owner(c.root + "/hierarchical", "POST", c.input);
    assert.equal(preview.status, 200, JSON.stringify(preview));
    assert.equal(
      preview.model.diagnostics.ready,
      true,
      JSON.stringify(preview.model.diagnostics),
    );
    assert.equal(preview.model.individual.length, 40);
    assert.equal(preview.model.portfolio.candidateCount, 6);
    const payload = {
      ...c.input,
      signature: preview.model.signature,
      reviewed: true,
      format: "individual",
    };
    assert.equal(
      (
        await c.owner(c.root + "/hierarchical/export", "POST", {
          ...payload,
          reviewed: false,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await c.owner(c.root + "/hierarchical/export", "POST", {
          ...payload,
          portfolioSize: 1,
        })
      ).status,
      409,
    );
    const file = await c.owner(
      c.root + "/hierarchical/export",
      "POST",
      payload,
    );
    assert.equal(file.status, 200);
    assert.ok(file.bytes.toString().includes(c.ids[0]));
    assert.ok(
      file.bytes.toString().includes("hierarchical-isotropic-joint-bw-v1"),
    );
    const portfolio = await c.owner(c.root + "/hierarchical/export", "POST", {
      ...payload,
      format: "portfolio",
    });
    assert.equal(portfolio.status, 200);
    assert.ok(portfolio.bytes.toString().includes("prior_kappa"));
    const anonymous = await client(),
      foreign = await client();
    await foreign("auth/signup", "POST", {
      name: "Other methods",
      email: randomUUID() + "@example.test",
      password: "advanced-methods-password",
    });
    assert.equal(
      (await anonymous(c.root + "/hierarchical", "POST", c.input)).status,
      401,
    );
    assert.equal(
      (await foreign(c.root + "/hierarchical", "POST", c.input)).status,
      404,
    );
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.actor.id);
    assert.equal(
      (await c.owner(c.root + "/hierarchical", "POST", c.input)).status,
      403,
    );
    await c.local.db
      .prepare("UPDATE users SET role='admin' WHERE id=?")
      .run(c.actor.id);
    await c.owner(`studies/${c.s.id}/responses/${c.ids[0]}`, "DELETE");
    assert.equal(
      (await c.owner(c.root + "/hierarchical/export", "POST", payload)).status,
      409,
    );
    assert.equal(
      (
        await c.owner(c.root + "/hierarchical", "POST", {
          ...c.input,
          chains: 1,
        })
      ).status,
      400,
    );
  },
);
test(
  "open/hybrid participant groups persist names and drafts, preserve uncertainty, reject foreign edits and become immutable at confirmation",
  { timeout: 120000 },
  async () => {
    const base = await advancedSetup(),
      person = await client();
    for (const mode of ["open", "hybrid"] as const) {
      const c = await flexibleFixture(mode, base),
        joined = await person("public/" + c.s.id, "POST", { consent: true });
      let i = joined.interview;
      const headers = { "x-interview-token": joined.token },
        root = "interviews/" + i.id;
      assert.equal(i.guide.questions[0].cardsort, undefined);
      assert.equal(i.cardsortPrompt.mode, mode);
      assert.equal(i.cardsortStates, undefined);
      const add = {
        requestId: randomUUID(),
        version: i.version,
        op: "add",
        text: "=Participant category",
        assignments: [],
      };
      i = (await person(root + "/cardsort-groups", "POST", add, headers))
        .interview;
      const own = i.cardsortPrompt.customGroups[0];
      assert.equal(i.cardsortPrompt.customGroups.length, 1);
      assert.equal(
        (await person(root + "/cardsort-groups", "POST", add, headers))
          .interview.cardsortPrompt.customGroups.length,
        1,
      );
      assert.equal(
        (
          await person(
            root + "/cardsort-groups",
            "POST",
            {
              ...add,
              requestId: randomUUID(),
              version: i.version,
              text: "=participant category",
            },
            headers,
          )
        ).status,
        400,
      );
      const assignments = i.cardsortPrompt.cards.map(
        (card: any, n: number) => ({
          cardId: card.id,
          groupId: n === 2 ? null : own.id,
        }),
      );
      i = (
        await person(
          root + "/cardsort-draft",
          "POST",
          { requestId: randomUUID(), version: i.version, assignments },
          headers,
        )
      ).interview;
      i = (await person(root, "GET", undefined, headers)).interview;
      assert.equal(i.cardsortPrompt.draft.length, 3);
      assert.equal(
        i.cardsortPrompt.groups.find((g: any) => g.id === own.id).text,
        own.text,
      );
      assert.equal(
        (
          await person(
            root + "/cardsort-groups",
            "POST",
            {
              requestId: randomUUID(),
              version: i.version,
              op: "rename",
              id: "foreign-category",
              text: "Bad",
              assignments,
            },
            headers,
          )
        ).status,
        404,
      );
      const confirmed = await person(
        root + "/answer",
        "POST",
        {
          requestId: randomUUID(),
          version: i.version,
          answer: "",
          value: assignments,
        },
        headers,
      );
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed));
      assert.equal(confirmed.interview.status, "complete");
      assert.ok(confirmed.interview.turns[0].answer.includes(own.text));
      assert.equal(
        (
          await person(
            root + "/cardsort-groups",
            "POST",
            {
              requestId: randomUUID(),
              version: confirmed.interview.version,
              op: "remove",
              id: own.id,
              assignments,
            },
            headers,
          )
        ).status,
        409,
      );
      const results = (await c.owner(`studies/${c.s.id}/cardsort`)).results[0];
      assert.equal(results.counts.included, 1);
      assert.equal(results.rows.filter((x: any) => x.custom === 1).length, 2);
      const chosen = assignments
        .filter((a: any) => a.groupId !== null)
        .map((a: any) => a.cardId)
        .sort();
      assert.equal(
        results.pairs.find(
          (p: any) => p.cardA === chosen[0] && p.cardB === chosen[1],
        ).percent,
        100,
      );
      const csv = await c.owner(
        `studies/${c.s.id}/cardsort/export?kind=assignments`,
      );
      assert.ok(csv.bytes.toString().includes("'=Participant category"));
      await c.owner(`studies/${c.s.id}/responses/${i.id}`, "DELETE");
      assert.deepEqual(
        (await c.owner(`studies/${c.s.id}/cardsort`)).results,
        [],
      );
    }
  },
);
test(
  "Pulse schedules atomically create due baseline drafts once, respect review/version/role checks, pause and stop at cycle bounds",
  { timeout: 120000 },
  async () => {
    const c = await scheduledFixture(),
      input = {
        requestId: randomUUID(),
        version: 0,
        reviewed: true,
        nextDate: "2026-10-21",
        intervalDays: 7,
        maxWaves: 2,
        labelPrefix: "Scheduled reference",
        timeZone: "America/Los_Angeles",
      };
    assert.equal(
      (await c.owner(c.root, "PUT", { ...input, reviewed: false })).status,
      400,
    );
    assert.equal(
      (await c.owner(c.root, "PUT", { ...input, timeZone: "Not/AZone" }))
        .status,
      400,
    );
    const saved = await c.owner(c.root, "PUT", input);
    assert.equal(saved.status, 200, JSON.stringify(saved));
    assert.equal((await c.owner(c.root, "PUT", input)).schedule.version, 1);
    const runner = await import("../src/lib/pulse-schedule-server");
    const at = new Date("2026-10-21T19:00:00Z"),
      scope = { workspaceId: c.actor.workspaceId, seriesId: c.series.id };
    assert.equal(
      (await runner.runPulseSchedules(new Date("2026-10-21T03:00:00Z"), scope))
        .created,
      0,
    );
    const simultaneous = await Promise.all([
      runner.runPulseSchedules(at, scope),
      runner.runPulseSchedules(at, scope),
    ]);
    assert.equal(
      simultaneous.reduce((n, v) => n + v.created, 0),
      1,
    );
    let current = (await c.owner(c.root)).schedule;
    assert.equal(current.createdCount, 1);
    const draft = (await c.owner("studies/" + current.runs[0].studyId)).study;
    assert.equal(draft.fielding, "draft");
    assert.equal(draft.revisionId, null);
    assert.deepEqual(draft.draft, c.s.draft);
    assert.equal(
      (
        await c.owner(c.root, "PATCH", {
          requestId: randomUUID(),
          version: 1,
          reviewed: true,
          op: "pause",
        })
      ).status,
      409,
    );
    current = (
      await c.owner(c.root, "PATCH", {
        requestId: randomUUID(),
        version: current.version,
        reviewed: true,
        op: "pause",
      })
    ).schedule;
    assert.equal(
      (await runner.runPulseSchedules(new Date("2026-11-01"), scope)).created,
      0,
    );
    await c.local.db
      .prepare("UPDATE users SET role='collaborator' WHERE id=?")
      .run(c.actor.id);
    assert.equal(
      (
        await c.owner(c.root, "PATCH", {
          requestId: randomUUID(),
          version: current.version,
          reviewed: true,
          op: "resume",
        })
      ).status,
      403,
    );
    await c.local.db
      .prepare("UPDATE users SET role='admin' WHERE id=?")
      .run(c.actor.id);
    current = (
      await c.owner(c.root, "PATCH", {
        requestId: randomUUID(),
        version: current.version,
        reviewed: true,
        op: "resume",
      })
    ).schedule;
    assert.equal(
      (await runner.runPulseSchedules(new Date("2026-11-01"), scope)).created,
      1,
    );
    current = (await c.owner(c.root)).schedule;
    assert.equal(current.state, "complete");
    assert.equal(current.createdCount, 2);
    assert.equal(
      (await runner.runPulseSchedules(new Date("2028-01-01"), scope)).created,
      0,
    );
    assert.equal(JSON.stringify(current).includes("creatorId"), false);
    assert.equal(
      JSON.stringify(current).includes("baselineFingerprint"),
      false,
    );
  },
);
test(
  "Pulse due execution blocks revoked creators and changed chronology; explicit run retries do not create duplicate waves",
  { timeout: 120000 },
  async () => {
    const c = await scheduledFixture(),
      input = {
        requestId: randomUUID(),
        version: 0,
        reviewed: true,
        nextDate: "2026-10-21",
        intervalDays: 1,
        maxWaves: 3,
        labelPrefix: "Daily reference",
        timeZone: "UTC",
      };
    let current = (await c.owner(c.root, "PUT", input)).schedule;
    const action = {
      requestId: randomUUID(),
      version: current.version,
      reviewed: true,
      op: "run",
    };
    const run = await c.owner(c.root, "PATCH", action);
    assert.equal(run.status, 200, JSON.stringify(run));
    assert.equal(run.schedule.createdCount, 1);
    assert.equal(
      (await c.owner(c.root, "PATCH", action)).schedule.createdCount,
      1,
    );
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.actor.id);
    const runner = await import("../src/lib/pulse-schedule-server");
    assert.equal(
      (
        await runner.runPulseSchedules(new Date("2026-11-01"), {
          workspaceId: c.actor.workspaceId,
          seriesId: c.series.id,
        })
      ).blocked,
      1,
    );
    current = (await c.owner(c.root)).schedule;
    assert.equal(current.error, "permission");
    await c.local.db
      .prepare("UPDATE users SET role='admin' WHERE id=?")
      .run(c.actor.id);
    current = (
      await c.owner(c.root, "PATCH", {
        requestId: randomUUID(),
        version: current.version,
        reviewed: true,
        op: "resume",
      })
    ).schedule;
    const tracker = (await c.owner("pulse/" + c.series.id)).series;
    await c.owner("pulse/" + c.series.id + "/waves", "POST", {
      version: tracker.version,
      label: "Manual future wave",
      date: "2028-01-01",
      recruitment: c.series.recruitment,
    });
    assert.equal(
      (
        await runner.runPulseSchedules(new Date("2028-02-01"), {
          workspaceId: c.actor.workspaceId,
          seriesId: c.series.id,
        })
      ).blocked,
      1,
    );
    assert.equal((await c.owner(c.root)).schedule.error, "chronology");
  },
);
