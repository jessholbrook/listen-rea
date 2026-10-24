import test, { before, after } from "node:test";
import { start, stop } from "./harness";
before(
  () =>
    start({ port: process.env.RESEARCH_TEST_PRODUCTION === "1" ? 3172 : 3171 }),
  { timeout: 90000 },
);
after(stop);
import assert from "node:assert/strict";
import path from "node:path";
import { createClient } from "@libsql/client";
import { dataDirectory } from "./harness";
import {
  setup,
  upload,
  answer,
  seed,
  generatedState,
  head,
  client,
} from "./image-review-fixture";
const fields = {
  quality: "usable",
  grounding: "supported",
  notes: "Human checked the visible control.",
  correction: "What does Save draft do?",
};
const route = (ctx: any, id: string) =>
  ctx.root + "/participant-images/" + id + "/review";
test(
  "Private attributed reviews preserve corrections, reject concurrent edits and stay out of participant payloads",
  { timeout: 90000 },
  async () => {
    const ctx = await setup(),
      { saved, i } = await generatedState(ctx, true),
      url = route(ctx, saved.image.id);
    const empty = await ctx.owner(url);
    assert.equal(empty.status, 200);
    assert.equal(empty.version, 0);
    assert.deepEqual(empty.history, []);
    const anonymous = await client();
    assert.equal((await anonymous(url)).status, 401);
    assert.equal(
      (await ctx.person(url, "GET", undefined, head(ctx.r))).status,
      401,
    );
    const other = await setup();
    assert.equal((await other.owner(url)).status, 404);
    const one = await ctx.owner(url, "PUT", {
      ...fields,
      source: empty.source,
      version: 0,
    });
    assert.equal(one.status, 200);
    assert.equal(one.version, 1);
    assert.equal(one.history[0].reviewer.name, "Image AI admin");
    const revision = {
      ...fields,
      quality: "unclear",
      grounding: "unsupported",
      notes: "Correction: the label is not readable.",
      correction: "Which control did you mean?",
      source: one.source,
      version: 1,
    };
    const concurrent = await Promise.all([
      ctx.owner(url, "PUT", revision),
      ctx.owner(url, "PUT", { ...revision, notes: "Other editor" }),
    ]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
    const current = await ctx.owner(url);
    assert.equal(current.history.length, 2);
    assert.deepEqual(current.history[0], one.history[0]);
    assert.equal(
      (
        await ctx.owner(url, "PUT", {
          ...revision,
          version: 2,
          quality: "automatically_verified",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await ctx.owner(url, "PUT", {
          ...revision,
          version: 2,
          notes: "x".repeat(2001),
        })
      ).status,
      400,
    );
    const participant = await ctx.person(
      "interviews/" + i.id,
      "GET",
      undefined,
      head(ctx.r),
    );
    assert.equal(participant.status, 200);
    assert.equal(JSON.stringify(participant).includes(fields.notes), false);
    assert.equal(JSON.stringify(participant).includes("reviewer"), false);
    await seed(ctx.r, (i) => {
      i.turns[0].imageProbe.probe = "Different source question?";
    });
    assert.equal(
      (await ctx.owner(url, "PUT", { ...revision, version: 2 })).status,
      409,
    );
    assert.equal((await ctx.owner(url)).status, 409);
  },
);
test(
  "Draft images cannot be reviewed; no-probe judgments are explicit and review history is erased with image or response",
  { timeout: 90000 },
  async () => {
    const ctx = await setup(false),
      up = await upload(ctx.person, ctx.r, false),
      url = route(ctx, up.image.id);
    assert.equal((await ctx.owner(url)).status, 409);
    assert.equal((await answer(ctx.person, ctx.r, up.image.id)).status, 200);
    const initial = await ctx.owner(url);
    assert.equal(initial.asked, false);
    assert.equal(
      (
        await ctx.owner(url, "PUT", {
          ...fields,
          source: initial.source,
          version: 0,
        })
      ).status,
      400,
    );
    const saved = await ctx.owner(url, "PUT", {
      ...fields,
      grounding: "not_applicable",
      correction: "",
      source: initial.source,
      version: 0,
    });
    assert.equal(saved.status, 200);
    assert.equal(
      (
        await ctx.owner(
          ctx.root + "/participant-images/" + up.image.id,
          "DELETE",
        )
      ).status,
      200,
    );
    assert.equal((await ctx.owner(url)).status, 404);
    const other = await setup(),
      generated = await generatedState(other, true),
      nextURL = route(other, generated.saved.image.id),
      initial2 = await other.owner(nextURL);
    assert.equal(
      (
        await other.owner(nextURL, "PUT", {
          ...fields,
          source: initial2.source,
          version: 0,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await other.owner(
          other.root + "/responses/" + other.r.interview.id,
          "DELETE",
        )
      ).status,
      200,
    );
    assert.equal((await other.owner(nextURL)).status, 404);
    const sql = createClient({
      url: "file:" + path.join(dataDirectory(), "research.sqlite"),
    });
    try {
      assert.equal(
        Number(
          (
            await sql.execute({
              sql: "SELECT COUNT(*) AS n FROM documents WHERE kind='imageReview' AND id IN (?,?)",
              args: [up.image.id, generated.saved.image.id],
            })
          ).rows[0].n,
        ),
        0,
      );
    } finally {
      sql.close();
    }
  },
);
