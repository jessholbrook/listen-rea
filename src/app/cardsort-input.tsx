"use client";
import { useState } from "react";
import { categoryCopy } from "@/lib/cardsort";
import type { Interview, Turn } from "@/lib/domain";
import { cardsortCopy, cardsortFormValue } from "@/lib/cardsort";
export default function CardsortInput({
  interview,
  value,
  onChange,
  disabled,
  saveDraft,
  manageGroups,
}: {
  interview: Interview;
  value: Turn["value"];
  onChange: (v: Turn["value"]) => void;
  disabled: boolean;
  saveDraft: () => void;
  manageGroups?: (input: {
    op: "add" | "rename" | "remove";
    id?: string;
    text?: string;
  }) => Promise<void>;
}) {
  const [newName, setNewName] = useState(""),
    [renames, setRenames] = useState<Record<string, string>>({});
  const copy = categoryCopy[interview.language || "en"];
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
      {p.mode && manageGroups && (
        <section className="visual-stack">
          <p>{copy.notice}</p>
          <label>
            {copy.newName}
            <input
              aria-label={copy.newName}
              value={newName}
              maxLength={100}
              onChange={(e) => setNewName(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={!newName.trim() || (p.customGroups?.length || 0) >= 10}
            onClick={() =>
              void manageGroups({ op: "add", text: newName })
                .then(() => setNewName(""))
                .catch(() => {})
            }
          >
            {copy.add}
          </button>
          {p.customGroups?.map((g) => (
            <div className="library-stack" key={g.id}>
              <label>
                {copy.label}
                <input
                  aria-label={copy.label + " " + g.text}
                  maxLength={100}
                  value={renames[g.id] ?? g.text}
                  onChange={(e) =>
                    setRenames((v) => ({ ...v, [g.id]: e.target.value }))
                  }
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  void manageGroups({
                    op: "rename",
                    id: g.id,
                    text: renames[g.id] ?? g.text,
                  }).catch(() => {})
                }
              >
                {copy.rename} {g.text}
              </button>
              <button
                type="button"
                onClick={() =>
                  void manageGroups({ op: "remove", id: g.id }).catch(() => {})
                }
              >
                {copy.remove} {g.text}
              </button>
            </div>
          ))}
        </section>
      )}
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
