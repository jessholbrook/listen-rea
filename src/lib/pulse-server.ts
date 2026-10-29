import { dispatchPulseSchedule } from "./pulse-schedule-server";
import { z } from "zod";
import { actor, canEdit, body, respond, fail } from "./http";
import {
  get,
  put,
  list,
  uid,
  now,
  requireStudy,
  transaction,
  interviews,
} from "./db";
import type { Study, Revision, Interview } from "./domain";
import { retention } from "./features";
import { saveHistory } from "./workflow-server";
import {
  pulseCodes,
  pulseWaveResults,
  type PulseSeries,
  type PulseReview,
} from "./pulse";
import { csv } from "./evidence";
const version = z.number().int().min(1);
const waveInput = z.object({
  label: z.string().trim().min(3).max(160),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (v) =>
        !Number.isNaN(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v,
      "Use a valid date.",
    ),
  recruitment: z.string().trim().min(3).max(2000),
});
export async function dispatchPulse(req: Request, p: string[]) {
  const schedule = await dispatchPulseSchedule(req, p);
  if (schedule) return schedule;
  const studyRoute =
    p[0] === "studies" && p[1] && p[2] === "pulse" && p.length === 3;
  if (!studyRoute && p[0] !== "pulse") return null;
  await retention();
  const a = await actor();
  if (studyRoute) {
    const s = await requireStudy(p[1], a);
    if (req.method === "GET")
      return respond({
        series: (await list<PulseSeries>("pulseSeries", a.workspaceId)).filter(
          (x) => x.waves.some((w) => w.studyId === s.id),
        ),
      });
    if (req.method !== "POST") fail(405, "Use GET or POST.");
    canEdit(a);
    const input = waveInput
      .extend({ version, name: z.string().trim().min(3).max(160) })
      .parse(await body(req));
    let series!: PulseSeries;
    await transaction(async () => {
      const current = await requireStudy(s.id, a);
      if (current.version !== input.version)
        fail(409, "Study changed. Refresh before creating a tracker.");
      const rev = current.revisionId
        ? await get<Revision>("revision", current.revisionId, a.workspaceId)
        : undefined;
      if (!rev) fail(400, "Publish a baseline study design first.");
      if (
        (await list<PulseSeries>("pulseSeries", a.workspaceId)).some((x) =>
          x.waves.some((w) => w.studyId === s.id),
        )
      )
        fail(409, "This study already belongs to a Pulse tracker.");
      series = {
        id: uid(),
        workspaceId: a.workspaceId,
        name: input.name,
        version: 1,
        createdAt: now(),
        baselineRevisionId: rev.id,
        baselineStudyId: s.id,
        baseline: structuredClone(rev.guide),
        guidelines: current.researchGuidelines || "",
        recruitment: input.recruitment,
        waves: [
          {
            studyId: s.id,
            label: input.label,
            date: input.date,
            recruitment: input.recruitment,
          },
        ],
        codebooks: [{ version: 1, codes: [], createdAt: now() }],
      };
      await put("pulseSeries", series);
    });
    return respond({ series }, 201);
  }
  if (!p[1]) fail(404, "Tracker not found.");
  const initial = await get<PulseSeries>("pulseSeries", p[1], a.workspaceId);
  if (!initial) fail(404, "Tracker not found.");
  if (req.method === "GET" && (!p[2] || p[2] === "export")) {
    const params = new URL(req.url).searchParams,
      key = params.get("attribute"),
      value = params.get("value");
    if ((key === null) !== (value === null))
      fail(400, "Provide an attribute and exact value together.");
    const segment =
      key !== null && value !== null
        ? z
            .object({
              key: z.string().min(1).max(100),
              value: z.string().max(500),
            })
            .parse({ key, value })
        : undefined;
    const reviews = await list<PulseReview>("pulseReview", a.workspaceId);
    const waves = await Promise.all(
      initial.waves.map(async (w) => {
        const s = await get<Study>("study", w.studyId, a.workspaceId);
        const rev = s?.revisionId
          ? await get<Revision>("revision", s.revisionId, a.workspaceId)
          : undefined;
        return pulseWaveResults(
          initial,
          w,
          s,
          rev,
          s ? await interviews(s) : [],
          reviews,
          segment,
        );
      }),
    );
    if (p[2] === "export") {
      const kind = z
        .enum(["comparison", "evidence"])
        .parse(params.get("kind") || "comparison");
      if (kind === "evidence") {
        const rows: string[][] = [
          [
            "series_id",
            "wave",
            "study_id",
            "revision_id",
            "comparable",
            "warnings",
            "codebook_version",
            "code_id",
            "code_name",
            "definition",
            "interview_id",
            "turn_id",
            "prompt",
            "answer",
            "reviewed_by",
            "reviewed_at",
          ],
        ];
        for (const w of waves)
          for (const source of w.sources)
            for (const t of source.turns) {
              const codes =
                source.review?.assignments.filter((a) => a.turnId === t.id) ||
                [];
              for (const code of codes.length
                ? codes
                : [{ codeId: "", turnId: t.id }]) {
                const definition = initial.codebooks
                  .at(-1)!
                  .codes.find((c) => c.id === code.codeId);
                rows.push([
                  initial.id,
                  w.label,
                  w.studyId,
                  w.revisionId || "",
                  String(w.comparable),
                  w.warnings.join(" "),
                  String(w.codebookVersion),
                  code.codeId,
                  definition?.name || "",
                  definition?.definition || "",
                  source.id,
                  t.id,
                  t.prompt,
                  t.answer,
                  source.review?.reviewedBy || "",
                  source.review?.reviewedAt || "",
                ]);
              }
            }
        return new Response(csv(rows), {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="pulse-evidence.csv"',
            "Cache-Control": "private, no-store",
          },
        });
      }
      const rows: string[][] = [
        [
          "series_id",
          "wave",
          "date",
          "study_id",
          "revision_id",
          "comparable",
          "warnings",
          "codebook_version",
          "metric_id",
          "metric",
          "kind",
          "option_or_code_id",
          "value",
          "denominator",
          "missing_or_unreviewed",
          "attribute",
          "attribute_value",
        ],
      ];
      for (const w of waves) {
        const prefix = [
          initial.id,
          w.label,
          w.date,
          w.studyId,
          w.revisionId || "",
          String(w.comparable),
          w.warnings.join(" "),
          String(w.codebookVersion),
        ];
        rows.push([
          ...prefix,
          "",
          "Wave sample",
          "included",
          "",
          String(w.counts.included),
          String(w.counts.complete),
          String(w.counts.unreviewed),
          key || "",
          value || "",
        ]);
        for (const m of w.metrics) {
          if (m.type === "rating")
            rows.push([
              ...prefix,
              m.id,
              m.text,
              "rating_mean",
              "",
              m.mean === null ? "" : String(m.mean),
              String(m.denominator),
              String(m.missing),
              key || "",
              value || "",
            ]);
          for (const o of m.options)
            rows.push([
              ...prefix,
              m.id,
              m.text,
              "choice_percent",
              o.id,
              o.percent === null ? "" : String(o.percent),
              String(m.denominator),
              String(m.missing),
              key || "",
              value || "",
            ]);
        }
        for (const t of w.themes)
          rows.push([
            ...prefix,
            t.id,
            t.name,
            "coded_participant_percent",
            t.id,
            t.percent === null ? "" : String(t.percent),
            String(t.denominator),
            String(w.counts.unreviewed),
            key || "",
            value || "",
          ]);
      }
      return new Response(csv(rows), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="pulse-comparison.csv"',
          "Cache-Control": "private, no-store",
        },
      });
    }
    return respond({ series: initial, waves, segment });
  }
  canEdit(a);
  if (req.method !== "POST") fail(405, "Use POST to change a tracker.");
  const raw = await body(req);
  let result: Study | undefined;
  await transaction(async () => {
    const series = (await get<PulseSeries>(
      "pulseSeries",
      initial.id,
      a.workspaceId,
    ))!;
    const inputVersion = z.object({ version }).parse(raw).version;
    if (inputVersion !== series.version)
      fail(409, "Tracker changed. Refresh before saving.");
    if (p[2] === "waves") {
      if (series.waves.length >= 100)
        fail(400, "A tracker supports up to 100 waves.");
      const input = waveInput.parse(raw);
      if (input.date < series.waves.at(-1)!.date)
        fail(400, "A new wave date must follow the previous wave.");
      result = {
        id: uid(),
        workspaceId: a.workspaceId,
        title: input.label,
        // Keep the participant title stable: it is part of the interview context and translation fingerprints.
        draft: structuredClone(series.baseline),
        researchGuidelines: series.guidelines,
        revisionId: null,
        fielding: "draft",
        createdAt: now(),
        updatedAt: now(),
        version: 1,
        dataVersion: 0,
      };
      await put("study", result);
      await saveHistory(result, a, "created");
      series.waves.push({ studyId: result.id, ...input });
    } else if (p[2] === "wave") {
      const input = waveInput.extend({ studyId: z.string() }).parse(raw);
      const index = series.waves.findIndex((w) => w.studyId === input.studyId);
      if (index < 0) fail(404, "Wave not found.");
      if (
        (index > 0 && input.date < series.waves[index - 1].date) ||
        (index + 1 < series.waves.length &&
          input.date > series.waves[index + 1].date)
      )
        fail(400, "Keep wave dates in sequence.");
      series.waves[index] = input;
    } else if (p[2] === "codebook") {
      if (series.codebooks.length >= 100)
        fail(400, "This tracker has reached its codebook version limit.");
      const { codes } = z.object({ codes: pulseCodes }).parse(raw);
      series.codebooks.push({
        version: series.codebooks.at(-1)!.version + 1,
        codes,
        createdAt: now(),
      });
    } else if (p[2] === "review") {
      const input = z
        .object({
          interviewId: z.string(),
          sourceVersion: z.number().int(),
          codebookVersion: version,
          assignments: z
            .array(z.object({ codeId: z.string(), turnId: z.string() }))
            .max(500),
        })
        .parse(raw);
      const i = await get<Interview>(
          "interview",
          input.interviewId,
          a.workspaceId,
        ),
        book = series.codebooks.at(-1)!;
      if (
        !i ||
        !series.waves.some((w) => w.studyId === i.studyId) ||
        i.status !== "complete" ||
        i.preview ||
        i.excluded ||
        i.origin
      )
        fail(404, "Completed wave source not found.");
      const s = await requireStudy(i.studyId, a);
      if (
        i.revisionId !== s.revisionId ||
        i.version !== input.sourceVersion ||
        input.codebookVersion !== book.version
      )
        fail(409, "Source or codebook changed. Refresh before reviewing.");
      if (
        input.assignments.some(
          (c) =>
            !book.codes.some((b) => b.id === c.codeId) ||
            !i.turns.some(
              (t) =>
                t.id === c.turnId &&
                series.baseline.questions.some(
                  (q) => q.id === (t.templateQuestionId || t.questionId),
                ),
            ),
        )
      )
        fail(
          400,
          "Code assignments must reference current recurring answers and defined codes.",
        );
      if (
        new Set(input.assignments.map((c) => c.codeId + ":" + c.turnId))
          .size !== input.assignments.length
      )
        fail(400, "Duplicate code assignment.");
      const review: PulseReview = {
        id: series.id + ":" + i.id,
        workspaceId: a.workspaceId,
        studyId: i.studyId,
        seriesId: series.id,
        interviewId: i.id,
        sourceVersion: i.version,
        codebookVersion: book.version,
        assignments: input.assignments,
        reviewedAt: now(),
        reviewedBy: a.name,
      };
      await put("pulseReview", review);
    } else fail(404, "Pulse route not found.");
    series.version++;
    await put("pulseSeries", series);
  });
  return respond({
    series: await get<PulseSeries>("pulseSeries", initial.id, a.workspaceId),
    ...(result ? { study: result } : {}),
  });
}
