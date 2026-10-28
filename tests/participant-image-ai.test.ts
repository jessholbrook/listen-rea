import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { participantImageProbe } from "../src/lib/participant-image-ai-server";
import {
  imageAIPermissionText,
  imageAIPermissionVersion,
  imageProbePromptVersion,
  usableImageProbe,
} from "../src/lib/participant-image-ai";
import { generationBody } from "../src/lib/ai";
import { participantImageGuide } from "./participant-images-fixture";
import type { Interview } from "../src/lib/domain";
function fixture() {
  const guide = participantImageGuide();
  guide.questions[0].participantImageAI = true;
  guide.questions[0].followUps = 2;
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    studyId: randomUUID(),
    version: 0,
    current: 0,
    guide,
    language: "en",
    participantImageDraft: {
      version: 0,
      image: {
        id: randomUUID(),
        description: "A screenshot of the Save draft button",
        bytes: 8,
        width: 1,
        height: 1,
        uploadedAt: new Date().toISOString(),
        aiPermission: {
          version: imageAIPermissionVersion,
          provider: "OpenAI",
          text: imageAIPermissionText,
          language: "en",
          grantedAt: new Date().toISOString(),
        },
      },
    },
  } as Interview;
}
test("Image probes require the published setting, exact upload permission and answer version before reading any bytes or contacting a provider", async () => {
  let reads = 0,
    calls = 0;
  const deps = {
    aiReady: () => true,
    model: () => "fixture-model",
    readRecording: async () => {
      reads++;
      return Buffer.from("png");
    },
    generate: async () => {
      calls++;
      return {
        probe: "What helped you use Save draft?",
        visualAnchor: "Save draft button",
      };
    },
  };
  for (const mutate of [
    (i: Interview) => {
      i.guide.questions[0].participantImageAI = false;
    },
    (i: Interview) => {
      delete i.participantImageDraft!.image.aiPermission;
    },
    (i: Interview) => {
      i.participantImageDraft!.image.aiPermission!.version = "older";
    },
    (i: Interview) => {
      i.participantImageDraft!.version = 1;
    },
  ]) {
    const i = fixture();
    mutate(i);
    assert.equal(await participantImageProbe(i, "It helped.", deps), null);
  }
  assert.equal(reads, 0);
  assert.equal(calls, 0);
  const absent = await participantImageProbe(fixture(), "It helped.", {
    ...deps,
    aiReady: () => false,
  });
  assert.equal(absent!.status, "unavailable");
  assert.equal(reads, 0);
  assert.equal(calls, 0);
});
test("Image observation cannot see participant text; contextual questions carry only independently extracted anchors and both calls remain bounded and non-stored", async () => {
  const i = fixture(),
    bytes = Buffer.from("synthetic-normalized-png");
  let calls = 0;
  let deadline: AbortSignal | undefined;
  const result = await participantImageProbe(i, "It saved my work.", {
    aiReady: () => true,
    model: () => "fixture-model",
    readRecording: async (id) => {
      assert.equal(id, i.participantImageDraft!.image.id);
      return bytes;
    },
    generate: async (system, input, w, s, operation, schema, options) => {
      calls++;
      assert.equal(w, i.workspaceId);
      assert.equal(s, i.studyId);
      const body = generationBody(system, input, schema, options);
      assert.equal(body.store, false);
      if (operation === "image-observe") {
        assert.deepEqual(Object.keys(input as object), ["interviewLanguage"]);
        assert.equal(options!.image, bytes);
        assert.equal(options!.maxTokens, 400);
        deadline = options!.signal;
        assert.ok(deadline);
        const content = body.messages[1].content as any[];
        assert.equal(
          content[1].image_url.url,
          "data:image/png;base64," + bytes.toString("base64"),
        );
        assert.equal(content[1].image_url.detail, "low");
        return { anchors: ["Save draft"] };
      }
      assert.equal(operation, "image-probe");
      assert.equal(options!.image, undefined);
      assert.equal(options!.maxTokens, 500);
      assert.equal(options!.signal, deadline);
      assert.equal(typeof body.messages[1].content, "string");
      assert.equal((input as any).answer, "It saved my work.");
      assert.deepEqual((input as any).visibleAnchors, ["Save draft"]);
      return { probe: "What helped you use Save draft?", anchorIndex: 0 };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result!.status, "asked");
  assert.equal(result!.visualAnchor, "Save draft");
  assert.equal(result!.imageId, i.participantImageDraft!.image.id);
  assert.equal(result!.model, "fixture-model");
  assert.equal(result!.promptVersion, imageProbePromptVersion);
  assert.ok(result!.observationPromptVersion);
  assert.equal(
    result!.imageSha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert.equal(
    JSON.stringify(result).includes(bytes.toString("base64")),
    false,
  );
  const ordinary = generationBody("system", { answer: "text" });
  assert.equal(typeof ordinary.messages[1].content, "string");
  assert.equal(ordinary.store, undefined);
});
test("Questions must cite a real anchor; invalid, secret-seeking and mismatched replies are rejected while empty observations stop before a contextual call", async () => {
  for (const value of [
    { probe: "What is the password?", anchorIndex: 0 },
    { probe: "What helped? Why now?", anchorIndex: 0 },
    { probe: "Visit https://example.test?", anchorIndex: 0 },
    { probe: "What helped you here?", anchorIndex: null },
    { probe: "How does the overdue invoice work?", anchorIndex: 0 },
    { probe: "What does Save draft do?", anchorIndex: 2 },
  ])
    assert.equal(usableImageProbe(value, ["Save draft"]), null);
  assert.equal(
    usableImageProbe({ probe: "What does Save draft do?", anchorIndex: 0 }, [
      "Save draft",
    ])!.visualAnchor,
    "Save draft",
  );
  let calls = 0;
  const deps = {
    aiReady: () => true,
    model: () => "fixture-model",
    readRecording: async () => Buffer.from("png"),
    generate: async () => {
      calls++;
      return { anchors: [] };
    },
  };
  assert.equal(
    (await participantImageProbe(
      fixture(),
      "This is an overdue invoice.",
      deps,
    ))!.status,
    "none",
  );
  assert.equal(calls, 1);
  assert.equal(
    (await participantImageProbe(fixture(), "It helped.", {
      ...deps,
      generate: async () => ({ anchors: ["password: secret@example.test"] }),
    }))!.status,
    "none",
  );
  assert.equal(
    (await participantImageProbe(fixture(), "It helped.", {
      ...deps,
      generate: async () => ({ probe: "What is your password?" }),
    }))!.status,
    "rejected",
  );
  assert.equal(
    (await participantImageProbe(fixture(), "It helped.", {
      ...deps,
      generate: async () => {
        throw new Error("PROVIDER_UNAVAILABLE");
      },
    }))!.status,
    "unavailable",
  );
});
