// Bounded text-only PPTX preparation. No application credentials, disk extraction,
// relationship fetching, Office rendering or executable document content.
const yauzl = require("yauzl");
const crc32 = require("buffer-crc32");
const { SaxesParser } = require("saxes");
const chunks = [];
let size = 0;
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
            ++count > 1000 ||
            entries.has(e.fileName) ||
            !Number.isSafeInteger(e.uncompressedSize) ||
            e.uncompressedSize > 2 * 1024 * 1024 ||
            e.generalPurposeBitFlag & 1 ||
            ![0, 8].includes(e.compressionMethod) ||
            /[\\\x00]/.test(e.fileName) ||
            /vbaProject|macros?|activeX\/.+|embeddings\/.+/i.test(e.fileName)
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
          if (total > 20 * 1024 * 1024) throw Error();
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
    const pns = new Set([
      "http://schemas.openxmlformats.org/presentationml/2006/main",
      "http://purl.oclc.org/ooxml/presentationml/main",
    ]);
    const ans = new Set([
      "http://schemas.openxmlformats.org/drawingml/2006/main",
      "http://purl.oclc.org/ooxml/drawingml/main",
    ]);
    const rns = new Set([
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "http://purl.oclc.org/ooxml/officeDocument/relationships",
    ]);
    const packageNS =
      "http://schemas.openxmlformats.org/package/2006/relationships";
    const types = new Map();
    xml(await read("[Content_Types].xml"), () => ({
      open(t) {
        if (
          t.uri !==
          "http://schemas.openxmlformats.org/package/2006/content-types"
        )
          return;
        const a = t.attributes,
          type = a.ContentType?.value || "";
        if (/macroEnabled|vbaProject|oleObject|activeX/i.test(type))
          throw Error();
        if (t.local === "Override") {
          const part = a.PartName?.value;
          if (!part || types.has(part)) throw Error();
          types.set(part, type);
        }
      },
    }));
    if (
      types.get("/ppt/presentation.xml") !==
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"
    )
      throw Error();
    function relationships(input) {
      const result = new Map();
      xml(input, () => ({
        open(t, depth) {
          if (
            depth === 1 &&
            (t.local !== "Relationships" || t.uri !== packageNS)
          )
            throw Error();
          if (t.local !== "Relationship" || t.uri !== packageNS) return;
          const a = t.attributes,
            id = a.Id?.value;
          if (depth !== 2 || !id || result.has(id)) throw Error();
          result.set(id, {
            type: a.Type?.value,
            target: a.Target?.value,
            external: a.TargetMode?.value === "External",
          });
        },
      }));
      return result;
    }
    const rootRels = relationships(await read("_rels/.rels"));
    const rootParts = [...rootRels.values()].filter((r) =>
      /\/officeDocument$/.test(r.type || ""),
    );
    if (
      rootParts.length !== 1 ||
      rootParts[0].external ||
      !["ppt/presentation.xml", "/ppt/presentation.xml"].includes(
        rootParts[0].target,
      )
    )
      throw Error();
    const rels = relationships(await read("ppt/_rels/presentation.xml.rels"));
    const slideIds = [],
      ids = new Set();
    let inList = false;
    xml(await read("ppt/presentation.xml"), () => ({
      open(t, depth) {
        if (depth === 1 && (t.local !== "presentation" || !pns.has(t.uri)))
          throw Error();
        if (pns.has(t.uri) && t.local === "sldIdLst" && depth === 2)
          inList = true;
        if (pns.has(t.uri) && t.local === "sldId" && inList) {
          const id = Object.values(t.attributes).find(
            (a) => a.local === "id" && rns.has(a.uri),
          )?.value;
          if (depth !== 3 || !id || ids.has(id) || slideIds.length >= 100)
            throw Error();
          ids.add(id);
          slideIds.push(id);
        }
      },
      close(t) {
        if (pns.has(t.uri) && t.local === "sldIdLst") inList = false;
      },
    }));
    if (!slideIds.length) throw Error();
    const paths = new Set(),
      slides = [];
    let totalText = 0,
      paragraphs = 0;
    for (const id of slideIds) {
      const rel = rels.get(id);
      if (
        !rel ||
        rel.external ||
        !/\/slide$/.test(rel.type || "") ||
        !rel.target ||
        /[\\%?#:]/.test(rel.target)
      )
        throw Error();
      const name = require("node:path").posix.normalize(
        rel.target.startsWith("/") ? rel.target.slice(1) : "ppt/" + rel.target,
      );
      if (
        !/^ppt\/slides\/[^/]+\.xml$/.test(name) ||
        paths.has(name) ||
        types.get("/" + name) !==
          "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"
      )
        throw Error();
      paths.add(name);
      let hidden = false,
        tree = false,
        bodyDepth = 0,
        paragraph = null,
        inText = false;
      const shapes = [],
        parts = [];
      xml(await read(name), () => ({
        open(t, depth) {
          if (depth === 1) {
            if (t.local !== "sld" || !pns.has(t.uri)) throw Error();
            hidden = ["0", "false"].includes(t.attributes.show?.value);
          }
          if (pns.has(t.uri) && t.local === "spTree") tree = true;
          if (!tree) return;
          if (
            pns.has(t.uri) &&
            ["sp", "graphicFrame", "grpSp"].includes(t.local)
          )
            shapes.push({ depth, hidden: false, parts: [] });
          const shape = shapes.at(-1);
          if (!shape) return;
          if (
            pns.has(t.uri) &&
            t.local === "cNvPr" &&
            ["1", "true"].includes(t.attributes.hidden?.value)
          )
            shape.hidden = true;
          if (t.local === "txBody" && (pns.has(t.uri) || ans.has(t.uri))) {
            if (bodyDepth) throw Error();
            bodyDepth = depth;
          }
          if (bodyDepth && ans.has(t.uri)) {
            if (t.local === "p") {
              if (paragraph !== null || ++paragraphs > 2000) throw Error();
              paragraph = "";
            }
            if (t.local === "t" && paragraph !== null) inText = true;
            if (t.local === "br" && paragraph !== null) paragraph += "\n";
          }
        },
        text(t) {
          if (inText && paragraph !== null) {
            totalText += t.length;
            if (totalText > 200000) throw Error();
            paragraph += t;
          }
        },
        close(t, depth) {
          if (ans.has(t.uri) && t.local === "t") inText = false;
          if (ans.has(t.uri) && t.local === "p" && paragraph !== null) {
            const text = paragraph.trim();
            if (text) shapes.at(-1)?.parts.push(text);
            paragraph = null;
          }
          if (depth === bodyDepth) bodyDepth = 0;
          if (shapes.at(-1)?.depth === depth) {
            const shape = shapes.pop();
            if (!shape.hidden)
              (shapes.at(-1)?.parts || parts).push(...shape.parts);
          }
          if (pns.has(t.uri) && t.local === "spTree") tree = false;
        },
      }));
      slides.push(hidden ? "" : parts.join("\n"));
    }
    if (!slides.some((s) => s.trim())) throw Error();
    return { version: 1, slides };
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
