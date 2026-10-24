"use client";
import type { Guide } from "@/lib/domain";
import { useRef, useState } from "react";
import ConceptImageUpload from "./concept-image-upload";
import ConceptImageLibrary from "./concept-image-library";
import ConceptVideoUpload from "./concept-video-upload";
import ConceptVideoLibrary from "./concept-video-library";
export default function ConceptEditor({
  studyId,
  guide: g,
  onChange,
  onBusy,
}: {
  studyId: string;
  guide: Guide;
  onChange: (patch: Partial<Guide>) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const config = g.conceptTest;
  const [uploading, setUploading] = useState(false);
  const latest = useRef({ config, onChange });
  latest.current = { config, onChange };
  const make = (n: number) => ({
    id: crypto.randomUUID(),
    name: "Concept " + n,
    headline: "Concept " + n,
    description: "Describe the idea participants will evaluate.",
    imageUrl: null,
    imageAlt: "",
  });
  const update = (patch: Partial<NonNullable<Guide["conceptTest"]>>) =>
    latest.current.onChange({
      conceptTest: { ...latest.current.config!, ...patch },
    });
  return (
    <section className="concept-editor">
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={!!config}
          disabled={uploading}
          onChange={(e) => {
            if (e.target.checked) {
              const start = g.questions.findIndex(
                (q) => !q.options.some((o) => o.rejects),
              );
              onChange({
                conceptTest: {
                  concepts: [make(1), make(2)],
                  count: 1,
                  randomizeOrder: true,
                },
                questions: g.questions.map((q, n) => ({
                  ...q,
                  conceptQuestion: start >= 0 && n >= start,
                })),
              });
            } else
              onChange({
                conceptTest: null,
                questions: g.questions.map((q) => ({
                  ...q,
                  conceptQuestion: false,
                })),
              });
          }}
        />
        Concept testing
      </label>
      {config && (
        <fieldset className="concept-image-controls" disabled={uploading}>
          <p className="muted">
            Each participant receives a random subset. Mark one consecutive
            block of questions to repeat for each assigned concept. Keep
            screeners outside that block.
          </p>
          <label>
            Concepts per participant
            <select
              value={config.count}
              onChange={(e) => update({ count: Number(e.target.value) })}
            >
              {Array.from(
                { length: Math.min(5, config.concepts.length) },
                (_, n) => (
                  <option key={n} value={n + 1}>
                    {n + 1}
                  </option>
                ),
              )}
            </select>
          </label>
          {config.count > 1 && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.randomizeOrder}
                onChange={(e) => update({ randomizeOrder: e.target.checked })}
              />
              Randomize presentation order
            </label>
          )}
          {config.concepts.map((c, n) => (
            <fieldset className="concept-config" key={c.id}>
              <legend>Concept {n + 1}</legend>
              <label>
                Presentation mode
                <select
                  aria-label="Presentation mode"
                  value={
                    c.videoOnce ? "once" : c.exposureSeconds ? "timed" : "self"
                  }
                  onChange={(e) =>
                    update({
                      concepts: config.concepts.map((x) =>
                        x.id === c.id
                          ? {
                              ...x,
                              exposureSeconds:
                                e.target.value === "timed" ? 10 : null,
                              videoOnce: e.target.value === "once",
                            }
                          : x,
                      ),
                    })
                  }
                >
                  <option value="self">Self-paced</option>
                  <option value="once" disabled={!c.videoAssetId}>
                    Watch video once, then answer
                  </option>
                  <option value="timed">Timed review, then answer</option>
                </select>
              </label>
              {c.exposureSeconds !== null &&
                c.exposureSeconds !== undefined && (
                  <label>
                    Exposure seconds
                    <input
                      type="number"
                      min={1}
                      max={300}
                      step={1}
                      value={c.exposureSeconds}
                      onChange={(e) =>
                        update({
                          concepts: config.concepts.map((x) =>
                            x.id === c.id
                              ? {
                                  ...x,
                                  exposureSeconds: Number(e.target.value),
                                }
                              : x,
                          ),
                        })
                      }
                    />
                  </label>
                )}
              {c.videoOnce && (
                <p className="small muted">
                  One explicit start per concept, with pause/resume but no
                  replay controls. Loading and pauses count toward video length
                  plus two minutes. Reloads do not restart the view.
                  Participants may continue without video or choose replayable
                  viewing; both choices are saved. Use a text alternative that
                  covers important visuals and speech.
                </p>
              )}
              {c.exposureSeconds && (
                <p className="small muted">
                  The concept hides after this server-timed window. Reloads and
                  background tabs do not reset it. Participants can switch to an
                  untimed view; that choice is saved. External prototype links
                  require self-paced presentation. Loading media consumes part
                  of the window.
                </p>
              )}
              {(
                [
                  "name",
                  "headline",
                  "description",
                  "imageUrl",
                  "imageAlt",
                  "prototypeUrl",
                  "taskInstructions",
                  "videoTranscript",
                ] as const
              ).map((key) =>
                key === "imageUrl" && c.imageAssetId ? null : (
                  <label key={key}>
                    {
                      {
                        name: "Researcher label",
                        headline: "Participant headline",
                        description: "Concept description",
                        imageUrl: "Image URL (optional)",
                        imageAlt: "Image description",
                        prototypeUrl: "Prototype URL (optional)",
                        taskInstructions: "Task instructions",
                        videoTranscript:
                          "Video text alternative (speech and important visuals)",
                      }[key]
                    }
                    {key === "description" ||
                    key === "taskInstructions" ||
                    key === "videoTranscript" ? (
                      <textarea
                        aria-label={
                          key === "videoTranscript"
                            ? "Video text alternative (speech and important visuals)"
                            : key === "taskInstructions"
                              ? "Task instructions"
                              : "Concept description"
                        }
                        rows={4}
                        value={c[key] || ""}
                        maxLength={key === "taskInstructions" ? 4000 : 6000}
                        onChange={(e) =>
                          update({
                            concepts: config.concepts.map((x) =>
                              x.id === c.id
                                ? { ...x, [key]: e.target.value }
                                : x,
                            ),
                          })
                        }
                      />
                    ) : (
                      <input
                        type={
                          key === "imageUrl" || key === "prototypeUrl"
                            ? "url"
                            : "text"
                        }
                        value={c[key] || ""}
                        onChange={(e) =>
                          update({
                            concepts: config.concepts.map((x) =>
                              x.id === c.id
                                ? {
                                    ...x,
                                    [key]:
                                      key === "imageUrl" ||
                                      key === "prototypeUrl"
                                        ? e.target.value || null
                                        : e.target.value,
                                  }
                                : x,
                            ),
                          })
                        }
                      />
                    )}
                  </label>
                ),
              )}
              <ConceptImageUpload
                studyId={studyId}
                assetId={c.imageAssetId}
                alt={c.imageAlt || c.headline}
                onBusy={(busy) => {
                  setUploading(busy);
                  onBusy?.(busy);
                }}
                onImage={(id) => {
                  const current = latest.current.config;
                  if (!current) return;
                  update({
                    concepts: current.concepts.map((x) =>
                      x.id === c.id
                        ? {
                            ...x,
                            imageAssetId: id,
                            imageUrl: id ? null : x.imageUrl,
                            imageAlt: id
                              ? x.imageAlt || x.headline
                              : x.imageAlt,
                          }
                        : x,
                    ),
                  });
                }}
              />
              <ConceptVideoUpload
                studyId={studyId}
                assetId={c.videoAssetId}
                alt={c.headline}
                onBusy={(busy) => {
                  setUploading(busy);
                  onBusy?.(busy);
                }}
                onVideo={(id) => {
                  const current = latest.current.config;
                  if (current)
                    update({
                      concepts: current.concepts.map((x) =>
                        x.id === c.id
                          ? {
                              ...x,
                              videoAssetId: id,
                              ...(!id
                                ? { videoTranscript: "", videoOnce: false }
                                : {}),
                            }
                          : x,
                      ),
                    });
                }}
              />
              <p className="small muted">
                MP4 or WebM, up to 3 MB and 60 seconds. Add a text alternative
                covering speech and important visuals before saving. Videos use
                participant-controlled playback.
              </p>
              {c.prototypeUrl && (
                <div className="prototype-editor-note">
                  <p className="small muted">
                    Participants open this HTTPS link in a new tab and return
                    here to answer. Check the prototype’s sharing permissions
                    before publishing. Echo Lab does not record activity inside
                    it.
                  </p>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      update({
                        concepts: config.concepts.map((x) =>
                          x.id === c.id
                            ? { ...x, prototypeUrl: null, taskInstructions: "" }
                            : x,
                        ),
                      })
                    }
                  >
                    Remove prototype and task
                  </button>
                </div>
              )}
              <button
                type="button"
                className="text-button"
                disabled={config.concepts.length <= 2}
                onClick={() => {
                  const concepts = config.concepts.filter((x) => x.id !== c.id);
                  update({
                    concepts,
                    count: Math.min(config.count, concepts.length),
                  });
                }}
              >
                Remove concept {n + 1}
              </button>
            </fieldset>
          ))}
          <p className="input-note">
            Upload PNG, JPEG or WebP up to 2 MB, or use an HTTPS image link.
            Uploaded images stay private and are resized to fit 1600 × 1600
            pixels. Provide an image description, then save and publish the
            guide.
          </p>
          <button
            type="button"
            className="button"
            disabled={config.concepts.length >= 10}
            onClick={() =>
              update({
                concepts: [
                  ...config.concepts,
                  make(config.concepts.length + 1),
                ],
              })
            }
          >
            Add concept
          </button>
          <ConceptImageLibrary
            studyId={studyId}
            usedIds={[
              ...config.concepts.flatMap((c) =>
                c.imageAssetId ? [c.imageAssetId] : [],
              ),
              ...g.questions.flatMap((q) =>
                [...q.options, ...(q.maxdiff?.items || [])].flatMap((o) =>
                  o.imageAssetId ? [o.imageAssetId] : [],
                ),
              ),
            ]}
            refreshKey={JSON.stringify([
              config.concepts.map((c) => c.imageAssetId),
              g.questions.map((q) =>
                [...q.options, ...(q.maxdiff?.items || [])].map(
                  (o) => o.imageAssetId,
                ),
              ),
            ])}
          />
          <ConceptVideoLibrary
            studyId={studyId}
            usedIds={config.concepts.flatMap((c) =>
              c.videoAssetId ? [c.videoAssetId] : [],
            )}
            refreshKey={config.concepts
              .map((c) => c.videoAssetId || "")
              .join(",")}
          />
        </fieldset>
      )}
    </section>
  );
}
