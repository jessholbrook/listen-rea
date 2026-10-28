"use client";
import type { Interview, Turn } from "@/lib/domain";
import { cardsortCopy, cardsortFormValue } from "@/lib/cardsort";
export default function CardsortInput({
  interview,
  value,
  onChange,
  disabled,
  saveDraft,
}: {
  interview: Interview;
  value: Turn["value"];
  onChange: (v: Turn["value"]) => void;
  disabled: boolean;
  saveDraft: () => void;
}) {
  const p = interview.cardsortPrompt,
    c = cardsortCopy(interview.language),
    values = cardsortFormValue(p, value);
  if (!p) return null;
  return (
    <fieldset className="visual-stack" disabled={disabled}>
      <legend>{c.confirm}</legend>
      <p>
        {values.filter(Boolean).length} / {p.cards.length} {c.assigned}
      </p>
      {p.cards.map((card, n) => (
        <label className="cardsort-card" key={card.id}>
          <span>{card.text}</span>
          <select
            aria-label={card.text}
            value={values[n] || ""}
            onChange={(e) => {
              const next = [...values];
              next[n] = e.target.value;
              onChange(next);
            }}
          >
            <option value="">{c.choose}</option>
            {p.groups.map((g) => (
              <option key={g.id} value={"group:" + g.id}>
                {g.text}
              </option>
            ))}
            {p.allowUncertain && <option value="unsure">{c.uncertain}</option>}
          </select>
        </label>
      ))}
      <p className="small muted">{c.unsaved}</p>
      <button type="button" className="button" onClick={saveDraft}>
        {c.save}
      </button>
    </fieldset>
  );
}
