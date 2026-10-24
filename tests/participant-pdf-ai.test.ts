import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { participantPDFProbe } from "../src/lib/participant-pdf-ai-server";
import {
  pdfAIPermissionText,
  pdfAIPermissionVersion,
  pdfProbePromptVersion,
  pdfProbePages,
  usablePDFProbe,
} from "../src/lib/participant-pdf-ai";
import { participantPDFGuide } from "./participant-pdfs-fixture";
import { guideSchema, type Interview } from "../src/lib/domain";
import { generationBody } from "../src/lib/ai";
function fixture() {
  const guide = participantPDFGuide();
  guide.questions[0].participantPDFAI = true;
  guide.questions[0].followUps = 1;
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    studyId: randomUUID(),
    version: 0,
    current: 0,
    status: "active",
    guide,
    language: "en",
    participantPDFDraft: {
      version: 0,
      pdf: {
        id: randomUUID(),
        description: "Synthetic workflow document",
        pages: 2,
        bytes: 20,
        uploadedAt: "now",
        aiPermission: {
          version: pdfAIPermissionVersion,
          provider: "OpenAI",
          text: pdfAIPermissionText,
          language: "en",
          grantedAt: "now",
        },
      },
    },
  } as Interview;
}
test("PDF probing requires frozen setting and exact per-upload permission/version before reading or sending text", async () => {
  let reads = 0,
    calls = 0;
  const deps = {
    aiReady: () => true,
    model: () => "fixture",
    readRecording: async () => {
      reads++;
      return Buffer.from("pdf");
    },
    extractPDFText: async () => ["Save draft"],
    generate: async () => {
      calls++;
      return {
        probe: "How does Save draft help you?",
        page: 1,
        quote: "Save draft",
      };
    },
  };
  for (const mutate of [
    (i: Interview) => {
      i.guide.questions[0].participantPDFAI = false;
    },
    (i: Interview) => {
      delete i.participantPDFDraft!.pdf.aiPermission;
    },
    (i: Interview) => {
      i.participantPDFDraft!.pdf.aiPermission!.version = "old";
    },
    (i: Interview) => {
      i.participantPDFDraft!.version = 1;
    },
    (i: Interview) => {
      i.status = "complete";
    },
  ]) {
    const i = fixture();
    mutate(i);
    assert.equal(await participantPDFProbe(i, "It helped", deps), null);
  }
  assert.equal(reads, 0);
  assert.equal(calls, 0);
  assert.equal(
    (await participantPDFProbe(fixture(), "It helped", {
      ...deps,
      aiReady: () => false,
    }))!.status,
    "unavailable",
  );
  assert.equal(reads, 0);
  const g = fixture().guide;
  g.questions[0].followUps = 0;
  assert.equal(guideSchema.safeParse(g).success, false);
});
test("PDF context comes from stored bytes, caps page text, uses non-stored bounded generation and records page/digest provenance", async () => {
  const i = fixture();
  let calls = 0;
  const result = await participantPDFProbe(i, "It helped me retain work", {
    aiReady: () => true,
    model: () => "fixture",
    readRecording: async (id) => {
      assert.equal(id, i.participantPDFDraft!.pdf.id);
      return Buffer.from("prepared-pdf");
    },
    extractPDFText: async () => [
      "Save draft " + "x".repeat(1500),
      "Submit sends a response",
    ],
    generate: async (system, input, w, s, operation, schema, options) => {
      calls++;
      const p = input as any;
      assert.equal(operation, "pdf-probe");
      assert.equal(p.pages[0].text.length, 1000);
      assert.equal(p.pages[1].page, 2);
      assert.equal(p.pdfDescription, i.participantPDFDraft!.pdf.description);
      assert.equal(p.answer, "It helped me retain work");
      assert.equal(options!.image, undefined);
      assert.equal(options!.maxTokens, 600);
      assert.ok(options!.signal instanceof AbortSignal);
      assert.equal(generationBody(system, input, schema, options).store, false);
      assert.match(system, /untrusted data/);
      return {
        probe: "What does Save draft help you do?",
        page: 1,
        quote: "Save draft",
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result!.status, "asked");
  assert.equal(result!.page, 1);
  assert.equal(result!.quote, "Save draft");
  assert.equal(result!.contextTruncated, true);
  assert.equal(result!.promptVersion, pdfProbePromptVersion);
  assert.match(result!.pdfSha256!, /^[a-f0-9]{64}$/);
  assert.deepEqual(result!.pagesConsidered, [1, 2]);
  assert.equal(pdfProbePages(Array(25).fill("a")).length, 20);
});
test("PDF page/quote mismatch, instructions, unsafe questions and provider/extraction failures cannot ask a question; scans skip generation", async () => {
  const pages = [{ page: 2, text: "Save draft retains work" }],
    valid = {
      probe: "How does Save draft help you?",
      page: 2,
      quote: "Save draft",
    };
  assert.ok(usablePDFProbe(valid, pages));
  for (const c of [
    { page: 1 },
    { quote: "invented" },
    { probe: "What does Submit help you do?" },
    { probe: "What is the password for Save draft?" },
    { probe: "Save draft? Why?" },
  ])
    assert.equal(usablePDFProbe({ ...valid, ...c }, pages), null);
  assert.deepEqual(
    usablePDFProbe({ probe: null, page: null, quote: null }, pages),
    { probe: null, page: null, quote: null },
  );
  let calls = 0;
  const deps = {
    aiReady: () => true,
    model: () => "fixture",
    readRecording: async () => Buffer.from("pdf"),
    extractPDFText: async () => [""],
    generate: async () => {
      calls++;
      return valid;
    },
  };
  assert.equal(
    (await participantPDFProbe(fixture(), "It helped", deps))!.status,
    "none",
  );
  assert.equal(calls, 0);
  assert.equal(
    (await participantPDFProbe(fixture(), "It helped", {
      ...deps,
      extractPDFText: async () => {
        throw Error();
      },
    }))!.status,
    "unavailable",
  );
  assert.equal(
    (await participantPDFProbe(fixture(), "It helped", {
      ...deps,
      extractPDFText: async () => ["Save draft"],
      generate: async () => {
        throw Error();
      },
    }))!.status,
    "unavailable",
  );
  assert.equal(
    (await participantPDFProbe(fixture(), "It helped", {
      ...deps,
      extractPDFText: async () => ["Save draft"],
    }))!.status,
    "rejected",
  );
});
