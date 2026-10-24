"use client";
import type { Turn } from "@/lib/domain";
import type { Language } from "@/lib/localization";
import { feelings, emotionCopy } from "@/lib/emotion";
export default function EmotionInput({
  value,
  onChange,
  disabled,
  language,
}: {
  value: Turn["value"];
  onChange: (v: Turn["value"]) => void;
  disabled: boolean;
  language: Language;
}) {
  const v = Array.isArray(value) ? value : ["", "", ""],
    w = emotionCopy(language),
    declined = v[0] === "prefer_not_to_answer";
  return (
    <fieldset className="mixed-input emotion-input" disabled={disabled}>
      <legend>{w.title}</legend>
      <p>{w.optional}</p>
      <div className="participant-options">
        {feelings.map((f) => (
          <label key={f} className={v[0] === f ? "chosen" : ""}>
            <input
              type="radio"
              name="feeling"
              checked={v[0] === f}
              onChange={() =>
                onChange([
                  f,
                  f === "neutral" || f === "prefer_not_to_answer"
                    ? ""
                    : v[1] || "",
                  f === "prefer_not_to_answer" ? "" : v[2] || "",
                ])
              }
            />
            {w.labels[f]}
          </label>
        ))}
      </div>
      {!!v[0] && !declined && (
        <div className="visual-stack">
          {v[0] !== "neutral" && (
            <label>
              {w.intensity}
              <select
                aria-label={w.intensity}
                value={v[1] || ""}
                onChange={(e) => onChange([v[0], e.target.value, v[2] || ""])}
              >
                <option value="">{w.unspecified}</option>
                {w.levels.map((s, n) => (
                  <option key={n} value={String(n + 1)}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            {w.note}
            <textarea
              aria-label={w.note}
              maxLength={2000}
              value={v[2] || ""}
              onChange={(e) => onChange([v[0], v[1] || "", e.target.value])}
            />
          </label>
        </div>
      )}
    </fieldset>
  );
}
