"use client";
import type { Guide, Question } from "@/lib/domain";
import { hasOptions, scaleFor } from "@/lib/mixed";
export default function MixedSettings({
  guide: g,
  question: q,
  index,
  onQuestion,
  onGuide,
}: {
  guide: Guide;
  question: Question;
  index: number;
  onQuestion: (patch: Partial<Question>) => void;
  onGuide: (patch: Partial<Guide>) => void;
}) {
  const scale = scaleFor(q),
    earlier = g.questions
      .slice(0, index)
      .filter(
        (s) => ["choice", "multiple"].includes(s.type) && !s.carryForward,
      ),
    first = g.questions.findIndex((s) => s.section === q.section),
    sectionSources = g.questions
      .slice(0, first)
      .filter(
        (s) => ["choice", "multiple"].includes(s.type) && !s.carryForward,
      );
  const section = g.sections?.find((s) => s.name === q.section);
  const choices = (sources: Question[]) =>
    sources.flatMap((s) =>
      s.options.map((o) => (
        <option
          key={s.id + ":" + o.id}
          value={JSON.stringify({ questionId: s.id, optionId: o.id })}
        >
          {s.text.slice(0, 50)} → {o.text}
        </option>
      )),
    );
  return (
    <div className="mixed-settings">
      {(q.type === "rating" || q.type === "matrix") && (
        <fieldset>
          <legend>Rating scale</legend>
          <div className="mixed-grid">
            {(["min", "max", "lowLabel", "highLabel"] as const).map((k) => (
              <label key={k}>
                {
                  {
                    min: "Minimum",
                    max: "Maximum",
                    lowLabel: "Low label",
                    highLabel: "High label",
                  }[k]
                }
                <input
                  type={k === "min" || k === "max" ? "number" : "text"}
                  value={scale[k]}
                  onChange={(e) =>
                    onQuestion({
                      scale: {
                        ...scale,
                        [k]:
                          k === "min" || k === "max"
                            ? Number(e.target.value)
                            : e.target.value,
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
          <small>Whole numbers; at most 11 scale points.</small>
        </fieldset>
      )}
      {q.type === "multiple" && (
        <div className="mixed-grid">
          <label>
            Minimum selections
            <input
              type="number"
              min={1}
              max={20}
              value={q.selection?.min || 1}
              onChange={(e) =>
                onQuestion({
                  selection: {
                    min: Number(e.target.value),
                    max: q.selection?.max || q.options.length || 20,
                  },
                })
              }
            />
          </label>
          <label>
            Maximum selections
            <input
              type="number"
              min={1}
              max={20}
              value={q.selection?.max || q.options.length || 20}
              onChange={(e) =>
                onQuestion({
                  selection: {
                    min: q.selection?.min || 1,
                    max: Number(e.target.value),
                  },
                })
              }
            />
          </label>
        </div>
      )}
      {hasOptions(q) && (
        <>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={!!q.randomizeOptions}
              onChange={(e) =>
                onQuestion({ randomizeOptions: e.target.checked })
              }
            />
            Randomize item order per participant
          </label>
          <label>
            Carry forward options
            <select
              value={q.carryForward?.questionId || ""}
              onChange={(e) =>
                onQuestion({
                  carryForward: e.target.value
                    ? {
                        questionId: e.target.value,
                        mode: q.carryForward?.mode || "selected",
                      }
                    : null,
                })
              }
            >
              <option value="">Use the items below</option>
              {earlier.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.text}
                </option>
              ))}
            </select>
          </label>
          {q.carryForward && (
            <>
              <label>
                Carry forward
                <select
                  value={q.carryForward.mode}
                  onChange={(e) =>
                    onQuestion({
                      carryForward: {
                        ...q.carryForward!,
                        mode: e.target.value as "selected" | "unselected",
                      },
                    })
                  }
                >
                  <option value="selected">Selected items</option>
                  <option value="unselected">Unselected items</option>
                </select>
              </label>
              <p className="muted">
                Uses source labels and IDs. If no eligible items remain, this
                question is skipped.
              </p>
            </>
          )}
        </>
      )}
      <label>
        Show section “{q.section}” when
        <select
          value={section ? JSON.stringify(section.condition) : ""}
          onChange={(e) =>
            onGuide({
              sections: [
                ...(g.sections || []).filter((s) => s.name !== q.section),
                ...(e.target.value
                  ? [{ name: q.section, condition: JSON.parse(e.target.value) }]
                  : []),
              ],
            })
          }
        >
          <option value="">Always</option>
          {choices(sectionSources)}
        </select>
      </label>
      <small>
        Applies to every question in this section. The source must precede the
        section.
      </small>
    </div>
  );
}
