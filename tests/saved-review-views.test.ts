import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import { client } from "./image-review-fixture";
import {
  inboxSetup,
  feedbackAction,
  finalReview,
} from "./team-review-inbox-fixture";
import { workloadSetup } from "./review-workload-fixture";
import {
  defaultInboxFilters,
  selectInboxPackets,
} from "../src/lib/team-review-inbox";
import { defaultWorkloadFilters } from "../src/lib/review-workload";
import { savedViewLabels } from "../src/lib/saved-review-views";
before(() => start({ port: 3404 }), { timeout: 90000 });
after(stop);
const root = "library/saved-review-views";
const config = () => ({
  kind: "requests",
  filters: { ...defaultInboxFilters },
});
const content = (
  visibility = "private",
  name = "Synthetic saved view",
  v: any = config(),
) => ({ name, visibility, config: v });
const detail = (v: any) => root + "/" + v.id;
test(
  "private filters stay private even from admins; shared views have explicit creator/admin management and readers can keep private copies",
  { timeout: 120000 },
  async () => {
    const c = await workloadSetup(),
      privateView = (
        await c.person.call(
          root,
          "POST",
          content("private", "PRIVATE_OTHER_PERSON_VIEW", {
            kind: "requests",
            filters: {
              ...defaultInboxFilters,
              query: "PRIVATE_OTHER_PERSON_QUERY",
            },
          }),
        )
      ).view;
    assert.ok(privateView);
    let catalog = await c.owner(root);
    assert.equal(
      JSON.stringify(catalog).includes("PRIVATE_OTHER_PERSON"),
      false,
    );
    for (const call of [c.owner, c.replacement.call]) {
      assert.equal((await call(detail(privateView))).status, 404);
      assert.equal(
        (await call(detail(privateView), "DELETE", { version: 1 })).status,
        404,
      );
    }
    const shared = (
      await c.person.call(
        root,
        "POST",
        content("shared", "Workspace coordination"),
      )
    ).view;
    assert.equal((await c.owner(detail(shared))).view.canManage, true);
    assert.equal(
      (await c.owner(detail(shared))).view.canChangeVisibility,
      false,
    );
    assert.equal(
      (await c.replacement.call(detail(shared))).view.canManage,
      false,
    );
    assert.equal(
      (
        await c.replacement.call(detail(shared), "PUT", {
          ...content("shared"),
          version: 1,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await c.owner(detail(shared), "PUT", {
          ...content("private"),
          version: 1,
        })
      ).status,
      403,
    );
    const edited = await c.owner(detail(shared), "PUT", {
      ...content("shared", "Admin renamed shared view"),
      version: 1,
    });
    assert.equal(edited.view.version, 2);
    assert.equal(edited.view.owner.id, c.person.id);
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.replacement.id);
    assert.equal((await c.replacement.call(root)).canShare, false);
    assert.equal(
      (await c.replacement.call(root, "POST", content("shared"))).status,
      403,
    );
    const read = (await c.replacement.call(detail(edited.view))).view,
      copy = await c.replacement.call(
        root,
        "POST",
        content("private", "Reader private copy", read.config),
      );
    assert.equal(copy.status, 200);
    assert.equal(copy.view.canManage, true);
    assert.equal((await c.owner(detail(copy.view))).status, 404);
    assert.equal(
      (
        await c.replacement.call(detail(copy.view), "PUT", {
          ...content("private", "Reader updated copy"),
          version: 1,
        })
      ).status,
      200,
    );
    assert.equal(
      (await c.replacement.call(detail(copy.view), "DELETE", { version: 2 }))
        .status,
      200,
    );
    const anon = await client(),
      foreign = await client();
    assert.equal((await anon(root)).status, 401);
    await foreign("auth/signup", "POST", {
      name: "Foreign preset user",
      email: randomUUID() + "@example.test",
      password: "foreign-preset-password",
    });
    assert.deepEqual((await foreign(root)).views, []);
    assert.equal((await foreign(detail(edited.view))).status, 404);
  },
);
test(
  "strict view schemas accept the three filter kinds and reject actions, authority fields, invalid dates, unknown keys and oversized text",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(false),
      valid = [
        config(),
        {
          kind: "workload",
          filters: { ...defaultWorkloadFilters },
          selected: randomUUID(),
        },
        {
          kind: "activity",
          filters: {
            packetId: randomUUID(),
            personId: "system",
            action: "plan",
            from: "2028-02-29",
            to: "2028-03-01",
          },
        },
      ];
    for (const v of valid) {
      const r = await c.owner(
        root,
        "POST",
        content("private", "Validated preset", v),
      );
      assert.equal(r.status, 200);
      assert.deepEqual(r.view.config, v);
    }
    for (const value of [
      { ...content(), ownerId: randomUUID() },
      { ...content(), name: "x" },
      { ...content(), name: "x".repeat(121) },
      { ...content(), visibility: "public" },
      content("private", "Unknown kind", { kind: "batch", filters: {} }),
      content("private", "Unknown field", { ...config(), page: 1 }),
      content("private", "Bad state", {
        kind: "requests",
        filters: { ...defaultInboxFilters, state: "injected" },
      }),
      content("private", "Long query", {
        kind: "requests",
        filters: { ...defaultInboxFilters, query: "x".repeat(161) },
      }),
      content("private", "Bad load", {
        kind: "workload",
        filters: { ...defaultWorkloadFilters, load: "capacity" },
        selected: null,
      }),
      content("private", "Missing selection", {
        kind: "workload",
        filters: { ...defaultWorkloadFilters },
      }),
      content("private", "Bad calendar", {
        kind: "activity",
        filters: {
          packetId: "",
          personId: "",
          action: "",
          from: "2027-02-29",
          to: "",
        },
      }),
      content("private", "Reverse dates", {
        kind: "activity",
        filters: {
          packetId: "",
          personId: "",
          action: "",
          from: "2028-03-02",
          to: "2028-03-01",
        },
      }),
      content("private", "Unsupported zone", {
        kind: "activity",
        filters: {
          packetId: "",
          personId: "",
          action: "",
          from: "",
          to: "",
          timeZone: "UTC",
        },
      }),
    ])
      assert.equal((await c.owner(root, "POST", value)).status, 400);
    assert.equal((await c.owner(root + "?extra=1")).status, 400);
    assert.equal((await c.owner(root, "PUT", {})).status, 405);
    assert.equal((await c.owner(root + "/bad/nested")).status, 404);
    for (const l of Object.values(savedViewLabels))
      assert.deepEqual(Object.keys(l), Object.keys(savedViewLabels.en));
  },
);
test(
  "edits, unsharing and deletion use current versions; stale cached shared presets cannot be applied after privacy changes",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(),
      r = await c.owner(root, "POST", content("shared")),
      v = r.view;
    assert.equal((await c.person.call(detail(v) + "?version=1")).status, 200);
    const changed = (
      await c.owner(detail(v), "PUT", {
        ...content("private", "Now private"),
        version: 1,
      })
    ).view;
    assert.equal(changed.version, 2);
    assert.equal((await c.person.call(detail(v) + "?version=1")).status, 404);
    assert.equal((await c.owner(detail(v) + "?version=1")).status, 409);
    assert.equal(
      (await c.owner(detail(v) + "?version=2&version=2")).status,
      400,
    );
    assert.equal(
      (await c.owner(detail(v), "PUT", { ...content(), version: 1 })).status,
      409,
    );
    assert.equal(
      (await c.owner(detail(v), "DELETE", { version: 1 })).status,
      409,
    );
    assert.equal(
      (await c.owner(detail(v), "DELETE", { version: 2 })).status,
      200,
    );
    assert.equal((await c.owner(detail(v))).status, 404);
    assert.equal(
      (await c.owner(detail(v), "PUT", { ...content(), version: 2 })).status,
      404,
    );
  },
);
test(
  "private and shared caps are independent, bounded and allow editing or removing existing presets at capacity",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(false),
      ids = [];
    for (const visibility of ["private", "shared"] as const)
      for (let n = 0; n < (visibility === "private" ? 25 : 50); n++) {
        const id = randomUUID();
        ids.push({ id, visibility });
        await c.local.put("librarySavedReviewView", {
          id,
          workspaceId: c.actor.workspaceId,
          ownerId: c.actor.id,
          version: 1,
          createdAt: c.local.now(),
          updatedAt: c.local.now(),
          ...content(visibility),
        });
      }
    assert.equal((await c.owner(root)).views.length, 75);
    assert.equal((await c.owner(root, "POST", content())).status, 409);
    assert.equal((await c.owner(root, "POST", content("shared"))).status, 409);
    const v = ids[0];
    assert.equal(
      (
        await c.owner(detail(v), "PUT", {
          ...content("private", "Update at capacity"),
          version: 1,
        })
      ).status,
      200,
    );
    assert.equal(
      (await c.owner(detail(v), "PUT", { ...content("shared"), version: 2 }))
        .status,
      409,
    );
    assert.equal(
      (await c.owner(detail(v), "DELETE", { version: 2 })).status,
      200,
    );
    assert.equal((await c.owner(root, "POST", content())).status, 200);
  },
);
test(
  "presets store only filters, preserve mine semantics for each viewer and never change requests, approvals or activity",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(),
      g = await c.create("Approved preset context", [c.actor.id]);
    let d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(g.d, { op: "decision", approved: true }),
    );
    d = await c.owner(g.path + "/review", "POST", finalReview(d));
    const prior = await c.local.get<any>(
        "libraryHandoffFeedback",
        d.packet.id,
        c.actor.workspaceId,
      ),
      packet = await c.local.get<any>(
        "libraryCollectionHandoff",
        d.packet.id,
        c.actor.workspaceId,
      ),
      history = await c.local.get<any>(
        "libraryReviewActivity",
        d.packet.id,
        c.actor.workspaceId,
      );
    const views = [
      config(),
      {
        kind: "workload",
        filters: { collectionId: g.collection.id, query: "", load: "pending" },
        selected: c.person.id,
      },
      {
        kind: "activity",
        filters: {
          packetId: d.packet.id,
          personId: c.person.id,
          action: "reviewer_approved",
          from: "2028-03-01",
          to: "2028-03-02",
        },
      },
    ];
    for (const cfg of views) {
      const r = await c.owner(
        root,
        "POST",
        content("shared", "Coordination filters", cfg),
      );
      assert.equal(r.status, 200);
      assert.deepEqual(
        (await c.person.call(detail(r.view) + "?version=1")).view.config,
        cfg,
      );
    }
    assert.deepEqual(
      await c.local.get(
        "libraryHandoffFeedback",
        d.packet.id,
        c.actor.workspaceId,
      ),
      prior,
    );
    assert.deepEqual(
      await c.local.get(
        "libraryCollectionHandoff",
        d.packet.id,
        c.actor.workspaceId,
      ),
      packet,
    );
    assert.deepEqual(
      await c.local.get(
        "libraryReviewActivity",
        d.packet.id,
        c.actor.workspaceId,
      ),
      history,
    );
    const h = await c.create("Personal mine semantics", [
      c.actor.id,
      c.person.id,
    ]);
    await c.owner(
      h.path + "/feedback",
      "POST",
      feedbackAction(h.d, { op: "decision", approved: true }),
    );
    const cfg = {
        kind: "requests",
        filters: { ...defaultInboxFilters, collectionId: h.collection.id },
      },
      saved = (
        await c.owner(
          root,
          "POST",
          content("shared", "My pending reviews", cfg),
        )
      ).view;
    const ownerQueue = await c.owner("library/review-inbox"),
      otherQueue = await c.person.call("library/review-inbox");
    assert.equal(
      selectInboxPackets(ownerQueue, saved.config.filters).length,
      0,
    );
    assert.equal(
      selectInboxPackets(otherQueue, saved.config.filters).length,
      1,
    );
    assert.equal(saved.config.filters.reviewer, "mine");
    const raw = await c.local.get<any>(
      "librarySavedReviewView",
      saved.id,
      c.actor.workspaceId,
    );
    assert.equal(JSON.stringify(raw).includes("PRIVATE_"), false);
    assert.equal(JSON.stringify(raw).includes(h.d.packet.title), false);
    assert.equal(JSON.stringify(raw).includes(c.person.name), false);
  },
);
test(
  "source removal keeps content-free unavailable filter IDs without widening scopes or copying deleted research",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(false),
      g = await c.create("Source scoped preset"),
      cfg = {
        kind: "activity",
        filters: {
          packetId: g.d.packet.id,
          personId: "",
          action: "",
          from: "",
          to: "",
        },
      },
      v = (
        await c.owner(
          root,
          "POST",
          content("private", "Retain unavailable scope", cfg),
        )
      ).view;
    await c.owner(
      `studies/${c.imports[0].s.id}/responses/${c.imports[0].interviewId}`,
      "DELETE",
    );
    const r = await c.owner(detail(v) + "?version=1");
    assert.equal(r.status, 200);
    assert.deepEqual(r.view.config, cfg);
    const filtered = await c.owner(
      "library/review-activity?" + new URLSearchParams(cfg.filters),
    );
    assert.equal(filtered.total, 0);
    assert.equal(
      JSON.stringify(await c.owner(root)).includes(g.d.packet.title),
      false,
    );
    assert.equal(
      (await c.local.list("libraryReviewActivity", c.actor.workspaceId)).length,
      0,
    );
    // A foreign or unavailable UUID is only a filter value, never an access grant.
    const unknown = {
      kind: "requests",
      filters: {
        ...defaultInboxFilters,
        collectionId: randomUUID(),
        reviewer: randomUUID(),
      },
    };
    const stored = (
      await c.owner(
        root,
        "POST",
        content("private", "Explicit empty scope", unknown),
      )
    ).view;
    assert.equal(
      selectInboxPackets(
        await c.owner("library/review-inbox"),
        stored.config.filters,
      ).length,
      0,
    );
  },
);
test(
  "role loss preserves personal management while shared ownership follows edit access; departed private owners are pruned and shared creators are masked",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(),
      privateView = (await c.person.call(root, "POST", content())).view,
      shared = (await c.person.call(root, "POST", content("shared"))).view;
    await c.local.db
      .prepare("UPDATE users SET role='viewer' WHERE id=?")
      .run(c.person.id);
    let catalog = await c.person.call(root);
    assert.equal(
      catalog.views.find((v: any) => v.id === privateView.id).canManage,
      true,
    );
    assert.equal(
      catalog.views.find((v: any) => v.id === shared.id).canManage,
      false,
    );
    assert.equal(
      (
        await c.person.call(detail(shared), "PUT", {
          ...content("shared"),
          version: 1,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await c.person.call(detail(privateView), "PUT", {
          ...content("private", "Reader owns private"),
          version: 1,
        })
      ).status,
      200,
    );
    await c.local.db
      .prepare("UPDATE users SET workspace_id=? WHERE id=?")
      .run(randomUUID(), c.person.id);
    catalog = await c.owner(root);
    assert.equal(
      catalog.views.some((v: any) => v.id === privateView.id),
      false,
    );
    const kept = catalog.views.find((v: any) => v.id === shared.id);
    assert.equal(kept.owner.name, null);
    assert.equal(kept.canManage, true);
    assert.equal(
      await c.local.get(
        "librarySavedReviewView",
        privateView.id,
        c.actor.workspaceId,
      ),
      undefined,
    );
    assert.equal((await c.person.call(detail(shared))).status, 404);
    assert.equal(
      (await c.owner(detail(shared), "DELETE", { version: 1 })).status,
      200,
    );
  },
);
test(
  "private presets persist across separate authenticated sessions and competing updates cannot silently overwrite each other",
  { timeout: 120000 },
  async () => {
    const c = await inboxSetup(false),
      v = (await c.owner(root, "POST", content())).view,
      session = await client();
    assert.equal(
      (
        await session("auth/login", "POST", {
          email: c.email,
          password: "saved-library-password",
        })
      ).status,
      200,
    );
    assert.deepEqual((await session(detail(v))).view.config, v.config);
    const r = await Promise.all(
      ["First update", "Second update"].map((name) =>
        session(detail(v), "PUT", { ...content("private", name), version: 1 }),
      ),
    );
    assert.deepEqual(r.map((v) => v.status).sort(), [200, 409]);
    const current = (await c.owner(detail(v))).view;
    assert.equal(current.version, 2);
    assert.ok(["First update", "Second update"].includes(current.name));
  },
);
