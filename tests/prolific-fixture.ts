import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { advancedSetup } from "./advanced-methods-fixture";
import { templateGuide } from "../src/lib/domain";
import { base } from "./harness";
import type { ProlificTransport } from "../src/lib/prolific-provider";
export async function prolificSetup() {
  const c = await advancedSetup(),
    guide = templateGuide("Synthetic Prolific study");
  guide.questions = [{ ...guide.questions[1], followUps: 0 }];
  guide.limit = 5;
  let study = await c.create(guide, guide.title);
  study = (
    await c.owner("studies/" + study.id + "/fielding", "POST", {
      state: "active",
    })
  ).study;
  const { dispatchProlific, syncProlific } =
    await import("../src/lib/prolific-server");
  const remotes = new Map<string, any>(),
    calls: { path: string; method: string; data?: any }[] = [];
  let paid = false,
    test = true,
    lose = false,
    hook: (() => Promise<void>) | undefined;
  let submissions: any[] = [],
    cost = {
      rewards: {
        rewards: { amount: 600, currency: "USD" },
        fees: { amount: 257, currency: "USD" },
        tax: { amount: 0, currency: "USD" },
      },
    };
  const provider: ProlificTransport = {
    binding: (workspaceId) =>
      workspaceId === c.actor.workspaceId
        ? {
            hash: "marked-provider-binding",
            researcherId: "researcher_1",
            projectId: "project_1",
            testEnabled: test,
            paidEnabled: paid,
          }
        : null,
    request: async (_workspaceId, path, method = "GET", data?: any) => {
      calls.push({ path, method, data: structuredClone(data) });
      if (path === "users/me/") return { id: "researcher_1" };
      if (path === "projects/project_1/") return { id: "project_1" };
      if (path.includes("/cost/")) return structuredClone(cost);
      if (path.startsWith("submissions/")) {
        if (hook) {
          const run = hook;
          hook = undefined;
          await run();
        }
        return { results: structuredClone(submissions) };
      }
      if (method === "POST" && path === "studies/") {
        const r = {
          ...structuredClone(data),
          id: "vendor_draft",
          status: "UNPUBLISHED",
        };
        remotes.set(r.id, r);
        if (lose) throw Error("Marked ambiguous response");
        return r;
      }
      const id = path.split("/")[1],
        r = remotes.get(id);
      assert.ok(r, "Missing marked provider study");
      if (method === "PATCH") {
        const updated = { ...r, ...structuredClone(data) };
        remotes.set(id, updated);
        return structuredClone(updated);
      }
      if (method === "POST" && path.endsWith("test-study")) {
        const clone = {
          ...structuredClone(r),
          id: "vendor_test",
          status: "ACTIVE",
        };
        remotes.set(clone.id, clone);
        return { study_id: clone.id };
      }
      if (method === "POST" && path.endsWith("transition/")) {
        const updated = {
          ...r,
          status: data.action === "PAUSE" ? "PAUSED" : "ACTIVE",
        };
        remotes.set(id, updated);
        return structuredClone(updated);
      }
      return structuredClone(r);
    },
  };
  const root = "studies/" + study.id + "/prolific";
  async function ask(action = "", method = "GET", value?: unknown) {
    return dispatchProlific(
      new Request(base + "/api/" + root + (action ? "/" + action : ""), {
        method,
        headers: { "content-type": "application/json" },
        ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      }),
      ["studies", study.id, "prolific", ...(action ? [action] : [])],
      provider,
      c.actor,
    );
  }
  const config = {
    title: "Synthetic recruitment",
    description: "A synthetic research workflow with no real participants.",
    minutes: 15,
    rewardMinor: 300,
    currency: "USD",
    places: 2,
    maxCostMinor: 1000,
    microphone: false,
    terms:
      "Provider submissions are reviewed. Contact the synthetic study team about technical issues or withdrawal.",
  };
  const saved = await (await ask("", "PUT", {
    version: 0,
    studyVersion: study.version,
    config,
    reviewed: true,
  }))!.json();
  assert.equal(saved.config.version, 1);
  async function current() {
    return (await (await ask())!.json()).config;
  }
  async function operation(kind: string, extra: any = {}) {
    const cfg = await current();
    return ask("operations", "POST", {
      version: cfg.version,
      kind,
      requestId: randomUUID(),
      reviewed: true,
      ...extra,
    });
  }
  return {
    ...c,
    study,
    root,
    config,
    provider,
    remotes,
    calls,
    ask,
    current,
    operation,
    sync: () => syncProlific(study.id, c.actor.workspaceId, provider),
    paid: (v: boolean) => {
      paid = v;
    },
    test: (v: boolean) => {
      test = v;
    },
    lose: (v: boolean) => {
      lose = v;
    },
    submissions: (v: any[]) => {
      submissions = v;
    },
    cost: (v: any) => {
      cost = v;
    },
    beforeSyncCommit: (v: () => Promise<void>) => {
      hook = v;
    },
  };
}
