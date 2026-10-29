import { createHash } from "node:crypto";
import { z } from "zod";
import { actor, canEdit, body, fail, respond } from "./http";
import {
  db,
  get,
  list,
  put,
  hash,
  uid,
  now,
  transaction,
  requireStudy,
} from "./db";
import type { Actor } from "./domain";
import type { ReportEdition } from "./reporting";
import { pptxMime } from "./participant-pptx";
import {
  inspectImportedPresentation,
  appendPresentation,
} from "./presentation-package";
import { ensureRecording, readRecording } from "./storage";
import { queueRenderDeletion } from "./reporting-cleanup";
import { cleanDeletions } from "./features";
import { dispatchReporting } from "./reporting-server";
type ImportedPresentation = {
  id: string;
  workspaceId: string;
  studyId: string;
  name: string;
  dataVersion: number;
  version: number;
  reviewed: boolean;
  slides: number;
  createdAt: string;
  reviewedAt?: string;
  reviewer?: string;
  file: { id: string; bytes: number; digest: string };
};
const view = ({ file, workspaceId, ...v }: ImportedPresentation) => ({
  ...v,
  bytes: file.bytes,
  digest: file.digest,
});
async function member(a: Actor) {
  const row = await db
    .prepare("SELECT role,workspace_id FROM users WHERE id=?")
    .get(a.id);
  if (!row || row.workspace_id !== a.workspaceId || row.role !== a.role)
    fail(409, "Workspace access changed. Refresh first.");
}
function download(bytes: Buffer, filename: string) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": pptxMime,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export async function dispatchPresentationImport(req: Request, p: string[]) {
  if (p[0] !== "studies" || !p[1] || p[2] !== "presentation-imports")
    return null;
  const a = await actor(),
    s = await requireStudy(p[1], a);
  if (p.length === 3 && req.method === "GET")
    return respond({
      dataVersion: s.dataVersion,
      imports: (
        await list<ImportedPresentation>(
          "presentationImport",
          a.workspaceId,
          s.id,
        )
      ).map(view),
    });
  if (p.length === 3 && req.method === "POST") {
    canEdit(a);
    if (
      req.headers.get("content-type")?.split(";")[0] !== pptxMime ||
      req.headers.get("x-import-consent") !== "yes"
    )
      fail(
        400,
        "Choose a PPTX and confirm permission to use its original slides.",
      );
    const requestId = z.uuid().parse(req.headers.get("x-request-id")),
      dataVersion = z.coerce
        .number()
        .int()
        .min(0)
        .parse(req.headers.get("x-source-version")),
      name = z
        .string()
        .trim()
        .min(1)
        .max(100)
        .parse(
          decodeURIComponent(
            req.headers.get("x-import-name") || "Imported presentation",
          ),
        );
    if (!req.headers.has("x-source-version") || dataVersion !== s.dataVersion)
      fail(409, "Responses changed. Refresh before importing a presentation.");
    if (
      Number(req.headers.get("content-length")) > 2 * 1024 * 1024 ||
      !req.body
    )
      fail(413, "Choose a PPTX up to 2 MB.");
    const reader = req.body.getReader(),
      parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) {
        await reader.cancel();
        fail(413, "Choose a PPTX up to 2 MB.");
      }
      parts.push(value);
    }
    const bytes = Buffer.concat(parts),
      digest = createHash("sha256").update(bytes).digest("hex"),
      id = hash(s.id + ":" + requestId),
      previous = await get<ImportedPresentation>(
        "presentationImport",
        id,
        a.workspaceId,
      );
    if (previous) {
      if (
        previous.file.digest !== digest ||
        previous.name !== name ||
        previous.dataVersion !== dataVersion
      )
        fail(409, "This import request has different content.");
      return respond({ imported: view(previous) });
    }
    let info: Awaited<ReturnType<typeof inspectImportedPresentation>>;
    try {
      info = await inspectImportedPresentation(bytes);
    } catch {
      fail(
        400,
        "Use a standard, unencrypted static PPTX with up to 50 slides and 2 MB. Macros, embedded objects, SVG assets and external media are unsupported; HTTPS hyperlinks are preserved.",
      );
    }
    const fileId = uid(),
      guard = await queueRenderDeletion(s, [fileId], Date.now() + 180000);
    await ensureRecording(fileId, bytes, pptxMime);
    let imported!: ImportedPresentation;
    await transaction(async () => {
      await member(a);
      const current = await requireStudy(s.id, a);
      if (current.dataVersion !== dataVersion)
        fail(
          409,
          "Responses changed while uploading. Refresh and import again.",
        );
      if (
        (
          await list<ImportedPresentation>(
            "presentationImport",
            a.workspaceId,
            s.id,
          )
        ).length >= 5
      )
        fail(400, "Keep at most five imported presentations in a study.");
      if (await get("presentationImport", id, a.workspaceId))
        fail(
          409,
          "This import request already completed. Reload the imported presentation.",
        );
      imported = {
        id,
        workspaceId: a.workspaceId,
        studyId: s.id,
        name,
        dataVersion,
        version: 1,
        reviewed: false,
        slides: info.slides,
        createdAt: now(),
        file: { id: fileId, bytes: bytes.length, digest },
      };
      await put("presentationImport", imported);
      if (guard)
        await db
          .prepare(
            "DELETE FROM documents WHERE kind='deletion' AND id=? AND workspace_id=?",
          )
          .run(guard, a.workspaceId);
    });
    return respond({ imported: view(imported) }, 201);
  }
  const imported = p[3]
    ? await get<ImportedPresentation>("presentationImport", p[3], a.workspaceId)
    : undefined;
  if (!imported || imported.studyId !== s.id)
    fail(404, "Imported presentation unavailable.");
  if (p.length === 4 && req.method === "DELETE") {
    canEdit(a);
    const input = z
      .object({ version: z.number().int().min(1) })
      .strict()
      .parse(await body(req));
    await transaction(async () => {
      await member(a);
      const d = await get<ImportedPresentation>(
        "presentationImport",
        imported.id,
        a.workspaceId,
      );
      if (!d || d.version !== input.version)
        fail(409, "The import changed. Refresh first.");
      await queueRenderDeletion(s, [d.file.id]);
      await db
        .prepare(
          "DELETE FROM documents WHERE kind='presentationImport' AND id=? AND workspace_id=?",
        )
        .run(d.id, a.workspaceId);
    });
    await cleanDeletions();
    return respond({ deleted: true });
  }
  if (imported.dataVersion !== s.dataVersion)
    fail(
      409,
      "Responses changed. Remove this import and review a fresh one before exporting.",
    );
  if (p.length === 4 && req.method === "PUT") {
    canEdit(a);
    const input = z
      .object({ version: z.number().int().min(1), reviewed: z.literal(true) })
      .strict()
      .parse(await body(req));
    let result!: ImportedPresentation;
    await transaction(async () => {
      await member(a);
      const current = await requireStudy(s.id, a),
        d = await get<ImportedPresentation>(
          "presentationImport",
          imported.id,
          a.workspaceId,
        );
      if (
        !d ||
        d.version !== input.version ||
        d.dataVersion !== current.dataVersion
      )
        fail(409, "Import or sources changed. Refresh first.");
      result = {
        ...d,
        reviewed: true,
        version: d.version + 1,
        reviewedAt: now(),
        reviewer: a.name,
      };
      await put("presentationImport", result);
    });
    return respond({ imported: view(result) });
  }
  if (p.length === 5 && p[4] === "file" && req.method === "GET") {
    const bytes = await readRecording(imported.file.id);
    await member(a);
    const current = await requireStudy(s.id, a),
      fresh = await get<ImportedPresentation>(
        "presentationImport",
        imported.id,
        a.workspaceId,
      );
    if (!fresh || current.dataVersion !== imported.dataVersion)
      fail(409, "Import sources changed.");
    return download(bytes, "imported-presentation.pptx");
  }
  if (p.length === 5 && p[4] === "compose" && req.method === "POST") {
    const input = z
      .object({
        editionId: z.uuid(),
        editionVersion: z.number().int().positive(),
        importVersion: z.number().int().positive(),
        reviewed: z.literal(true),
      })
      .strict()
      .parse(await body(req));
    if (!imported.reviewed || imported.version !== input.importVersion)
      fail(
        409,
        "Review the current imported slides before composing an export.",
      );
    const e = await get<ReportEdition>(
      "reportEdition",
      input.editionId,
      a.workspaceId,
    );
    if (
      !e ||
      e.studyId !== s.id ||
      e.version !== input.editionVersion ||
      !e.reviewed
    )
      fail(409, "Choose a current reviewed report edition.");
    const response = await dispatchReporting(
      new Request("http://localhost/api/deck"),
      ["studies", s.id, "reporting", "editions", e.id, "deck"],
      a,
    );
    if (!response || !response.ok) fail(409, "Report export unavailable.");
    const original = await readRecording(imported.file.id);
    let output: Buffer;
    try {
      output = await appendPresentation(
        original,
        Buffer.from(await response.arrayBuffer()),
      );
    } catch {
      fail(
        422,
        "This presentation cannot be combined within the supported slide/package limits. Use fewer original or report slides.",
      );
    }
    await transaction(async () => {
      await member(a);
      const current = await requireStudy(s.id, a),
        currentEdition = await get<ReportEdition>(
          "reportEdition",
          e.id,
          a.workspaceId,
        ),
        currentImport = await get<ImportedPresentation>(
          "presentationImport",
          imported.id,
          a.workspaceId,
        );
      if (
        current.dataVersion !== imported.dataVersion ||
        currentEdition?.version !== e.version ||
        !currentEdition.reviewed ||
        currentImport?.version !== imported.version ||
        !currentImport.reviewed
      )
        fail(
          409,
          "Sources or approvals changed during export. Refresh and review again.",
        );
    });
    return download(output, "research-report-with-import.pptx");
  }
  fail(405, "Unsupported presentation import operation.");
}
