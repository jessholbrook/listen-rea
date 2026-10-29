import { z } from "zod";
import {
  actor,
  participant,
  publicInterview,
  body,
  fail,
  respond,
  limit,
} from "./http";
import {
  get,
  put,
  dirty,
  transaction,
  requireStudy,
  interviews,
  uid,
} from "./db";
import { retention } from "./features";
import type { Interview, Study } from "./domain";
import {
  assignmentSchema,
  cardsortState,
  validateAssignments,
  validateCustomGroups,
} from "./cardsort";
import { cardsortResults } from "./cardsort-results";
import { csv } from "./evidence";
export async function dispatchCardsort(req: Request, p: string[]) {
  if (
    p[0] === "interviews" &&
    p[1] &&
    p[2] === "cardsort-groups" &&
    p.length === 3 &&
    req.method === "POST"
  ) {
    const initial = await participant(req, p[1]);
    const input = z
      .object({
        requestId: z.uuid(),
        version: z.number().int().min(0),
        op: z.enum(["add", "rename", "remove"]),
        id: z.string().max(100).optional(),
        text: z.string().trim().min(1).max(100).optional(),
        assignments: assignmentSchema,
      })
      .strict()
      .parse(await body(req));
    limit("cardsort-groups:" + initial.id, 60);
    let i = initial;
    await transaction(async () => {
      i = (await get<Interview>("interview", initial.id))!;
      if (!i) fail(404, "Interview not found.");
      if (i.requests[input.requestId]) return;
      if (
        i.status !== "active" ||
        i.version !== input.version ||
        (i.pending && Date.now() - i.pending.at < 70000)
      )
        fail(409, "Interview changed. Reload before editing categories.");
      const q = i.guide.questions[i.current],
        s = cardsortState(i, q),
        c = q.cardsort;
      if (
        q.type !== "cardsort" ||
        !c ||
        !s ||
        s.phase !== "sort" ||
        !c.mode ||
        c.mode === "closed"
      )
        fail(409, "This question does not accept category edits.");
      const groups = structuredClone(s.customGroups || []);
      if (input.op === "add") {
        if (input.id || !input.text) fail(400, "Provide a new category name.");
        groups.push({ id: "participant_" + uid(), text: input.text });
      } else {
        const g = groups.find((g) => g.id === input.id);
        if (!g) fail(404, "Your category is unavailable.");
        if (input.op === "rename") {
          if (!input.text) fail(400, "Provide a category name.");
          g.text = input.text;
        } else groups.splice(groups.indexOf(g), 1);
      }
      const assignments =
        input.op === "remove"
          ? input.assignments.filter((a) => a.groupId !== input.id)
          : input.assignments;
      try {
        s.customGroups = validateCustomGroups(c, groups);
        s.draft = validateAssignments(c, assignments, false, s.customGroups);
      } catch {
        fail(
          400,
          "Use at most ten distinct category names and valid card placements.",
        );
      }
      i.version++;
      i.requests[input.requestId] = { version: i.version };
      await put("interview", i);
      if (!i.preview) await dirty((await get<Study>("study", i.studyId))!);
    });
    return respond({ interview: publicInterview(i, true) });
  }
  if (
    p[0] === "interviews" &&
    p[1] &&
    p[2] === "cardsort-draft" &&
    req.method === "POST"
  ) {
    const initial = await participant(req, p[1]),
      input = z
        .object({
          requestId: z.uuid(),
          version: z.number().int().min(0),
          assignments: assignmentSchema,
        })
        .parse(await body(req));
    limit("cardsort-draft:" + initial.id, 60);
    let i: Interview = initial;
    await transaction(async () => {
      i = (await get<Interview>("interview", initial.id))!;
      if (!i) fail(404, "Interview not found.");
      if (i.requests[input.requestId]) return;
      if (i.pending && Date.now() - i.pending.at < 70000)
        fail(
          409,
          "Your previous answer is still being processed. Please wait.",
        );
      if (i.status !== "active" || i.version !== input.version)
        fail(409, "This interview changed. Reload before editing the draft.");
      const q = i.guide.questions[i.current],
        s = cardsortState(i, q);
      if (q.type !== "cardsort" || !s || s.phase !== "sort")
        fail(
          409,
          "This sort has already been confirmed. Continue with the current question.",
        );
      s.draft = validateAssignments(
        q.cardsort!,
        input.assignments,
        false,
        s.customGroups,
      );
      i.version++;
      i.requests[input.requestId] = { version: i.version };
      await put("interview", i);
      if (!i.preview) await dirty((await get<Study>("study", i.studyId))!);
    });
    return respond({ interview: publicInterview(i, true) });
  }
  if (p[0] !== "studies" || !p[1] || p[2] !== "cardsort") return null;
  await retention();
  const a = await actor(),
    s = await requireStudy(p[1], a);
  if (req.method !== "GET")
    fail(
      405,
      "Card-sort results are read-only. Edit the study guide to configure a sort.",
    );
  const params = new URL(req.url).searchParams,
    key = params.get("attribute"),
    value = params.get("value");
  if ((key === null) !== (value === null))
    fail(400, "Provide an attribute and exact value together.");
  const attribute =
    key !== null && value !== null
      ? z
          .object({
            key: z.string().min(1).max(100),
            value: z.string().max(500),
          })
          .parse({ key, value })
      : undefined;
  const results = cardsortResults(await interviews(s), attribute);
  if (!p[3]) return respond({ results, attribute });
  if (p[3] === "export") {
    const kind = z
      .enum(["assignments", "summary", "pairs"])
      .parse(params.get("kind") || "summary");
    let rows: string[][];
    if (kind === "summary") {
      rows = [
        [
          "study_id",
          "revision_id",
          "question_id",
          "concept_id",
          "card_id",
          "card_label",
          "group_id",
          "group_label",
          "uncertain",
          "count",
          "denominator",
          "percent",
          "incomplete",
          "not_asked",
          "invalid",
          "attribute",
          "attribute_value",
        ],
      ];
      for (const r of results)
        for (const card of r.rows) {
          for (const g of card.groups)
            rows.push([
              s.id,
              r.revisionId,
              r.questionId,
              r.conceptId || "",
              card.id,
              card.text,
              g.id,
              g.text,
              "false",
              String(g.count),
              String(card.denominator),
              g.percent === null ? "" : String(g.percent),
              String(r.counts.incomplete),
              String(r.counts.notAsked),
              String(r.counts.invalid),
              key || "",
              value || "",
            ]);
          if (r.config.mode && r.config.mode !== "closed")
            rows.push([
              s.id,
              r.revisionId,
              r.questionId,
              r.conceptId || "",
              card.id,
              card.text,
              "",
              "Participant-created category",
              "false",
              String(card.custom),
              String(card.denominator),
              card.denominator
                ? String((100 * card.custom) / card.denominator)
                : "",
              String(r.counts.incomplete),
              String(r.counts.notAsked),
              String(r.counts.invalid),
              key || "",
              value || "",
            ]);
          rows.push([
            s.id,
            r.revisionId,
            r.questionId,
            r.conceptId || "",
            card.id,
            card.text,
            "",
            "Uncertain",
            "true",
            String(card.uncertain),
            String(card.denominator),
            card.denominator
              ? String((100 * card.uncertain) / card.denominator)
              : "",
            String(r.counts.incomplete),
            String(r.counts.notAsked),
            String(r.counts.invalid),
            key || "",
            value || "",
          ]);
        }
    } else if (kind === "pairs") {
      rows = [
        [
          "study_id",
          "revision_id",
          "question_id",
          "concept_id",
          "card_a",
          "card_b",
          "same_real_group",
          "both_assigned_real_groups",
          "percent",
          "attribute",
          "attribute_value",
        ],
      ];
      for (const r of results)
        for (const pair of r.pairs)
          rows.push([
            s.id,
            r.revisionId,
            r.questionId,
            r.conceptId || "",
            pair.cardA,
            pair.cardB,
            String(pair.together),
            String(pair.bothAssigned),
            pair.percent === null ? "" : String(pair.percent),
            key || "",
            value || "",
          ]);
    } else {
      rows = [
        [
          "study_id",
          "revision_id",
          "question_id",
          "concept_id",
          "response_id",
          "status",
          "confirmed",
          "card_id",
          "card_label",
          "group_id",
          "group_label",
          "uncertain",
          "reason",
          "sort_turn_id",
          "reason_turn_id",
          "version",
        ],
      ];
      for (const r of results)
        for (const o of r.outcomes) {
          const assignments = o.assignments.length ? o.assignments : o.draft;
          for (const placement of assignments)
            rows.push([
              s.id,
              r.revisionId,
              r.questionId,
              r.conceptId || "",
              o.interviewId,
              o.status,
              String(o.assignments.length > 0),
              placement.cardId,
              r.config.cards.find((c) => c.id === placement.cardId)?.text || "",
              placement.groupId || "",
              placement.groupId === null
                ? "Uncertain"
                : [...r.config.groups, ...(o.customGroups || [])].find(
                    (g) => g.id === placement.groupId,
                  )?.text || "",
              String(placement.groupId === null),
              o.reason,
              o.turns.find((t) => t.phase === "sort")?.id || "",
              o.turns.find((t) => t.phase === "reason")?.id || "",
              r.version,
            ]);
        }
    }
    return new Response(csv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="cardsort-${kind}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  fail(404, "Card-sort route not found.");
}
