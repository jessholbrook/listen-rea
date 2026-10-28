import { z } from "zod";
import type { PPTXEvidence } from "./pptx-evidence";
export const pptxPassageCitation = z
  .object({
    pptxId: z.string().min(1).max(100),
    verificationVersion: z.number().int().positive(),
    slide: z.number().int().min(1).max(100),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    quote: z
      .string()
      .min(1)
      .max(1000)
      .refine((q) => /\S/.test(q)),
  })
  .strict();
export const pptxSynthesisPromptVersion = "2026-10-21-pptx-synthesis-v1";
export const pptxSynthesisInput = z
  .object({
    findings: z
      .array(
        z
          .object({
            title: z.string().trim().min(3).max(150),
            description: z.string().trim().min(3).max(1500),
            citations: z.array(pptxPassageCitation).min(1).max(10),
          })
          .strict(),
      )
      .max(6),
    limitations: z.string().trim().min(3).max(2000),
  })
  .strict();
export type PPTXSynthesisContent = z.infer<typeof pptxSynthesisInput>;
export type PPTXSynthesis = PPTXSynthesisContent & {
  model: string;
  promptVersion: string;
  generatedAt: string;
  reviewed: boolean;
  reviewedBy?: { id: string; name: string };
  reviewedAt?: string;
  edited?: boolean;
};
export function validatePPTXSynthesis(
  input: unknown,
  evidence: PPTXEvidence[],
): PPTXSynthesisContent {
  const parsed = pptxSynthesisInput.parse(input);
  validatePPTXPassageCitations(
    parsed.findings.flatMap((f) => f.citations),
    evidence,
  );
  return parsed;
}
export const pptxSynthesisLabels = {
  en: {
    title: "Synthesis of verified PPTX passages",
    notice:
      "AI interpretations of selected, researcher-verified document excerpts. These are not interview statements or independently verified facts and do not change participant or theme counts.",
    limits: "PPTX synthesis limitations",
    citation: "PPTX slide",
    review: "Verification",
    characters: "characters",
  },
  es: {
    title: "Síntesis de pasajes verificados de PPTX",
    notice:
      "Interpretaciones de IA de extractos seleccionados y verificados por un investigador. No son declaraciones de entrevistas ni hechos verificados independientemente y no cambian los recuentos de participantes o temas.",
    limits: "Limitaciones de la síntesis de PPTX",
    citation: "Diapositiva del PPTX",
    review: "Verificación",
    characters: "caracteres",
  },
  fr: {
    title: "Synthèse des passages PPTX vérifiés",
    notice:
      "Interprétations par IA d’extraits sélectionnés et vérifiés par un chercheur. Ce ne sont pas des déclarations d’entretien ni des faits vérifiés indépendamment ; elles ne modifient pas les décomptes des participants ou des thèmes.",
    limits: "Limites de la synthèse PPTX",
    citation: "Diapositive PPTX",
    review: "Vérification",
    characters: "caractères",
  },
};
export function pptxSynthesisText(
  s: PPTXSynthesis | undefined,
  language: "en" | "es" | "fr" = "en",
) {
  if (!s?.reviewed) return "";
  const l = pptxSynthesisLabels[language];
  return (
    "\n\n" +
    [
      l.title,
      l.notice,
      ...s.findings.flatMap((f) => [
        f.title,
        f.description,
        ...f.citations.map(
          (c) =>
            `${l.citation} ${c.slide} · ${l.characters} ${c.start + 1}–${c.end}: “${c.quote}” [${c.pptxId} · ${l.review} ${c.verificationVersion}]`,
        ),
      ]),
      l.limits,
      s.limitations,
      `${s.reviewedBy?.name || ""} · ${s.reviewedAt || ""} · ${s.model} · ${s.promptVersion}`,
    ].join("\n")
  );
}

export function validatePPTXPassageCitations(
  citations: z.infer<typeof pptxPassageCitation>[],
  evidence: PPTXEvidence[],
) {
  for (const c of citations) {
    const e = evidence.find(
      (e) =>
        e.pptxId === c.pptxId &&
        e.verificationVersion === c.verificationVersion,
    );
    if (
      !e ||
      !e.passages.some(
        (p) =>
          p.slide === c.slide &&
          p.start === c.start &&
          p.end === c.end &&
          p.quote === c.quote,
      )
    )
      throw new Error("INVALID_CITATION");
  }
}
