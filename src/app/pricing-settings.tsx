"use client";
import { useState } from "react";
import type { Question } from "@/lib/domain";
export default function PricingSettings({
  question: q,
  onChange,
}: {
  question: Question;
  onChange: (patch: Partial<Question>) => void;
}) {
  const c = q.pricing!;
  const [text, setText] = useState(
      c.prices.map((p) => (p / 100).toFixed(2)).join(", "),
    ),
    [error, setError] = useState("");
  return (
    <section className="panel visual-stack">
      <h3>Gabor–Granger price ladder</h3>
      <p>
        Describe one product or offer in the question wording. Prices are
        ascending; each participant starts at a saved random price and sees one
        price at a time, then a repeated starting-price check.
      </p>
      <label>
        Currency
        <select
          value={c.currency}
          onChange={(e) =>
            onChange({
              pricing: { ...c, currency: e.target.value as typeof c.currency },
            })
          }
        >
          <option>USD</option>
          <option>EUR</option>
          <option>GBP</option>
        </select>
      </label>
      <label>
        Price unit
        <input
          value={c.unit}
          maxLength={100}
          onChange={(e) =>
            onChange({ pricing: { ...c, unit: e.target.value } })
          }
        />
      </label>
      <label>
        Prices (comma separated)
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const parts = e.target.value.split(",").map((p) => p.trim());
            const prices = parts.map((p) => Math.round(Number(p) * 100));
            if (
              parts.length < 3 ||
              parts.length > 12 ||
              parts.some((p) => !/^\d+(?:\.\d{1,2})?$/.test(p)) ||
              prices.some(
                (p, n) =>
                  p < 1 || p > 100000000 || (n > 0 && p <= prices[n - 1]),
              )
            ) {
              onChange({ pricing: { ...c, prices: [] } });
              setError(
                "Enter 3–12 increasing positive prices, each with at most two decimal places. Fix this list before saving or publishing.",
              );
            } else {
              setError("");
              onChange({ pricing: { ...c, prices } });
            }
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <p className="small muted">
        Configured ladder:{" "}
        {c.prices.map((p) => (p / 100).toFixed(2)).join(", ")} {c.currency}.
        Researcher edits affect new published revisions; existing interviews
        retain their saved ladder.
      </p>
      <label className="check-row">
        <input
          type="checkbox"
          checked={c.askReason}
          onChange={(e) =>
            onChange({ pricing: { ...c, askReason: e.target.checked } })
          }
        />
        Ask one optional written reason after the ladder (participants can
        skip).
      </label>
      <p className="small muted">
        Nonbuyers stay in the denominator. Incomplete ladders and inconsistent
        checks are reported separately. Demand assumes willingness decreases as
        price rises. These are stated intentions, not forecasts or observed
        purchases.
      </p>
    </section>
  );
}
