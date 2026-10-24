import test from "node:test";
import assert from "node:assert/strict";
import {
  guideSchema,
  templateGuide,
  nextQuestion,
  summarizeThemes,
  type Interview,
  type Turn,
} from "../src/lib/domain";
test("guide validation rejects forward references, duplicate IDs and empty choices", () => {
  const g = templateGuide();
  g.questions[0].condition = { questionId: "decision", optionId: "yes" };
  assert.equal(guideSchema.safeParse(g).success, false);
  g.questions[0].condition = null;
  g.questions[1].id = "screener";
  assert.equal(guideSchema.safeParse(g).success, false);
  g.questions[1].id = "decision";
  g.questions[0].options = [];
  assert.equal(guideSchema.safeParse(g).success, false);
});
test("branching skips unmet conditions and preserves stable option IDs", () => {
  const g = templateGuide();
  g.questions[1].condition = { questionId: "screener", optionId: "yes" };
  assert.equal(nextQuestion(g, 0, []), 2);
  assert.equal(
    nextQuestion(g, 0, [{ questionId: "screener", optionId: "yes" } as Turn]),
    1,
  );
});
test("theme counts deduplicate participants and exclude incomplete, hidden and preview responses", () => {
  const make = (id: string, extra: Partial<Interview> = {}) =>
    ({
      id,
      status: "complete",
      preview: false,
      excluded: false,
      turns: [],
      ...extra,
    }) as Interview;
  const i = [
    make("a"),
    make("b"),
    make("c", { excluded: true }),
    make("d", { preview: true }),
    make("e", { status: "active" }),
  ];
  const themes = [
    {
      id: "theme",
      title: "Friction",
      description: "",
      citations: ["a", "a", "b", "c", "d", "e"].map((id, n) => ({
        interviewId: id,
        turnId: "turn" + n,
        quote: "Exact quote",
      })),
    },
  ];
  const r = summarizeThemes(themes, i);
  assert.equal(r.denominator, 2);
  assert.equal(r.themes[0].count, 2);
  assert.equal(r.themes[0].percent, 100);
  assert.equal(summarizeThemes(themes, []).themes[0].percent, 0);
});
import { validateEvidence, csv } from "../src/lib/evidence";
test("citation validation rejects fabricated quotes and excluded sources", () => {
  const i = {
    id: "participant",
    status: "complete",
    excluded: false,
    preview: false,
    turns: [
      { id: "turn", answer: "The evidence was scattered across three tools." },
    ],
  } as Interview;
  const input = {
    summary: "",
    limitations: "",
    themes: [
      {
        title: "Scattered evidence",
        description: "",
        citations: [
          {
            interviewId: "participant",
            turnId: "turn",
            quote: "scattered across three tools",
          },
        ],
      },
    ],
  };
  assert.equal(validateEvidence(input, [i]).themes.length, 1);
  input.themes[0].citations[0].quote = "This quote was fabricated";
  assert.throws(() => validateEvidence(input, [i]), /INVALID_CITATION/);
  input.themes[0].citations[0].quote = "scattered across three tools";
  assert.throws(
    () => validateEvidence(input, [{ ...i, excluded: true }]),
    /INVALID_CITATION/,
  );
});
test("CSV exports quote commas/newlines and neutralize spreadsheet formulas", () => {
  const out = csv([['=HYPERLINK("bad")', "line one\nline two", "A,B"]]);
  assert.ok(out.includes("'="));
  assert.ok(out.includes('"line one\nline two"'));
  assert.ok(out.includes('"A,B"'));
});
import { remainingProbes } from "../src/lib/domain";
test("probe limits count the follow-up currently being answered, not only previously saved probes", () => {
  const q = templateGuide().questions[1];
  q.followUps = 1;
  assert.equal(remainingProbes(q, [], q.text), 1);
  assert.equal(remainingProbes(q, [], "Could you explain?"), 0);
  q.followUps = 2;
  assert.equal(
    remainingProbes(
      q,
      [{ questionId: q.id, followUp: true } as Turn],
      "Another follow-up?",
    ),
    0,
  );
});
