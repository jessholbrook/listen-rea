import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { start, stop } from "./harness";
import {
  mediaStudy,
  reviewedEdition,
  syntheticClipAnswer,
} from "./media-expansion-fixture";
import { staticDeck } from "./presentation-import-fixture";
import { pptxMime } from "../src/lib/participant-pptx";
import {
  readPresentationPackage,
  validatePresentationPackage,
} from "../src/lib/presentation-package";
before(() => start({ port: 3440 }), { timeout: 90000 });
after(stop);
test(
  "cross-study reels bind every source version, label rendered captions, revoke shares and physically erase dependent outputs while preserving unrelated reels",
  { timeout: 120000 },
  async () => {
    const c = await mediaStudy(),
      other = await mediaStudy(c, "Synthetic source Beta");
    assert.equal(
      (
        await c.owner(c.root + "/reels", "POST", {
          name: "Wrong scope",
          clipIds: [c.clip.id, other.clip.id],
          reviewed: true,
        })
      ).status,
      400,
    );
    const reel = (
      await c.owner(c.root + "/reels", "POST", {
        name: "Cross-study evidence",
        clipIds: [c.clip.id, other.clip.id],
        crossStudy: true,
        reviewed: true,
      })
    ).reel;
    assert.ok(reel.id);
    const own = (
      await c.owner(c.root + "/reels", "POST", {
        name: "Independent Alpha",
        clipIds: [c.clip.id],
        reviewed: true,
      })
    ).reel;
    let job = (
      await c.owner(c.root + "/jobs", "POST", {
        reelId: reel.id,
        version: reel.version,
      })
    ).job;
    assert.equal(job.sourceVersions.length, 2);
    job = (await c.owner(c.root + "/jobs/" + job.id + "/run", "POST")).job;
    assert.equal(job.state, "complete", JSON.stringify(job));
    const manifest = await c.owner(c.root + "/jobs/" + job.id + "/sources");
    assert.deepEqual(
      new Set(manifest.clips.map((v: any) => v.studyId)),
      new Set([c.s.id, other.s.id]),
    );
    const captions = (
      await c.owner(c.root + "/jobs/" + job.id + "/captions")
    ).bytes.toString();
    assert.ok(captions.includes("Synthetic source Alpha"));
    assert.ok(captions.includes("Synthetic source Beta"));
    const shared = (
      await c.owner(c.root + "/jobs/" + job.id + "/share", "POST")
    ).token;
    assert.equal((await c.person("shared/" + shared)).kind, "reel");
    await c.local.dirty(other.s);
    assert.equal(
      (await c.owner(c.root + "/jobs/" + job.id + "/download")).status,
      409,
    );
    assert.equal((await c.person("shared/" + shared)).status, 404);
    const freshJob = (
      await c.owner(c.root + "/jobs", "POST", {
        reelId: reel.id,
        version: reel.version,
      })
    ).job;
    const rendered = (
      await c.owner(c.root + "/jobs/" + freshJob.id + "/run", "POST")
    ).job;
    assert.equal(rendered.state, "complete");
    await c.owner(
      `studies/${other.s.id}/responses/${other.interview.id}`,
      "DELETE",
    );
    const current = await c.owner(c.root);
    assert.equal(
      current.reels.some((r: any) => r.id === reel.id),
      false,
    );
    assert.equal(
      current.reels.some((r: any) => r.id === own.id),
      true,
    );
    assert.equal(
      current.jobs.some((j: any) => j.id === freshJob.id),
      false,
    );
    const { readRecording } = await import("../src/lib/storage");
    await assert.rejects(() => readRecording(rendered.outputId));
    await assert.rejects(() => readRecording(job.outputId));
  },
);
test("AI clip suggestions only accept exact uniquely aligned quotes, preserve edit provenance, deduplicate generation/acceptance and disappear after source erasure", async () => {
  const c = await mediaStudy(),
    { dispatchClipSuggestions } =
      await import("../src/lib/clip-suggestions-server"),
    path = ["studies", c.s.id, "clip-suggestions"],
    src = (await c.owner(`studies/${c.s.id}/clip-suggestions`)).sources[0];
  let alignments = 0,
    proposals = 0;
  const deps = {
    ready: () => true,
    model: () => "marked-clip-model",
    align: async () => {
      alignments++;
      return syntheticClipAnswer
        .split(" ")
        .map((word, n) => ({ word, start: n * 0.2, end: (n + 1) * 0.2 }));
    },
    propose: async () => {
      proposals++;
      return {
        suggestions: [
          {
            quote: syntheticClipAnswer,
            caption: "Original evidence",
            rationale: "A concrete source-checking account (marked fixture).",
          },
          {
            quote: "This quote is entirely invented.",
            caption: "Bad",
            rationale: "Must be rejected.",
          },
        ],
      };
    },
  };
  const input = {
      requestId: randomUUID(),
      mediaId: c.mediaId,
      fingerprint: src.fingerprint,
      aiConsent: true,
    },
    req = (data = input) =>
      new Request("http://localhost/api/suggestions", {
        method: "POST",
        body: JSON.stringify(data),
      });
  await assert.rejects(() =>
    dispatchClipSuggestions(
      req({ ...input, aiConsent: false }),
      path,
      deps,
      c.actor,
    ),
  );
  assert.equal(alignments, 0);
  await c.local.db
    .prepare("UPDATE media SET duration_ms=1000 WHERE id=?")
    .run(c.mediaId);
  const mismatch = (await c.owner(`studies/${c.s.id}/clip-suggestions`))
    .sources[0];
  await assert.rejects(
    () =>
      dispatchClipSuggestions(
        req({
          ...input,
          requestId: randomUUID(),
          fingerprint: mismatch.fingerprint,
        }),
        path,
        deps,
        c.actor,
      ),
    /Decoded duration differs/,
  );
  assert.deepEqual([alignments, proposals], [0, 0]);
  await c.local.db
    .prepare("UPDATE media SET duration_ms=3000 WHERE id=?")
    .run(c.mediaId);
  const draft = (
    await (await dispatchClipSuggestions(req(), path, deps, c.actor))!.json()
  ).draft;
  assert.equal(draft.suggestions.length, 1);
  assert.equal(draft.sourceDigest.length, 64);
  await dispatchClipSuggestions(req(), path, deps, c.actor);
  assert.deepEqual([alignments, proposals], [1, 1]);
  const v = draft.suggestions[0],
    accept = {
      ...v,
      name: "Edited proposed clip",
      mediaId: c.mediaId,
      fingerprint: draft.fingerprint,
      suggestionIndex: 0,
      requestId: randomUUID(),
      reviewed: true,
    };
  delete accept.rationale;
  assert.equal(
    (
      await c.owner(
        `studies/${c.s.id}/clip-suggestions/${draft.id}/accept`,
        "POST",
        { ...accept, reviewed: false },
      )
    ).status,
    400,
  );
  const saved = await c.owner(
    `studies/${c.s.id}/clip-suggestions/${draft.id}/accept`,
    "POST",
    accept,
  );
  assert.equal(saved.status, 201);
  assert.equal(saved.clip.aiProvenance.model, "marked-clip-model");
  assert.equal(
    (
      await c.owner(
        `studies/${c.s.id}/clip-suggestions/${draft.id}/accept`,
        "POST",
        accept,
      )
    ).clip.id,
    saved.clip.id,
  );
  const edited = (
    await c.owner(c.root + "/clips/" + saved.clip.id, "PUT", {
      ...saved.clip,
      caption: "Researcher edited caption",
    })
  ).clip;
  assert.equal(edited.aiProvenance.edited, true);
  await c.owner(`studies/${c.s.id}/responses/${c.interview.id}`, "DELETE");
  assert.equal(
    (await c.owner(`studies/${c.s.id}/clip-suggestions`)).drafts.length,
    0,
  );
  assert.equal(await c.local.get("reportClipDraft", draft.id), undefined);
});
test("late AI clip generation cannot recreate an erased response or draft", async () => {
  const c = await mediaStudy(),
    { dispatchClipSuggestions } =
      await import("../src/lib/clip-suggestions-server"),
    src = (await c.owner(`studies/${c.s.id}/clip-suggestions`)).sources[0];
  const deps = {
    ready: () => true,
    model: () => "marked-clip-model",
    align: async () =>
      syntheticClipAnswer
        .split(" ")
        .map((word, n) => ({ word, start: n * 0.2, end: (n + 1) * 0.2 })),
    propose: async () => {
      await c.owner(`studies/${c.s.id}/responses/${c.interview.id}`, "DELETE");
      return {
        suggestions: [
          {
            quote: syntheticClipAnswer,
            caption: "Source",
            rationale: "Marked fixture.",
          },
        ],
      };
    },
  };
  await assert.rejects(
    () =>
      dispatchClipSuggestions(
        new Request("http://localhost/api/suggestions", {
          method: "POST",
          body: JSON.stringify({
            requestId: randomUUID(),
            mediaId: c.mediaId,
            fingerprint: src.fingerprint,
            aiConsent: true,
          }),
        }),
        ["studies", c.s.id, "clip-suggestions"],
        deps,
        c.actor,
      ),
    /unavailable|changed/,
  );
  assert.equal(
    (await c.owner(`studies/${c.s.id}/clip-suggestions`)).drafts.length,
    0,
  );
});
test("presentation imports preserve original slides, require both approvals, append cited report slides, isolate workspaces and erase stored bytes with the source", async () => {
  const c = await mediaStudy(),
    edition = await reviewedEdition(c),
    root = `studies/${c.s.id}/presentation-imports`,
    bytes = await staticDeck("Company context slide"),
    version = (await c.owner(c.root)).dataVersion;
  const headers = {
    "content-type": pptxMime,
    "x-import-consent": "yes",
    "x-import-name": "Company context",
    "x-source-version": String(version),
    "x-request-id": randomUUID(),
  };
  assert.equal((await c.person(root)).status, 401);
  assert.equal(
    (
      await c.owner(root, "POST", bytes, {
        ...headers,
        "x-import-consent": "no",
      })
    ).status,
    400,
  );
  const uploaded = await c.owner(root, "POST", bytes, headers);
  assert.equal(uploaded.status, 201);
  let d = uploaded.imported;
  assert.equal((await c.owner(root, "POST", bytes, headers)).imported.id, d.id);
  const input = {
    editionId: edition.id,
    editionVersion: edition.version,
    importVersion: d.version,
    reviewed: true,
  };
  assert.equal(
    (await c.owner(root + "/" + d.id + "/compose", "POST", input)).status,
    409,
  );
  d = (
    await c.owner(root + "/" + d.id, "PUT", {
      version: d.version,
      reviewed: true,
    })
  ).imported;
  assert.equal(
    (await c.owner(root + "/" + d.id + "/file")).bytes.equals(bytes),
    true,
  );
  assert.equal(
    (
      await c.owner(root + "/" + d.id + "/compose", "POST", {
        ...input,
        importVersion: d.version,
        reviewed: false,
      })
    ).status,
    400,
  );
  const output = await c.owner(root + "/" + d.id + "/compose", "POST", {
    ...input,
    importVersion: d.version,
  });
  assert.equal(output.status, 200, output.bytes.toString().slice(0, 150));
  const originalParts = await readPresentationPackage(bytes),
    parts = await readPresentationPackage(output.bytes),
    info = validatePresentationPackage(parts);
  assert.ok(info.order.length > 1);
  assert.ok(
    parts
      .get(info.order[0])!
      .equals(originalParts.get("ppt/slides/slide1.xml")!),
  );
  assert.ok(
    [...parts.values()].some((b) => b.toString().includes(syntheticClipAnswer)),
  );
  const foreign = await mediaStudy();
  assert.equal((await foreign.owner(root)).status, 404);
  assert.equal((await foreign.owner(root + "/" + d.id + "/file")).status, 404);
  const stored = await c.local.get<any>("presentationImport", d.id);
  assert.ok(stored.file.id);
  await c.owner(`studies/${c.s.id}/responses/${c.interview.id}`, "DELETE");
  assert.equal((await c.owner(root)).imports.length, 0);
  const { readRecording } = await import("../src/lib/storage");
  await assert.rejects(() => readRecording(stored.file.id));
  assert.equal((await c.owner(root, "POST", bytes, headers)).status, 409);
});
