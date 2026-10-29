import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { savedLibrarySetup } from "./library-answers-fixture";
import { maxdiffInterview, simulatedRespondents } from "./maxdiff-fixture";
import { cardsortInterview } from "./cardsort-fixture";
import { pulseFixture } from "./pulse-fixture";
import { beginMaxdiff, applyMaxdiff } from "../src/lib/maxdiff";
export async function advancedSetup() {
  const c = await savedLibrarySetup([]);
  async function create(guide: any, title: string) {
    let s = (await c.owner("studies", "POST", { title })).study;
    s = (await c.owner("studies/" + s.id, "PUT", { guide, version: s.version }))
      .study;
    s = (
      await c.owner("studies/" + s.id + "/publish", "POST", {
        version: s.version,
      })
    ).study;
    return s;
  }
  return { ...c, create };
}
export async function hierarchicalFixture() {
  const guide = maxdiffInterview().guide;
  guide.questions[0].maxdiff!.cycles = 2;
  const c = await advancedSetup(),
    s = await c.create(guide, "Synthetic hierarchical study");
  const rows = Array.from({ length: 40 }, (_, r) =>
      Array.from(
        { length: 2 },
        (_, cycle) =>
          simulatedRespondents(
            1,
            r % 2 ? [1.2, -0.8, 0.6, -1] : [-0.8, 1.2, -1, 0.6],
            123 + r * 17 + cycle,
          )[0],
      ).flat(),
    ),
    ids: string[] = [];
  for (const choices of rows) {
    const i = maxdiffInterview();
    i.id = randomUUID();
    i.studyId = s.id;
    i.workspaceId = c.actor.workspaceId;
    i.revisionId = s.revisionId;
    i.guide = structuredClone(s.draft);
    i.maxdiffStates = {};
    beginMaxdiff(i, i.guide.questions[0], (n) => n - 1);
    const state = i.maxdiffStates!.maxdiff;
    state.tasks = choices.map((c) => c.set.map(String));
    state.choices = [];
    for (const choice of choices) {
      const prompt = i.prompt,
        result = applyMaxdiff(i, i.guide.questions[0], {
          best: String(choice.best),
          worst: String(choice.worst),
        });
      i.turns.push({
        id: randomUUID(),
        questionId: "maxdiff",
        prompt,
        ...result,
        followUp: false,
        createdAt: new Date().toISOString(),
        source: "typed",
        strategy: "guide",
      });
    }
    i.status = "complete";
    ids.push(i.id);
    await c.local.put("interview", i);
  }
  await c.local.dirty(s);
  const root = "studies/" + s.id + "/maxdiff",
    r = (await c.owner(root)).results[0];
  const input = {
    revisionId: r.revisionId,
    questionId: r.questionId,
    conceptId: r.conceptId,
    sourceFingerprint: r.sourceFingerprint,
    portfolioSize: 2,
    topItems: 1,
  };
  return { ...c, s, root, input, ids };
}
export async function flexibleFixture(
  mode: "open" | "hybrid",
  c?: Awaited<ReturnType<typeof advancedSetup>>,
) {
  const a = c || (await advancedSetup()),
    g = cardsortInterview().guide;
  g.questions[0].cardsort = {
    ...g.questions[0].cardsort!,
    mode,
    groups: mode === "open" ? [] : g.questions[0].cardsort!.groups,
    askReason: false,
  };
  const s = await a.create(g, "Synthetic " + mode + " sort");
  await a.owner("studies/" + s.id + "/fielding", "POST", { state: "active" });
  return { ...a, s };
}
export async function scheduledFixture(
  c?: Awaited<ReturnType<typeof advancedSetup>>,
) {
  const a = c || (await advancedSetup()),
    s = await a.create(pulseFixture().guide, "Synthetic scheduled Pulse");
  const r = await a.owner(`studies/${s.id}/pulse`, "POST", {
    version: s.version,
    name: "Synthetic scheduled tracker",
    label: "Baseline wave",
    date: "2026-10-20",
    recruitment: "Self-recruited internal pilot",
  });
  assert.equal(r.status, 201, JSON.stringify(r));
  return { ...a, s, series: r.series, root: `pulse/${r.series.id}/schedule` };
}
