"use client";
import AnswerOptionImage from "./answer-option-image";
import EmotionInput from "./emotion-input";
import { copy } from "@/lib/participant-copy";
import { scaleLabels } from "@/lib/localization";

import type { Interview, Question, Turn } from "@/lib/domain";
import { optionsFor, scaleFor } from "@/lib/mixed";
export default function MixedInput({
  interview,
  question: q,
  value,
  onChange,
  disabled,
  token = "",
}: {
  interview: Interview;
  question: Question;
  value: Turn["value"];
  onChange: (v: Turn["value"]) => void;
  disabled: boolean;
  token?: string;
}) {
  const t = (text: string) => copy(interview.language || "en", text);
  const options = optionsFor(interview, q),
    scale = q.scale || {
      ...scaleFor(q),
      ...scaleLabels(interview.language || "en"),
    },
    points = Array.from(
      { length: scale.max - scale.min + 1 },
      (_, n) => n + scale.min,
    );
  if (q.type === "emotion")
    return (
      <EmotionInput
        value={value}
        onChange={onChange}
        disabled={disabled}
        language={
          interview.language ||
          interview.guide.localization?.sourceLanguage ||
          "en"
        }
      />
    );
  if (q.type === "rating")
    return (
      <fieldset className="mixed-input" disabled={disabled}>
        <legend>{t("Your rating")} </legend>
        <div className="rating-points">
          {points.map((n) => (
            <label key={n} className={value === n ? "selected" : ""}>
              <input
                type="radio"
                name="rating"
                checked={value === n}
                onChange={() => onChange(n)}
              />
              {n}
            </label>
          ))}
        </div>
        <div className="scale-labels">
          <span>{scale.lowLabel}</span>
          <span>{scale.highLabel}</span>
        </div>
      </fieldset>
    );
  if (q.type === "matrix") {
    const cells = (
      value && typeof value === "object" && !Array.isArray(value) ? value : {}
    ) as Record<string, number>;
    return (
      <fieldset className="mixed-input" disabled={disabled}>
        <legend>{t("Rate each item")} </legend>
        <p className="muted">
          {scale.min}: {scale.lowLabel} · {scale.max}: {scale.highLabel}
        </p>
        {options.map((o) => (
          <label className="matrix-row" key={o.id}>
            {o.text}
            <select
              aria-label={o.text}
              value={cells[o.id] ?? ""}
              onChange={(e) => {
                const next = { ...cells };
                if (e.target.value === "") delete next[o.id];
                else next[o.id] = Number(e.target.value);
                onChange(next);
              }}
            >
              <option value="">{t("Choose a rating")} </option>
              {points.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>
    );
  }
  const ids = Array.isArray(value) ? value : [];
  if (q.type === "multiple")
    return (
      <fieldset className="mixed-input participant-options" disabled={disabled}>
        <legend>
          {`${t("Select")} ${q.selection?.min || 1}–${Math.min(q.selection?.max || options.length, options.length)} ${t("options")}`}
        </legend>
        {options.map((o) => (
          <div className="answer-option" key={o.id}>
            <label className={ids.includes(o.id) ? "chosen" : ""}>
              <input
                type="checkbox"
                checked={ids.includes(o.id)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...ids, o.id]
                      : ids.filter((id) => id !== o.id),
                  )
                }
              />
              {o.text}
            </label>
            <AnswerOptionImage option={o} interview={interview} token={token} />
          </div>
        ))}
      </fieldset>
    );
  return (
    <fieldset className="mixed-input" disabled={disabled}>
      <legend>{t("Rank every item, highest priority first")} </legend>
      {options.some((o) => o.imageAssetId) && (
        <div className="ranking-image-options">
          {options.map((o) => (
            <div className="answer-option" key={o.id}>
              <p>{o.text}</p>
              <AnswerOptionImage
                option={o}
                interview={interview}
                token={token}
              />
              <button
                type="button"
                className="button secondary"
                disabled={ids.includes(o.id)}
                onClick={() => onChange([...ids, o.id])}
              >
                {t("Add the next item")}: {o.text}
                {ids.includes(o.id) ? ` (${ids.indexOf(o.id) + 1})` : ""}
              </button>
            </div>
          ))}
        </div>
      )}
      <label>
        {t("Add the next item")}{" "}
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onChange([...ids, e.target.value]);
          }}
        >
          <option value="">{t("Choose an item")} </option>
          {options
            .filter((o) => !ids.includes(o.id))
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.text}
              </option>
            ))}
        </select>
      </label>
      <ol className="ranking-list">
        {ids.map((id, n) => (
          <li key={id}>
            <span>{options.find((o) => o.id === id)?.text}</span>
            <button
              type="button"
              className="text-button"
              aria-label={t("Move ") + (n + 1) + t(" up")}
              disabled={n === 0}
              onClick={() => {
                const next = [...ids];
                [next[n], next[n - 1]] = [next[n - 1], next[n]];
                onChange(next);
              }}
            >
              ↑
            </button>
            <button
              type="button"
              className="text-button"
              aria-label={t("Move ") + (n + 1) + t(" down")}
              disabled={n === ids.length - 1}
              onClick={() => {
                const next = [...ids];
                [next[n], next[n + 1]] = [next[n + 1], next[n]];
                onChange(next);
              }}
            >
              ↓
            </button>
            <button
              type="button"
              className="text-button"
              aria-label={t("Remove rank ") + (n + 1)}
              onClick={() => onChange(ids.filter((x) => x !== id))}
            >
              {t("Remove")}{" "}
            </button>
          </li>
        ))}
      </ol>
      <small>{`${ids.length} ${t("of")} ${options.length} ${t("ranked")}`}</small>
    </fieldset>
  );
}
