import test from "node:test";
import assert from "node:assert/strict";
import { staticDeck } from "./presentation-import-fixture";
import JSZip from "jszip";
import { alignQuote, timedWords } from "../src/lib/clip-suggestions";
import {
  readPresentationPackage,
  validatePresentationPackage,
  inspectImportedPresentation,
  appendPresentation,
  parsePackageXml,
  writePackageXml,
} from "../src/lib/presentation-package";
import { crossStudyCaption } from "../src/lib/reporting";
test("quote alignment uses independent word boundaries, padding and Unicode normalization, and abstains on missing/repeated/short or overlong matches", () => {
  const words = timedWords.parse([
    { word: "We", start: 0, end: 0.2 },
    { word: "check", start: 0.2, end: 0.5 },
    { word: "original", start: 0.5, end: 0.8 },
    { word: "evidence.", start: 0.8, end: 1.2 },
  ]);
  assert.deepEqual(alignQuote("check original evidence", words, 2000), {
    startMs: 50,
    endMs: 1400,
  });
  assert.deepEqual(alignQuote("WE CHECK ORIGINAL EVIDENCE", words, 1250), {
    startMs: 0,
    endMs: 1250,
  });
  assert.equal(alignQuote("We checked other evidence", words, 2000), null);
  assert.equal(alignQuote("We check", words, 2000), null);
  assert.equal(
    alignQuote(
      "check original evidence",
      [
        ...words,
        ...words.map((w) => ({ ...w, start: w.start + 2, end: w.end + 2 })),
      ],
      5000,
    ),
    null,
  );
  assert.equal(
    alignQuote(
      "We check original evidence",
      words.map((w, n) => (n === 3 ? { ...w, end: 35 } : w)),
      40000,
    ),
    null,
  );
  assert.equal(
    timedWords.safeParse([{ word: "bad", start: 2, end: 1 }]).success,
    false,
  );
  assert.deepEqual(
    alignQuote(
      "Le café fonctionne",
      [
        { word: "Le", start: 0, end: 0.2 },
        { word: "cafe\u0301", start: 0.2, end: 0.5 },
        { word: "fonctionne", start: 0.5, end: 1 },
      ],
      1200,
    ),
    { startMs: 0, endMs: 1200 },
  );
});
test("PPTX import preserves original slide/theme/notes bytes and appends independently styled report parts with source dimensions and valid relationships", async () => {
  const original = await staticDeck(),
    generated = await staticDeck(
      "Reviewed research evidence & citations",
      true,
    ),
    before = await readPresentationPackage(original),
    output = await appendPresentation(original, generated),
    merged = await readPresentationPackage(output),
    info = validatePresentationPackage(merged);
  assert.equal(info.order.length, 2);
  assert.equal(info.width, 9144000);
  assert.equal(info.height, 6858000);
  for (const name of [
    "ppt/slides/slide1.xml",
    "ppt/slideMasters/slideMaster1.xml",
    "ppt/theme/theme1.xml",
    "ppt/notesSlides/notesSlide1.xml",
  ])
    assert.ok(merged.get(name)!.equals(before.get(name)!), name);
  const appended = merged.get(info.order[1])!.toString();
  assert.ok(appended.includes("Reviewed research evidence &amp; citations"));
  assert.ok(appended.includes("Echo Lab report content"));
  assert.equal((await inspectImportedPresentation(original)).slides, 1);
  const sameSize = await appendPresentation(
    await staticDeck("Wide original", true),
    generated,
  );
  assert.equal(
    validatePresentationPackage(await readPresentationPackage(sameSize)).order
      .length,
    2,
  );
});
test("PPTX import rejects active/external content, corrupt packages, path traversal, XML entities and unresolved slide relationships", async () => {
  const deck = await staticDeck();
  const mutate = async (edit: (z: JSZip) => void) => {
    const z = await JSZip.loadAsync(deck);
    edit(z);
    return z.generateAsync({ type: "nodebuffer" });
  };
  await assert.rejects(() =>
    inspectImportedPresentation(Buffer.from("not a presentation")),
  );
  await assert.rejects(async () =>
    inspectImportedPresentation(
      await mutate((z) => z.file("ppt/vbaProject.bin", "macro")),
    ),
  );
  await assert.rejects(async () => {
    const z = await JSZip.loadAsync(deck);
    z.file("ppt/media/innocent.jpg", "disguised active payload");
    const rel = await z
      .file("ppt/_rels/presentation.xml.rels")!
      .async("string");
    z.file(
      "ppt/_rels/presentation.xml.rels",
      rel.replace(
        "</Relationships>",
        '<Relationship Id="hidden" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="media/innocent.jpg"/></Relationships>',
      ),
    );
    return inspectImportedPresentation(
      await z.generateAsync({ type: "nodebuffer" }),
    );
  });
  await assert.rejects(async () => {
    const z = await JSZip.loadAsync(deck);
    const types = await z.file("[Content_Types].xml")!.async("string");
    z.file(
      "[Content_Types].xml",
      types.replace(
        "</Types>",
        '<Override PartName="/ppt/media/innocent.jpg" ContentType="application/vnd.ms-office.vbaProject"/></Types>',
      ),
    );
    z.file("ppt/media/innocent.jpg", "disguised active payload");
    return inspectImportedPresentation(
      await z.generateAsync({ type: "nodebuffer" }),
    );
  });
  await assert.rejects(async () =>
    inspectImportedPresentation(
      await mutate((z) => z.file("../escaped.xml", "bad")),
    ),
  );
  await assert.rejects(async () =>
    inspectImportedPresentation(
      await mutate((z) =>
        z.file(
          "ppt/_rels/presentation.xml.rels",
          '<Relationships><Relationship Id="bad" Type="image" TargetMode="External" Target="https://example.com/image.png"/></Relationships>',
        ),
      ),
    ),
  );
  await assert.rejects(async () =>
    inspectImportedPresentation(
      await mutate((z) => z.remove("ppt/slides/slide1.xml")),
    ),
  );
  assert.throws(() =>
    parsePackageXml('<!DOCTYPE x [<!ENTITY a "expand">]><x>&a;</x>'),
  );
  assert.throws(() => parsePackageXml("<a>".repeat(150) + "</a>".repeat(150)));
  const tree = parsePackageXml(
    '<a value="&quot;safe&quot;">Quote &amp; evidence</a>',
  );
  assert.equal(
    writePackageXml(tree),
    '<a value="&quot;safe&quot;">Quote &amp; evidence</a>',
  );
  assert.ok(
    crossStudyCaption(
      "Study\nOne",
      "12345678-0000",
      "Checked context",
    ).startsWith("Study One [12345678]\n"),
  );
});
