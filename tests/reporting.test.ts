import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  defaultStyle,
  captionsVtt,
  editionInput,
  type ReportEdition,
} from "../src/lib/reporting";
import { presentation } from "../src/lib/presentation";
test("caption export keeps reel offsets, treats markup as text and does not invent word timing", () => {
  const vtt = captionsVtt([
    {
      startMs: 1000,
      endMs: 2500,
      caption: "First <b>quote</b> & context\ncontinued",
    },
    { startMs: 500, endMs: 1500, caption: "Second caption" },
  ]);
  assert.match(vtt, /00:00:00.000 --> 00:00:01.500/);
  assert.match(vtt, /00:00:01.500 --> 00:00:02.500/);
  assert.match(vtt, /&lt;b&gt;quote&lt;\/b&gt; &amp; context continued/);
});
test("editable presentation preserves visible text, exact citations and provenance while hiding blocks", async () => {
  const e: ReportEdition = {
    id: "edition",
    workspaceId: "workspace",
    studyId: "study",
    sourceAnalysisId: "analysis",
    sourceAnalysisVersion: 2,
    dataVersion: 3,
    version: 4,
    sampleSize: 2,
    title: "Product evidence",
    blocks: [
      {
        id: "one",
        title: "Finding",
        body: "A tentative interpretation.",
        hidden: false,
        citations: [
          {
            interviewId: "participant-123",
            turnId: "turn-456",
            quote: "We check the original evidence.",
          },
        ],
      },
      {
        id: "hidden",
        title: "Not for export",
        body: "HIDDEN-BLOCK-SECRET",
        hidden: true,
        citations: [],
      },
    ],
    style: { ...defaultStyle, brand: "Research team" },
    reviewed: true,
    createdAt: "2026-10-19",
    updatedAt: "2026-10-19",
  };
  const zip = await JSZip.loadAsync(await presentation(e)),
    parts = await Promise.all(
      Object.entries(zip.files)
        .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .map(([, f]) => f.async("string")),
    ),
    text = parts.join("\n");
  assert.match(text, /A tentative interpretation\./);
  assert.match(text, /We check the original evidence\./);
  assert.match(text, /participant-123/);
  assert.match(text, /turn-456/);
  assert.match(text, /Research team/);
  assert.match(text, /Response set: 3/);
  assert.ok(!text.includes("HIDDEN-BLOCK-SECRET"));
  assert.match(text, /<a:t>/);
  assert.equal(
    editionInput.safeParse({
      ...e,
      blocks: e.blocks.map((b) => ({ ...b, hidden: true })),
    }).success,
    false,
  );
});
