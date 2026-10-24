import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { start, stop, client } from "../tests/harness";
import { guideSchema, type Interview } from "../src/lib/domain";
if (!process.env.RESEARCH_AI_KEY) {
  console.error(
    "RESEARCH_AI_KEY is required. Configure it securely before running the live evaluation.",
  );
  process.exit(2);
}
const checks: {
  check: string;
  passed: boolean;
  details?: unknown;
  elapsedMs?: number;
}[] = [];
try {
  await start({ live: true });
  const owner = await client(),
    participant = await client();
  await owner("auth/signup", "POST", {
    name: "Synthetic Evaluation",
    email: "evaluation@example.test",
    password: "synthetic-test-password",
  });
  let study = (
    await owner("studies", "POST", {
      title: "Synthetic feedback research evaluation",
      goal: "Understand how teams retrieve customer feedback and distinguish scattered sources from an organized process.",
    })
  ).study;
  let t = Date.now();
  const draft = await owner("studies/" + study.id + "/draft", "POST");
  assert.equal(draft.status, 200, JSON.stringify(draft));
  assert.ok(guideSchema.safeParse(draft.guide).success);
  checks.push({
    check:
      "Generated guide passes production schema without saving automatically",
    passed: true,
    elapsedMs: Date.now() - t,
    details: draft.guide.questions.map((q: any) => q.text),
  });
  console.log("Live guide generation passed.");
  const g = study.draft;
  g.questions = [
    {
      ...g.questions[0],
      text: "Which setup describes your team?",
      options: [
        { id: "scattered", text: "Several separate tools", rejects: false },
        { id: "organized", text: "One organized source", rejects: false },
      ],
    },
    {
      ...g.questions[1],
      text: "Tell me about the last time you looked up customer feedback.",
      followUps: 1,
    },
    {
      ...g.questions[2],
      id: "end",
      type: "statement",
      text: "Thank you for sharing your experience.",
      followUps: 0,
    },
  ];
  study = (
    await owner("studies/" + study.id, "PUT", {
      guide: g,
      version: study.version,
    })
  ).study;
  study = (
    await owner("studies/" + study.id + "/publish", "POST", {
      version: study.version,
    })
  ).study;
  await owner("studies/" + study.id + "/fielding", "POST", { state: "active" });
  const fixtures = [
    {
      option: "scattered",
      answer:
        "We lost hours searching interview notes, support tickets, and spreadsheets for the original customer quote.",
      follow:
        "The original quote was in a spreadsheet. We could not easily trace the summary back to its source.",
    },
    {
      option: "organized",
      answer:
        "Our single research notebook works well. We found the source quote immediately and had no trouble retrieving the evidence.",
      follow:
        "The organized notebook lets us find exact quotes quickly. Retrieval was not a problem in this decision.",
    },
  ];
  for (const fixture of fixtures) {
    let r = await participant("public/" + study.id, "POST", { consent: true });
    let i: Interview = r.interview;
    const headers = { "x-interview-token": r.token };
    r = await participant(
      "interviews/" + i.id + "/answer",
      "POST",
      {
        requestId: crypto.randomUUID(),
        version: i.version,
        answer: "",
        optionId: fixture.option,
      },
      headers,
    );
    i = r.interview;
    t = Date.now();
    r = await participant(
      "interviews/" + i.id + "/answer",
      "POST",
      {
        requestId: crypto.randomUUID(),
        version: i.version,
        answer: fixture.answer,
      },
      headers,
    );
    assert.equal(r.status, 200, JSON.stringify(r));
    i = r.interview;
    checks.push({
      check: "Bounded AI probing: " + fixture.option,
      passed: true,
      elapsedMs: Date.now() - t,
      details: i.current === 1 ? i.prompt : "No probe needed",
    });
    if (i.current === 1) {
      assert.equal(i.strategy, "ai");
      r = await participant(
        "interviews/" + i.id + "/answer",
        "POST",
        {
          requestId: crypto.randomUUID(),
          version: i.version,
          answer: fixture.follow,
        },
        headers,
      );
      assert.equal(r.status, 200, JSON.stringify(r));
      i = r.interview;
      assert.notEqual(i.current, 1, "Probe limit exceeded");
    }
    r = await participant(
      "interviews/" + i.id + "/answer",
      "POST",
      { requestId: crypto.randomUUID(), version: i.version, answer: "" },
      headers,
    );
    assert.equal(r.interview.status, "complete");
  }
  console.log("Live bounded probes passed for both fixture viewpoints.");
  t = Date.now();
  const analysis = await owner("studies/" + study.id + "/analysis", "POST", {
    mode: "ai",
  });
  assert.equal(analysis.status, 200, JSON.stringify(analysis));
  assert.equal(analysis.stats.denominator, 2);
  const data = await owner("studies/" + study.id);
  const ids = new Set(
    analysis.analysis.themes.flatMap((theme: any) =>
      theme.citations.map((c: any) => c.interviewId),
    ),
  );
  assert.equal(
    ids.size,
    2,
    "The minority/contrary viewpoint was omitted from coded evidence",
  );
  checks.push({
    check: "Source-validated synthesis includes both contrasting viewpoints",
    passed: true,
    elapsedMs: Date.now() - t,
    details: analysis.analysis.themes.map((x: any) => ({
      title: x.title,
      description: x.description,
      citations: x.citations,
    })),
  });
  t = Date.now();
  const qa = await owner("studies/" + study.id + "/qa", "POST", {
    question: "What were the participants exact annual salaries?",
  });
  assert.equal(qa.status, 200, JSON.stringify(qa));
  assert.match(
    qa.answer,
    /not|insufficient|no (information|data|evidence)|cannot|doesn.t/i,
  );
  checks.push({
    check: "Unsupported question does not invent salary data",
    passed: true,
    elapsedMs: Date.now() - t,
    details: qa.answer,
  });
  assert.equal(
    data.interviews.filter((i: Interview) => i.status === "complete").length,
    2,
  );
  console.log(
    "Live source-backed analysis and unsupported-question check passed.",
  );
} catch (e) {
  checks.push({
    check: "Evaluation stopped",
    passed: false,
    details: (e as Error).message,
  });
  console.error("Live evaluation did not complete:", (e as Error).message);
  process.exitCode = 1;
} finally {
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/live-ai-evaluation.json",
    JSON.stringify(
      { date: new Date().toISOString(), syntheticFixtures: true, checks },
      null,
      2,
    ),
  );
  await stop();
}
