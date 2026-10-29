import { z } from "zod";
import { db, get, list, put, uid, hash, now, transaction } from "./db";
import { actor, canEdit, canLaunch, body, fail, respond } from "./http";
import type { Actor, Study, Revision } from "./domain";
import { canonical, type PulseSeries } from "./pulse";
import { saveHistory } from "./workflow-server";
import {
  pulseScheduleSettings,
  pulseScheduleView,
  pulseToday,
  nextPulseDate,
  type PulseSchedule,
} from "./pulse-schedule";
const kind = "pulseSchedule";
const baselineHash = (s: PulseSeries) =>
  hash(
    canonical([s.baselineRevisionId, s.baseline, s.guidelines, s.recruitment]),
  );
function canSchedule(a: Actor) {
  canEdit(a);
  canLaunch(a);
}
export async function dispatchPulseSchedule(req: Request, p: string[]) {
  if (p[0] !== "pulse" || !p[1] || p[2] !== "schedule") return null;
  if (p.length !== 3) fail(404, "Schedule route unavailable.");
  const a = await actor();
  const series = await get<PulseSeries>("pulseSeries", p[1], a.workspaceId);
  if (!series) fail(404, "Tracker unavailable.");
  if (req.method === "GET") {
    const s = await get<PulseSchedule>(kind, series.id, a.workspaceId);
    return respond({
      schedule: s ? pulseScheduleView(s) : null,
      canSchedule: ["admin", "researcher"].includes(a.role),
    });
  }
  if (!["PUT", "PATCH"].includes(req.method))
    fail(405, "Use GET, PUT or PATCH for Pulse schedules.");
  canSchedule(a);
  const raw = await body(req);
  let result: PulseSchedule | undefined;
  await transaction(async () => {
    const current = await get<PulseSchedule>(kind, series.id, a.workspaceId),
      tracker = await get<PulseSeries>("pulseSeries", series.id, a.workspaceId);
    if (!tracker) fail(404, "Tracker unavailable.");
    const meta = z
        .object({
          requestId: z.uuid(),
          version: z.number().int().min(0),
          reviewed: z.literal(true),
        })
        .parse(raw),
      inputHash = hash(canonical(raw));
    if (current?.lastRequest.id === meta.requestId) {
      if (current.lastRequest.hash !== inputHash)
        fail(409, "This schedule request has different settings.");
      result = current;
      return;
    }
    if ((current?.version || 0) !== meta.version)
      fail(409, "Schedule changed. Refresh before saving.");
    if (req.method === "PUT") {
      const input = pulseScheduleSettings
        .extend({
          requestId: z.uuid(),
          version: z.number().int().min(0),
          reviewed: z.literal(true),
        })
        .strict()
        .parse(raw);
      if (input.nextDate <= tracker.waves.at(-1)!.date)
        fail(400, "The first scheduled date must follow the latest wave date.");
      if (tracker.waves.length + input.maxWaves > 100)
        fail(400, "This schedule would exceed the tracker’s 100-wave limit.");
      if (
        (await list<PulseSchedule>(kind, a.workspaceId)).filter(
          (s) => s.state === "scheduled" && s.id !== series.id,
        ).length >= 20
      )
        fail(409, "This workspace has 20 active Pulse schedules.");
      result = {
        id: series.id,
        workspaceId: a.workspaceId,
        studyId: tracker.baselineStudyId,
        creatorId: a.id,
        generation: uid(),
        version: meta.version + 1,
        state: "scheduled",
        nextDate: input.nextDate,
        intervalDays: input.intervalDays,
        maxWaves: input.maxWaves,
        labelPrefix: input.labelPrefix,
        timeZone: input.timeZone,
        createdCount: 0,
        createdAt: now(),
        updatedAt: now(),
        baselineFingerprint: baselineHash(tracker),
        lastRequest: { id: meta.requestId, hash: inputHash },
        runs: [],
      };
    } else if (req.method === "PATCH") {
      const input = z
        .object({
          requestId: z.uuid(),
          version: z.number().int().min(1),
          reviewed: z.literal(true),
          op: z.enum(["pause", "resume", "run"]),
        })
        .strict()
        .parse(raw);
      if (!current) fail(404, "Schedule unavailable.");
      if (input.op === "run") {
        if (current.state !== "scheduled")
          fail(409, "Resume the schedule before running due dates.");
        await runPulseSchedules(new Date(), {
          workspaceId: a.workspaceId,
          seriesId: series.id,
        });
        result = (await get<PulseSchedule>(kind, series.id, a.workspaceId))!;
        result.lastRequest = { id: meta.requestId, hash: inputHash };
        result.version++;
        result.updatedAt = now();
        await put(kind, result);
        return;
      }
      if (current.state === "complete")
        fail(
          409,
          "This schedule is complete. Save new dates to schedule another cycle.",
        );
      if (
        input.op === "resume" &&
        (current.nextDate <= tracker.waves.at(-1)!.date ||
          current.baselineFingerprint !== baselineHash(tracker))
      )
        fail(
          409,
          "Wave chronology or baseline changed. Save a reviewed new schedule.",
        );
      result = {
        ...current,
        state: input.op === "pause" ? "paused" : "scheduled",
        creatorId: a.id,
        error: undefined,
        version: current.version + 1,
        updatedAt: now(),
        lastRequest: { id: meta.requestId, hash: inputHash },
      };
    } else fail(405, "Use GET, PUT or PATCH.");
    await put(kind, result!);
  });
  return respond({ schedule: pulseScheduleView(result!) });
}
export async function runPulseSchedules(
  at = new Date(),
  scope?: { workspaceId: string; seriesId: string },
) {
  const rows = await db
    .prepare(
      "SELECT data FROM documents WHERE kind='pulseSchedule' AND json_extract(data,'$.state')='scheduled' AND (? IS NULL OR workspace_id=?) AND (? IS NULL OR id=?) ORDER BY json_extract(data,'$.nextDate') LIMIT 100",
    )
    .all(
      scope?.workspaceId || null,
      scope?.workspaceId || null,
      scope?.seriesId || null,
      scope?.seriesId || null,
    );
  let created = 0,
    blocked = 0;
  for (const row of rows) {
    const queued = JSON.parse(String(row.data)) as PulseSchedule;
    if (queued.nextDate > pulseToday(at, queued.timeZone)) continue;
    await transaction(async () => {
      const s = await get<PulseSchedule>(kind, queued.id, queued.workspaceId);
      if (
        !s ||
        s.state !== "scheduled" ||
        s.version !== queued.version ||
        s.nextDate > pulseToday(at, s.timeZone)
      )
        return;
      const series = await get<PulseSeries>("pulseSeries", s.id, s.workspaceId),
        baseline = series
          ? await get<Revision>(
              "revision",
              series.baselineRevisionId,
              s.workspaceId,
            )
          : undefined,
        study = series
          ? await get<Study>("study", series.baselineStudyId, s.workspaceId)
          : undefined;
      const user = await db
        .prepare(
          "SELECT id,name,email,role,workspace_id FROM users WHERE id=? AND workspace_id=?",
        )
        .get(s.creatorId, s.workspaceId);
      const reason =
        !user || !["admin", "researcher"].includes(String(user.role))
          ? "permission"
          : !series ||
              !baseline ||
              !study ||
              baselineHash(series) !== s.baselineFingerprint ||
              canonical(baseline.guide) !== canonical(series.baseline)
            ? "source"
            : series.waves.length >= 100
              ? "capacity"
              : s.nextDate <= series.waves.at(-1)!.date
                ? "chronology"
                : null;
      if (reason) {
        s.state = "blocked";
        s.error = reason;
        s.version++;
        s.updatedAt = now();
        await put(kind, s);
        blocked++;
        return;
      }
      const date = s.nextDate,
        requestId = hash(s.id + ":" + s.generation + ":" + date);
      // A single transaction owns the new study, history, tracker membership and occurrence receipt.
      if (await get("pulseScheduleRun", requestId, s.workspaceId)) return;
      const a: Actor = {
        id: String(user!.id),
        name: String(user!.name),
        email: String(user!.email),
        workspaceId: s.workspaceId,
        role: user!.role as Actor["role"],
      };
      const wave: Study = {
        id: uid(),
        workspaceId: s.workspaceId,
        title: s.labelPrefix + " " + date,
        draft: structuredClone(series!.baseline),
        researchGuidelines: series!.guidelines,
        revisionId: null,
        fielding: "draft",
        createdAt: now(),
        updatedAt: now(),
        version: 1,
        dataVersion: 0,
      };
      await put("study", wave);
      await saveHistory(wave, a, "created");
      series!.waves.push({
        studyId: wave.id,
        label: wave.title,
        date,
        recruitment: series!.recruitment,
      });
      series!.version++;
      await put("pulseSeries", series!);
      await put("pulseScheduleRun", {
        id: requestId,
        workspaceId: s.workspaceId,
        studyId: wave.id,
        seriesId: s.id,
        scheduleGeneration: s.generation,
        scheduledDate: date,
        createdAt: now(),
      });
      s.createdCount++;
      s.runs.push({ studyId: wave.id, date, at: now() });
      s.state = s.createdCount >= s.maxWaves ? "complete" : "scheduled";
      s.nextDate = nextPulseDate(date, s.intervalDays);
      s.version++;
      s.updatedAt = now();
      await put(kind, s);
      created++;
    });
  }
  return { created, blocked };
}
