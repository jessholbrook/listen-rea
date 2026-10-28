import { z } from "zod";
import { guideSchema, questionSchema, type Guide } from "./domain";

export const defaultsSchema = z.object({
  audience: z.string().trim().min(3).max(1000),
  intro: z.string().trim().min(5).max(3000),
  limit: z.number().int().min(1).max(500),
  guidelines: z.string().trim().max(4000),
});
export type WorkspaceDefaults = z.infer<typeof defaultsSchema> & {
  version: number;
};
export type Folder = { id: string; workspaceId: string; name: string };
export const audienceSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().min(3).max(1000),
    questions: z.array(questionSchema).min(1).max(15),
    sections: guideSchema.shape.sections,
  })
  .superRefine((a, ctx) => {
    if (
      a.questions.some(
        (q) =>
          q.type !== "choice" || q.conceptQuestion || q.carryForward || q.task,
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Saved screeners must be fixed single-choice questions outside the concept block.",
      });
    const valid = guideSchema.safeParse({
      title: a.name + " audience",
      goal: "Qualify the intended audience.",
      audience: a.description,
      intro: "Please answer these screening questions.",
      questions: a.questions,
      sections: a.sections,
      limit: 20,
    });
    if (!valid.success)
      for (const issue of valid.error.issues)
        ctx.addIssue({
          code: "custom",
          message: issue.message,
          path: issue.path,
        });
  });
export type SavedAudience = z.infer<typeof audienceSchema> & {
  id: string;
  workspaceId: string;
  createdAt: string;
};
export type GuideHistory = {
  id: string;
  workspaceId: string;
  studyId: string;
  guide: Guide;
  version: number;
  createdAt: string;
  actorName: string;
  action:
    "created" | "saved" | "published" | "restored" | "audience" | "baseline";
  restoredFrom?: string;
};
export type WorkflowLibrary = {
  folders: Folder[];
  audiences: SavedAudience[];
  defaults: WorkspaceDefaults;
};

// Imported references are remapped together, so a saved audience cannot bind to
// unrelated question IDs in the destination guide.
export function applyAudience(
  guide: Guide,
  audience: Pick<SavedAudience, "questions" | "description" | "sections">,
  makeId: () => string,
): Guide {
  const used = new Set(guide.questions.map((q) => q.id));
  const ids = new Map<string, string>();
  for (const q of audience.questions) {
    let id = makeId();
    while (used.has(id)) id = makeId();
    used.add(id);
    ids.set(q.id, id);
  }
  const usedSections = new Set(guide.questions.map((q) => q.section));
  const sections = new Map<string, string>();
  for (const q of audience.questions)
    if (!sections.has(q.section)) {
      let name = "Saved audience · " + (sections.size + 1);
      while (usedSections.has(name)) name += " ·";
      usedSections.add(name);
      sections.set(q.section, name);
    }
  const questions = structuredClone(audience.questions).map((q) => ({
    ...q,
    id: ids.get(q.id)!,
    section: sections.get(q.section)!,
    condition: q.condition
      ? { ...q.condition, questionId: ids.get(q.condition.questionId)! }
      : null,
  }));
  const importedSections = (audience.sections || []).map((s) => ({
    name: sections.get(s.name)!,
    condition: { ...s.condition, questionId: ids.get(s.condition.questionId)! },
  }));
  return guideSchema.parse({
    ...guide,
    audience: audience.description,
    questions: [...questions, ...guide.questions],
    sections: [...importedSections, ...(guide.sections || [])],
  });
}
export type Advice = {
  id: string;
  level: "error" | "review";
  message: string;
  questionId?: string;
};
export function adviseGuide(g: Guide): Advice[] {
  const advice: Advice[] = [];
  const parsed = guideSchema.safeParse(g);
  if (!parsed.success)
    parsed.error.issues.forEach((issue, n) => {
      const index = issue.path[0] === "questions" ? Number(issue.path[1]) : -1;
      advice.push({
        id: "validation-" + n,
        level: "error",
        message: issue.message,
        questionId: g.questions[index]?.id,
      });
    });
  const add = (id: string, message: string, questionId?: string) =>
    advice.push({ id, message, questionId, level: "review" });
  const texts = new Set<string>();
  for (const q of g.questions) {
    if (
      /\b(don.t you (agree|think)|wouldn.t you|obviously|clearly superior|how much do you love|how helpful|how frustrating)\b/i.test(
        q.text,
      )
    )
      add(
        "leading-" + q.id,
        "This wording may suggest a preferred answer. Try a neutral question that allows positive, negative or no impact.",
        q.id,
      );
    if (
      (q.text.match(/\?/g) || []).length > 1 ||
      /\b(and why|and how|and what)\b/i.test(q.text)
    )
      add(
        "compound-" + q.id,
        "This may ask more than one thing. Consider splitting it so each answer is clear.",
        q.id,
      );
    const text = q.text.trim().toLowerCase();
    if (texts.has(text))
      add(
        "repeat-" + q.id,
        "Another question has the same wording. Check whether both are needed.",
        q.id,
      );
    texts.add(text);
    if (
      q.type === "choice" &&
      q.options.some((o) => o.rejects) &&
      q.options.every((o) => o.rejects)
    )
      add(
        "reject-" + q.id,
        "Every option screens out. No participant reaching this question can continue.",
        q.id,
      );
    if (q.type === "open" && /\b(would you|will you|might you)\b/i.test(q.text))
      add(
        "future-" + q.id,
        "This asks for a prediction. Consider asking about a recent experience before interpreting stated intent.",
        q.id,
      );
  }
  if (!g.questions.some((q) => q.type === "open"))
    add(
      "no-open",
      "There are no open questions. Add one if understanding reasons or unexpected experiences is part of the objective.",
    );
  const turns = g.questions.reduce(
    (n, q) =>
      n +
      (q.type === "statement"
        ? 0
        : (1 + q.followUps) *
          (q.conceptQuestion ? g.conceptTest?.count || 1 : 1)),
    0,
  );
  if (turns > 25)
    add(
      "burden",
      `This guide allows up to ${turns} answer turns before routing skips. Consider participant burden and preview the full path.`,
    );
  if (g.conceptTest && g.conceptTest.concepts.some((c) => c.imageUrl))
    add(
      "images",
      "Check linked images in participant preview. An HTTPS URL alone does not establish that participants can access the image.",
    );
  return advice;
}
