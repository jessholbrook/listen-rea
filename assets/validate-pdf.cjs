// Runs in a separate, memory-limited process. Never evaluates document actions.
const { PDFDocument, PDFName } = require("pdf-lib");
const chunks = [];
let size = 0;
process.stdin.on("data", (b) => {
  size += b.length;
  if (size > 3 * 1024 * 1024) process.exit(2);
  chunks.push(b);
});
process.stdin.on("end", async () => {
  try {
    const bytes = Buffer.concat(chunks);
    if (!/^%PDF-(1\.[0-9]|2\.0)/.test(bytes.subarray(0, 12).toString("latin1")))
      throw Error();
    const source = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      updateMetadata: false,
      throwOnInvalidObject: true,
    });
    if (
      source.isEncrypted ||
      source.getPageCount() < 1 ||
      source.getPageCount() > 20 ||
      source.context.enumerateIndirectObjects().length > 5000 ||
      source.catalog.has(PDFName.of("AcroForm"))
    )
      throw Error();
    const output = await PDFDocument.create({ updateMetadata: false });
    output.setProducer("Echo Lab");
    output.setCreator("Echo Lab");
    output.setCreationDate(new Date(0));
    output.setModificationDate(new Date(0));
    for (const page of await output.copyPages(
      source,
      source.getPageIndices(),
    )) {
      const { width, height } = page.getSize();
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width < 1 ||
        height < 1 ||
        width > 14400 ||
        height > 14400
      )
        throw Error();
      for (const key of [
        "Annots",
        "AA",
        "Metadata",
        "PieceInfo",
        "PresSteps",
        "B",
        "AF",
      ])
        page.node.delete(PDFName.of(key));
      output.addPage(page);
    }
    const prepared = await output.save({ useObjectStreams: true });
    if (prepared.length > 3 * 1024 * 1024) throw Error();
    process.stdout.write(
      JSON.stringify({
        pages: output.getPageCount(),
        data: Buffer.from(prepared).toString("base64"),
      }),
    );
  } catch {
    process.exitCode = 2;
  }
});
