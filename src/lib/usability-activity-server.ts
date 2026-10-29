import { z } from "zod";
import {
  db,
  get,
  put,
  transaction,
  hash,
  now,
  requireStudy,
  interviews,
} from "./db";
import { participant, actor, body, fail, respond, limit } from "./http";
import type { Interview } from "./domain";
import {
  taskTiming,
  taskAttemptView,
  taskOutcome,
  taskActivityVersion,
  type TaskAttempt,
} from "./usability-activity";
import { csv } from "./evidence";
export async function requireClosedTaskAttempts(i: Interview) {
  const row = await db
    .prepare(
      "SELECT id FROM documents WHERE kind='taskAttempt' AND workspace_id=? AND json_extract(data,'$.interviewId')=? AND json_extract(data,'$.turnVersion')=? AND json_extract(data,'$.state')!='ended'",
    )
    .get(i.workspaceId, i.id, i.version);
  if (row)
    fail(409, "End your task timer and report its outcome before continuing.");
}
async function ownAttempts(i: Interview) {
  return (
    await db
      .prepare(
        "SELECT data FROM documents WHERE kind='taskAttempt' AND workspace_id=? AND json_extract(data,'$.interviewId')=? ORDER BY rowid",
      )
      .all(i.workspaceId, i.id)
  ).map((r) => JSON.parse(String(r.data)) as TaskAttempt);
}
export async function dispatchTaskActivity(req: Request, p: string[]) {
  if (p[0] === "interviews" && p[1] && p[2] === "usability") {
    const i = await participant(req, p[1]);
    if (p.length !== 3) fail(404, "Task activity route unavailable.");
    if (req.method === "GET")
      return respond({
        attempts: (await ownAttempts(i))
          .filter((a) => a.turnVersion === i.version)
          .map(taskAttemptView),
      });
    if (req.method !== "POST") fail(405, "Use GET or POST for task controls.");
    const input = z
      .object({
        requestId: z.uuid(),
        version: z.number().int().min(0),
        op: z.enum(["start", "pause", "resume", "end"]),
        attemptId: z.uuid().optional(),
        attemptVersion: z.number().int().min(1).optional(),
        outcome: taskOutcome.optional(),
        reviewed: z.literal(true).optional(),
      })
      .strict()
      .parse(await body(req));
    limit("usability:" + i.id, 60);
    let result!: TaskAttempt;
    await transaction(async () => {
      const fresh = await get<Interview>("interview", i.id);
      if (
        !fresh ||
        fresh.status !== "active" ||
        fresh.pending ||
        fresh.version !== input.version ||
        !fresh.guide.questions[fresh.current]?.task
      )
        fail(409, "This task changed. Reload before using task controls.");
      const all = await ownAttempts(fresh),
        digest = hash(JSON.stringify(input)),
        duplicate = all.find((a) => Object.hasOwn(a.requests, input.requestId));
      if (duplicate) {
        if (duplicate.requests[input.requestId] !== digest)
          fail(409, "This request has different task settings.");
        result = duplicate;
        return;
      }
      if (input.op === "start") {
        if (
          input.attemptId ||
          input.attemptVersion ||
          input.outcome ||
          input.reviewed
        )
          fail(400, "Start a new task attempt without outcome fields.");
        if (
          all.filter((a) => a.turnVersion === fresh.version).length >= 3 ||
          all.some(
            (a) => a.state !== "ended" && a.turnVersion === fresh.version,
          )
        )
          fail(
            409,
            "End the current attempt first. At most three attempts are allowed per task turn.",
          );
        const at = now();
        result = {
          id: crypto.randomUUID(),
          workspaceId: i.workspaceId,
          studyId: i.studyId,
          interviewId: i.id,
          questionId: fresh.guide.questions[fresh.current].id,
          revisionId: fresh.revisionId,
          turnVersion: fresh.version,
          turnIndex: fresh.turns.length,
          version: 1,
          state: "running",
          startedAt: at,
          intervals: [{ start: at }],
          requests: {},
        };
      } else {
        const a = all.find(
          (a) => a.id === input.attemptId && a.turnVersion === fresh.version,
        );
        if (!a) fail(404, "Task attempt unavailable.");
        if (a.version !== input.attemptVersion || a.state === "ended")
          fail(409, "This task attempt changed. Refresh before continuing.");
        if (Object.keys(a.requests).length >= 60 && input.op !== "end")
          fail(
            400,
            "This attempt has reached its control-event limit. Contact the researcher.",
          );
        result = a;
        const at = new Date(
          Math.max(
            Date.now(),
            Date.parse(a.intervals.at(-1)!.end || a.intervals.at(-1)!.start),
          ),
        ).toISOString();
        if (input.op === "pause") {
          if (a.state !== "running" || input.outcome || input.reviewed)
            fail(400, "Only a running timer can pause.");
          a.intervals.at(-1)!.end = at;
          a.state = "paused";
        }
        if (input.op === "resume") {
          if (a.state !== "paused" || input.outcome || input.reviewed)
            fail(400, "Only a paused timer can resume.");
          a.intervals.push({ start: at });
          a.state = "running";
        }
        if (input.op === "end") {
          if (!input.reviewed || !input.outcome)
            fail(400, "Review and report your task outcome before ending.");
          if (a.state === "running") a.intervals.at(-1)!.end = at;
          a.state = "ended";
          a.endedAt = at;
          a.outcome = input.outcome;
        }
        a.version++;
      }
      result.requests[input.requestId] = digest;
      await put("taskAttempt", result);
    });
    return respond({ attempt: taskAttemptView(result) });
  }
  if (p[0] !== "studies" || !p[1] || p[2] !== "usability") return null;
  const a = await actor(),
    s = await requireStudy(p[1], a),
    params = new URL(req.url).searchParams;
  const key = params.get("attribute"),
    value = params.get("value");
  if ((key === null) !== (value === null))
    fail(400, "Provide attribute and exact value together.");
  if (
    [...params.keys()].some((k) => !["attribute", "value"].includes(k)) ||
    (key !== null && (!key || key.length > 100 || value!.length > 500))
  )
    fail(400, "Invalid task-results filter.");
  const sources = (await interviews(s)).filter(
      (i) =>
        !i.preview &&
        !i.excluded &&
        !i.origin &&
        (key === null || i.attributes[key] === value),
    ),
    records = (
      await db
        .prepare(
          "SELECT data FROM documents WHERE kind='taskAttempt' AND workspace_id=? AND study_id=? ORDER BY rowid",
        )
        .all(a.workspaceId, s.id)
    ).map((r) => JSON.parse(String(r.data)) as TaskAttempt),
    rows = records.flatMap((t) => {
      const i = sources.find((i) => i.id === t.interviewId),
        turn = i?.turns[t.turnIndex];
      if (!i || !i.guide.questions.some((q) => q.id === t.questionId && q.task))
        return [];
      return [
        {
          ...taskAttemptView(t),
          included:
            i.status === "complete" &&
            t.state === "ended" &&
            turn?.questionId === t.questionId,
          turnId: turn?.id || null,
          prompt: i.guide.questions.find((q) => q.id === t.questionId)!.text,
        },
      ];
    }),
    guidance = (
      await db
        .prepare(
          "SELECT data FROM documents WHERE kind='taskProbe' AND workspace_id=? AND study_id=? AND json_extract(data,'$.state')='complete' ORDER BY rowid",
        )
        .all(a.workspaceId, s.id)
    ).flatMap((row) => {
      const t = JSON.parse(String(row.data)),
        i = sources.find((i) => i.id === t.interviewId);
      if (!i) return [];
      return [
        {
          id: t.id,
          interviewId: t.interviewId,
          captureId: t.captureId,
          questionId: t.questionId,
          revisionId: t.revisionId,
          createdAt: t.createdAt,
          model: t.model,
          promptVersion: t.promptVersion,
          imageDigest: t.imageDigest,
          guidance: t.guidance,
        },
      ];
    }),
    signature = hash(
      JSON.stringify([
        a.id,
        a.workspaceId,
        a.role,
        key,
        value,
        taskActivityVersion,
        sources.map((i) => [i.id, i.status, i.version]),
        rows,
        guidance,
      ]),
    );
  if (p.length === 3 && req.method === "GET")
    return respond({
      method: taskActivityVersion,
      rows,
      guidance,
      eligibleResponses: sources.filter(
        (i) =>
          i.status === "complete" &&
          i.turns.some((t) =>
            i.guide.questions.some((q) => q.task && q.id === t.questionId),
          ),
      ).length,
      signature,
    });
  if (p.length !== 4 || p[3] !== "export" || req.method !== "POST")
    fail(405, "Use GET for task results or POST for reviewed CSV export.");
  const input = z
    .object({
      signature: z.string().length(64),
      reviewed: z.literal(true),
      format: z.enum(["attempts", "guidance"]).default("attempts"),
    })
    .strict()
    .parse(await body(req));
  if (input.signature !== signature)
    fail(
      409,
      "Task sources or access changed. Refresh and review the current results.",
    );
  if (input.format === "guidance") {
    const data = [
      [
        "study_id",
        "revision_id",
        "question_id",
        "interview_id",
        "capture_id",
        "guidance_id",
        "kind",
        "question",
        "visible_context",
        "uncertainty",
        "model",
        "prompt_version",
        "image_digest",
        "created_at",
        "source_fingerprint",
      ],
    ];
    for (const g of guidance)
      data.push([
        s.id,
        g.revisionId || "",
        g.questionId || "",
        g.interviewId,
        g.captureId,
        g.id,
        "optional_AI_guidance_not_participant_evidence",
        g.guidance.question,
        g.guidance.visibleContext,
        g.guidance.uncertainty,
        g.model,
        g.promptVersion,
        g.imageDigest,
        g.createdAt,
        signature,
      ]);
    return new Response(csv(data), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="usability-guidance.csv"',
        "Cache-Control": "no-store",
      },
    });
  }
  const data = [
    [
      "study_id",
      "revision_id",
      "question_id",
      "interview_id",
      "turn_id",
      "attempt_id",
      "included",
      "state",
      "participant_reported_outcome",
      "active_control_ms",
      "wall_control_ms",
      "paused_control_ms",
      "started_at",
      "ended_at",
      "method",
      "source_fingerprint",
    ],
  ];
  for (const r of rows)
    data.push([
      s.id,
      r.revisionId,
      r.questionId,
      r.interviewId,
      r.turnId || "",
      r.id,
      String(r.included),
      r.state,
      r.outcome || "",
      r.timing.activeMs === null ? "" : String(r.timing.activeMs),
      r.timing.wallMs === null ? "" : String(r.timing.wallMs),
      r.timing.pausedMs === null ? "" : String(r.timing.pausedMs),
      r.startedAt,
      r.endedAt || "",
      taskActivityVersion,
      signature,
    ]);
  return new Response(csv(data), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="usability.csv"',
      "Cache-Control": "no-store",
    },
  });
}
