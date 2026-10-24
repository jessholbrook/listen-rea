import { reportingCopy } from "./localization";
import { z } from "zod";
import {
  type Interview,
  type Theme,
  type Analysis,
  summarizeThemes,
} from "./domain";
export const themeInput = z.object({
  id: z.string().max(100).optional(),
  title: z.string().trim().min(3).max(150),
  description: z.string().max(1500),
  citations: z
    .array(
      z.object({
        interviewId: z.string(),
        turnId: z.string(),
        quote: z.string().min(3).max(12000),
      }),
    )
    .min(1)
    .max(300),
});
export const analysisInput = z.object({
  summary: z.string().max(6000),
  limitations: z.string().max(4000),
  themes: z.array(themeInput).max(20),
});
export function validateEvidence(
  input: unknown,
  interviews: Interview[],
): { summary: string; limitations: string; themes: Theme[] } {
  const result = analysisInput.parse(input);
  const eligible = interviews.filter(
    (i) => i.status === "complete" && !i.excluded && !i.preview,
  );
  const themes = result.themes.map((t, n) => ({
    ...t,
    id: t.id || "theme-" + n,
    citations: t.citations.map((c) => {
      const i = eligible.find((i) => i.id === c.interviewId),
        turn = i?.turns.find((t) => t.id === c.turnId);
      if (!turn || !turn.answer.includes(c.quote))
        throw new Error("INVALID_CITATION");
      return c;
    }),
  }));
  if (new Set(themes.map((t) => t.id)).size !== themes.length)
    throw new Error("INVALID_CITATION");
  return { ...result, themes };
}
export function buildMemo(
  analysis: Pick<
    Analysis,
    "themes" | "summary" | "limitations" | "reportLanguage"
  >,
  interviews: Interview[],
  title: string,
  goal: string,
) {
  const stats = summarizeThemes(analysis.themes, interviews);
  const labels = reportingCopy[analysis.reportLanguage || "en"];
  const method = interviews.some(
    (i) => i.origin && !i.preview && !i.excluded && i.status === "complete",
  )
    ? labels.external
    : labels.native;
  return `${title}\n\n${labels.objective}\n${goal}\n\n${labels.method}\n${method}. ${stats.denominator} ${labels.participants}. ${labels.sample}\n\n${labels.summary}\n${analysis.summary || labels.emptySummary}\n\n${labels.findings}\n${stats.themes.length ? stats.themes.map((t) => `${t.title} — ${t.count}/${stats.denominator} (${t.percent}%)\n${t.description}\n${t.citations.map((c) => `“${c.quote}” [${c.interviewId.slice(0, 8)} / ${c.turnId.slice(0, 8)}]`).join("\n")}`).join("\n\n") : labels.emptyFindings}\n\n${labels.limits}\n${analysis.limitations || labels.emptyLimits}`;
}
export function csv(rows: string[][]) {
  const cell = (s: string) =>
    '"' + (/^[=+@\-\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"';
  return "\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
