import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAttributeCsv,
  rankEvidence,
  excerpt,
  verifiedLibraryAnswer,
  type LibraryHit,
} from "../src/lib/library";
test("attribute CSV preserves quoted values and reports structural errors without unsafe keys", () => {
  const c = parseAttributeCsv(
    '\ufeffresponse_id,segment,note\r\nabc,"Enterprise, EU","First line\nsecond ""quoted"" line"\r\n',
  );
  assert.equal(c.rows.length, 1);
  assert.equal(c.rows[0].attributes.segment, "Enterprise, EU");
  assert.equal(c.rows[0].attributes.note, 'First line\nsecond "quoted" line');
  assert.throws(() => parseAttributeCsv("email,segment\na,b"), /first column/);
  assert.throws(
    () => parseAttributeCsv("response_id,constructor\na,b"),
    /Attribute names/,
  );
  assert.throws(
    () => parseAttributeCsv("response_id,segment,segment\na,b,c"),
    /unique/,
  );
  assert.throws(
    () => parseAttributeCsv('response_id,segment\na,"unfinished'),
    /not closed/,
  );
  assert.throws(
    () => parseAttributeCsv('response_id,segment\na,"x"oops'),
    /Unexpected/,
  );
  assert.ok(parseAttributeCsv("response_id,segment\na,b,c").rows[0].error);
  assert.ok(
    parseAttributeCsv("response_id,segment\na," + "x".repeat(501)).rows[0]
      .error,
  );
  assert.throws(
    () =>
      parseAttributeCsv(
        "response_id,segment\n" +
          Array.from({ length: 201 }, (_, n) => n + ",a").join("\n"),
      ),
    /200/,
  );
});
const hit = (studyId: string, quote: string): LibraryHit => ({
  studyId,
  studyTitle: "Product research",
  interviewId: "response-" + studyId,
  turnId: "turn-" + studyId,
  prompt: "Recent decisions",
  quote,
  source: "interview",
  sourceTitle: "Interview",
  externalId: "",
  revisionId: "rev-" + studyId,
  attributes: {},
});
test("library retrieval preserves source context and exact contiguous excerpts", () => {
  const hits = [
    hit("one", "Feedback is useful."),
    hit("two", "We use feedback for product decisions."),
    hit("three", "Nothing related."),
  ];
  assert.equal(
    rankEvidence(hits, "How do we use feedback for decisions?")[0].studyId,
    "two",
  );
  assert.equal(rankEvidence(hits, "unobtanium").length, 0);
  const text = "x".repeat(1000) + " feedback decisions " + "y".repeat(1000),
    e = excerpt(text, "feedback", 300);
  assert.equal(e.length, 300);
  assert.ok(text.includes(e));
  assert.ok(e.includes("feedback"));
});
test("library answers reject invented study IDs, turn IDs and quotes outside supplied excerpts", () => {
  const evidence = [hit("one", "We review feedback before deciding.")],
    citation = {
      studyId: "one",
      interviewId: "response-one",
      turnId: "turn-one",
      quote: "review feedback",
    };
  assert.equal(
    verifiedLibraryAnswer(
      { answer: "Tentative finding.", citations: [citation] },
      evidence,
    ).citations.length,
    1,
  );
  for (const c of [
    { ...citation, studyId: "elsewhere" },
    { ...citation, turnId: "foreign" },
    { ...citation, quote: "We invent quotes." },
  ])
    assert.throws(
      () => verifiedLibraryAnswer({ answer: "", citations: [c] }, evidence),
      /INVALID_CITATION/,
    );
  assert.match(
    verifiedLibraryAnswer(
      { answer: "An unsupported assertion", citations: [] },
      evidence,
    ).answer,
    /not enough/,
  );
});
