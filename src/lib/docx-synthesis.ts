import { z } from "zod";
import type { DOCXEvidence } from "./docx-evidence";
export const docxPassageCitation = z
  .object({
    docxId: z.string().min(1).max(100),
    verificationVersion: z.number().int().positive(),
    paragraph: z.number().int().min(1).max(2000),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    quote: z
      .string()
      .min(1)
      .max(1000)
      .refine((q) => /\S/.test(q)),
  })
  .strict();
export const docxSynthesisPromptVersion = "2026-10-21-docx-synthesis-v1";
export const docxSynthesisInput = z
  .object({
    findings: z
      .array(
        z
          .object({
            title: z.string().trim().min(3).max(150),
            description: z.string().trim().min(3).max(1500),
            citations: z.array(docxPassageCitation).min(1).max(10),
          })
          .strict(),
      )
      .max(6),
    limitations: z.string().trim().min(3).max(2000),
  })
  .strict();
export type DOCXSynthesisContent = z.infer<typeof docxSynthesisInput>;
export type DOCXSynthesis = DOCXSynthesisContent & {
  model: string;
  promptVersion: string;
  generatedAt: string;
  reviewed: boolean;
  reviewedBy?: { id: string; name: string };
  reviewedAt?: string;
  edited?: boolean;
};
export function validateDOCXSynthesis(
  input: unknown,
  evidence: DOCXEvidence[],
): DOCXSynthesisContent {
  const parsed = docxSynthesisInput.parse(input);
  validateDOCXPassageCitations(
    parsed.findings.flatMap((f) => f.citations),
    evidence,
  );
  return parsed;
}
export const docxSynthesisLabels = {
  en: {
    title: "Synthesis of verified DOCX passages",
    notice:
      "AI interpretations of selected, researcher-verified document excerpts. These are not interview statements or independently verified facts and do not change participant or theme counts.",
    limits: "DOCX synthesis limitations",
    citation: "DOCX paragraph",
    review: "Verification",
    characters: "characters",
  },
  es: {
    title: "Síntesis de pasajes verificados de DOCX",
    notice:
      "Interpretaciones de IA de extractos seleccionados y verificados por un investigador. No son declaraciones de entrevistas ni hechos verificados independientemente y no cambian los recuentos de participantes o temas.",
    limits: "Limitaciones de la síntesis de DOCX",
    citation: "Párrafo del DOCX",
    review: "Verificación",
    characters: "caracteres",
  },
  fr: {
    title: "Synthèse des passages DOCX vérifiés",
    notice:
      "Interprétations par IA d’extraits sélectionnés et vérifiés par un chercheur. Ce ne sont pas des déclarations d’entretien ni des faits vérifiés indépendamment ; elles ne modifient pas les décomptes des participants ou des thèmes.",
    limits: "Limites de la synthèse DOCX",
    citation: "Paragraphe DOCX",
    review: "Vérification",
    characters: "caractères",
  },
};
export function docxSynthesisText(
  s: DOCXSynthesis | undefined,
  language: "en" | "es" | "fr" = "en",
) {
  if (!s?.reviewed) return "";
  const l = docxSynthesisLabels[language];
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
            `${l.citation} ${c.paragraph} · ${l.characters} ${c.start + 1}–${c.end}: “${c.quote}” [${c.docxId} · ${l.review} ${c.verificationVersion}]`,
        ),
      ]),
      l.limits,
      s.limitations,
      `${s.reviewedBy?.name || ""} · ${s.reviewedAt || ""} · ${s.model} · ${s.promptVersion}`,
    ].join("\n")
  );
}

export function validateDOCXPassageCitations(
  citations: z.infer<typeof docxPassageCitation>[],
  evidence: DOCXEvidence[],
) {
  for (const c of citations) {
    const e = evidence.find(
      (e) =>
        e.docxId === c.docxId &&
        e.verificationVersion === c.verificationVersion,
    );
    if (
      !e ||
      !e.passages.some(
        (p) =>
          p.paragraph === c.paragraph &&
          p.start === c.start &&
          p.end === c.end &&
          p.quote === c.quote,
      )
    )
      throw new Error("INVALID_CITATION");
  }
}
