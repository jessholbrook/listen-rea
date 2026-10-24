// Bounded text-only DOCX preparation. No application credentials, disk extraction,
// relationship fetching, Office rendering or executable document content.
const yauzl = require("yauzl");
const crc32 = require("buffer-crc32");
const { SaxesParser } = require("saxes");
const chunks = [];
let size = 0;
const word = new Set([
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
]);
function xml(input, setup) {
  if (input.length > 2 * 1024 * 1024) throw Error();
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0,
    nodes = 0;
  parser.on("doctype", () => {
    throw Error();
  });
  parser.on("processinginstruction", () => {
    throw Error();
  });
  parser.on("error", (e) => {
    throw e;
  });
  const handlers = setup();
  parser.on("opentag", (tag) => {
    if (++depth > 64 || ++nodes > 50000) throw Error();
    handlers.open?.(tag, depth);
  });
  parser.on("closetag", (tag) => {
    handlers.close?.(tag, depth);
    depth--;
  });
  parser.on("text", (text) => handlers.text?.(text));
  parser.on("cdata", (text) => handlers.text?.(text));
  parser.write(new TextDecoder("utf-8", { fatal: true }).decode(input)).close();
}
async function prepare(bytes) {
  if (bytes.length > 3 * 1024 * 1024 || bytes.readUInt32LE(0) !== 0x04034b50)
    throw Error();
  const zip = await new Promise((resolve, reject) =>
    yauzl.fromBuffer(
      bytes,
      {
        lazyEntries: true,
        autoClose: false,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (e, z) => (e ? reject(e) : resolve(z)),
    ),
  );
  try {
    const entries = await new Promise((resolve, reject) => {
      const entries = new Map();
      let total = 0,
        count = 0;
      zip.on("error", reject);
      zip.on("end", () => resolve(entries));
      zip.on("entry", (e) => {
        try {
          if (
            ++count > 300 ||
            entries.has(e.fileName) ||
            !Number.isSafeInteger(e.uncompressedSize) ||
            e.uncompressedSize > 2 * 1024 * 1024 ||
            e.generalPurposeBitFlag & 1 ||
            ![0, 8].includes(e.compressionMethod) ||
            /[\\\x00]/.test(e.fileName) ||
            /vbaProject|macros?/i.test(e.fileName)
          )
            throw Error();
          const offset = e.relativeOffsetOfLocalHeader;
          if (
            !Number.isSafeInteger(offset) ||
            offset < 0 ||
            offset + 30 > bytes.length ||
            bytes.readUInt32LE(offset) !== 0x04034b50 ||
            bytes.readUInt16LE(offset + 6) !== e.generalPurposeBitFlag ||
            bytes.readUInt16LE(offset + 8) !== e.compressionMethod
          )
            throw Error();
          total += e.uncompressedSize;
          if (total > 10 * 1024 * 1024) throw Error();
          entries.set(e.fileName, e);
          zip.readEntry();
        } catch (e) {
          reject(e);
        }
      });
      zip.readEntry();
    });
    async function read(name) {
      const entry = entries.get(name);
      if (!entry) throw Error();
      return new Promise((resolve, reject) =>
        zip.openReadStream(entry, (error, stream) => {
          if (error) return reject(error);
          let count = 0;
          const chunks = [];
          stream.on("error", reject);
          stream.on("data", (b) => {
            count += b.length;
            if (count > 2 * 1024 * 1024) {
              stream.destroy();
              reject(Error());
            } else chunks.push(b);
          });
          stream.on("end", () => {
            const output = Buffer.concat(chunks);
            if (crc32.unsigned(output) !== entry.crc32) reject(Error());
            else resolve(output);
          });
        }),
      );
    }
    let contentType = false;
    xml(await read("[Content_Types].xml"), () => ({
      open: (t) => {
        if (
          t.local === "Override" &&
          t.uri ===
            "http://schemas.openxmlformats.org/package/2006/content-types"
        ) {
          const a = t.attributes;
          if (
            a.PartName?.value === "/word/document.xml" &&
            a.ContentType?.value ===
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
          )
            contentType = true;
          if (/macroEnabled|vbaProject/i.test(a.ContentType?.value || ""))
            throw Error();
        }
      },
    }));
    if (!contentType) throw Error();
    let rootRel = false;
    xml(await read("_rels/.rels"), () => ({
      open: (t) => {
        if (t.local === "Relationship") {
          const a = t.attributes;
          if (
            /\/officeDocument$/.test(a.Type?.value || "") &&
            a.Target?.value === "word/document.xml" &&
            a.TargetMode?.value !== "External"
          )
            rootRel = true;
        }
      },
    }));
    if (!rootRel) throw Error();
    if (entries.has("word/styles.xml"))
      xml(await read("word/styles.xml"), () => ({
        open: (t) => {
          if (word.has(t.uri) && ["vanish", "webHidden"].includes(t.local))
            throw Error();
        },
      }));
    let body = false,
      root = false,
      paragraph = null,
      paragraphHidden = false,
      paragraphs = [],
      run = null,
      hidden = false,
      inText = false,
      skip = 0,
      totalText = 0,
      paragraphCount = 0;
    xml(await read("word/document.xml"), () => ({
      open: (t, depth) => {
        if (depth === 1) {
          if (t.local !== "document" || !word.has(t.uri)) throw Error();
          root = true;
        }
        if (skip) {
          skip++;
          return;
        }
        if (!word.has(t.uri)) return;
        if (
          [
            "del",
            "moveFrom",
            "drawing",
            "pict",
            "object",
            "txbxContent",
          ].includes(t.local)
        ) {
          skip = 1;
          return;
        }
        if (t.local === "body") body = true;
        if (!body) return;
        if (t.local === "p") {
          if (paragraph !== null || ++paragraphCount > 2000) throw Error();
          paragraph = "";
          paragraphHidden = false;
        }
        if (t.local === "r") {
          if (run !== null) throw Error();
          run = "";
          hidden = false;
        }
        if (["vanish", "webHidden"].includes(t.local) && run !== null)
          hidden = true;
        if (
          ["vanish", "webHidden"].includes(t.local) &&
          run === null &&
          paragraph !== null
        )
          paragraphHidden = true;
        if (t.local === "t" && run !== null) inText = true;
        if (t.local === "tab" && run !== null) run += "\t";
        if (["br", "cr"].includes(t.local) && run !== null) run += "\n";
      },
      text: (t) => {
        if (!skip && inText && run !== null) {
          totalText += t.length;
          if (totalText > 200000) throw Error();
          run += t;
        }
      },
      close: (t) => {
        if (skip) {
          skip--;
          return;
        }
        if (!word.has(t.uri)) return;
        if (t.local === "t") inText = false;
        if (t.local === "r") {
          if (paragraph !== null && !hidden) paragraph += run || "";
          run = null;
        }
        if (t.local === "p") {
          const p = (paragraph || "").trim();
          if (p && !paragraphHidden) paragraphs.push(p);
          paragraph = null;
        }
        if (t.local === "body") body = false;
      },
    }));
    if (!root || !paragraphs.length || paragraphs.join("").length > 200000)
      throw Error();
    return { version: 1, paragraphs };
  } finally {
    zip.close();
  }
}
(async () => {
  try {
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 3 * 1024 * 1024) throw Error();
      chunks.push(chunk);
    }
    process.stdout.write(JSON.stringify(await prepare(Buffer.concat(chunks))));
  } catch {
    process.exitCode = 2;
  }
})();
