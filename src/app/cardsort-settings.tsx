"use client";
import type { Question } from "@/lib/domain";
export default function CardsortSettings({
  question: q,
  onChange,
}: {
  question: Question;
  onChange: (patch: Partial<Question>) => void;
}) {
  const c = q.cardsort!;
  return (
    <section className="panel visual-stack">
      <h3>
        {c.mode === "open"
          ? "Open card sort"
          : c.mode === "hybrid"
            ? "Hybrid card sort"
            : "Closed card sort"}
      </h3>
      <label>
        Sort method
        <select
          aria-label="Card sort method"
          value={c.mode || "closed"}
          onChange={(e) => {
            const mode = e.target.value as "closed" | "open" | "hybrid";
            onChange({
              cardsort: {
                ...c,
                mode,
                groups:
                  mode === "open"
                    ? []
                    : c.groups.length >= 2
                      ? c.groups
                      : [
                          { id: crypto.randomUUID(), text: "Group 1" },
                          { id: crypto.randomUUID(), text: "Group 2" },
                        ],
              },
            });
          }}
        >
          <option value="closed">Closed: predefined groups</option>
          <option value="open">Open: participant-created groups</option>
          <option value="hybrid">
            Hybrid: predefined and participant-created groups
          </option>
        </select>
      </label>
      <p>
        Define cards and groups. Each card goes in one group, or an explicit
        uncertain category if enabled. Participants can revise placements and
        save a partial draft before confirming.
      </p>
      {(
        ["cards", ...(c.mode === "open" ? [] : ["groups"])] as (
          "cards" | "groups"
        )[]
      ).map((type) => (
        <fieldset className="visual-stack" key={type}>
          <legend>{type === "cards" ? "Cards" : "Groups"}</legend>
          {c[type].map((item, n) => (
            <label key={item.id}>
              {type === "cards" ? "Card" : "Group"} {n + 1}
              <div className="cardsort-edit-row">
                <input
                  aria-label={`Card sort ${type === "cards" ? "card" : "group"} ${n + 1}`}
                  value={item.text}
                  maxLength={500}
                  onChange={(e) =>
                    onChange({
                      cardsort: {
                        ...c,
                        [type]: c[type].map((x) =>
                          x.id === item.id ? { ...x, text: e.target.value } : x,
                        ),
                      },
                    })
                  }
                />
                <button
                  type="button"
                  className="button"
                  disabled={c[type].length <= (type === "cards" ? 3 : 2)}
                  onClick={() =>
                    onChange({
                      cardsort: {
                        ...c,
                        [type]: c[type].filter((x) => x.id !== item.id),
                      },
                    })
                  }
                >
                  Remove {type === "cards" ? "card" : "group"} {n + 1}
                </button>
              </div>
            </label>
          ))}
          <button
            className="button"
            disabled={c[type].length >= (type === "cards" ? 30 : 10)}
            onClick={() =>
              onChange({
                cardsort: {
                  ...c,
                  [type]: [
                    ...c[type],
                    {
                      id: crypto.randomUUID(),
                      text: `${type === "cards" ? "Card" : "Group"} ${c[type].length + 1}`,
                    },
                  ],
                },
              })
            }
          >
            Add {type === "cards" ? "card" : "group"}
          </button>
        </fieldset>
      ))}
      {(
        [
          "randomizeCards",
          "randomizeGroups",
          "allowUncertain",
          "askReason",
        ] as const
      ).map((key) => (
        <label className="check-row" key={key}>
          <input
            type="checkbox"
            checked={c[key]}
            onChange={(e) =>
              onChange({ cardsort: { ...c, [key]: e.target.checked } })
            }
          />
          {
            {
              randomizeCards: "Randomize card order per interview",
              randomizeGroups: "Randomize group order per interview",
              allowUncertain: "Allow “Not sure / doesn’t fit” placements",
              askReason:
                "Ask one optional written explanation (participants can skip)",
            }[key]
          }
        </label>
      ))}
      <p className="small muted">
        IDs remain stable when labels change. Published revisions and concept
        repeats are reported separately. Participant-created labels remain
        respondent-specific. Drag-and-drop and automated semantic clustering are
        not applied.
      </p>
    </section>
  );
}
