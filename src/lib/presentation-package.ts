import { createRequire } from "node:module";
import path from "node:path";
import JSZip from "jszip";
import { SaxesParser } from "saxes";
const yauzl = createRequire(import.meta.url)("yauzl");
export type XmlNode = {
  name: string;
  attrs: Record<string, string>;
  children: (XmlNode | string)[];
};
export const localName = (name: string) => name.split(":").at(-1)!;
const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export function parsePackageXml(data: Buffer | string) {
  const text =
    typeof data === "string"
      ? data
      : new TextDecoder("utf-8", { fatal: true }).decode(data);
  if (text.length > 6 * 1024 * 1024) throw Error("PPTX_XML_LIMIT");
  const parser = new SaxesParser({ xmlns: false }),
    stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  let nodes = 0;
  parser.on("doctype", () => {
    throw Error("PPTX_DTD_FORBIDDEN");
  });
  parser.on("error", (e) => {
    throw e;
  });
  parser.on("opentag", (tag) => {
    if (++nodes > 100000 || stack.length > 128) throw Error("PPTX_XML_LIMIT");
    const node: XmlNode = {
      name: tag.name,
      attrs: Object.assign(Object.create(null), tag.attributes),
      children: [],
    };
    if (
      ["script", "oleObj", "control", "externalData"].includes(
        localName(tag.name),
      )
    )
      throw Error("PPTX_ACTIVE_CONTENT");
    if (stack.length) stack.at(-1)!.children.push(node);
    else {
      if (root) throw Error("PPTX_XML_ROOT");
      root = node;
    }
    stack.push(node);
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  parser.on("text", (value) => {
    if (stack.length) stack.at(-1)!.children.push(value);
  });
  parser.on("cdata", (value) => {
    if (stack.length) stack.at(-1)!.children.push(value);
  });
  parser.write(text).close();
  if (!root || stack.length) throw Error("PPTX_XML_ROOT");
  return root;
}
export function writePackageXml(n: XmlNode): string {
  return `<${n.name}${Object.entries(n.attrs)
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join(
      "",
    )}>${n.children.map((c) => (typeof c === "string" ? esc(c) : writePackageXml(c))).join("")}</${n.name}>`;
}
const children = (n: XmlNode, name: string) =>
  n.children.filter(
    (c): c is XmlNode => typeof c !== "string" && localName(c.name) === name,
  );
const child = (n: XmlNode, name: string) => children(n, name)[0];
const prefixName = (n: XmlNode, name: string) =>
  n.name.includes(":") ? n.name.split(":")[0] + ":" + name : name;
const relationNamespace =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export async function readPresentationPackage(bytes: Buffer) {
  if (
    bytes.length > 3 * 1024 * 1024 ||
    bytes.length < 4 ||
    bytes.readUInt32LE(0) !== 0x04034b50
  )
    throw Error("PPTX_SIZE_OR_FORMAT");
  const zip: any = await new Promise((resolve, reject) =>
    yauzl.fromBuffer(
      bytes,
      {
        lazyEntries: true,
        autoClose: false,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (error: Error | null, value: any) =>
        error ? reject(error) : resolve(value),
    ),
  );
  const files = new Map<string, Buffer>();
  let size = 0,
    count = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.on("entry", (entry: any) => {
        const name: string = entry.fileName;
        if (
          ++count > 1000 ||
          entry.generalPurposeBitFlag & 1 ||
          /[\\\x00-\x1f%?#]/.test(name) ||
          name.startsWith("/") ||
          name.split("/").includes("..") ||
          files.has(name) ||
          entry.uncompressedSize > 6 * 1024 * 1024 ||
          size + entry.uncompressedSize > 30 * 1024 * 1024
        ) {
          reject(Error("PPTX_PACKAGE_LIMIT"));
          return;
        }
        if (name.endsWith("/")) {
          zip.readEntry();
          return;
        }
        if (/vba|activeX|embeddings|\.bin$|\.html?$|\.svg$|\.js$/i.test(name)) {
          reject(Error("PPTX_ACTIVE_CONTENT"));
          return;
        }
        zip.openReadStream(entry, (error: Error | null, stream: any) => {
          if (error) {
            reject(error);
            return;
          }
          const chunks: Buffer[] = [];
          let read = 0;
          stream.on("error", reject);
          stream.on("data", (b: Buffer) => {
            read += b.length;
            if (read > entry.uncompressedSize || read > 6 * 1024 * 1024) {
              stream.destroy();
              reject(Error("PPTX_PACKAGE_LIMIT"));
            } else chunks.push(b);
          });
          stream.on("end", () => {
            const data = Buffer.concat(chunks);
            if (
              data.length !== entry.uncompressedSize ||
              crc32(data) !== entry.crc32
            ) {
              reject(Error("PPTX_CORRUPT"));
              return;
            }
            size += data.length;
            files.set(name, data);
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  return files;
}
function relationshipTarget(owner: string, target: string) {
  if (
    !target ||
    /[\\\x00-\x1f]/.test(target) ||
    /^[a-z][a-z0-9+.-]*:/i.test(target) ||
    target.startsWith("//")
  )
    throw Error("PPTX_RELATIONSHIP");
  const decoded = decodeURIComponent(target.split("#")[0]),
    resolved = decoded.startsWith("/")
      ? decoded.slice(1)
      : path.posix.normalize(
          path.posix.join(path.posix.dirname(owner), decoded),
        );
  if (
    resolved.startsWith("../") ||
    resolved === ".." ||
    resolved.startsWith("/")
  )
    throw Error("PPTX_RELATIONSHIP");
  return resolved;
}
export function validatePresentationPackage(files: Map<string, Buffer>) {
  if (
    !files.has("[Content_Types].xml") ||
    !files.has("ppt/presentation.xml") ||
    !files.has("ppt/_rels/presentation.xml.rels") ||
    !files.has("_rels/.rels")
  )
    throw Error("PPTX_MAIN_MISSING");
  for (const [name, data] of files) {
    if (!/\.(xml|rels)$/i.test(name)) continue;
    const xml = parsePackageXml(data);
    if (name.endsWith(".rels")) {
      const owner =
          name === "_rels/.rels"
            ? "root.xml"
            : name.replace(/(^|\/)\_rels\/([^/]+)\.rels$/, "$1$2"),
        ids = new Set<string>();
      for (const r of children(xml, "Relationship")) {
        if (!r.attrs.Id || ids.has(r.attrs.Id))
          throw Error("PPTX_RELATIONSHIP");
        ids.add(r.attrs.Id);
        if (
          /\/(vbaProject|activeX|oleObject|control|package|customUI)$/i.test(
            r.attrs.Type || "",
          )
        )
          throw Error("PPTX_ACTIVE_CONTENT");
        if (r.attrs.TargetMode === "External") {
          if (!r.attrs.Type.endsWith("/hyperlink"))
            throw Error("PPTX_EXTERNAL_CONTENT");
          const u = new URL(r.attrs.Target);
          if (u.protocol !== "https:" || u.username || u.password)
            throw Error("PPTX_EXTERNAL_CONTENT");
        } else if (!files.has(relationshipTarget(owner, r.attrs.Target)))
          throw Error("PPTX_RELATIONSHIP");
      }
    }
  }
  const rootRelations = parsePackageXml(files.get("_rels/.rels")!),
    officeDocuments = children(rootRelations, "Relationship").filter(
      (r) => r.attrs.Type === relationNamespace + "/officeDocument",
    );
  if (
    officeDocuments.length !== 1 ||
    officeDocuments[0].attrs.TargetMode === "External" ||
    relationshipTarget("root.xml", officeDocuments[0].attrs.Target) !==
      "ppt/presentation.xml"
  )
    throw Error("PPTX_MAIN_REFERENCE");
  const contentTypes = parsePackageXml(files.get("[Content_Types].xml")!);
  for (const name of files.keys()) {
    const type =
      children(contentTypes, "Override").find(
        (n) => n.attrs.PartName === "/" + name,
      )?.attrs.ContentType ||
      children(contentTypes, "Default").find(
        (n) =>
          n.attrs.Extension?.toLowerCase() ===
          name.split(".").at(-1)?.toLowerCase(),
      )?.attrs.ContentType ||
      "";
    if (
      /vba|macroenabled|activex|oleobject|javascript|svg|html|x-msdownload/i.test(
        type,
      )
    )
      throw Error("PPTX_ACTIVE_CONTENT");
  }

  if (
    children(contentTypes, "Override").filter(
      (t) =>
        t.attrs.PartName === "/ppt/presentation.xml" &&
        t.attrs.ContentType ===
          "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    ).length !== 1
  )
    throw Error("PPTX_MAIN_CONTENT_TYPE");
  const presentation = parsePackageXml(files.get("ppt/presentation.xml")!),
    rels = parsePackageXml(files.get("ppt/_rels/presentation.xml.rels")!);
  if (
    localName(presentation.name) !== "presentation" ||
    !Object.values(presentation.attrs).includes(
      "http://schemas.openxmlformats.org/presentationml/2006/main",
    )
  )
    throw Error("PPTX_PRESENTATION_FORMAT");
  const slides = child(presentation, "sldIdLst"),
    dimensions = child(presentation, "sldSz"),
    width = Number(dimensions?.attrs.cx),
    height = Number(dimensions?.attrs.cy);
  const order = slides
    ? children(slides, "sldId").map((n) => {
        const id = Object.entries(n.attrs).find(([k]) =>
            k.endsWith(":id"),
          )?.[1],
          rel = children(rels, "Relationship").find(
            (r) =>
              r.attrs.Id === id &&
              r.attrs.Type === relationNamespace + "/slide",
          );
        if (!rel) throw Error("PPTX_SLIDE_REFERENCE");
        return relationshipTarget("ppt/presentation.xml", rel.attrs.Target);
      })
    : [];
  if (
    !order.length ||
    order.length > 100 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 914400 ||
    height < 914400 ||
    width > 30 * 914400 ||
    height > 30 * 914400 ||
    new Set(order).size !== order.length
  )
    throw Error("PPTX_SLIDE_LIMIT");
  return { presentation, rels, order, width, height };
}
export async function inspectImportedPresentation(bytes: Buffer) {
  if (bytes.length > 2 * 1024 * 1024) throw Error("PPTX_IMPORT_LIMIT");
  const files = await readPresentationPackage(bytes),
    info = validatePresentationPackage(files);
  if (info.order.length > 50) throw Error("PPTX_IMPORT_LIMIT");
  return { slides: info.order.length, width: info.width, height: info.height };
}
function fitGeneratedSlide(
  data: Buffer,
  width: number,
  height: number,
  fromWidth: number,
  fromHeight: number,
) {
  if (width === fromWidth && height === fromHeight) return data;
  const root = parsePackageXml(data),
    common = child(root, "cSld"),
    tree = common && child(common, "spTree");
  if (!tree) throw Error("PPTX_SLIDE_FORMAT");
  const body = tree.children.filter(
      (n) =>
        typeof n !== "string" &&
        !["nvGrpSpPr", "grpSpPr"].includes(localName(n.name)),
    ),
    scale = Math.min(width / fromWidth, height / fromHeight),
    w = Math.round(fromWidth * scale),
    h = Math.round(fromHeight * scale);
  // A group transform letterboxes the generated report without modifying imported slide geometry.
  const group = parsePackageXml(
    `<p:grpSp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:nvGrpSpPr><p:cNvPr id="2147483647" name="Echo Lab report content"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${Math.round((width - w) / 2)}" y="${Math.round((height - h) / 2)}"/><a:ext cx="${w}" cy="${h}"/><a:chOff x="0" y="0"/><a:chExt cx="${fromWidth}" cy="${fromHeight}"/></a:xfrm></p:grpSpPr></p:grpSp>`,
  );
  group.children.push(...body);
  tree.children = tree.children.filter(
    (n) =>
      typeof n === "string" ||
      ["nvGrpSpPr", "grpSpPr"].includes(localName(n.name)),
  );
  tree.children.push(group);
  return Buffer.from(writePackageXml(root));
}
export async function appendPresentation(original: Buffer, generated: Buffer) {
  const files = await readPresentationPackage(original),
    extra = await readPresentationPackage(generated),
    before = validatePresentationPackage(files),
    after = validatePresentationPackage(extra);
  if (
    before.order.length > 50 ||
    before.order.length + after.order.length > 100
  )
    throw Error("PPTX_SLIDE_LIMIT");
  let folder = "echoLabReport",
    index = 1;
  while ([...files.keys()].some((k) => k.startsWith(folder + "/")))
    folder = "echoLabReport" + index++;
  const skip = new Set([
      "[Content_Types].xml",
      "_rels/.rels",
      "ppt/presentation.xml",
      "ppt/_rels/presentation.xml.rels",
    ]),
    copied = new Set<string>();
  for (const [name, raw] of extra) {
    if (skip.has(name) || name.startsWith("docProps/")) continue;
    let data = raw;
    if (after.order.includes(name))
      data = fitGeneratedSlide(
        raw,
        before.width,
        before.height,
        after.width,
        after.height,
      );
    if (name.endsWith(".rels")) {
      const xml = parsePackageXml(data);
      for (const r of children(xml, "Relationship"))
        if (r.attrs.TargetMode !== "External" && r.attrs.Target.startsWith("/"))
          r.attrs.Target = "/" + folder + r.attrs.Target;
      data = Buffer.from(writePackageXml(xml));
    }
    files.set(folder + "/" + name, data);
    copied.add(name);
  }
  const p = before.presentation,
    rels = before.rels,
    ids = new Set(children(rels, "Relationship").map((r) => r.attrs.Id));
  let rp = "echoRel";
  while (writePackageXml(p).includes(rp + ":")) rp += "X";
  p.attrs["xmlns:" + rp] = relationNamespace;
  for (const listName of [
    "sldIdLst",
    "sldMasterIdLst",
    "notesMasterIdLst",
    "handoutMasterIdLst",
  ]) {
    const incoming = child(after.presentation, listName);
    if (!incoming) continue;
    let list = child(p, listName);
    if (!list) {
      list = { name: prefixName(p, listName), attrs: {}, children: [] };
      const slideIndex = p.children.findIndex(
        (n) => typeof n !== "string" && localName(n.name) === "sldIdLst",
      );
      p.children.splice(
        listName === "sldIdLst" || slideIndex < 0
          ? p.children.length
          : slideIndex,
        0,
        list,
      );
    }
    const numeric = new Set(
      list.children.flatMap((n) =>
        typeof n === "string" || !n.attrs.id ? [] : [Number(n.attrs.id)],
      ),
    );
    for (const n of incoming.children) {
      if (typeof n === "string") continue;
      const oldId = Object.entries(n.attrs).find(([k]) =>
          k.endsWith(":id"),
        )?.[1],
        r = children(after.rels, "Relationship").find(
          (r) => r.attrs.Id === oldId,
        );
      if (!r) throw Error("PPTX_MASTER_REFERENCE");
      const target = relationshipTarget("ppt/presentation.xml", r.attrs.Target);
      if (!copied.has(target)) throw Error("PPTX_MASTER_REFERENCE");
      let id = "rIdEcho" + index++;
      while (ids.has(id)) id = "rIdEcho" + index++;
      ids.add(id);
      rels.children.push({
        name: prefixName(rels, "Relationship"),
        attrs: {
          Id: id,
          Type: r.attrs.Type,
          Target: "../" + folder + "/" + target,
        },
        children: [],
      });
      const attrs: Record<string, string> = { [rp + ":id"]: id };
      if (n.attrs.id) {
        let number = listName === "sldIdLst" ? 256 : 2147483648;
        while (numeric.has(number)) number++;
        numeric.add(number);
        attrs.id = String(number);
      }
      list.children.push({
        name: prefixName(p, localName(n.name)),
        attrs,
        children: [],
      });
    }
  }
  const types = parsePackageXml(files.get("[Content_Types].xml")!),
    newTypes = parsePackageXml(extra.get("[Content_Types].xml")!);
  for (const name of copied) {
    const type =
      children(newTypes, "Override").find(
        (t) => t.attrs.PartName === "/" + name,
      )?.attrs.ContentType ||
      children(newTypes, "Default").find(
        (t) => t.attrs.Extension === name.split(".").at(-1),
      )?.attrs.ContentType;
    if (!type) throw Error("PPTX_CONTENT_TYPE");
    types.children.push({
      name: prefixName(types, "Override"),
      attrs: { PartName: "/" + folder + "/" + name, ContentType: type },
      children: [],
    });
  }
  files.set("[Content_Types].xml", Buffer.from(writePackageXml(types)));
  files.set("ppt/presentation.xml", Buffer.from(writePackageXml(p)));
  files.set(
    "ppt/_rels/presentation.xml.rels",
    Buffer.from(writePackageXml(rels)),
  );
  if (files.has("docProps/app.xml")) {
    const props = parsePackageXml(files.get("docProps/app.xml")!),
      count = child(props, "Slides");
    if (count)
      count.children = [String(before.order.length + after.order.length)];
    files.set("docProps/app.xml", Buffer.from(writePackageXml(props)));
  }
  validatePresentationPackage(files);
  const zip = new JSZip();
  for (const [name, data] of files) zip.file(name, data);
  const out = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  if (out.length > 3 * 1024 * 1024) throw Error("PPTX_EXPORT_LIMIT");
  return out;
}
