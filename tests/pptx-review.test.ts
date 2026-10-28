import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  pptxProbeFingerprint,
  pptxReviewSnapshot,
} from "../src/lib/pptx-observations-server";
import type { PPTXProbe } from "../src/lib/participant-pptx";

test("PPTX grounding reviews bind the original question to actual prepared bytes and a valid source slide", () => {
  const bytes = Buffer.from(
    JSON.stringify({
      version: 1,
      slides: ["First slide", "Save draft before review."],
    }),
  );
  const digest = createHash("sha256").update(bytes).digest("hex");
  const probe: PPTXProbe = {
    pptxId: "synthetic",
    status: "asked",
    probe: "How does Save draft help?",
    slide: 2,
    quote: "Save draft",
    snapshotSha256: digest,
    generatedAt: "2026-10-21T00:00:00Z",
    permissionVersion: "fixture",
    promptVersion: "fixture",
    model: "fixture",
  };
  assert.equal(pptxReviewSnapshot(bytes, probe), digest);
  assert.throws(
    () =>
      pptxReviewSnapshot(
        Buffer.from(
          JSON.stringify({
            version: 1,
            slides: ["Changed", "Save draft before review."],
          }),
        ),
        probe,
      ),
    /no longer matches/,
  );
  assert.throws(
    () => pptxReviewSnapshot(bytes, { ...probe, slide: 1 }),
    /no longer matches/,
  );
  assert.throws(
    () => pptxReviewSnapshot(bytes, { ...probe, quote: "Invented" }),
    /no longer matches/,
  );
  assert.throws(
    () => pptxReviewSnapshot(bytes, { ...probe, snapshotSha256: undefined }),
    /no longer matches/,
  );
  // Unsupported interpretations remain reviewable when their cited source is intact.
  const changed = { ...probe, probe: "Unsupported interpretation?" };
  assert.equal(pptxReviewSnapshot(bytes, changed), digest);
  assert.notEqual(
    pptxProbeFingerprint("source", probe, digest),
    pptxProbeFingerprint("source", changed, digest),
  );
  assert.notEqual(
    pptxProbeFingerprint("source", undefined, digest),
    pptxProbeFingerprint("source", probe, digest),
  );
});
