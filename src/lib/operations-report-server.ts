import { z } from "zod";
import { dispatchUnifiedPlanning } from "./unified-planning-server";
import { unifiedReportContent } from "./unified-report";
import { unifiedLabels, type UnifiedPlanning } from "./unified-planning";
import { calendarProjection, calendarLabels } from "./follow-up-calendar";
import { db, hash, transaction, list } from "./db";
import { body, fail, respond } from "./http";
import type { Actor } from "./domain";
import { dispatchActionCenter } from "./research-action-center-server";
import { dispatchTaskActivity } from "./task-activity-server";
import {
  followUpWorkload,
  workloadMetrics,
  followUpWorkloadLabels,
} from "./follow-up-workload";
import { actionLabels, type ActionCenter } from "./research-action-center";
import { taskActivityLabels, type TaskActivityView } from "./task-activity";
import {
  operationsReportConfig,
  operationsReportLabels,
  operationsReportFile,
  type OperationsReportPreview,
} from "./operations-report";
export async function dispatchOperationsReport(
  req: Request,
  p: string[],
  a: Actor,
) {
  if (p[1] !== "operations-report") return null;
  if (p.length !== 3 || !["preview", "export"].includes(p[2]))
    fail(404, "Report route unavailable.");
  if (req.method !== "POST")
    fail(405, "Generate reports with an explicit request.");
  if (new URL(req.url).search)
    fail(400, "Report query parameters are unavailable.");
  const base = z.object({ config: operationsReportConfig }).strict();
  const raw = await body(req);
  const download =
    p[2] === "export"
      ? base
          .extend({
            signature: z.string().regex(/^[a-f0-9]{64}$/),
            reviewed: z.literal(true),
            format: z.enum(["csv", "txt"]),
          })
          .parse(raw)
      : null;
  const input = download || base.parse(raw);
  return transaction(async () => {
    const member = await db
      .prepare("SELECT workspace_id,role FROM users WHERE id=?")
      .get(a.id);
    if (!member || member.workspace_id !== a.workspaceId)
      fail(403, "Workspace access unavailable.");
    const config = input.config,
      l = operationsReportLabels[config.language],
      al = actionLabels[config.language],
      hl = taskActivityLabels[config.language],
      wl = followUpWorkloadLabels[config.language];
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: config.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const today = ["year", "month", "day"]
      .map((t) => parts.find((p) => p.type === t)!.value)
      .join("-");
    const report: OperationsReportPreview = {
      signature: "",
      generatedAt: new Date().toISOString(),
      metadata: [
        [
          l.kind,
          config.kind === "workload"
            ? wl.title
            : config.kind === "calendar"
              ? calendarLabels[config.language].title
              : config.kind === "unified"
                ? unifiedLabels[config.language].title
                : hl.title,
        ],
        [l.asOf, today],
        [l.zone, config.timeZone],
      ],
      headers: [],
      rows: [],
    };
    if (config.kind === "workload") {
      const data: ActionCenter = await (await dispatchActionCenter(
        new Request("http://localhost/api/library/action-center"),
        ["library", "action-center"],
        a,
      ))!.json();
      const f = config.filters,
        view = followUpWorkload(
          data,
          { collectionId: f.collectionId, query: f.query },
          today,
        );
      report.metadata.push(
        [
          al.collection,
          f.collectionId
            ? (data.collections.find((c) => c.id === f.collectionId)?.title ||
                al.unavailableCollection) +
              " (" +
              f.collectionId +
              ")"
            : al.allCollections,
        ],
        [wl.query, f.query || l.all],
        [wl.rows, wl[f.show]],
      );
      report.headers = [l.member, ...workloadMetrics.map((m) => al[m])];
      report.rows = [
        [wl.totals, ...workloadMetrics.map((m) => view.totals[m])],
        ...view.rows
          .filter((r) => f.show === "all" || r.counts[f.show] > 0)
          .map((r) => [
            r.id === "unassigned" ? al.unassigned : r.name || wl.unavailable,
            ...workloadMetrics.map((m) => r.counts[m]),
          ]),
      ];
    } else if (config.kind === "calendar") {
      const data: ActionCenter = await (await dispatchActionCenter(
        new Request("http://localhost/api/library/action-center"),
        ["library", "action-center"],
        a,
      ))!.json();
      const f = config.filters,
        cl = calendarLabels[config.language];
      report.metadata.push(
        [
          al.collection,
          f.collectionId
            ? (data.collections.find((c) => c.id === f.collectionId)?.title ||
                al.unavailableCollection) +
              " (" +
              f.collectionId +
              ")"
            : al.allCollections,
        ],
        [
          al.assignee,
          f.assignee === "mine"
            ? al.mine
            : f.assignee === "unassigned"
              ? al.unassigned
              : f.assignee
                ? (data.members.find((m) => m.id === f.assignee)?.name ||
                    al.unavailableAssignee) +
                  " (" +
                  f.assignee +
                  ")"
                : al.allAssignees,
        ],
        [al.status, al[f.status]],
        [al.query, f.query || l.all],
        [al.due, f.window === "month" ? cl.monthView : al[f.window]],
        [cl.month, f.month],
        [al.dueDate, f.day || l.all],
      );
      report.headers = [
        al.dueDate,
        al.collection,
        al.titleField,
        al.assignee,
        al.status,
        al.overdue,
        l.version,
        l.collectionId,
        l.taskId,
      ];
      report.rows = calendarProjection(data, f, today).rows.map((t) => [
        t.dueDate || al.undated,
        data.collections.find((c) => c.id === t.collectionId)?.title ||
          al.unavailableCollection,
        t.title,
        t.assigneeId
          ? data.members.find((m) => m.id === t.assigneeId)?.name ||
            al.unavailableAssignee
          : al.unassigned,
        al[t.status],
        t.status !== "completed" && t.dueDate && t.dueDate < today
          ? l.yes
          : l.no,
        t.version,
        t.collectionId,
        t.id,
      ]);
    } else if (config.kind === "unified") {
      const data: UnifiedPlanning = await (await dispatchUnifiedPlanning(
        new Request("http://localhost/api/library/unified-planning"),
        ["library", "unified-planning"],
        a,
      ))!.json();
      const versions = new Map(
        (
          await list<{ id: string; version: number }>(
            "libraryHandoffFeedback",
            a.workspaceId,
          )
        ).map((v) => [v.id, v.version]),
      );
      const projection = unifiedReportContent(data, config, today, versions);
      report.metadata.push(...projection.metadata);
      report.headers = projection.headers;
      report.rows = projection.rows;
    } else {
      const params = new URLSearchParams({
        ...config.filters,
        timeZone: config.timeZone,
      });
      const data: TaskActivityView = await (await dispatchTaskActivity(
        new Request("http://localhost/api/library/task-activity?" + params),
        ["library", "task-activity"],
        a,
        true,
      ))!.json();
      const f = config.filters,
        coordinate = (id: string, name: string | undefined, missing: string) =>
          id ? (name || missing) + " (" + id + ")" : l.all;
      report.metadata.push(
        [
          hl.collection,
          coordinate(
            f.collectionId,
            data.collections.find((c) => c.id === f.collectionId)?.title,
            hl.unavailableCollection,
          ),
        ],
        [
          hl.task,
          coordinate(
            f.taskId,
            data.tasks.find((t) => t.id === f.taskId)?.title,
            hl.unavailableTask,
          ),
        ],
        [
          hl.person,
          f.personId === "system"
            ? hl.system
            : coordinate(
                f.personId,
                data.people.find((p) => p.id === f.personId)?.name || undefined,
                hl.former,
              ),
        ],
        [hl.action, f.action ? hl[f.action] : l.all],
        [
          hl.field,
          f.field
            ? {
                assignee: hl.assignee,
                dueDate: hl.dueDate,
                status: hl.status,
                title: hl.titleField,
              }[f.field]
            : l.all,
        ],
        [hl.from, f.from || l.all],
        [hl.to, f.to || l.all],
        [l.retention, String(data.omitted)],
      );
      report.headers = [
        "UTC",
        hl.collection,
        hl.task,
        l.actor,
        hl.action,
        l.version,
        hl.before + " · " + hl.assignee,
        hl.before + " · " + hl.dueDate,
        hl.before + " · " + hl.status,
        hl.after + " · " + hl.assignee,
        hl.after + " · " + hl.dueDate,
        hl.after + " · " + hl.status,
        l.changed,
        l.collectionId,
        l.taskId,
      ];
      const person = (p: { name: string | null } | null | undefined) =>
        p ? p.name || hl.former : hl.unassigned;
      const status = (s: "open" | "in_progress" | "completed" | undefined) =>
        s ? (s === "open" ? hl.openStatus : hl[s]) : hl.none;
      report.rows = data.events.map((e) => [
        e.at,
        e.task.collectionTitle,
        e.task.title,
        e.actor ? e.actor.name || hl.former : hl.system,
        hl[e.action],
        e.taskVersion,
        e.before ? person(e.before.assignee) : hl.none,
        e.before?.dueDate || hl.none,
        status(e.before?.status),
        person(e.after.assignee),
        e.after.dueDate || hl.none,
        status(e.after.status),
        e.titleChanged ? l.yes : l.no,
        e.task.collectionId,
        e.task.id,
      ]);
    }
    if (
      report.rows.length > 1000 ||
      Buffer.byteLength(JSON.stringify(report)) > 2_000_000
    )
      fail(
        413,
        "Narrow the report filters; reports support up to 1,000 rows and 2 MB.",
      );
    report.signature = hash(
      JSON.stringify({
        v: 1,
        workspace: a.workspaceId,
        actor: a.id,
        role: member.role,
        config,
        metadata: report.metadata,
        headers: report.headers,
        rows: report.rows,
      }),
    );
    if (p[2] === "preview") return respond(report);
    if (!download || download.signature !== report.signature)
      fail(
        409,
        "Report changed or its sources are unavailable. Generate a new preview.",
      );
    const format = download.format;
    return new Response(operationsReportFile(report, format), {
      headers: {
        "Content-Type":
          format === "csv"
            ? "text/csv; charset=utf-8"
            : "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="echo-lab-operations-${config.kind}.${format}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
