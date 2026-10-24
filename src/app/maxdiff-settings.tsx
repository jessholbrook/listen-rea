"use client";
import ConceptImageUpload from "./concept-image-upload";
import type { Question } from "@/lib/domain";
import { maxdiffDesign, designDiagnostics } from "@/lib/maxdiff";
export default function MaxdiffSettings({
  question: q,
  onChange,
  studyId,
  onBusy,
  onImage,
}: {
  question: Question;
  onChange: (patch: Partial<Question>) => void;
  studyId: string;
  onBusy: (id: string, busy: boolean) => void;
  onImage: (id: string, assetId: string | null) => void;
}) {
  const c = q.maxdiff!;
  let diagnostic: ReturnType<typeof designDiagnostics> | undefined;
  try {
    diagnostic = designDiagnostics(
      maxdiffDesign(c.items.length, c.setSize, c.cycles),
      c.items.length,
    );
  } catch {}
  return (
    <section className="panel visual-stack">
      <h3>MaxDiff choice tasks</h3>
      <p>
        Use the question wording to describe the comparison, such as which
        product features matter most. Participants select one most important and
        one least important item per task.
      </p>
      {c.items.map((item, n) => (
        <div className="maxdiff-item-editor" key={q.id + ":" + item.id}>
          <label>
            MaxDiff item {n + 1}
            <div className="input-row">
              <input
                aria-label={`MaxDiff item ${n + 1}`}
                value={item.text}
                maxLength={500}
                onChange={(e) =>
                  onChange({
                    maxdiff: {
                      ...c,
                      items: c.items.map((x) =>
                        x.id === item.id ? { ...x, text: e.target.value } : x,
                      ),
                    },
                  })
                }
              />
              <button
                type="button"
                className="button"
                disabled={c.items.length <= 4}
                onClick={() =>
                  onChange({
                    maxdiff: {
                      ...c,
                      items: c.items.filter((x) => x.id !== item.id),
                      setSize: Math.min(c.setSize, c.items.length - 2),
                    },
                  })
                }
              >
                Remove item {n + 1}
              </button>
            </div>
          </label>
          <details className="answer-image-editor">
            <summary>
              Answer image for MaxDiff item {n + 1}
              {item.imageAssetId ? " · Uploaded" : ""}
            </summary>
            <p className="small muted">
              Optional private PNG, JPEG or WebP, up to 2 MB. Keep a distinct
              label and describe what participants need to compare.
            </p>
            <ConceptImageUpload
              studyId={studyId}
              assetId={item.imageAssetId}
              alt={item.imageAlt || item.text}
              purpose="answer"
              onBusy={(busy) => onBusy(item.id, busy)}
              onImage={(id) => onImage(item.id, id)}
            />
            {item.imageAssetId && (
              <label>
                Answer image description
                <textarea
                  aria-label="Answer image description"
                  maxLength={500}
                  value={item.imageAlt || ""}
                  onChange={(e) =>
                    onChange({
                      maxdiff: {
                        ...c,
                        items: c.items.map((x) =>
                          x.id === item.id
                            ? { ...x, imageAlt: e.target.value }
                            : x,
                        ),
                      },
                    })
                  }
                />
              </label>
            )}
          </details>
        </div>
      ))}
      <button
        className="button"
        disabled={c.items.length >= 12}
        onClick={() =>
          onChange({
            maxdiff: {
              ...c,
              items: [
                ...c.items,
                { id: crypto.randomUUID(), text: `Item ${c.items.length + 1}` },
              ],
            },
          })
        }
      >
        Add MaxDiff item
      </button>
      <label>
        Items per task
        <select
          aria-label="Items per MaxDiff task"
          value={c.setSize}
          onChange={(e) =>
            onChange({ maxdiff: { ...c, setSize: Number(e.target.value) } })
          }
        >
          {[3, 4, 5]
            .filter((n) => n < c.items.length)
            .map((n) => (
              <option key={n}>{n}</option>
            ))}
        </select>
      </label>
      <label>
        Design cycles
        <select
          aria-label="MaxDiff design cycles"
          value={c.cycles}
          onChange={(e) =>
            onChange({
              maxdiff: { ...c, cycles: Number(e.target.value) as 1 | 2 },
            })
          }
        >
          <option value={1}>One</option>
          <option value={2}>Two</option>
        </select>
      </label>
      {diagnostic && (
        <p className="small">
          {c.items.length * c.cycles} tasks per person · {c.setSize * c.cycles}{" "}
          appearances per item · connected comparisons · pair co-occurrences{" "}
          {diagnostic.pairMin}–{diagnostic.pairMax}. Item mapping, task order
          and display positions are randomized and saved for each interview.
        </p>
      )}
      <p className="small muted">
        Results include descriptive counts and a separate pooled best–worst
        logit fit. This release does not implement Hierarchical Bayes,
        individual utilities or portfolio optimization. Use distinct labels with
        comparable scope.
      </p>
    </section>
  );
}
