// Read only prepared, private PDF bytes. No application credentials are inherited.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const chunks = [];
let size = 0;
try {
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 3 * 1024 * 1024) throw Error();
    chunks.push(chunk);
  }
  const task = getDocument({
    data: new Uint8Array(Buffer.concat(chunks)),
    enableXfa: false,
    verbosity: 0,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    stopAtErrors: true,
    maxImageSize: 4000000,
  });
  try {
    const doc = await task.promise;
    if (doc.numPages < 1 || doc.numPages > 20) throw Error();
    const pages = [];
    let total = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n),
        content = await page.getTextContent();
      let text = "";
      for (const item of content.items)
        if ("str" in item) {
          text += item.str + (item.hasEOL ? "\n" : " ");
          if (text.length > 20000) throw Error();
        }
      text = text.trim();
      total += text.length;
      if (total > 200000) throw Error();
      pages.push(text);
      page.cleanup();
    }
    process.stdout.write(JSON.stringify(pages));
  } finally {
    await task.destroy();
  }
} catch {
  process.exitCode = 2;
}
