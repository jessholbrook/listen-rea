import { recordReviewEvent } from "./review-activity-records";
import { z } from "zod";
import { feedbackInput, type FeedbackInput } from "./handoff-feedback";
import {
  currentHandoffFeedback,
  mutateHandoffFeedback,
} from "./handoff-feedback-server";
import {
  db,
  get,
  list,
  put,
  uid,
  now,
  hash,
  transaction,
  pruneLibraryCollections,
  removeCollectionHandoff,
} from "./db";
import { body, canEdit, respond, fail } from "./http";
import type { Actor } from "./domain";
import type { LibraryCollection } from "./library-collections";
import type { SavedLibraryAnswer } from "./library-answers";
import { libraryAnswerExport } from "./library-answers";
import { csv } from "./evidence";
import { currentCollectionTasks } from "./collection-tasks-server";
import { collectionDashboardSnapshot } from "./collection-review-server";
import {
  handoffContent,
  handoffCreate,
  handoffEdit,
  handoffReview,
  handoffLabels,
  type CollectionHandoff,
  type HandoffContent,
  type HandoffDetails,
} from "./collection-handoff";
const kind = "libraryCollectionHandoff";
const content = (p: HandoffContent): HandoffContent => ({
  title: p.title,
  summary: p.summary,
  language: p.language,
  answerIds: p.answerIds,
  taskIds: p.taskIds,
});
async function context(a: Actor, collectionId: string) {
  await currentCollectionTasks(a, collectionId);
  const { dashboard } = await collectionDashboardSnapshot(a, collectionId);
  await pruneLibraryCollections(a.workspaceId);
  const collection = (await get<LibraryCollection>(
    "libraryCollection",
    collectionId,
    a.workspaceId,
  ))!;
  const answers = (
    await list<SavedLibraryAnswer>("libraryAnswer", a.workspaceId)
  ).filter(
    (s) =>
      s.filter.collectionId === collectionId &&
      dashboard.answers.some((row) => row.id === s.id),
  );
  const tasks = (
    await list<import("./collection-tasks").CollectionTask>(
      "libraryCollectionTask",
      a.workspaceId,
    )
  ).filter((t) => t.collectionId === collectionId);
  const members = (
    await db
      .prepare("SELECT id,name,role FROM users WHERE workspace_id=?")
      .all(a.workspaceId)
  ).map((m) => ({
    id: String(m.id),
    name: String(m.name),
    role: String(m.role),
  }));
  const packet = (await list<CollectionHandoff>(kind, a.workspaceId)).find(
    (p) => p.collectionId === collectionId,
  );
  const x = { collection, dashboard, answers, tasks, members, packet };
  const current = packet
    ? await currentHandoffFeedback(packet, a, signature(x, packet), members)
    : null;
  return {
    ...x,
    packet: current?.packet || packet,
    feedback: current?.review || null,
  };
}
type Context = Awaited<ReturnType<typeof context>>;
function approved(a: SavedLibraryAnswer) {
  const r = a.history.at(-1)!;
  return r.reviewed && r.includeInExports;
}
function eligible(x: Context, p: HandoffContent) {
  return (
    p.answerIds.every((id) =>
      x.answers.some((a) => a.id === id && approved(a)),
    ) &&
    p.taskIds.every((id) =>
      x.tasks.some((t) => t.id === id && t.status !== "completed"),
    )
  );
}
function signature(
  x: {
    dashboard: { signature: string };
    answers: SavedLibraryAnswer[];
    tasks: import("./collection-tasks").CollectionTask[];
    members: { id: string; name: string }[];
  },
  p: CollectionHandoff,
) {
  return hash(
    JSON.stringify({
      id: p.id,
      content: content(p),
      dashboard: x.dashboard.signature,
      answers: p.answerIds.map(
        (id) => x.answers.find((a) => a.id === id) || null,
      ),
      tasks: [...x.tasks]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((t) => ({
          ...t,
          assignee: x.members.find((m) => m.id === t.assigneeId)?.name || null,
        })),
    }),
  );
}
function dependencies(x: Context, p: CollectionHandoff) {
  return {
    memberInterviewIds: [
      ...new Set([...p.memberInterviewIds, ...x.collection.interviewIds]),
    ],
    briefDependencies: [
      ...new Set([...p.briefDependencies, ...x.collection.briefIds]),
    ],
    answerDependencies: [
      ...new Set([...p.answerDependencies, ...x.answers.map((a) => a.id)]),
    ],
    taskDependencies: [
      ...new Set([...p.taskDependencies, ...x.tasks.map((t) => t.id)]),
    ],
  };
}
function exportText(
  x: Context,
  p: CollectionHandoff,
  format: "md" | "csv",
  origin: string,
) {
  const l = handoffLabels[p.language],
    rows: string[][] = [
      [
        "section",
        "item_id",
        "version",
        "title",
        "body",
        "source_url",
        "assignee",
        "due_date",
        "status",
      ],
    ];
  const collectionURL = origin + `/api/library/collections/${p.collectionId}`;
  rows.push([
    "notice",
    p.id,
    String(p.version),
    p.title,
    l.warning,
    collectionURL,
    "",
    "",
    "",
  ]);
  rows.push([
    "summary",
    p.id,
    String(p.version),
    l.summary,
    p.summary,
    collectionURL,
    "",
    "",
    "",
  ]);
  const parts = [
    p.title,
    `${l.collection}: ${x.collection.title} [${x.collection.id}]`,
    `${l.version}: ${p.version} · ${p.id}`,
    l.warning,
    `${l.summary}\n${p.summary}`,
  ];
  for (const id of p.answerIds) {
    const a = x.answers.find((a) => a.id === id);
    if (!a || !approved(a)) {
      parts.push(l.changed);
      continue;
    }
    const text = libraryAnswerExport(a, "md", origin),
      url =
        origin +
        "/api/library/" +
        (a.scope === "transcripts" ? "answers/" : "attachments/answers/") +
        a.id;
    parts.push(
      `${l.finding}: ${a.id} · v${a.history.at(-1)!.version}\n${url}\n${text}`,
    );
    rows.push([
      "finding",
      a.id,
      String(a.history.at(-1)!.version),
      a.original.question,
      text,
      url,
      "",
      "",
      "",
    ]);
  }
  for (const id of p.taskIds) {
    const t = x.tasks.find((t) => t.id === id);
    if (!t || t.status === "completed") {
      parts.push(l.changed);
      continue;
    }
    const assignee =
        x.members.find((m) => m.id === t.assigneeId)?.name || l.unassigned,
      url = t.target
        ? origin +
          (t.target.kind === "interview"
            ? `/api/library/sources/${t.target.id}`
            : t.target.kind === "brief"
              ? `/api/library/briefs/${t.target.id}`
              : `/api/library/${x.answers.find((a) => a.id === t.target!.id)?.scope === "transcripts" ? "answers" : "attachments/answers"}/${t.target.id}`)
        : origin + `/api/library/collections/${p.collectionId}/tasks`;
    parts.push(
      `${l.task}: ${t.title}\n${l.version}: ${t.version} · ${t.id}\n${l.status}: ${l[t.status]} · ${assignee}\n${l.due}: ${t.dueDate || "—"}\n${url}`,
    );
    rows.push([
      "follow_up",
      t.id,
      String(t.version),
      t.title,
      l[t.status],
      url,
      assignee,
      t.dueDate || "",
      t.status,
    ]);
  }
  const text = format === "csv" ? csv(rows) : parts.join("\n\n");
  if (text.length > 1000000)
    fail(413, "This packet is too large. Choose fewer findings or follow-ups.");
  return text;
}
function details(x: Context, a: Actor, origin: string): HandoffDetails {
  const p = x.packet,
    sig = p ? signature(x, p) : "";
  return {
    collection: { id: x.collection.id, title: x.collection.title },
    feedback: x.feedback,
    canEdit: ["admin", "researcher", "collaborator"].includes(a.role),
    signature: sig,
    packet: p
      ? {
          ...content(p),
          id: p.id,
          version: p.version,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          reviewedAt:
            p.approvedSignature === sig && eligible(x, p) ? p.reviewedAt : null,
          canExport:
            p.approvedSignature === sig &&
            !!p.reviewedAt &&
            eligible(x, p) &&
            (x.feedback?.ready ?? true),
        }
      : null,
    preview: p ? exportText(x, p, "md", origin) : "",
    answers: x.answers.map((s) => ({
      id: s.id,
      question: s.original.question,
      version: s.history.at(-1)!.version,
      approved: approved(s),
    })),
    tasks: x.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      version: t.version,
      status: t.status,
      assignee: x.members.find((m) => m.id === t.assigneeId)?.name || null,
      dueDate: t.dueDate,
    })),
  };
}
export async function currentHandoffInboxPacket(
  a: Actor,
  collectionId: string,
): Promise<import("./team-review-inbox").InboxPacket | null> {
  const x = await context(a, collectionId),
    p = x.packet;
  if (!p || !x.feedback) return null;
  const canExport =
    p.approvedSignature === signature(x, p) &&
    !!p.reviewedAt &&
    eligible(x, p) &&
    x.feedback.ready;
  return {
    id: p.id,
    collectionId,
    title: p.title,
    collectionTitle: x.collection.title,
    version: p.version,
    updatedAt: p.updatedAt,
    reviewers: x.feedback.reviewers,
    openComments: x.feedback.comments.filter((c) => !c.resolvedAt).length,
    state: canExport
      ? "exported"
      : !eligible(x, p) ||
          x.feedback.comments.some((c) => !c.resolvedAt) ||
          x.feedback.reviewers.some((r) => !r.available)
        ? "blocked"
        : x.feedback.ready
          ? "ready"
          : "awaiting",
  };
}
async function requireBatchActor(a: Actor) {
  const current = await db
    .prepare("SELECT workspace_id,role FROM users WHERE id=?")
    .get(a.id);
  if (
    !current ||
    current.workspace_id !== a.workspaceId ||
    !["admin", "researcher", "collaborator"].includes(String(current.role))
  )
    fail(403, "Edit access unavailable.");
}
// Batch coordination uses the same current context, dependency capture and review mutation.
export async function prepareBatchReview(
  a: Actor,
  collectionId: string,
  id: string,
) {
  canEdit(a);
  const x = await transaction(async () => {
      await requireBatchActor(a);
      return context(a, collectionId);
    }),
    p = x.packet;
  if (!p || p.id !== id) fail(404, "Packet unavailable.");
  return {
    collectionId,
    id: p.id,
    status: "ready" as const,
    title: p.title,
    packetVersion: p.version,
    version: x.feedback!.version,
    signature: signature(x, p),
    reviewers: x.feedback!.reviewers.map(
      ({ id, name, dueDate, approvedAt }) => ({
        id,
        name,
        dueDate,
        approvedAt,
      }),
    ),
    openComments: x.feedback!.comments.filter((c) => !c.resolvedAt).length,
    finalApproved: !!p.reviewedAt,
  };
}
async function writeFeedback(x: Context, a: Actor, input: FeedbackInput) {
  if (!x.packet) fail(404, "Packet unavailable.");
  const packet = { ...x.packet, ...dependencies(x, x.packet) };
  await put(kind, packet);
  return mutateHandoffFeedback(
    packet,
    a,
    signature(x, packet),
    x.members,
    input,
    eligible(x, packet),
  );
}
export async function applyBatchReview(
  a: Actor,
  collectionId: string,
  input: Extract<FeedbackInput, { op: "plan" }>,
) {
  canEdit(a);
  // Cleanup must commit even if the optimistic mutation rejects afterwards.
  await transaction(async () => {
    await requireBatchActor(a);
    return context(a, collectionId);
  });
  return transaction(async () => {
    await requireBatchActor(a);
    const x = await context(a, collectionId);
    await writeFeedback(x, a, input);
    return { title: x.packet!.title };
  });
}
export async function dispatchCollectionHandoff(
  req: Request,
  p: string[],
  a: Actor,
) {
  if (p[1] !== "collections" || p[3] !== "handoff") return null;
  if (
    p.length !== 4 &&
    !(
      p.length === 5 &&
      ["review", "export", "feedback", "planning"].includes(p[4])
    )
  )
    fail(404, "Packet route unavailable.");
  const collectionId = z.uuid().parse(p[2]),
    url = new URL(req.url),
    origin = url.origin;
  if (
    (p.length === 4 &&
      !["GET", "POST", "PUT", "DELETE"].includes(req.method)) ||
    (["review", "feedback"].includes(p[4]) && req.method !== "POST") ||
    (["export", "planning"].includes(p[4]) && req.method !== "GET")
  )
    fail(405, "Packet method unavailable.");
  const payload =
    req.method === "GET" ? undefined : (canEdit(a), await body(req));
  if (p[4] === "planning") canEdit(a);
  // Commit stale-source cleanup even when a subsequent write/export must reject.
  const initial = await transaction(() => context(a, collectionId));
  if (p.length === 4 && req.method === "GET")
    return respond(details(initial, a, origin));
  return transaction(async () => {
    let x = await context(a, collectionId),
      packet = x.packet;
    if (p[4] === "planning") {
      const q = z
        .object({ id: z.uuid() })
        .strict()
        .parse(Object.fromEntries(url.searchParams));
      if (!packet || packet.id !== q.id) fail(404, "Packet unavailable.");
      return respond({
        planning: {
          id: packet.id,
          packetVersion: packet.version,
          version: x.feedback!.version,
          signature: signature(x, packet),
          title: packet.title,
          members: x.feedback!.members,
          reviewers: x.feedback!.reviewers,
        },
      });
    }
    if (p[4] === "export") {
      const q = z
        .object({
          id: z.uuid(),
          version: z.coerce.number().int().positive(),
          signature: z.string().regex(/^[a-f0-9]{64}$/),
          format: z.enum(["md", "csv"]),
        })
        .strict()
        .parse(Object.fromEntries(url.searchParams));
      if (!packet || packet.id !== q.id) fail(404, "Packet unavailable.");
      const d = details(x, a, origin);
      if (
        packet.version !== q.version ||
        d.signature !== q.signature ||
        !d.packet!.canExport
      )
        fail(
          409,
          "Refresh, save and review the current packet before exporting.",
        );
      return new Response(exportText(x, packet, q.format, origin), {
        headers: {
          "Content-Type":
            q.format === "csv"
              ? "text/csv; charset=utf-8"
              : "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="echo-lab-handoff-${packet.id}.${q.format}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (req.method === "POST" && p.length === 4) {
      const input = handoffCreate.parse(payload),
        { requestId, ...c } = input,
        inputHash = hash(JSON.stringify({ collectionId, ...c }));
      if (
        await get(
          "libraryCollectionHandoffTombstone",
          hash(a.workspaceId + ":" + requestId),
          a.workspaceId,
        )
      )
        fail(409, "This packet request was deleted. Start a new draft.");
      const existing = (
        await list<CollectionHandoff>(kind, a.workspaceId)
      ).find((p) => p.requestId === requestId);
      if (existing) {
        if (existing.inputHash !== inputHash)
          fail(409, "This request has different packet contents.");
        return respond({
          ...details({ ...x, packet: existing }, a, origin),
          reused: true,
        });
      }
      if (packet)
        fail(409, "This collection already has a packet. Refresh it first.");
      if (!eligible(x, c))
        fail(
          409,
          "Choose current approved collection findings and unfinished tasks.",
        );
      packet = {
        ...c,
        id: uid(),
        workspaceId: a.workspaceId,
        collectionId,
        requestId,
        inputHash,
        version: 1,
        createdAt: now(),
        updatedAt: now(),
        reviewedAt: null,
        approvedSignature: null,
        memberInterviewIds: [],
        briefDependencies: [],
        answerDependencies: [],
        taskDependencies: [],
      };
      packet = { ...packet, ...dependencies(x, packet) };
      await put(kind, packet);
      await recordReviewEvent(packet, {
        actorId: a.id,
        action: "packet_created",
        reviewVersion: null,
        clearedReviewerIds: [],
        finalApprovalReset: false,
      });
      return respond(details(await context(a, collectionId), a, origin), 201);
    }
    if (!packet) fail(404, "Packet unavailable.");
    if (p[4] === "feedback") {
      const input = feedbackInput.parse(payload);
      const result = await writeFeedback(x, a, input);
      x = await context(a, collectionId);
      return respond({ ...details(x, a, origin), reused: result.reused });
    }
    if (p[4] === "review") {
      const input = handoffReview.parse(payload),
        sig = signature(x, packet);
      if (input.id !== packet.id) fail(404, "Packet unavailable.");
      if (input.signature !== sig || input.version > packet.version)
        fail(409, "Packet changed. Refresh and review current contents.");
      if (
        input.reviewed &&
        (!eligible(x, packet) || x.feedback?.ready === false)
      )
        fail(
          409,
          "Complete requested reviews, resolve feedback and choose eligible contents before final approval.",
        );
      if (
        (input.reviewed && packet.approvedSignature === sig) ||
        (!input.reviewed && !packet.approvedSignature)
      )
        return respond({ ...details(x, a, origin), reused: true });
      if (input.version !== packet.version)
        fail(409, "Packet changed. Refresh before reviewing.");
      packet = {
        ...packet,
        ...dependencies(x, packet),
        version: packet.version + 1,
        updatedAt: now(),
        reviewedAt: input.reviewed ? now() : null,
        approvedSignature: input.reviewed ? sig : null,
      };
      await put(kind, packet);
      await recordReviewEvent(packet, {
        actorId: a.id,
        action: input.reviewed ? "final_approved" : "final_withdrawn",
        reviewVersion: x.feedback?.version || 0,
        clearedReviewerIds: [],
        finalApprovalReset: false,
      });
      return respond(details({ ...x, packet }, a, origin));
    }
    if (req.method === "DELETE") {
      const input = z
        .object({ id: z.uuid(), version: z.number().int().positive() })
        .strict()
        .parse(payload);
      if (input.id !== packet.id) fail(404, "Packet unavailable.");
      if (input.version !== packet.version)
        fail(409, "Packet changed. Refresh before deleting.");
      await removeCollectionHandoff(packet);
      return respond({ deleted: true });
    }
    const input = handoffEdit.parse(payload),
      { id, version, ...c } = input;
    if (id !== packet.id) fail(404, "Packet unavailable.");
    if (version > packet.version)
      fail(409, "Packet changed. Refresh before saving.");
    if (JSON.stringify(content(packet)) === JSON.stringify(c))
      return respond({ ...details(x, a, origin), reused: true });
    if (version !== packet.version)
      fail(409, "Packet changed. Refresh before saving.");
    if (!eligible(x, c))
      fail(
        409,
        "Choose current approved collection findings and unfinished tasks.",
      );
    const wasFinal = !!packet.reviewedAt;
    packet = {
      ...packet,
      ...c,
      version: packet.version + 1,
      updatedAt: now(),
      reviewedAt: null,
      approvedSignature: null,
    };
    packet = { ...packet, ...dependencies(x, packet) };
    await put(kind, packet);
    await recordReviewEvent(packet, {
      actorId: a.id,
      action: "packet_edited",
      reviewVersion: x.feedback?.version || 0,
      clearedReviewerIds: [],
      finalApprovalReset: wasFinal,
    });
    return respond(details(await context(a, collectionId), a, origin));
  });
}
