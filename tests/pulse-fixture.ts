import {
  templateGuide,
  guideSchema,
  type Study,
  type Revision,
  type Interview,
} from "../src/lib/domain";
import type { PulseSeries, PulseReview } from "../src/lib/pulse";
export function pulseFixture() {
  const guide = guideSchema.parse({
    ...templateGuide("Experience tracker"),
    questions: [
      {
        id: "rating",
        type: "rating",
        text: "How satisfied are you?",
        scale: {
          min: 0,
          max: 10,
          lowLabel: "Not at all",
          highLabel: "Extremely",
        },
      },
      {
        id: "choice",
        type: "choice",
        text: "Would you return?",
        options: [
          { id: "yes", text: "Yes" },
          { id: "no", text: "No" },
        ],
      },
      { id: "reason", type: "open", text: "Why do you feel this way?" },
    ],
  });
  const study: Study = {
    id: "wave1",
    workspaceId: "workspace",
    title: guide.title,
    draft: guide,
    revisionId: "r1",
    fielding: "paused",
    createdAt: "2026-10-19",
    updatedAt: "2026-10-19",
    version: 1,
    dataVersion: 0,
  };
  const revision: Revision = {
    id: "r1",
    studyId: study.id,
    guide,
    createdAt: study.createdAt,
  };
  const wave = {
    studyId: study.id,
    label: "Wave 1",
    date: "2026-10-19",
    recruitment: "Same panel, quotas and market",
  };
  const series: PulseSeries = {
    id: "series",
    workspaceId: study.workspaceId,
    name: "Experience Pulse",
    version: 1,
    createdAt: study.createdAt,
    baselineRevisionId: revision.id,
    baselineStudyId: study.id,
    baseline: structuredClone(guide),
    guidelines: "",
    recruitment: wave.recruitment,
    waves: [wave],
    codebooks: [
      {
        version: 1,
        createdAt: study.createdAt,
        codes: [
          {
            id: "cost",
            name: "Cost concern",
            definition: "Explicit concern about price; exclude value praise.",
          },
        ],
      },
    ],
  };
  const interview = (id: string, rating: number, yes = true): Interview => ({
    id,
    workspaceId: study.workspaceId,
    studyId: study.id,
    revisionId: revision.id,
    guide: structuredClone(guide),
    preview: false,
    excluded: false,
    exclusionReason: "",
    tokenHash: "private",
    status: "complete",
    createdAt: study.createdAt,
    consentAt: study.createdAt,
    consentVersion: "test",
    current: 3,
    prompt: "",
    strategy: "guide",
    attributes: { segment: "Team" },
    version: 3,
    requests: {},
    turns: [
      {
        id: id + "-rating",
        questionId: "rating",
        prompt: guide.questions[0].text,
        answer: String(rating),
        value: rating,
        followUp: false,
        strategy: "guide",
        source: "typed",
        createdAt: study.createdAt,
      },
      {
        id: id + "-choice",
        questionId: "choice",
        prompt: guide.questions[1].text,
        answer: yes ? "Yes" : "No",
        optionId: yes ? "yes" : "no",
        followUp: false,
        strategy: "guide",
        source: "typed",
        createdAt: study.createdAt,
      },
      {
        id: id + "-reason",
        questionId: "reason",
        prompt: guide.questions[2].text,
        answer: "The price is too high for me.",
        followUp: false,
        strategy: "guide",
        source: "typed",
        createdAt: study.createdAt,
      },
    ],
  });
  const review = (i: Interview, match = true): PulseReview => ({
    id: "series:" + i.id,
    workspaceId: study.workspaceId,
    studyId: study.id,
    interviewId: i.id,
    seriesId: series.id,
    sourceVersion: i.version,
    codebookVersion: 1,
    assignments: match ? [{ codeId: "cost", turnId: i.id + "-reason" }] : [],
    reviewedAt: study.createdAt,
    reviewedBy: "Researcher",
  });
  return { guide, study, revision, series, wave, interview, review };
}
