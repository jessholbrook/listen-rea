import test from "node:test";
import assert from "node:assert/strict";
import { guideSchema, templateGuide, type Interview } from "../src/lib/domain";
import {
  guideSource,
  applyFields,
  validateFields,
  declines,
  settings,
  responseLanguage,
} from "../src/lib/localization";
import { copy, participantCopy } from "../src/lib/participant-copy";
import { conceptGuide } from "./concept-fixture";
import { translatedFields } from "./localization-fixture";
import { transcriptionBody } from "../src/lib/speech";
test("guide translations preserve concept IDs, routing, option IDs, scales and source text", () => {
  const g = conceptGuide(),
    before = structuredClone(g),
    fields = translatedFields(g, "es"),
    out = guideSchema.parse(applyFields(g, fields));
  assert.deepEqual(g, before);
  assert.notEqual(out.title, g.title);
  for (const [n, q] of out.questions.entries()) {
    assert.equal(q.id, g.questions[n].id);
    assert.equal(q.type, g.questions[n].type);
    assert.deepEqual(q.condition, g.questions[n].condition);
    assert.deepEqual(q.carryForward, g.questions[n].carryForward);
    assert.deepEqual(
      q.options.map((o) => o.id),
      g.questions[n].options.map((o) => o.id),
    );
    assert.equal(
      q.scale?.min,
      g.questions[n].scale?.min ??
        (["rating", "matrix"].includes(q.type) ? 1 : undefined),
    );
  }
  assert.deepEqual(
    out.conceptTest?.concepts.map((c) => c.id),
    g.conceptTest?.concepts.map((c) => c.id),
  );
  assert.deepEqual(
    out.conceptTest?.concepts.map((c) => c.imageUrl),
    g.conceptTest?.concepts.map((c) => c.imageUrl),
  );
  assert.throws(() => validateFields(g, fields.slice(1)), /TRANSLATION_FIELDS/);
  assert.throws(
    () => validateFields(g, [...fields.slice(1), fields[1]]),
    /TRANSLATION_FIELDS/,
  );
  assert.throws(
    () =>
      validateFields(
        g,
        fields.map((f, n) =>
          n === 0 ? { ...f, key: '["question","forged","text"]' } : f,
        ),
      ),
    /TRANSLATION_FIELDS/,
  );
  const configured = {
    ...g,
    localization: {
      sourceLanguage: "en" as const,
      reportingLanguage: "es" as const,
      guidance: "",
      translations: [],
    },
  };
  assert.equal(
    guideSource(configured),
    guideSource({
      ...configured,
      localization: { ...configured.localization, reportingLanguage: "fr" },
    }),
  );
  assert.notEqual(
    guideSource(configured),
    guideSource({
      ...configured,
      localization: {
        ...configured.localization,
        guidance: "Preserve product names",
      },
    }),
  );
});
test("participant copy, refusal phrases and legacy language defaults cover English, Spanish and French", () => {
  for (const [english, values] of Object.entries(participantCopy)) {
    assert.equal(copy("en", english), english);
    assert.ok(values.es.length);
    assert.ok(values.fr.length);
    assert.equal(copy("es", english), values.es);
  }
  assert.equal(copy("es", "Continue"), "Continuar");
  assert.equal(copy("fr", "Continue"), "Continuer");
  assert.ok(declines("Omitir.", "es"));
  assert.ok(declines("Je ne sais pas.", "fr"));
  assert.ok(declines("skip", "en"));
  assert.equal(declines("I skipped a meeting.", "en"), false);
  assert.equal(settings(templateGuide()).sourceLanguage, "en");
  assert.equal(responseLanguage({ guide: templateGuide() } as Interview), "en");
});
test("transcription requests retain the selected source language without requesting translation", () => {
  const form = transcriptionBody(
    Buffer.from("synthetic"),
    "audio/wav",
    "source.wav",
    "transcribe",
    "fr",
  );
  assert.equal(form.get("language"), "fr");
  assert.equal(form.get("model"), "transcribe");
  assert.equal(form.get("prompt"), null);
  assert.ok(form.get("file"));
});
