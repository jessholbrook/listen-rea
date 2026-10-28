import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  docxProbeFingerprint,
  docxReviewSnapshot,
} from "../src/lib/docx-observations-server";
import type { DOCXProbe } from "../src/lib/participant-docx";

test("DOCX grounding reviews bind the original question to actual prepared bytes and a valid source paragraph", () => {
  const bytes = Buffer.from(
    JSON.stringify({
      version: 1,
      paragraphs: ["First paragraph", "Save draft before review."],
    }),
  );
  const digest = createHash("sha256").update(bytes).digest("hex");
  const probe: DOCXProbe = {
    docxId: "synthetic",
    status: "asked",
    probe: "How does Save draft help?",
    paragraph: 2,
    quote: "Save draft",
    snapshotSha256: digest,
    generatedAt: "2026-10-21T00:00:00Z",
    permissionVersion: "fixture",
    promptVersion: "fixture",
    model: "fixture",
  };
  assert.equal(docxReviewSnapshot(bytes, probe), digest);
  assert.throws(
    () =>
      docxReviewSnapshot(
        Buffer.from(
          JSON.stringify({
            version: 1,
            paragraphs: ["Changed", "Save draft before review."],
          }),
        ),
        probe,
      ),
    /no longer matches/,
  );
  assert.throws(
    () => docxReviewSnapshot(bytes, { ...probe, paragraph: 1 }),
    /no longer matches/,
  );
  assert.throws(
    () => docxReviewSnapshot(bytes, { ...probe, quote: "Invented" }),
    /no longer matches/,
  );
  assert.throws(
    () => docxReviewSnapshot(bytes, { ...probe, snapshotSha256: undefined }),
    /no longer matches/,
  );
  // Unsupported interpretations remain reviewable when their cited source is intact.
  const changed = { ...probe, probe: "Unsupported interpretation?" };
  assert.equal(docxReviewSnapshot(bytes, changed), digest);
  assert.notEqual(
    docxProbeFingerprint("source", probe, digest),
    docxProbeFingerprint("source", changed, digest),
  );
  assert.notEqual(
    docxProbeFingerprint("source", undefined, digest),
    docxProbeFingerprint("source", probe, digest),
  );
});
