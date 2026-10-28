import { verifyPPTXEvidence } from "./pptx-evidence-server";
import type { PPTXEvidence } from "./pptx-evidence";
import { verifyDOCXObservations } from "./docx-observations-server";
import { verifyPPTXObservations } from "./pptx-observations-server";
import type { DOCXObservation } from "./docx-observations";
import type { PPTXObservation } from "./pptx-observations";
import { includedDOCXAnswers, type DOCXAnswerEvidence } from "./docx-answers";
import { includedPPTXAnswers, type PPTXAnswerEvidence } from "./pptx-answers";
import { verifyDOCXAnswers } from "./docx-answers-server";
import { verifyPPTXAnswers } from "./pptx-answers-server";
import { validateDOCXSynthesis, type DOCXSynthesis } from "./docx-synthesis";
import { validatePPTXSynthesis, type PPTXSynthesis } from "./pptx-synthesis";
import { verifyDOCXEvidence } from "./docx-evidence-server";
import type { DOCXEvidence } from "./docx-evidence";
import { includedPDFAnswers, type PDFAnswerEvidence } from "./pdf-answers";
import { verifyPDFAnswers } from "./pdf-answers-server";
import {
  includedDOCXObservationAnswers,
  type DOCXObservationAnswerEvidence,
} from "./docx-observation-answers";
import {
  includedPPTXObservationAnswers,
  type PPTXObservationAnswerEvidence,
} from "./pptx-observation-answers";
import {
  includedPDFObservationAnswers,
  type PDFObservationAnswerEvidence,
} from "./pdf-observation-answers";
import { verifyDOCXObservationAnswers } from "./docx-observation-answers-server";
import { verifyPPTXObservationAnswers } from "./pptx-observation-answers-server";
import { verifyPDFObservationAnswers } from "./pdf-observation-answers-server";
import {
  validateDOCXObservationSynthesis,
  type DOCXObservationSynthesis,
} from "./docx-observation-synthesis";
import {
  validatePPTXObservationSynthesis,
  type PPTXObservationSynthesis,
} from "./pptx-observation-synthesis";
import {
  validatePDFObservationSynthesis,
  type PDFObservationSynthesis,
} from "./pdf-observation-synthesis";
import { verifyPDFObservations } from "./pdf-observations-server";
import type { PDFObservation } from "./pdf-observations";
import { validatePDFSynthesis, type PDFSynthesis } from "./pdf-synthesis";
import { verifyPDFEvidence } from "./pdf-evidence-server";
import type { PDFEvidence } from "./pdf-evidence";
import {
  validateAttachmentSynthesis,
  type AttachmentSynthesis,
} from "./attachment-synthesis";
import { verifyAttachmentEvidence } from "./attachment-evidence-server";
import type { AttachmentEvidence } from "./attachment-evidence";
import { z } from "zod";
import {
  db,
  get,
  put,
  list,
  uid,
  now,
  hash,
  token,
  transaction,
  requireStudy,
  interviews,
} from "./db";
import { actor, canEdit, body, respond, fail } from "./http";
import { scopeInterviews } from "./concepts";
import type { Study, Analysis, Interview, Actor, Citation } from "./domain";
import {
  templateSchema,
  defaultStyle,
  editionInput,
  blocksFromAnalysis,
  citationsOf,
  editionText,
  clipInput,
  reelInput,
  captionsVtt,
  type ReportTemplate,
  type ReportEdition,
  type ReportSnapshot,
  type MediaSource,
  type MediaClip,
  type MediaReel,
  type RenderJob,
} from "./reporting";
import { presentation } from "./presentation";
import { renderReel } from "./render";
import { writeRecording, recordingResponse } from "./storage";
import { queueRenderDeletion } from "./reporting-cleanup";
import { retention, cleanDeletions } from "./features";
async function included(s: Study, scope?: ReportEdition["scope"]) {
  return scopeInterviews(await interviews(s), scope);
}
async function verifyCitations(
  s: Study,
  citations: Citation[],
  scope?: ReportEdition["scope"],
  attachments?: AttachmentEvidence[],
  synthesis?: AttachmentSynthesis,
  pdfs?: PDFEvidence[],
  pdfSynthesis?: PDFSynthesis,
  pdfObservations?: PDFObservation[],
  pdfObservationSynthesis?: PDFObservationSynthesis,
  pdfObservationAnswers?: PDFObservationAnswerEvidence[],
  answerSourceAnalysisId?: string,
  pdfAnswers?: PDFAnswerEvidence[],
  docxs?: DOCXEvidence[],
  docxSynthesis?: DOCXSynthesis,
  docxAnswers?: DOCXAnswerEvidence[],
  docxObservations?: DOCXObservation[],
  docxObservationSynthesis?: DOCXObservationSynthesis,
  docxObservationAnswers?: DOCXObservationAnswerEvidence[],
  pptxs?: PPTXEvidence[],
  pptxSynthesis?: PPTXSynthesis,
  pptxAnswers?: PPTXAnswerEvidence[],
  pptxObservations?: PPTXObservation[],
  pptxObservationSynthesis?: PPTXObservationSynthesis,
  pptxObservationAnswers?: PPTXObservationAnswerEvidence[],
) {
  const all = await included(s, scope);
  for (const c of citations) {
    const t = all
      .find((i) => i.id === c.interviewId)
      ?.turns.find((t) => t.id === c.turnId);
    if (!t || !t.answer.includes(c.quote))
      fail(
        400,
        "A quote does not match the included source evidence in this report scope.",
      );
  }
  await verifyAttachmentEvidence(s, all, attachments);
  await verifyPDFEvidence(s, all, pdfs);
  await verifyDOCXEvidence(s, all, docxs);
  await verifyPPTXEvidence(s, all, pptxs);
  await verifyPDFObservations(s, all, pdfObservations);
  await verifyDOCXObservationAnswers(
    s,
    answerSourceAnalysisId,
    docxObservationAnswers,
    docxObservations || [],
  );
  await verifyPPTXObservationAnswers(
    s,
    answerSourceAnalysisId,
    pptxObservationAnswers,
    pptxObservations || [],
  );
  await verifyPDFObservationAnswers(
    s,
    answerSourceAnalysisId,
    pdfObservationAnswers,
    pdfObservations || [],
  );
  await verifyPDFAnswers(s, answerSourceAnalysisId, pdfAnswers, pdfs || []);
  await verifyDOCXAnswers(s, answerSourceAnalysisId, docxAnswers, docxs || []);
  await verifyPPTXAnswers(s, answerSourceAnalysisId, pptxAnswers, pptxs || []);
  await verifyDOCXObservations(s, all, docxObservations);
  await verifyPPTXObservations(s, all, pptxObservations);
  if (docxObservationSynthesis) {
    if (!docxObservationSynthesis.reviewed)
      fail(
        400,
        "Review or discard the DOCX observation synthesis before creating or sharing a report.",
      );
    validateDOCXObservationSynthesis(
      {
        findings: docxObservationSynthesis.findings,
        limitations: docxObservationSynthesis.limitations,
      },
      docxObservations || [],
    );
  }
  if (pptxObservationSynthesis) {
    if (!pptxObservationSynthesis.reviewed)
      fail(
        400,
        "Review or discard the PPTX observation synthesis before creating or sharing a report.",
      );
    validatePPTXObservationSynthesis(
      {
        findings: pptxObservationSynthesis.findings,
        limitations: pptxObservationSynthesis.limitations,
      },
      pptxObservations || [],
    );
  }
  if (pdfObservationSynthesis) {
    if (!pdfObservationSynthesis.reviewed)
      fail(
        400,
        "Review or discard the PDF observation synthesis before creating or sharing a report.",
      );
    validatePDFObservationSynthesis(
      {
        findings: pdfObservationSynthesis.findings,
        limitations: pdfObservationSynthesis.limitations,
      },
      pdfObservations || [],
    );
  }
  if (docxSynthesis) {
    if (!docxSynthesis.reviewed)
      fail(
        400,
        "Review or discard the DOCX synthesis before creating or sharing a report.",
      );
    validateDOCXSynthesis(
      {
        findings: docxSynthesis.findings,
        limitations: docxSynthesis.limitations,
      },
      docxs || [],
    );
  }
  if (pptxSynthesis) {
    if (!pptxSynthesis.reviewed)
      fail(
        400,
        "Review or discard the PPTX synthesis before creating or sharing a report.",
      );
    validatePPTXSynthesis(
      {
        findings: pptxSynthesis.findings,
        limitations: pptxSynthesis.limitations,
      },
      pptxs || [],
    );
  }
  if (pdfSynthesis) {
    if (!pdfSynthesis.reviewed)
      fail(
        400,
        "Review or discard the PDF synthesis before creating or sharing a report.",
      );
    validatePDFSynthesis(
      {
        findings: pdfSynthesis.findings,
        limitations: pdfSynthesis.limitations,
      },
      pdfs || [],
    );
  }
  if (synthesis) {
    if (!synthesis.reviewed)
      fail(
        400,
        "Review or discard the observation synthesis before creating or sharing a report.",
      );
    validateAttachmentSynthesis(
      { findings: synthesis.findings, limitations: synthesis.limitations },
      attachments || [],
    );
  }
  return all;
}
async function sources(s: Study): Promise<MediaSource[]> {
  const all = (await interviews(s)).filter(
    (i) => !i.preview && !i.excluded && i.status === "complete",
  );
  const rows = await db
    .prepare(
      "SELECT id,interview_id,turn_version,duration_ms,kind FROM media WHERE workspace_id=? AND study_id=? AND kind IN ('audio','screen','import-video')",
    )
    .all(s.workspaceId, s.id);
  return rows.flatMap((m) => {
    const i = all.find((i) => i.id === m.interview_id),
      t = i?.turns[Number(m.turn_version)];
    if (!i || !t || (m.kind === "audio" && t.audioId !== m.id)) return [];
    return [
      {
        mediaId: String(m.id),
        external: Boolean(i.origin),
        interviewId: i.id,
        turnId: t.id,
        prompt: t.prompt,
        answerPreview: t.answer.slice(0, 160),
        kind: m.kind === "audio" ? "audio" : "screen",
        durationMs: Number(m.duration_ms),
        revisionId: i.revisionId,
        conceptId: t.conceptId,
      },
    ];
  });
}
async function validateClip(s: Study, c: z.infer<typeof clipInput>) {
  const source = (await sources(s)).find((m) => m.mediaId === c.mediaId);
  if (!source)
    fail(
      400,
      "Choose a recording from a completed, included response in this study.",
    );
  if (
    c.endMs > source.durationMs ||
    c.endMs <= c.startMs ||
    c.endMs - c.startMs > 30000
  )
    fail(
      400,
      "Choose a range within the recording, between 0.1 and 30 seconds.",
    );
  if (c.endMs - c.startMs < 100) fail(400, "Choose at least 0.1 seconds.");
  const i = (await get<Interview>(
      "interview",
      source.interviewId,
      s.workspaceId,
    ))!,
    t = i.turns.find((t) => t.id === source.turnId)!;
  if (!t.answer.includes(c.quote))
    fail(
      400,
      "The evidence quote must exactly match the linked participant answer.",
    );
  return source;
}
async function reelClips(s: Study, r: MediaReel, review = false) {
  const clips: MediaClip[] = [];
  for (const id of r.clipIds) {
    const c = await get<MediaClip>("mediaClip", id, s.workspaceId);
    if (!c || c.studyId !== s.id) fail(400, "A reel clip is missing.");
    await validateClip(s, c);
    if (review && !c.reviewed)
      fail(400, "Review every clip’s timing and caption before rendering.");
    clips.push(c);
  }
  if (clips.reduce((n, c) => n + c.endMs - c.startMs, 0) > 60000)
    fail(400, "Keep a reel to at most 60 seconds.");
  return clips;
}
async function edition(s: Study, id: string) {
  const e = await get<ReportEdition>("reportEdition", id, s.workspaceId);
  if (!e || e.studyId !== s.id) fail(404, "Report edition not found.");
  return e;
}
async function snapshot(
  e: ReportEdition,
  a: Actor,
  action: ReportSnapshot["action"],
) {
  await put("reportSnapshot", {
    id: uid(),
    workspaceId: e.workspaceId,
    studyId: e.studyId,
    editionId: e.id,
    edition: structuredClone(e),
    action,
    actorName: a.name,
    createdAt: now(),
  } satisfies ReportSnapshot);
}
async function revoke(s: Study) {
  await db
    .prepare("DELETE FROM shares WHERE workspace_id=? AND study_id=?")
    .run(s.workspaceId, s.id);
}
function fresh(e: { dataVersion: number }, s: Study) {
  if (e.dataVersion !== s.dataVersion)
    fail(
      409,
      "The response set changed. Rebase and review the report, or create a new render job.",
    );
}
async function verifiedJob(s: Study, id: string) {
  const j = await get<RenderJob>("renderJob", id, s.workspaceId);
  if (!j || j.studyId !== s.id) fail(404, "Render job not found.");
  fresh(j, s);
  const r = await get<MediaReel>("mediaReel", j.reelId, s.workspaceId);
  if (!r || r.studyId !== s.id || r.version !== j.reelVersion || !r.reviewed)
    fail(409, "The reel changed. Review it and create a new render job.");
  const clips = await reelClips(s, r, true);
  if (
    clips.some(
      (c, n) =>
        j.clipVersions[n]?.id !== c.id ||
        j.clipVersions[n]?.version !== c.version,
    ) ||
    clips.length !== j.clipVersions.length
  )
    fail(409, "A clip changed. Create a new render job.");
  return { job: j, reel: r, clips };
}
async function deleteJobs(s: Study, predicate: (j: RenderJob) => boolean) {
  const jobs = (await list<RenderJob>("renderJob", s.workspaceId, s.id)).filter(
    predicate,
  );
  await queueRenderDeletion(
    s,
    jobs.flatMap((j) => (j.outputId ? [j.outputId] : [])),
  );
  for (const j of jobs)
    await db
      .prepare(
        "DELETE FROM documents WHERE kind='renderJob' AND id=? AND workspace_id=?",
      )
      .run(j.id, s.workspaceId);
  await revoke(s);
}
function attachment(bytes: Buffer, mime: string, name: string) {
  if (bytes.length > 3 * 1024 * 1024)
    fail(
      413,
      "This export is too large. Shorten the report or use fewer blocks.",
    );
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
function vtt(clips: MediaClip[], segments?: RenderJob["segments"]) {
  const timed = clips.map((c, n) => ({
    ...c,
    startMs: 0,
    endMs: segments?.[n]
      ? segments[n].endMs - segments[n].startMs
      : c.endMs - c.startMs,
  }));
  return new Response(captionsVtt(timed), {
    headers: {
      "Content-Type": "text/vtt; charset=utf-8",
      "Content-Disposition": 'attachment; filename="research-captions.vtt"',
      "Cache-Control": "private, no-store",
    },
  });
}
export async function dispatchReporting(
  req: Request,
  p: string[],
): Promise<Response | null> {
  const method = req.method;
  if (p[0] === "shared" && p[1] && method === "GET") {
    const sh = await db
      .prepare("SELECT * FROM shares WHERE hash=? AND expires>?")
      .get(hash(p[1]), Date.now());
    if (
      !sh ||
      (!String(sh.analysis_id).startsWith("edition:") &&
        !String(sh.analysis_id).startsWith("render:"))
    )
      return null;
    await retention();
    const s = await get<Study>(
      "study",
      String(sh.study_id),
      String(sh.workspace_id),
    );
    if (!s) fail(404, "This share link is unavailable.");
    const [kind, id, version] = String(sh.analysis_id).split(":");
    try {
      if (kind === "edition") {
        const e = await edition(s, id);
        fresh(e, s);
        if (!e.reviewed || e.version !== Number(version))
          fail(404, "This report changed.");
        await verifyCitations(
          s,
          citationsOf(e.blocks),
          e.scope,
          e.attachmentEvidence,
          e.attachmentSynthesis,
          e.pdfEvidence,
          e.pdfSynthesis,

          e.pdfObservations,
          e.pdfObservationSynthesis,
          e.pdfObservationAnswers,
          e.sourceAnalysisId,
          e.pdfAnswers,
          e.docxEvidence,
          e.docxSynthesis,
          e.docxAnswers,
          e.docxObservations,
          e.docxObservationSynthesis,
          e.docxObservationAnswers,
          e.pptxEvidence,
          e.pptxSynthesis,
          e.pptxAnswers,
          e.pptxObservations,
          e.pptxObservationSynthesis,
          e.pptxObservationAnswers,
        );
        if (p[2] === "deck")
          return attachment(
            await presentation(e),
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "research-report.pptx",
          );
        if (p[2]) fail(404, "Report resource not found.");
        return respond({
          kind: "edition",
          title: e.title,
          memo: editionText(e),
          reviewed: true,
        });
      }
      const { job: j, clips } = await verifiedJob(s, id);
      if (j.state !== "complete" || !j.outputId)
        fail(404, "This reel is unavailable.");
      if (p[2] === "media")
        return recordingResponse(req, j.outputId, "video/mp4");
      if (p[2] === "captions") return vtt(clips, j.segments);
      if (p[2]) fail(404, "Reel resource not found.");
      return respond({
        kind: "reel",
        title: j.name,
        memo: clips
          .map(
            (c, n) =>
              `${n + 1}. ${c.name}\n“${c.quote}”\nParticipant ${c.interviewId} · Turn ${c.turnId}`,
          )
          .join("\n\n"),
        reviewed: true,
      });
    } catch {
      fail(
        404,
        "This shared report or reel changed, expired or is no longer available.",
      );
    }
  }
  if (p[0] !== "studies" || !p[1] || p[2] !== "reporting") return null;
  await retention();
  const a = await actor(),
    s = await requireStudy(p[1], a),
    resource = p[3],
    id = p[4],
    action = p[5];
  if (!resource && method === "GET") {
    const all = (await interviews(s)).filter(
      (i) => i.status === "complete" && !i.preview && !i.excluded,
    );
    const analyses = await list<Analysis>("analysis", s.workspaceId, s.id);
    const latest = analyses.filter(
      (v, n) =>
        analyses.findIndex(
          (x) => JSON.stringify(x.scope) === JSON.stringify(v.scope),
        ) === n,
    );
    return respond({
      dataVersion: s.dataVersion,
      editions: await list<ReportEdition>("reportEdition", s.workspaceId, s.id),
      templates: await list<ReportTemplate>("reportTemplate", s.workspaceId),
      clips: await list<MediaClip>("mediaClip", s.workspaceId, s.id),
      reels: await list<MediaReel>("mediaReel", s.workspaceId, s.id),
      jobs: await list<RenderJob>("renderJob", s.workspaceId, s.id),
      sources: await sources(s),
      analyses: latest.map((x) => ({
        id: x.id,
        label: x.scope
          ? `Concept ${x.scope.conceptId} · ${x.scope.revisionId.slice(0, 8)}`
          : "Shared-question analysis",
        stale: x.dataVersion !== s.dataVersion,
      })),
      evidence: all.flatMap((i) =>
        i.turns.map((t) => ({
          interviewId: i.id,
          turnId: t.id,
          label: t.prompt.slice(0, 80) + " · " + i.id.slice(0, 8),
        })),
      ),
    });
  }
  if (resource === "evidence" && id && action && method === "GET") {
    const i = await get<Interview>("interview", id, s.workspaceId),
      t = i?.turns.find((t) => t.id === action);
    if (
      !i ||
      i.studyId !== s.id ||
      i.preview ||
      i.excluded ||
      i.status !== "complete" ||
      !t
    )
      fail(404, "Source evidence not found.");
    return respond({
      answer: t.answer,
      prompt: t.prompt,
      interviewId: i.id,
      turnId: t.id,
    });
  }
  if (resource === "editions" && id && method === "GET") {
    const e = await edition(s, id);
    if (action === "history")
      return respond({
        history: (
          await list<ReportSnapshot>("reportSnapshot", s.workspaceId, s.id)
        ).filter((h) => h.editionId === e.id),
      });
    if (action === "deck") {
      fresh(e, s);
      if (!e.reviewed) fail(400, "Review the edition before exporting.");
      await verifyCitations(
        s,
        citationsOf(e.blocks),
        e.scope,
        e.attachmentEvidence,
        e.attachmentSynthesis,
        e.pdfEvidence,
        e.pdfSynthesis,

        e.pdfObservations,
        e.pdfObservationSynthesis,
        e.pdfObservationAnswers,
        e.sourceAnalysisId,
        e.pdfAnswers,
        e.docxEvidence,
        e.docxSynthesis,
        e.docxAnswers,
        e.docxObservations,
        e.docxObservationSynthesis,
        e.docxObservationAnswers,
        e.pptxEvidence,
        e.pptxSynthesis,
        e.pptxAnswers,
        e.pptxObservations,
        e.pptxObservationSynthesis,
        e.pptxObservationAnswers,
      );
      return attachment(
        await presentation(e),
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "research-report.pptx",
      );
    }
    if (action) fail(404, "Edition resource not found.");
    return respond({ edition: e, stale: e.dataVersion !== s.dataVersion });
  }
  if (resource === "clips" && id && action === "captions" && method === "GET") {
    const c = await get<MediaClip>("mediaClip", id, s.workspaceId);
    if (!c || c.studyId !== s.id) fail(404, "Clip not found.");
    await validateClip(s, c);
    return vtt([c]);
  }
  if (resource === "jobs" && id && method === "GET") {
    const { job: j, clips } = await verifiedJob(s, id);
    if (action === "download") {
      if (j.state !== "complete" || !j.outputId)
        fail(409, "Render this job before downloading.");
      return recordingResponse(req, j.outputId, "video/mp4");
    }
    if (action === "captions") return vtt(clips, j.segments);
    if (action) fail(404, "Render resource not found.");
    return respond({ job: j });
  }
  canEdit(a);
  if (resource === "templates") {
    if (a.role !== "admin")
      fail(403, "Only admins can manage workspace presentation styles.");
    if (!id && method === "POST") {
      const input = templateSchema.parse(await body(req));
      const t: ReportTemplate = {
        ...input,
        id: uid(),
        workspaceId: s.workspaceId,
        version: 1,
      };
      await put("reportTemplate", t);
      return respond({ template: t }, 201);
    }
    if (id && (method === "PUT" || method === "DELETE")) {
      await transaction(async () => {
        const t = await get<ReportTemplate>(
          "reportTemplate",
          id,
          s.workspaceId,
        );
        if (!t) fail(404, "Template not found.");
        if (method === "DELETE")
          await db
            .prepare(
              "DELETE FROM documents WHERE kind='reportTemplate' AND id=? AND workspace_id=?",
            )
            .run(id, s.workspaceId);
        else {
          const input = templateSchema
            .extend({ version: z.number().int() })
            .parse(await body(req));
          if (input.version !== t.version)
            fail(409, "Template changed. Reload before saving.");
          await put("reportTemplate", {
            ...t,
            ...input,
            version: t.version + 1,
          });
        }
      });
      return respond({ ok: true });
    }
  }
  if (resource === "editions" && !id && method === "POST") {
    const input = z
      .object({
        analysisId: z.uuid(),
        title: z.string().trim().min(3).max(160),
        templateId: z.uuid().optional(),
      })
      .parse(await body(req));
    let e: ReportEdition | undefined;
    await transaction(async () => {
      const current = await requireStudy(s.id, a),
        analysis = await get<Analysis>(
          "analysis",
          input.analysisId,
          s.workspaceId,
        );
      if (!analysis || analysis.studyId !== s.id)
        fail(404, "Analysis not found.");
      fresh(analysis, current);
      let style = defaultStyle;
      if (input.templateId) {
        const t = await get<ReportTemplate>(
          "reportTemplate",
          input.templateId,
          s.workspaceId,
        );
        if (!t) fail(404, "Template not found.");
        style = templateSchema.parse(t);
      }
      const blocks = blocksFromAnalysis(analysis, uid);
      const all = await verifyCitations(
        current,
        citationsOf(blocks),
        analysis.scope,
        analysis.attachmentEvidence,
        analysis.attachmentSynthesis,
        analysis.pdfEvidence,
        analysis.pdfSynthesis,

        analysis.pdfObservations,
        analysis.pdfObservationSynthesis,
        includedPDFObservationAnswers(
          analysis.pdfObservationAnswers,
          analysis.pdfObservations || [],
        ),
        analysis.id,
        includedPDFAnswers(analysis.pdfAnswers, analysis.pdfEvidence || []),
        analysis.docxEvidence,
        analysis.docxSynthesis,
        includedDOCXAnswers(analysis.docxAnswers, analysis.docxEvidence || []),
        analysis.docxObservations,
        analysis.docxObservationSynthesis,
        includedDOCXObservationAnswers(
          analysis.docxObservationAnswers,
          analysis.docxObservations || [],
        ),
        analysis.pptxEvidence,
        analysis.pptxSynthesis,
        includedPPTXAnswers(analysis.pptxAnswers, analysis.pptxEvidence || []),
        analysis.pptxObservations,
        analysis.pptxObservationSynthesis,
        includedPPTXObservationAnswers(
          analysis.pptxObservationAnswers,
          analysis.pptxObservations || [],
        ),
      );
      e = {
        id: uid(),
        workspaceId: s.workspaceId,
        studyId: s.id,
        language: analysis.reportLanguage || "en",
        sourceAnalysisId: analysis.id,
        sourceAnalysisVersion: analysis.version,
        dataVersion: current.dataVersion,
        scope: analysis.scope,
        ...(includedDOCXAnswers(
          analysis.docxAnswers,
          analysis.docxEvidence || [],
        ).length
          ? {
              docxAnswers: structuredClone(
                includedDOCXAnswers(
                  analysis.docxAnswers,
                  analysis.docxEvidence || [],
                ),
              ),
            }
          : {}),
        ...(includedPPTXAnswers(
          analysis.pptxAnswers,
          analysis.pptxEvidence || [],
        ).length
          ? {
              pptxAnswers: structuredClone(
                includedPPTXAnswers(
                  analysis.pptxAnswers,
                  analysis.pptxEvidence || [],
                ),
              ),
            }
          : {}),
        ...(includedPDFAnswers(analysis.pdfAnswers, analysis.pdfEvidence || [])
          .length
          ? {
              pdfAnswers: includedPDFAnswers(
                analysis.pdfAnswers,
                analysis.pdfEvidence || [],
              ),
            }
          : {}),
        ...(analysis.pdfSynthesis
          ? { pdfSynthesis: structuredClone(analysis.pdfSynthesis) }
          : {}),
        ...(includedDOCXObservationAnswers(
          analysis.docxObservationAnswers,
          analysis.docxObservations || [],
        ).length
          ? {
              docxObservationAnswers: includedDOCXObservationAnswers(
                analysis.docxObservationAnswers,
                analysis.docxObservations || [],
              ),
            }
          : {}),
        ...(includedPPTXObservationAnswers(
          analysis.pptxObservationAnswers,
          analysis.pptxObservations || [],
        ).length
          ? {
              pptxObservationAnswers: includedPPTXObservationAnswers(
                analysis.pptxObservationAnswers,
                analysis.pptxObservations || [],
              ),
            }
          : {}),
        ...(includedPDFObservationAnswers(
          analysis.pdfObservationAnswers,
          analysis.pdfObservations || [],
        ).length
          ? {
              pdfObservationAnswers: includedPDFObservationAnswers(
                analysis.pdfObservationAnswers,
                analysis.pdfObservations || [],
              ),
            }
          : {}),
        ...(analysis.docxObservationSynthesis
          ? {
              docxObservationSynthesis: structuredClone(
                analysis.docxObservationSynthesis,
              ),
            }
          : {}),
        ...(analysis.pptxObservationSynthesis
          ? {
              pptxObservationSynthesis: structuredClone(
                analysis.pptxObservationSynthesis,
              ),
            }
          : {}),
        ...(analysis.pdfObservationSynthesis
          ? {
              pdfObservationSynthesis: structuredClone(
                analysis.pdfObservationSynthesis,
              ),
            }
          : {}),
        ...(analysis.docxObservations?.length
          ? { docxObservations: structuredClone(analysis.docxObservations) }
          : {}),
        ...(analysis.pptxObservations?.length
          ? { pptxObservations: structuredClone(analysis.pptxObservations) }
          : {}),
        ...(analysis.pdfObservations?.length
          ? { pdfObservations: structuredClone(analysis.pdfObservations) }
          : {}),
        ...(analysis.docxSynthesis
          ? { docxSynthesis: structuredClone(analysis.docxSynthesis) }
          : {}),
        ...(analysis.pptxSynthesis
          ? { pptxSynthesis: structuredClone(analysis.pptxSynthesis) }
          : {}),
        ...(analysis.pptxEvidence?.length
          ? { pptxEvidence: structuredClone(analysis.pptxEvidence) }
          : {}),
        ...(analysis.docxEvidence?.length
          ? { docxEvidence: structuredClone(analysis.docxEvidence) }
          : {}),
        ...(analysis.pdfEvidence?.length
          ? { pdfEvidence: structuredClone(analysis.pdfEvidence) }
          : {}),
        ...(analysis.attachmentEvidence?.length
          ? { attachmentEvidence: structuredClone(analysis.attachmentEvidence) }
          : {}),
        ...(analysis.attachmentSynthesis
          ? {
              attachmentSynthesis: structuredClone(
                analysis.attachmentSynthesis,
              ),
            }
          : {}),
        version: 1,
        sampleSize: all.length,
        title: input.title,
        blocks,
        style: structuredClone(style),
        reviewed: false,
        createdAt: now(),
        updatedAt: now(),
      };
      await put("reportEdition", e);
      await snapshot(e, a, "created");
    });
    return respond({ edition: e }, 201);
  }
  if (resource === "editions" && id) {
    // Mutations below parse the body once, including their optimistic version.
    if (
      (method === "PUT" && !action) ||
      (method === "POST" && ["restore", "rebase"].includes(action))
    ) {
      const input = await body(req);
      let updated: ReportEdition | undefined;
      await transaction(async () => {
        const current = await requireStudy(s.id, a),
          e = await edition(current, id),
          version = z.number().int().parse(input.version);
        if (e.version !== version)
          fail(409, "This edition changed. Reload before saving.");
        let value = e;
        if (action === "restore") {
          const h = await get<ReportSnapshot>(
            "reportSnapshot",
            z.uuid().parse(input.snapshotId),
            s.workspaceId,
          );
          if (!h || h.editionId !== e.id || h.studyId !== s.id)
            fail(404, "Edition snapshot not found.");
          fresh(e, current);
          value = {
            ...e,
            ...editionInput.parse(h.edition),
            version: e.version,
          };
        } else if (!action) {
          value = { ...e, ...editionInput.parse(input) };
          if (e.dataVersion !== current.dataVersion) value.reviewed = false;
        }
        const all = await verifyCitations(
          current,
          citationsOf(value.blocks),
          value.scope,
          value.attachmentEvidence,
          value.attachmentSynthesis,
          value.pdfEvidence,
          value.pdfSynthesis,

          value.pdfObservations,
          value.pdfObservationSynthesis,
          value.pdfObservationAnswers,
          value.sourceAnalysisId,
          value.pdfAnswers,
          value.docxEvidence,
          value.docxSynthesis,
          value.docxAnswers,
          value.docxObservations,
          value.docxObservationSynthesis,
          value.docxObservationAnswers,
          value.pptxEvidence,
          value.pptxSynthesis,
          value.pptxAnswers,
          value.pptxObservations,
          value.pptxObservationSynthesis,
          value.pptxObservationAnswers,
        );
        value.version = e.version + 1;
        value.updatedAt = now();
        if (action === "rebase") {
          value.dataVersion = current.dataVersion;
          value.sampleSize = all.length;
          value.reviewed = false;
        } else if (action === "restore") value.reviewed = false;
        await put("reportEdition", value);
        await snapshot(
          value,
          a,
          action === "restore"
            ? "restored"
            : action === "rebase"
              ? "rebased"
              : "saved",
        );
        await revoke(current);
        updated = value;
      });
      return respond({ edition: updated });
    }
    if (method === "DELETE" && !action) {
      await transaction(async () => {
        await edition(s, id);
        await db
          .prepare(
            "DELETE FROM documents WHERE workspace_id=? AND study_id=? AND (kind='reportEdition' AND id=? OR kind='reportSnapshot' AND json_extract(data,'$.editionId')=?)",
          )
          .run(s.workspaceId, s.id, id, id);
        await revoke(s);
      });
      return respond({ ok: true });
    }
    if (method === "POST" && action === "share") {
      const e = await edition(s, id);
      fresh(e, s);
      if (!e.reviewed) fail(400, "Review this edition before sharing.");
      await verifyCitations(
        s,
        citationsOf(e.blocks),
        e.scope,
        e.attachmentEvidence,
        e.attachmentSynthesis,
        e.pdfEvidence,
        e.pdfSynthesis,

        e.pdfObservations,
        e.pdfObservationSynthesis,
        e.pdfObservationAnswers,
        e.sourceAnalysisId,
        e.pdfAnswers,
        e.docxEvidence,
        e.docxSynthesis,
        e.docxAnswers,
        e.docxObservations,
        e.docxObservationSynthesis,
        e.docxObservationAnswers,
        e.pptxEvidence,
        e.pptxSynthesis,
        e.pptxAnswers,
        e.pptxObservations,
        e.pptxObservationSynthesis,
        e.pptxObservationAnswers,
      );
      const t = token();
      await db
        .prepare(
          "INSERT INTO shares(hash,study_id,workspace_id,analysis_id,expires) VALUES(?,?,?,?,?)",
        )
        .run(
          hash(t),
          s.id,
          s.workspaceId,
          `edition:${e.id}:${e.version}`,
          Date.now() + 7 * 86400000,
        );
      return respond({ token: t });
    }
  }
  if (
    resource === "clips" &&
    ((method === "POST" && !id) || (method === "PUT" && id && !action))
  ) {
    const input = z
      .object({ ...clipInput.shape, version: z.number().int().optional() })
      .parse(await body(req));
    let clip: MediaClip | undefined;
    await transaction(async () => {
      const current = await requireStudy(s.id, a),
        source = await validateClip(current, input);
      let previous: MediaClip | undefined;
      if (id) {
        previous = await get<MediaClip>("mediaClip", id, s.workspaceId);
        if (!previous || previous.studyId !== s.id)
          fail(404, "Clip not found.");
        if (previous.version !== input.version)
          fail(409, "Clip changed. Reload before saving.");
        await deleteJobs(current, (j) =>
          j.clipVersions.some((c) => c.id === id),
        );
      }
      clip = {
        ...clipInput.parse(input),
        id: id || uid(),
        workspaceId: s.workspaceId,
        studyId: s.id,
        interviewId: source.interviewId,
        turnId: source.turnId,
        kind: source.kind,
        revisionId: source.revisionId,
        conceptId: source.conceptId,
        version: (previous?.version || 0) + 1,
        createdAt: previous?.createdAt || now(),
      };
      await put("mediaClip", clip);
    });
    await cleanDeletions();
    return respond({ clip }, id ? 200 : 201);
  }
  if (resource === "clips" && id && method === "DELETE") {
    await transaction(async () => {
      const c = await get<MediaClip>("mediaClip", id, s.workspaceId);
      if (!c || c.studyId !== s.id) fail(404, "Clip not found.");
      await deleteJobs(s, (j) => j.clipVersions.some((c) => c.id === id));
      for (const r of await list<MediaReel>("mediaReel", s.workspaceId, s.id)) {
        if (!r.clipIds.includes(id)) continue;
        r.clipIds = r.clipIds.filter((c) => c !== id);
        if (!r.clipIds.length)
          await db
            .prepare(
              "DELETE FROM documents WHERE kind='mediaReel' AND id=? AND workspace_id=?",
            )
            .run(r.id, s.workspaceId);
        else
          await put("mediaReel", {
            ...r,
            version: r.version + 1,
            reviewed: false,
          });
      }
      await db
        .prepare(
          "DELETE FROM documents WHERE kind='mediaClip' AND id=? AND workspace_id=?",
        )
        .run(id, s.workspaceId);
    });
    await cleanDeletions();
    return respond({ ok: true });
  }
  if (
    resource === "reels" &&
    ((method === "POST" && !id) || (method === "PUT" && id && !action))
  ) {
    const raw = await body(req),
      input = reelInput.parse(raw);
    let reel: MediaReel | undefined;
    await transaction(async () => {
      const current = await requireStudy(s.id, a);
      let previous: MediaReel | undefined;
      if (id) {
        previous = await get<MediaReel>("mediaReel", id, s.workspaceId);
        if (!previous || previous.studyId !== s.id)
          fail(404, "Reel not found.");
        if (previous.version !== raw.version)
          fail(409, "Reel changed. Reload before saving.");
        await deleteJobs(current, (j) => j.reelId === id);
      }
      reel = {
        ...input,
        id: id || uid(),
        workspaceId: s.workspaceId,
        studyId: s.id,
        version: (previous?.version || 0) + 1,
        createdAt: previous?.createdAt || now(),
      };
      await reelClips(current, reel, input.reviewed);
      await put("mediaReel", reel);
    });
    await cleanDeletions();
    return respond({ reel }, id ? 200 : 201);
  }
  if (resource === "reels" && id && method === "DELETE") {
    await transaction(async () => {
      const r = await get<MediaReel>("mediaReel", id, s.workspaceId);
      if (!r || r.studyId !== s.id) fail(404, "Reel not found.");
      await deleteJobs(s, (j) => j.reelId === id);
      await db
        .prepare(
          "DELETE FROM documents WHERE kind='mediaReel' AND id=? AND workspace_id=?",
        )
        .run(id, s.workspaceId);
    });
    await cleanDeletions();
    return respond({ ok: true });
  }
  if (resource === "jobs" && !id && method === "POST") {
    const input = z
      .object({ reelId: z.uuid(), version: z.number().int() })
      .parse(await body(req));
    let job: RenderJob | undefined;
    await transaction(async () => {
      const current = await requireStudy(s.id, a),
        r = await get<MediaReel>("mediaReel", input.reelId, s.workspaceId);
      if (!r || r.studyId !== s.id) fail(404, "Reel not found.");
      if (r.version !== input.version)
        fail(409, "Reel changed. Reload before rendering.");
      if (!r.reviewed) fail(400, "Review this reel before rendering.");
      const clips = await reelClips(current, r, true);
      job = {
        id: uid(),
        workspaceId: s.workspaceId,
        studyId: s.id,
        reelId: r.id,
        reelVersion: r.version,
        clipVersions: clips.map((c) => ({ id: c.id, version: c.version })),
        dataVersion: current.dataVersion,
        name: r.name,
        state: "queued",
        attempts: 0,
        createdAt: now(),
        updatedAt: now(),
      };
      await put("renderJob", job);
    });
    return respond({ job }, 201);
  }
  if (resource === "jobs" && id && action === "run" && method === "POST") {
    let claimed: RenderJob | undefined,
      clips: MediaClip[] = [];
    const lease = token();
    await transaction(async () => {
      const current = await requireStudy(s.id, a),
        v = await verifiedJob(current, id);
      if (v.job.state === "complete") {
        claimed = v.job;
        return;
      }
      if (v.job.state === "running" && (v.job.leaseUntil || 0) > Date.now())
        fail(409, "This job is already rendering.");
      const active = (await list<RenderJob>("renderJob", s.workspaceId)).some(
        (j) =>
          j.state === "running" &&
          (j.leaseUntil || 0) > Date.now() &&
          j.id !== id,
      );
      if (active)
        fail(
          409,
          "Another workspace render is running. Retry when it finishes.",
        );
      await queueRenderDeletion(
        current,
        v.job.outputId ? [v.job.outputId] : [],
      );
      claimed = {
        ...v.job,
        state: "running",
        attempts: v.job.attempts + 1,
        lease,
        leaseUntil: Date.now() + 150000,
        outputId: uid(),
        error: undefined,
        updatedAt: now(),
      };
      clips = v.clips;
      await put("renderJob", claimed);
    });
    if (claimed!.state === "complete") return respond({ job: claimed });
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(120000)]);
    try {
      const output = await renderReel(clips, signal);
      signal.throwIfAborted();
      await writeRecording(claimed!.outputId!, output.bytes, "video/mp4");
      await transaction(async () => {
        const current = await requireStudy(s.id, a),
          v = await verifiedJob(current, id);
        if (v.job.lease !== lease || v.job.state !== "running")
          fail(409, "This render was superseded.");
        Object.assign(v.job, {
          state: "complete",
          durationMs: output.durationMs,
          segments: output.segments,
          bytes: output.bytes.length,
          lease: undefined,
          leaseUntil: undefined,
          updatedAt: now(),
        });
        await put("renderJob", v.job);
        claimed = v.job;
      });
    } catch (e) {
      await transaction(async () => {
        const current = await get<RenderJob>("renderJob", id, s.workspaceId);
        await queueRenderDeletion(
          s,
          claimed?.outputId ? [claimed.outputId] : [],
        );
        if (current?.lease === lease) {
          current.state = "failed";
          current.lease = undefined;
          current.leaseUntil = undefined;
          current.error =
            e instanceof Error && e.message === "RENDER_SOURCE_RANGE"
              ? "The selected timing does not match the available recording. Review the clip ranges."
              : e instanceof Error && e.message === "RENDER_TOO_LARGE"
                ? "The rendered reel exceeds the download limit. Shorten the reel."
                : "Rendering failed or was interrupted. Check source playback and retry this job.";
          current.updatedAt = now();
          await put("renderJob", current);
          claimed = current;
        }
      });
      await cleanDeletions();
      return respond({ job: claimed }, 200);
    }
    await cleanDeletions();
    return respond({ job: claimed });
  }
  if (resource === "jobs" && id && action === "share" && method === "POST") {
    const { job: j } = await verifiedJob(s, id);
    if (j.state !== "complete")
      fail(400, "Render the reviewed reel before sharing.");
    const t = token();
    await db
      .prepare(
        "INSERT INTO shares(hash,study_id,workspace_id,analysis_id,expires) VALUES(?,?,?,?,?)",
      )
      .run(
        hash(t),
        s.id,
        s.workspaceId,
        `render:${j.id}:1`,
        Date.now() + 7 * 86400000,
      );
    return respond({ token: t });
  }
  if (resource === "shares" && method === "DELETE") {
    await revoke(s);
    return respond({ ok: true });
  }
  fail(404, "Reporting resource not found.");
}
