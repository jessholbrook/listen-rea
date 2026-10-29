import { advancedSetup } from "./advanced-methods-fixture";
import { templateGuide } from "../src/lib/domain";
import { client } from "./image-review-fixture";
export async function richerFixture(
  task = true,
  setup?: Awaited<ReturnType<typeof advancedSetup>>,
) {
  const c = setup || (await advancedSetup()),
    guide = templateGuide();
  guide.questions = [
    {
      ...guide.questions[1],
      id: "task-question",
      text: "Find the support page and describe what you see.",
      followUps: 0,
      ...(task
        ? { task: { url: "https://example.com/task", maxSeconds: 60 } }
        : {}),
    },
  ];
  const s = await c.create(
    guide,
    task
      ? "Synthetic richer usability task"
      : "Synthetic streaming voice interview",
  );
  await c.owner(`studies/${s.id}/fielding`, "POST", { state: "active" });
  const person = await client(),
    joined = await person(`public/${s.id}`, "POST", {
      consent: true,
      attributes: { segment: "Team" },
    });
  return {
    ...c,
    s,
    person,
    joined,
    i: joined.interview,
    headers: { "x-interview-token": joined.token },
    root: "interviews/" + joined.interview.id,
  };
}
