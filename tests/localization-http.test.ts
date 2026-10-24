import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop, client } from "./harness";
import { translatedFields } from "./localization-fixture";
before(() => start({ port: 3111 }), { timeout: 90000 });
after(stop);
test(
  "reviewed languages freeze admission text and routing while stale drafts, invalid fields and foreign access are rejected",
  { timeout: 90000 },
  async () => {
    const owner = await client(),
      person = await client(),
      stranger = await client();
    await owner("auth/signup", "POST", {
      name: "Language Owner",
      email: "languages@example.test",
      password: "language-test-password",
    });
    await stranger("auth/signup", "POST", {
      name: "Foreign Owner",
      email: "foreign-language@example.test",
      password: "language-test-password",
    });
    let s = (
      await owner("studies", "POST", { title: "From feedback to decisions" })
    ).study;
    s.draft.questions = [
      {
        ...s.draft.questions[1],
        id: "recent",
        text: "Tell me about your recent research.",
        followUps: 1,
      },
    ];
    s.draft.localization = {
      sourceLanguage: "en",
      reportingLanguage: "fr",
      guidance: "Keep product names unchanged.",
      translations: [],
    };
    s = (
      await owner("studies/" + s.id, "PUT", {
        guide: s.draft,
        version: s.version,
      })
    ).study;
    assert.equal(
      (await owner(`studies/${s.id}/preview`, "POST")).interview.language,
      "en",
    );
    let meta = await owner(`studies/${s.id}/localization`);
    const fields = translatedFields(s.draft, "es");
    assert.equal((await stranger(`studies/${s.id}/localization`)).status, 404);
    assert.equal(
      (
        await owner(`studies/${s.id}/localization/guide/es`, "PUT", {
          version: s.version,
          sourceFingerprint: meta.sourceFingerprint,
          fields: fields.slice(1),
          reviewed: true,
        })
      ).status,
      400,
    );
    s = (
      await owner(`studies/${s.id}/localization/guide/es`, "PUT", {
        version: s.version,
        sourceFingerprint: meta.sourceFingerprint,
        fields,
        reviewed: false,
      })
    ).study;
    assert.deepEqual(
      (await owner(`studies/${s.id}/localization`)).availableLanguages,
      ["en"],
    );
    assert.equal(
      (await owner(`studies/${s.id}/preview`, "POST", { language: "es" }))
        .status,
      409,
    );
    meta = await owner(`studies/${s.id}/localization`);
    s = (
      await owner(`studies/${s.id}/localization/guide/es`, "PUT", {
        version: s.version,
        sourceFingerprint: meta.sourceFingerprint,
        fields,
        reviewed: true,
      })
    ).study;
    const preview = await owner(`studies/${s.id}/preview`, "POST", {
      language: "es",
    });
    assert.equal(preview.interview.language, "es");
    assert.equal(preview.interview.guide.questions[0].id, "recent");
    assert.equal(preview.interview.guide.localization.translations.length, 0);
    assert.equal(preview.interview.guide.localization.guidance, "");
    s = (await owner(`studies/${s.id}/publish`, "POST", { version: s.version }))
      .study;
    await owner(`studies/${s.id}/fielding`, "POST", { state: "active" });
    const info = await person(`public/${s.id}?language=es-MX`);
    assert.equal(info.language, "es");
    assert.equal(info.title, "De comentarios a decisiones");
    assert.deepEqual(info.languages, ["en", "es"]);
    assert.equal((await person(`public/${s.id}?language=de`)).language, "en");
    let r = await person(`public/${s.id}`, "POST", {
      consent: true,
      language: "es",
    });
    const id = r.interview.id,
      headers = { "x-interview-token": r.token };
    assert.equal(
      r.interview.prompt,
      "Cuéntame sobre tu investigación reciente.",
    );
    assert.equal(r.interview.consentVersion, "2026-10-19-v2-es");
    r = await person(
      `interviews/${id}/answer`,
      "POST",
      { requestId: randomUUID(), version: 0, answer: "Usé notas." },
      headers,
    );
    assert.equal(r.interview.prompt, "¿Podrías compartir un ejemplo concreto?");
    r = await person(
      `interviews/${id}/answer`,
      "POST",
      {
        requestId: randomUUID(),
        version: 1,
        answer: "Revisé las notas antes de decidir.",
      },
      headers,
    );
    assert.equal(r.interview.status, "complete");
    const first = r.interview.turns[0],
      second = r.interview.turns[1],
      path = `studies/${s.id}/localization/responses/${id}/${second.id}/en`;
    let tr = await owner(path);
    assert.equal(tr.original, "Revisé las notas antes de decidir.");
    assert.equal(tr.translation, null);
    assert.equal((await stranger(path)).status, 404);
    assert.equal(
      (
        await owner(path, "PUT", {
          version: 0,
          sourceFingerprint: "forged",
          translated: "I reviewed the notes before deciding.",
          reviewed: true,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await owner(path, "PUT", {
          version: 0,
          sourceFingerprint: tr.sourceFingerprint,
          translated: "I reviewed the notes before deciding.",
          reviewed: true,
        })
      ).status,
      200,
    );
    tr = await owner(path);
    assert.equal(tr.translation.reviewed, true);
    assert.equal(tr.translation.original, tr.original);
    assert.equal(
      (
        await owner(path, "PUT", {
          version: 0,
          sourceFingerprint: tr.sourceFingerprint,
          translated: "Changed",
          reviewed: true,
        })
      ).status,
      409,
    );
    const bilingual = await owner(`studies/${s.id}/localization/export`);
    assert.ok(bilingual.text.includes("Revisé las notas antes de decidir."));
    assert.ok(bilingual.text.includes("I reviewed the notes before deciding."));
    let analysis = (
      await owner(`studies/${s.id}/analysis`, "POST", { mode: "manual" })
    ).analysis;
    assert.equal(analysis.reportLanguage, "fr");
    assert.match(analysis.memo, /OBJECTIF DE RECHERCHE/);
    assert.equal(
      (
        await owner(`studies/${s.id}/analysis`, "PUT", {
          ...analysis,
          summary: "Synthèse.",
          themes: [
            {
              id: "notes",
              title: "Notes",
              description: "Une observation.",
              citations: [
                {
                  interviewId: id,
                  turnId: second.id,
                  quote: "I reviewed the notes before deciding.",
                },
              ],
            },
          ],
          reviewed: true,
        })
      ).status,
      502,
    );
    analysis = (
      await owner(`studies/${s.id}/analysis`, "PUT", {
        ...analysis,
        memo: undefined,
        summary: "Synthèse.",
        themes: [
          {
            id: "notes",
            title: "Notes",
            description: "Une observation.",
            citations: [
              { interviewId: id, turnId: second.id, quote: second.answer },
            ],
          },
        ],
        reviewed: true,
      })
    ).analysis;
    assert.ok(analysis.memo.includes(second.answer));
    const edition = await owner(`studies/${s.id}/reporting/editions`, "POST", {
      analysisId: analysis.id,
      title: "Synthèse de recherche",
    });
    assert.equal(edition.edition.language, "fr");
    const current = (await owner("studies/" + s.id)).study;
    current.draft.questions[0].text = "What helped you decide?";
    s = (
      await owner("studies/" + s.id, "PUT", {
        guide: current.draft,
        version: current.version,
      })
    ).study;
    meta = await owner(`studies/${s.id}/localization`);
    assert.deepEqual(meta.availableLanguages, ["en"]);
    assert.equal(
      (
        await owner(`studies/${s.id}/localization/guide/es`, "PUT", {
          version: s.version - 1,
          sourceFingerprint: meta.sourceFingerprint,
          fields,
          reviewed: true,
        })
      ).status,
      409,
    );
    s = (await owner(`studies/${s.id}/publish`, "POST", { version: s.version }))
      .study;
    assert.deepEqual((await person(`public/${s.id}?language=es`)).languages, [
      "en",
    ]);
    const resumed = await person(`interviews/${id}`, "GET", undefined, headers);
    assert.equal(resumed.interview.language, "es");
    assert.equal(resumed.interview.turns[0].prompt, first.prompt);
    assert.equal(resumed.interview.turns[1].answer, second.answer);
    assert.equal(
      (
        await person(`public/${s.id}`, "POST", {
          consent: true,
          language: "es",
        })
      ).status,
      409,
    );
    await owner(`studies/${s.id}/responses/${id}`, "PATCH", {
      excluded: true,
      reason: "Verify provenance",
    });
    assert.equal((await owner(path)).status, 404);
    assert.equal(
      (await owner(`studies/${s.id}/localization/export`)).text.includes(
        "I reviewed",
      ),
      false,
    );
    assert.equal(
      (await owner(`studies/${s.id}/responses/${id}`, "DELETE")).deleted,
      true,
    );
    assert.equal((await owner(path)).status, 404);
    assert.equal(
      (await owner(`studies/${s.id}/localization`)).evidence.length,
      0,
    );
  },
);
test(
  "French translated options retain screen-out, section routing, carry-forward and numeric values",
  { timeout: 60000 },
  async () => {
    const owner = await client(),
      person = await client();
    await owner("auth/signup", "POST", {
      name: "Routing Owner",
      email: "language-routing@example.test",
      password: "language-routing-password",
    });
    let s = (
      await owner("studies", "POST", { title: "Translated routing study" })
    ).study;
    const q = s.draft.questions[1];
    s.draft.questions = [
      {
        ...q,
        id: "qualify",
        section: "Context",
        text: "Do you use notes?",
        type: "choice",
        options: [
          { id: "yes", text: "Yes", rejects: false },
          { id: "no", text: "No", rejects: true },
        ],
        followUps: 0,
      },
      {
        ...q,
        id: "carried",
        section: "Detail",
        text: "Select the option you chose.",
        type: "multiple",
        carryForward: { questionId: "qualify", mode: "selected" },
        selection: { min: 1, max: 1 },
        followUps: 0,
      },
      {
        ...q,
        id: "rating",
        section: "Detail",
        text: "How useful were the notes?",
        type: "rating",
        scale: {
          min: 0,
          max: 5,
          lowLabel: "Not useful",
          highLabel: "Very useful",
        },
        followUps: 0,
      },
    ];
    s.draft.sections = [
      { name: "Detail", condition: { questionId: "qualify", optionId: "yes" } },
    ];
    s = (
      await owner(`studies/${s.id}`, "PUT", {
        guide: s.draft,
        version: s.version,
      })
    ).study;
    const meta = await owner(`studies/${s.id}/localization`);
    s = (
      await owner(`studies/${s.id}/localization/guide/fr`, "PUT", {
        version: s.version,
        sourceFingerprint: meta.sourceFingerprint,
        fields: translatedFields(s.draft, "fr"),
        reviewed: true,
      })
    ).study;
    s = (await owner(`studies/${s.id}/publish`, "POST", { version: s.version }))
      .study;
    await owner(`studies/${s.id}/fielding`, "POST", { state: "active" });
    const first = await person(`public/${s.id}`, "POST", {
        consent: true,
        language: "fr",
      }),
      h = { "x-interview-token": first.token };
    let r = await person(
      `interviews/${first.interview.id}/answer`,
      "POST",
      { requestId: randomUUID(), version: 0, optionId: "yes", answer: "" },
      h,
    );
    assert.equal(
      r.interview.guide.questions[r.interview.current].id,
      "carried",
    );
    assert.deepEqual(
      r.interview.optionAssignments.carried.map((o: any) => o.id),
      ["yes"],
    );
    assert.equal(
      r.interview.guide.questions[r.interview.current].section,
      "FR Detail",
    );
    r = await person(
      `interviews/${first.interview.id}/answer`,
      "POST",
      { requestId: randomUUID(), version: 1, value: ["yes"], answer: "" },
      h,
    );
    assert.equal(r.interview.guide.questions[r.interview.current].id, "rating");
    r = await person(
      `interviews/${first.interview.id}/answer`,
      "POST",
      { requestId: randomUUID(), version: 2, value: 0, answer: "" },
      h,
    );
    assert.equal(r.interview.status, "complete");
    assert.equal(r.interview.turns[2].value, 0);
    assert.equal(r.interview.turns[0].optionId, "yes");
    const second = await person(`public/${s.id}`, "POST", {
      consent: true,
      language: "fr",
    });
    const rejected = await person(
      `interviews/${second.interview.id}/answer`,
      "POST",
      { requestId: randomUUID(), version: 0, optionId: "no", answer: "" },
      { "x-interview-token": second.token },
    );
    assert.equal(rejected.interview.status, "screened_out");
    assert.equal(rejected.interview.turns.length, 1);
  },
);
