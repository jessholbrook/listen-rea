import { db, get } from "./db";
import type { Study, Revision, Interview, Analysis } from "./domain";
import { fail } from "./http";
import { retention } from "./features";
import {
  readPage,
  nextCursor,
  studyDto,
  responseSummary,
  responseDto,
  analysisDto,
  safeAnalysis,
  eligibleResponse,
  type ReadApiKey,
} from "./external-api";
export async function readAuthorizedData(
  req: Request,
  p: string[],
  key: ReadApiKey,
  json: (data: unknown) => Response = Response.json,
) {
  const scope = (name: ReadApiKey["scopes"][number]) => {
    if (!key.scopes.includes(name))
      fail(403, "This API key does not grant the required read permission.");
  };
  const page = (resource: string) => {
    try {
      return readPage(new URL(req.url), resource);
    } catch {
      fail(400, "Use limit 1–100 and a valid cursor for this endpoint.");
    }
  };
  const detailQuery = () => {
    if (new URL(req.url).search)
      fail(400, "This endpoint does not accept query parameters.");
  };
  const published = async (id: string) => {
    if (!key.studyIds.includes(id)) fail(404, "Study not found.");
    const s = await get<Study>("study", id, key.workspaceId);
    if (!s?.revisionId) fail(404, "Published study not found.");
    const r = await get<Revision>("revision", s.revisionId, key.workspaceId);
    if (!r || r.studyId !== s.id) fail(404, "Published study not found.");
    return { s, r };
  };
  // Apply the same source lifecycle rules as the researcher workspace before reading research data.
  await retention();
  if (p.length === 1 && p[0] === "studies") {
    scope("studies:read");
    const { limit, after } = page("studies");
    const rows = await db
      .prepare(
        `SELECT data FROM documents WHERE kind='study' AND workspace_id=? AND id>? AND id IN (${key.studyIds.map(() => "?").join(",")}) AND json_extract(data,'$.revisionId') IS NOT NULL ORDER BY id LIMIT ?`,
      )
      .all(key.workspaceId, after, ...key.studyIds, limit + 1);
    const data = [];
    for (const row of rows.slice(0, limit)) {
      const s = JSON.parse(row.data as string) as Study,
        r = await get<Revision>("revision", s.revisionId!, key.workspaceId);
      if (r && r.studyId === s.id) data.push(studyDto(s, r));
    }
    return json({
      data,
      nextCursor:
        rows.length > limit
          ? nextCursor(
              "studies",
              (JSON.parse(rows[limit - 1].data as string) as Study).id,
            )
          : null,
    });
  }
  if (p[0] !== "studies" || !p[1]) fail(404, "API endpoint not found.");
  if (p.length === 2) {
    scope("studies:read");
    detailQuery();
    const { s, r } = await published(p[1]);
    return json({ data: studyDto(s, r) });
  }
  if (!["responses", "analyses"].includes(p[2]) || p.length > 4)
    fail(404, "API endpoint not found.");
  scope(p[2] === "responses" ? "responses:read" : "analyses:read");
  const { s } = await published(p[1]);
  if (p[2] === "responses") {
    if (p.length === 4) {
      detailQuery();
      const i = await get<Interview>("interview", p[3], key.workspaceId);
      if (!i || i.studyId !== s.id || !eligibleResponse(i))
        fail(404, "Included completed response not found.");
      return json({ data: responseDto(i) });
    }
    const resource = "responses:" + s.id,
      { limit, after } = page(resource);
    const rows = await db
      .prepare(
        "SELECT data FROM documents WHERE kind='interview' AND workspace_id=? AND study_id=? AND id>? AND json_extract(data,'$.status')='complete' AND COALESCE(json_extract(data,'$.preview'),0)=0 AND COALESCE(json_extract(data,'$.excluded'),0)=0 ORDER BY id LIMIT ?",
      )
      .all(key.workspaceId, s.id, after, limit + 1);
    const all = rows.map((row) => JSON.parse(row.data as string) as Interview);
    return json({
      data: all.slice(0, limit).map(responseSummary),
      nextCursor:
        all.length > limit ? nextCursor(resource, all[limit - 1].id) : null,
    });
  }
  const sources = (
    await db
      .prepare(
        "SELECT data FROM documents WHERE kind='interview' AND workspace_id=? AND study_id=? AND json_extract(data,'$.status')='complete' AND COALESCE(json_extract(data,'$.preview'),0)=0 AND COALESCE(json_extract(data,'$.excluded'),0)=0",
      )
      .all(key.workspaceId, s.id)
  ).map((row) => JSON.parse(row.data as string) as Interview);
  if (p.length === 4) {
    detailQuery();
    const a = await get<Analysis>("analysis", p[3], key.workspaceId);
    if (!a || a.studyId !== s.id || !safeAnalysis(a, s, sources))
      fail(404, "Reviewed current analysis not found.");
    return json({ data: analysisDto(a, true) });
  }
  const resource = "analyses:" + s.id,
    { limit, after } = page(resource);
  const rows = await db
    .prepare(
      "SELECT data FROM documents WHERE kind='analysis' AND workspace_id=? AND study_id=? AND id>? AND json_extract(data,'$.reviewed')=1 AND json_extract(data,'$.dataVersion')=? ORDER BY id LIMIT ?",
    )
    .all(key.workspaceId, s.id, after, s.dataVersion, limit + 1);
  const all = rows.map((row) => JSON.parse(row.data as string) as Analysis),
    valid = all.slice(0, limit).filter((a) => safeAnalysis(a, s, sources));
  return json({
    data: valid.map((a) => analysisDto(a)),
    nextCursor:
      all.length > limit ? nextCursor(resource, all[limit - 1].id) : null,
  });
}
