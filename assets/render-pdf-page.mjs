// Render only one prepared PDF page; this process receives no application credentials.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
let size = 0;
const chunks = [];
try {
  const number = Number(process.argv[2]);
  if (!Number.isInteger(number) || number < 1 || number > 20) throw Error();
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 3 * 1024 * 1024) throw Error();
    chunks.push(chunk);
  }
  const task = getDocument({
    data: new Uint8Array(Buffer.concat(chunks)),
    enableXfa: false,
    verbosity: 0,
    useSystemFonts: false,
    useWorkerFetch: false,
    stopAtErrors: true,
    maxImageSize: 4000000,
    isEvalSupported: false,
  });
  try {
    const doc = await task.promise;
    if (doc.numPages > 20 || number > doc.numPages) throw Error();
    const page = await doc.getPage(number),
      original = page.getViewport({ scale: 1 });
    if (
      !Number.isFinite(original.width + original.height) ||
      original.width <= 0 ||
      original.height <= 0
    )
      throw Error();
    const scale = Math.min(2, 1600 / Math.max(original.width, original.height));
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(
      Math.max(1, Math.ceil(viewport.width)),
      Math.max(1, Math.ceil(viewport.height)),
    );
    await page.render({
      canvasContext: canvas.getContext("2d"),
      viewport,
      background: "white",
    }).promise;
    const output = canvas.toBuffer("image/png");
    if (output.length > 4 * 1024 * 1024) throw Error();
    process.stdout.write(output);
    page.cleanup();
  } finally {
    await task.destroy();
  }
} catch {
  process.exitCode = 2;
}
