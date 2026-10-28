import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { workloadSetup } from "./review-workload-fixture";
import { feedbackAction } from "./team-review-inbox-fixture";
import { initialUnifiedFilters } from "../src/lib/unified-planning";
export async function combinedSetup() {
  const c = await workloadSetup(),
    g = await c.create("Combined calendar", [c.actor.id, c.person.id]),
    tasks = [];
  for (const [assigneeId, dueDate, status] of [
    [c.actor.id, "2028-02-29", "open"],
    [null, null, "open"],
    [c.person.id, "2028-02-29", "completed"],
  ]) {
    const r = await c.owner(
      `library/collections/${g.collection.id}/tasks`,
      "POST",
      {
        requestId: randomUUID(),
        title:
          tasks.length === 0
            ? "=COMBINED_TITLE"
            : "Combined task " + tasks.length,
        assigneeId,
        dueDate,
        status,
        target: { kind: "interview", id: c.imports[0].interviewId },
      },
    );
    assert.equal(r.status, 201);
    tasks.push(r.task);
  }
  let d = await c.owner(g.path);
  for (const reviewerId of [c.actor.id, c.person.id])
    d = await c.owner(
      g.path + "/feedback",
      "POST",
      feedbackAction(d, { op: "deadline", reviewerId, dueDate: "2028-02-29" }),
    );
  return {
    ...c,
    g,
    tasks,
    config: {
      kind: "unified" as const,
      filters: {
        ...initialUnifiedFilters("2028-02-29"),
        collectionId: g.collection.id,
      },
      language: "en" as const,
      timeZone: "America/Los_Angeles",
    },
  };
}
