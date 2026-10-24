import { z } from "zod";
import { validateConceptImages } from "./concept-images-server";
import { validateConceptVideos } from "./concept-videos-server";
import { db, get, put, list, uid, now, transaction, requireStudy } from "./db";
import { actor, canEdit, body, respond, fail } from "./http";
import {
  guideSchema,
  templateGuide,
  type Actor,
  type Study,
  type Revision,
} from "./domain";
import {
  defaultsSchema,
  audienceSchema,
  applyAudience,
  type WorkspaceDefaults,
  type Folder,
  type SavedAudience,
  type GuideHistory,
} from "./workflow";

export async function workspaceDefaults(
  workspaceId: string,
): Promise<WorkspaceDefaults> {
  const saved = await get<WorkspaceDefaults>(
    "defaults",
    workspaceId,
    workspaceId,
  );
  const g = templateGuide("New study");
  return (
    saved || {
      audience: g.audience,
      intro: g.intro,
      limit: g.limit,
      guidelines: "",
      version: 0,
    }
  );
}
export async function saveHistory(
  s: Study,
  a: Actor,
  action: GuideHistory["action"],
  restoredFrom?: string,
) {
  const h: GuideHistory = {
    id: uid(),
    workspaceId: s.workspaceId,
    studyId: s.id,
    guide: structuredClone(s.draft),
    version: s.version,
    createdAt: now(),
    actorName: a.name,
    action,
    ...(restoredFrom ? { restoredFrom } : {}),
  };
  await put("history", h);
}
export async function ensureHistory(s: Study, a: Actor) {
  if (!(await list<GuideHistory>("history", a.workspaceId, s.id)).length)
    await saveHistory(s, a, "baseline");
}
const versionInput = z.number().int().min(1);
async function deleteDoc(kind: string, id: string, workspaceId: string) {
  await db
    .prepare("DELETE FROM documents WHERE kind=? AND id=? AND workspace_id=?")
    .run(kind, id, workspaceId);
}
export async function dispatchWorkflow(
  req: Request,
  p: string[],
): Promise<Response | null> {
  const method = req.method;
  if (p[0] === "workflow" && p.length === 1 && method === "GET") {
    const a = await actor();
    return respond({
      folders: await list<Folder>("folder", a.workspaceId),
      audiences: await list<SavedAudience>("audience", a.workspaceId),
      defaults: await workspaceDefaults(a.workspaceId),
    });
  }
  if (p[0] === "workflow" && p[1] === "defaults" && method === "PUT") {
    const a = await actor();
    if (a.role !== "admin")
      fail(403, "Only admins can change workspace defaults.");
    const input = defaultsSchema
      .extend({ version: z.number().int().min(0) })
      .parse(await body(req));
    await transaction(async () => {
      const current = await workspaceDefaults(a.workspaceId);
      if (current.version !== input.version)
        fail(409, "Defaults changed. Reload before saving.");
      await put("defaults", {
        ...input,
        id: a.workspaceId,
        workspaceId: a.workspaceId,
        version: current.version + 1,
      });
    });
    return respond({ defaults: await workspaceDefaults(a.workspaceId) });
  }
  if (p[0] === "workflow" && p[1] === "folders") {
    const a = await actor();
    canEdit(a);
    if (method === "POST" && !p[2]) {
      const { name } = z
        .object({ name: z.string().trim().min(1).max(100) })
        .parse(await body(req));
      const folder: Folder = { id: uid(), workspaceId: a.workspaceId, name };
      await put("folder", folder);
      return respond({ folder }, 201);
    }
    if (p[2] && (method === "PUT" || method === "DELETE")) {
      await transaction(async () => {
        const folder = await get<Folder>("folder", p[2], a.workspaceId);
        if (!folder) fail(404, "Folder not found.");
        if (method === "PUT") {
          const { name } = z
            .object({ name: z.string().trim().min(1).max(100) })
            .parse(await body(req));
          await put("folder", { ...folder, name });
        } else {
          for (const s of await list<Study>("study", a.workspaceId))
            if (s.folderId === folder.id) {
              s.folderId = null;
              s.version++;
              s.updatedAt = now();
              await put("study", s);
            }
          await deleteDoc("folder", folder.id, a.workspaceId);
        }
      });
      return respond({ ok: true });
    }
  }
  if (p[0] === "workflow" && p[1] === "audiences") {
    const a = await actor();
    canEdit(a);
    if (p[2] && method === "DELETE") {
      if (!(await get("audience", p[2], a.workspaceId)))
        fail(404, "Audience not found.");
      await deleteDoc("audience", p[2], a.workspaceId);
      return respond({ ok: true });
    }
  }
  if (
    p[0] !== "studies" ||
    !p[1] ||
    !["history", "restore", "audience", "folder"].includes(p[2])
  )
    return null;
  const a = await actor(),
    s = await requireStudy(p[1], a);
  if (p[2] === "history" && method === "GET") {
    return respond({
      history: await list<GuideHistory>("history", a.workspaceId, s.id),
      revisions: await list<Revision>("revision", a.workspaceId, s.id),
    });
  }
  canEdit(a);
  if (p[2] === "audience" && method === "POST") {
    const input = z
      .object({
        name: z.string(),
        questionIds: z.array(z.string()).min(1).max(15),
        version: versionInput,
      })
      .parse(await body(req));
    let audience: SavedAudience | undefined;
    await transaction(async () => {
      const current = await requireStudy(s.id, a);
      if (current.version !== input.version)
        fail(409, "Guide changed. Reload before saving an audience.");
      const questions = current.draft.questions.filter((q) =>
        input.questionIds.includes(q.id),
      );
      if (questions.length !== new Set(input.questionIds).size)
        fail(400, "Select questions from this guide.");
      const data = audienceSchema.parse({
        name: input.name,
        description: current.draft.audience,
        questions,
        sections: current.draft.sections?.filter((s) =>
          questions.some((q) => q.section === s.name),
        ),
      });
      audience = {
        ...data,
        id: uid(),
        workspaceId: a.workspaceId,
        createdAt: now(),
      };
      await put("audience", audience);
    });
    return respond({ audience }, 201);
  }
  if (
    (p[2] === "restore" && method === "POST") ||
    (p[2] === "audience" && method === "PUT") ||
    (p[2] === "folder" && method === "PUT")
  ) {
    const input = z
      .object({
        version: versionInput,
        id: z.string().min(1).max(100).nullable(),
        source: z.enum(["history", "revision"]).optional(),
      })
      .parse(await body(req));
    await transaction(async () => {
      const current = await requireStudy(s.id, a);
      if (current.version !== input.version)
        fail(409, "Study changed. Reload before applying this change.");
      if (p[2] === "folder") {
        if (input.id && !(await get<Folder>("folder", input.id, a.workspaceId)))
          fail(404, "Folder not found.");
        current.folderId = input.id;
      } else {
        await ensureHistory(current, a);
        if (p[2] === "restore") {
          const snapshot = input.id
            ? await get<GuideHistory | Revision>(
                input.source === "revision" ? "revision" : "history",
                input.id,
                a.workspaceId,
              )
            : undefined;
          if (!snapshot || snapshot.studyId !== current.id)
            fail(404, "Guide snapshot not found.");
          current.draft = guideSchema.parse(snapshot.guide);
        } else {
          const audience = input.id
            ? await get<SavedAudience>("audience", input.id, a.workspaceId)
            : undefined;
          if (!audience) fail(404, "Saved audience not found.");
          current.draft = applyAudience(current.draft, audience, uid);
        }
        current.title = current.draft.title;
      }
      await validateConceptImages(current, current.draft);
      await validateConceptVideos(current, current.draft);
      current.version++;
      current.updatedAt = now();
      await put("study", current);
      if (p[2] !== "folder")
        await saveHistory(
          current,
          a,
          p[2] === "restore" ? "restored" : "audience",
          p[2] === "restore" ? input.id! : undefined,
        );
    });
    return respond({ study: await requireStudy(s.id, a) });
  }
  return null;
}
