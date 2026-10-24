import { z } from "zod";
import type { Interview, Question, Turn } from "./domain";
export const pricingSchema = z.object({
  prices: z
    .array(z.number().int().min(1).max(100000000))
    .min(3)
    .max(12)
    .refine(
      (p) => p.every((v, n) => n === 0 || v > p[n - 1]),
      "Use 3–12 unique prices in ascending order.",
    ),
  currency: z.enum(["USD", "EUR", "GBP"]),
  unit: z.string().trim().min(1).max(100),
  askReason: z.boolean().default(true),
});
export type PricingConfig = z.infer<typeof pricingSchema>;
export type PricingEvent = {
  phase: "price" | "check";
  index: number;
  buy: boolean;
};
export type PricingState = {
  phase: "price" | "check" | "reason" | "done";
  start: number;
  index: number;
  low: number;
  high: number;
  events: PricingEvent[];
  highest: number;
  inconsistent: boolean;
  reason: string;
};
export type PricingPrompt = {
  phase: PricingState["phase"];
  amountMinor: number | null;
  currency: PricingConfig["currency"];
  unit: string;
};
export const money = (minor: number, currency: string, language = "en") =>
  new Intl.NumberFormat(language, { style: "currency", currency }).format(
    minor / 100,
  );
const words = {
  en: {
    buy: "Would you buy this at",
    check: "One final consistency check: would you buy this at",
    yes: "Yes",
    no: "No",
    reason:
      "What explains your price decisions? You can type “skip” to continue.",
    notMeasured: "These are stated intentions, not observed purchases.",
  },
  es: {
    buy: "¿Comprarías esto por",
    check: "Una última comprobación de coherencia: ¿comprarías esto por",
    yes: "Sí",
    no: "No",
    reason:
      "¿Qué explica tus decisiones sobre el precio? Puedes escribir «omitir» para continuar.",
    notMeasured: "Son intenciones declaradas, no compras observadas.",
  },
  fr: {
    buy: "Achèteriez-vous ceci à",
    check: "Une dernière vérification de cohérence : achèteriez-vous ceci à",
    yes: "Oui",
    no: "Non",
    reason:
      "Qu’est-ce qui explique vos décisions de prix ? Vous pouvez écrire «passer» pour continuer.",
    notMeasured: "Il s’agit d’intentions déclarées, pas d’achats observés.",
  },
};
export const pricingCopy = (language: Interview["language"]) =>
  words[language || "en"];
const savedState = (i: Interview, q: Question) =>
  Object.hasOwn(i.pricingStates || {}, q.id)
    ? i.pricingStates![q.id]
    : undefined;
export function pricingPrompt(
  i: Interview,
  q: Question,
): PricingPrompt | undefined {
  const s = savedState(i, q),
    c = q.pricing;
  return s && c
    ? {
        phase: s.phase,
        amountMinor:
          s.phase === "price" || s.phase === "check" ? c.prices[s.index] : null,
        currency: c.currency,
        unit: c.unit,
      }
    : undefined;
}
export function pricingText(i: Interview, q: Question) {
  const p = pricingPrompt(i, q),
    t = pricingCopy(i.language);
  if (!p) return q.text;
  if (p.phase === "reason") return t.reason;
  return `${q.text}\n\n${p.phase === "check" ? t.check : t.buy} ${money(p.amountMinor!, p.currency, i.language)} ${p.unit}?`;
}
export function beginPricing(
  i: Interview,
  q: Question,
  pick: (n: number) => number,
) {
  if (!q.pricing) return;
  i.pricingStates ||= {};
  if (!Object.hasOwn(i.pricingStates, q.id)) {
    const start = pick(q.pricing.prices.length);
    Object.defineProperty(i.pricingStates, q.id, {
      enumerable: true,
      writable: true,
      configurable: true,
      value: {
        phase: "price",
        start,
        index: start,
        low: -1,
        high: q.pricing.prices.length,
        events: [],
        highest: -1,
        inconsistent: false,
        reason: "",
      },
    });
  }
  i.prompt = pricingText(i, q);
}
export function pricingInput(
  i: Interview,
  q: Question,
  input: { optionId?: string; answer?: string },
) {
  const s = savedState(i, q);
  if (!s || s.phase === "done") throw new Error("INVALID_STRUCTURED_ANSWER");
  if (s.phase === "reason") {
    if (!input.answer?.trim()) throw new Error("INVALID_STRUCTURED_ANSWER");
    return;
  }
  if (!["yes", "no"].includes(input.optionId || ""))
    throw new Error("INVALID_STRUCTURED_ANSWER");
}
export function applyPricing(
  i: Interview,
  q: Question,
  input: { optionId?: string; answer?: string },
): Pick<Turn, "answer" | "pricing"> {
  pricingInput(i, q, input);
  const s = i.pricingStates![q.id],
    c = q.pricing!,
    phase = s.phase;
  if (phase === "reason") {
    s.reason = input.answer!.trim();
    s.phase = "done";
    return { answer: s.reason, pricing: { phase: "reason" } };
  }
  const buy = input.optionId === "yes",
    index = s.index;
  s.events.push({ phase: phase as "price" | "check", index, buy });
  if (phase === "check") {
    s.inconsistent = s.events.some((e, n) =>
      s.events
        .slice(n + 1)
        .some(
          (f) =>
            (e.index === f.index && e.buy !== f.buy) ||
            (e.index < f.index && !e.buy && f.buy) ||
            (f.index < e.index && !f.buy && e.buy),
        ),
    );
    s.phase = c.askReason ? "reason" : "done";
  } else {
    if (buy) s.low = index;
    else s.high = index;
    if (s.high - s.low === 1) {
      s.highest = s.low;
      s.index = s.start;
      s.phase = "check";
    } else s.index = buy ? index + 1 : index - 1;
  }
  i.prompt = pricingText(i, q);
  return {
    answer: `${money(c.prices[index], c.currency, i.language)} ${c.unit}: ${buy ? pricingCopy(i.language).yes : pricingCopy(i.language).no}`,
    pricing: {
      phase: phase as "price" | "check",
      priceMinor: c.prices[index],
      buy,
    },
  };
}
export function pricingResults(
  interviews: Interview[],
  attribute?: { key: string; value: string },
) {
  const groups = new Map<
    string,
    { revisionId: string; question: Question; members: Interview[] }
  >();
  for (const i of interviews.filter(
    (i) =>
      !i.preview &&
      !i.excluded &&
      !i.origin &&
      (!attribute || i.attributes[attribute.key] === attribute.value),
  ))
    for (const q of i.guide.questions.filter(
      (q) => q.type === "pricing" && q.pricing,
    )) {
      const key = JSON.stringify([
        i.revisionId,
        q.templateQuestionId || q.id,
        q.conceptId || null,
      ]);
      if (!groups.has(key))
        groups.set(key, { revisionId: i.revisionId, question: q, members: [] });
      groups.get(key)!.members.push(i);
    }
  return [...groups.values()].map(({ revisionId, question: q, members }) => {
    const c = q.pricing!,
      outcomes = members.map((i) => {
        const s = savedState(i, q);
        const status = !s
          ? "not_asked"
          : i.status !== "complete" || s.phase !== "done"
            ? "incomplete"
            : s.inconsistent
              ? "inconsistent"
              : s.highest < 0
                ? "nonbuyer"
                : "buyer";
        return {
          interviewId: i.id,
          questionId: q.id,
          status,
          highestMinor: status === "buyer" ? c.prices[s!.highest] : null,
          aboveRange: status === "buyer" && s!.highest === c.prices.length - 1,
          events:
            s?.events.map((e) => ({ ...e, priceMinor: c.prices[e.index] })) ||
            [],
          reason: s?.reason || "",
          turnIds: i.turns
            .filter((t) => t.questionId === q.id)
            .map((t) => t.id),
        };
      });
    const included = outcomes.filter(
        (o) => o.status === "buyer" || o.status === "nonbuyer",
      ),
      denominator = included.length;
    const points = c.prices.map((priceMinor) => {
      const buyers = included.filter(
        (o) => o.highestMinor !== null && o.highestMinor >= priceMinor,
      ).length;
      const observedYes = included.filter((o) =>
        o.events.some(
          (e) => e.phase === "price" && e.priceMinor === priceMinor && e.buy,
        ),
      ).length;
      const observedNo = included.filter((o) =>
        o.events.some(
          (e) => e.phase === "price" && e.priceMinor === priceMinor && !e.buy,
        ),
      ).length;
      return {
        priceMinor,
        buyers,
        denominator,
        demand: denominator ? buyers / denominator : null,
        revenuePerRespondentMinor: denominator
          ? (priceMinor * buyers) / denominator
          : null,
        observedYes,
        observedNo,
        inferredYes: buyers - observedYes,
        inferredNo: denominator - buyers - observedNo,
      };
    });
    const best = Math.max(0, ...points.map((p) => p.priceMinor * p.buyers));
    return {
      revisionId,
      questionId: q.templateQuestionId || q.id,
      conceptId: q.conceptId || null,
      prompt: q.text,
      config: c,
      counts: {
        total: members.length,
        notAsked: outcomes.filter((o) => o.status === "not_asked").length,
        incomplete: outcomes.filter((o) => o.status === "incomplete").length,
        inconsistent: outcomes.filter((o) => o.status === "inconsistent")
          .length,
        nonbuyers: included.filter((o) => o.status === "nonbuyer").length,
        aboveRange: included.filter((o) => o.aboveRange).length,
        denominator,
      },
      points,
      revenueMaxPrices: best
        ? points
            .filter((p) => p.priceMinor * p.buyers === best)
            .map((p) => p.priceMinor)
        : [],
      outcomes,
    };
  });
}
