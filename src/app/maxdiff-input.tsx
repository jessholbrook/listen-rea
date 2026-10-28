"use client";
import AnswerOptionImage from "./answer-option-image";
import type { Interview, Turn } from "@/lib/domain";
import { maxdiffCopy } from "@/lib/maxdiff";
export default function MaxdiffInput({
  interview,
  value,
  onChange,
  disabled,
  token,
}: {
  interview: Interview;
  value: Turn["value"];
  onChange: (v: Turn["value"]) => void;
  disabled: boolean;
  token: string;
}) {
  const p = interview.maxdiffPrompt,
    c = maxdiffCopy(interview.language),
    ids = Array.isArray(value) ? value : [];
  if (!p) return null;
  return (
    <fieldset disabled={disabled} className="visual-stack">
      <legend>{c.choose}</legend>
      {p.items.map((item) => (
        <div className="maxdiff-item answer-option" key={item.id}>
          <p>{item.text}</p>
          <AnswerOptionImage
            option={item}
            interview={interview}
            token={token}
          />
          <div className="panel-actions">
            <label className="check-row">
              <input
                type="radio"
                name="maxdiff-best"
                aria-label={`${c.best}: ${item.text}`}
                checked={ids[0] === item.id}
                onChange={() =>
                  onChange([item.id, ids[1] === item.id ? "" : ids[1] || ""])
                }
              />
              {c.best}
            </label>
            <label className="check-row">
              <input
                type="radio"
                name="maxdiff-worst"
                aria-label={`${c.worst}: ${item.text}`}
                checked={ids[1] === item.id}
                onChange={() =>
                  onChange([ids[0] === item.id ? "" : ids[0] || "", item.id])
                }
              />
              {c.worst}
            </label>
          </div>
        </div>
      ))}
    </fieldset>
  );
}
