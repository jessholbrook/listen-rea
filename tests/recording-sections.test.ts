import test from "node:test";
import assert from "node:assert/strict";
import {
  validateRecordingSections,
  initialRecordingSections,
  recordingSection,
} from "../src/lib/recording-sections";
test("speaker sections require full exact text coverage, bounded audio, Unicode boundaries and reviewed labels/timing", () => {
  const text = "What happened?\n\nThe draft was saved.",
    cut = text.indexOf("The"),
    sections = [
      { start: 0, end: cut, speaker: "Interviewer", startMs: 0, endMs: 1000 },
      {
        start: cut,
        end: text.length,
        speaker: "Participant",
        startMs: 1500,
        endMs: 3000,
      },
    ];
  assert.doesNotThrow(() =>
    validateRecordingSections(text, sections, 3000, true),
  );
  assert.doesNotThrow(() =>
    validateRecordingSections(
      text,
      initialRecordingSections(text),
      3000,
      false,
    ),
  );
  for (const altered of [
    [],
    [{ ...sections[0], start: 1 }, sections[1]],
    [sections[0], { ...sections[1], end: text.length - 1 }],
    [sections[0], { ...sections[1], startMs: 999 }],
    [sections[0], { ...sections[1], endMs: 3001 }],
    [sections[0], { ...sections[1], speaker: "" }],
    [sections[0], { ...sections[1], startMs: null }],
    [sections[0], { ...sections[1], endMs: 1500 }],
  ])
    assert.throws(
      () => validateRecordingSections(text, altered, 3000, true),
      /RECORDING_SECTIONS_INVALID/,
    );
  assert.equal(
    recordingSection.safeParse({ ...sections[0], mediaId: "forged" }).success,
    false,
  );
  const unicode = "a😀b";
  assert.throws(() =>
    validateRecordingSections(
      unicode,
      [
        { ...sections[0], end: 2 },
        { ...sections[1], start: 2, end: 4 },
      ],
      3000,
      true,
    ),
  );
});

test("many-paragraph transcript initialization remains editable within the section bound and preserves all text", () => {
  const text = "Repeated paragraph.\n\n".repeat(500).trim(),
    sections = initialRecordingSections(text);
  assert.ok(sections.length <= 200);
  assert.equal(sections.map((s) => text.slice(s.start, s.end)).join(""), text);
  assert.doesNotThrow(() =>
    validateRecordingSections(text, sections, 3600000, false),
  );
});
