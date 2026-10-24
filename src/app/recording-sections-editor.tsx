"use client";
import { useState } from "react";
import {
  initialRecordingSections,
  sectionLabels,
  type RecordingSection,
} from "@/lib/recording-sections";
import type { Language } from "@/lib/localization";
export default function RecordingSectionsEditor({
  text,
  sections,
  change,
  language,
  disabled,
  play,
}: {
  text: string;
  sections: RecordingSection[] | undefined;
  change: (s: RecordingSection[] | undefined) => void;
  language: Language;
  disabled: boolean;
  play: (start: number, end: number) => void;
}) {
  const l = sectionLabels[language],
    [cursor, setCursor] = useState<{ index: number; offset: number } | null>(
      null,
    );
  const update = (index: number, value: Partial<RecordingSection>) =>
    change(sections!.map((s, n) => (n === index ? { ...s, ...value } : s)));
  return (
    <fieldset
      disabled={disabled}
      className="library-stack"
      aria-label={l.title}
    >
      <legend>{l.title}</legend>
      <p>{l.notice}</p>
      {!sections ? (
        <button
          onClick={() => change(initialRecordingSections(text.trim()))}
          disabled={disabled || !text.trim()}
        >
          {l.create}
        </button>
      ) : (
        <>
          <p>{l.warning}</p>
          <button className="secondary" onClick={() => change(undefined)}>
            {l.remove}
          </button>
          {sections.map((s, index) => (
            <section
              className="panel library-stack"
              key={`${s.start}-${s.end}`}
              aria-label={`${l.title} ${index + 1}`}
            >
              <h4>
                {index + 1} · {s.start}–{s.end}
              </h4>
              <label>
                {l.text}
                <textarea
                  aria-label={`${l.text} ${index + 1}`}
                  readOnly
                  value={text.slice(s.start, s.end)}
                  rows={3}
                  onKeyUp={(e) =>
                    setCursor({ index, offset: e.currentTarget.selectionStart })
                  }
                  onPointerUp={(e) =>
                    setCursor({ index, offset: e.currentTarget.selectionStart })
                  }
                  onSelect={(e) =>
                    setCursor({ index, offset: e.currentTarget.selectionStart })
                  }
                />
              </label>
              <label>
                {l.speaker}
                <input
                  aria-label={`${l.speaker} ${index + 1}`}
                  maxLength={80}
                  value={s.speaker}
                  onChange={(e) => update(index, { speaker: e.target.value })}
                />
              </label>
              <label>
                {l.start}
                <input
                  aria-label={`${l.start} ${index + 1}`}
                  type="number"
                  min={0}
                  step={0.001}
                  value={s.startMs === null ? "" : s.startMs / 1000}
                  onChange={(e) =>
                    update(index, {
                      startMs:
                        e.target.value === ""
                          ? null
                          : Math.round(Number(e.target.value) * 1000),
                    })
                  }
                />
              </label>
              <label>
                {l.end}
                <input
                  aria-label={`${l.end} ${index + 1}`}
                  type="number"
                  min={0}
                  step={0.001}
                  value={s.endMs === null ? "" : s.endMs / 1000}
                  onChange={(e) =>
                    update(index, {
                      endMs:
                        e.target.value === ""
                          ? null
                          : Math.round(Number(e.target.value) * 1000),
                    })
                  }
                />
              </label>
              <button
                className="secondary"
                disabled={
                  disabled ||
                  s.startMs === null ||
                  s.endMs === null ||
                  s.endMs <= s.startMs
                }
                onClick={() => play(s.startMs!, s.endMs!)}
              >
                {l.play}
              </button>
              <button
                className="secondary"
                disabled={
                  disabled ||
                  sections.length >= 200 ||
                  cursor?.index !== index ||
                  !cursor.offset ||
                  cursor.offset >= s.end - s.start
                }
                onClick={() => {
                  const at = s.start + cursor!.offset;
                  if (
                    /[\uD800-\uDBFF]/.test(text[at - 1]) ||
                    !text.slice(s.start, at).trim() ||
                    !text.slice(at, s.end).trim()
                  )
                    return;
                  change([
                    ...sections.slice(0, index),
                    { ...s, end: at, startMs: null, endMs: null },
                    { ...s, start: at, startMs: null, endMs: null },
                    ...sections.slice(index + 1),
                  ]);
                  setCursor(null);
                }}
              >
                {l.split}
              </button>
              {index < sections.length - 1 && (
                <button
                  className="secondary"
                  disabled={
                    disabled || sections[index + 1].end - s.start > 12000
                  }
                  onClick={() => {
                    change([
                      ...sections.slice(0, index),
                      {
                        ...s,
                        end: sections[index + 1].end,
                        startMs: null,
                        endMs: null,
                      },
                      ...sections.slice(index + 2),
                    ]);
                    setCursor(null);
                  }}
                >
                  {l.merge}
                </button>
              )}
            </section>
          ))}
        </>
      )}
    </fieldset>
  );
}
