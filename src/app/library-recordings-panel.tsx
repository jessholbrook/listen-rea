"use client";
import BackgroundJobsPanel from "./background-jobs-panel";
import { useEffect, useRef, useState } from "react";
import { uploadRecordingParts } from "@/lib/library-recording-upload-client";
import RecordingBatchPanel from "./recording-batch-panel";
import RecordingSectionsEditor from "./recording-sections-editor";
import {
  sectionLabels,
  recordingRangeLabel,
  type RecordingSection,
} from "@/lib/recording-sections";
import { api } from "@/lib/client";
import {
  recordingLabels,
  recordingView,
  maxImportBytes,
  maxImportTranscript,
  type LibraryRecording,
} from "@/lib/library-recordings";
import { languages, languageNames, type Language } from "@/lib/localization";
import { Notice } from "./components";
type Detail = ReturnType<typeof recordingView>;
type Row = Pick<
  Detail,
  "id" | "title" | "studyId" | "status" | "version" | "interviewId"
>;
export default function LibraryRecordingsPanel({
  studies,
  openResponse,
}: {
  studies: { id: string; title: string }[];
  openResponse: (id: string) => Promise<void>;
}) {
  const [language, setLanguage] = useState<Language>("en"),
    [studyId, setStudyId] = useState(studies[0]?.id || ""),
    [title, setTitle] = useState(""),
    [externalId, setExternalId] = useState(""),
    [permission, setPermission] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [rows, setRows] = useState<Row[]>([]),
    [selected, setSelected] = useState<Detail | null>(null),
    [text, setText] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [sections, setSections] = useState<RecordingSection[] | undefined>(
      undefined,
    ),
    [canEdit, setCanEdit] = useState(false),
    [working, setBusy] = useState(false),
    [batchBusy, setBatchBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState("");
  const busy = working || batchBusy;
  const l = recordingLabels[language],
    player = useRef<HTMLMediaElement | null>(null),
    playUntil = useRef<number | null>(null),
    pause = useRef(false),
    epoch = useRef(0),
    controller = useRef<AbortController | null>(null),
    request = useRef<{ signature: string; id: string } | null>(null);
  function reset() {
    epoch.current++;
    controller.current?.abort();
    setBusy(false);
    setError("");
    setProgress("");
  }
  function populate(r: Detail) {
    setSections(r.history?.at(-1)?.sections);
    setSelected(r);
    setText(r.history?.at(-1)?.text || "");
    setReviewed(r.history?.at(-1)?.reviewed || false);
  }
  async function loadLists(signal?: AbortSignal) {
    return api<{ recordings: Row[]; canEdit: boolean }>(
      "library/recordings",
      "GET",
      undefined,
      undefined,
      signal,
    );
  }
  async function run(
    action: (signal: AbortSignal, generation: number) => Promise<void>,
  ) {
    reset();
    const generation = ++epoch.current,
      c = new AbortController();
    controller.current = c;
    setBusy(true);
    try {
      await action(c.signal, generation);
    } catch (e) {
      if (epoch.current === generation) {
        setError((e as Error).message);
      }
    } finally {
      if (epoch.current === generation) setBusy(false);
    }
  }
  async function refresh() {
    await run(async (signal, g) => {
      const list = await loadLists(signal),
        r = selected
          ? await api<{ recording: Detail }>(
              "library/recordings/" + selected.id,
              "GET",
              undefined,
              undefined,
              signal,
            )
          : null;
      if (epoch.current === g) {
        setRows(list.recordings);
        setCanEdit(list.canEdit);
        if (r) populate(r.recording);
      }
    });
  }
  useEffect(() => {
    void refresh();
    return () => {
      epoch.current++;
      controller.current?.abort();
    };
  }, [language, studies]);
  async function uploadParts(
    r: Detail,
    source: File,
    signal: AbortSignal,
    g: number,
  ) {
    return uploadRecordingParts(r, source, signal, (next) => {
      if (epoch.current === g) {
        populate(next);
        setProgress(
          `${l.progress}: ${next.upload!.parts.filter((p) => p.digest).length}/${next.upload!.parts.length}`,
        );
      }
    });
  }
  async function resumeUpload(source: File) {
    await run(async (signal, g) => {
      const r = await uploadParts(selected!, source, signal, g),
        list = await loadLists(signal);
      if (epoch.current === g) {
        populate(r);
        setRows(list.recordings);
      }
    });
  }
  async function upload() {
    await run(async (signal, g) => {
      const signature = JSON.stringify({
        studyId,
        title,
        externalId,
        language,
        name: file!.name,
        size: file!.size,
        modified: file!.lastModified,
      });
      if (request.current?.signature !== signature)
        request.current = { signature, id: crypto.randomUUID() };
      let r = await api<{ recording: Detail }>(
        "library/recordings",
        "POST",
        {
          requestId: request.current!.id,
          studyId,
          title,
          externalId,
          language,
          permissionConfirmed: permission,
          transcriptionPermission: permission,
        },
        undefined,
        signal,
      );
      r = { recording: await uploadParts(r.recording, file!, signal, g) };
      const list = await loadLists(signal);
      if (epoch.current === g) {
        populate(r.recording);
        setRows(list.recordings);
      }
    });
  }
  async function transcribeJob() {
    pause.current = false;
    await run(async (signal, g) => {
      let r = selected!;
      do {
        r = (
          await api<{ recording: Detail }>(
            "library/recordings/" + r.id + "/transcribe",
            "POST",
            { version: r.version, permissionConfirmed: true },
            undefined,
            signal,
          )
        ).recording;
        if (epoch.current === g) {
          populate(r);
          setProgress(
            `${l.progress}: ${r.job ? `${r.job.completed}/${r.job.total}` : "✓"}`,
          );
        }
      } while (
        !r.original &&
        !pause.current &&
        !signal.aborted &&
        epoch.current === g
      );
      const list = await loadLists(signal);
      if (epoch.current === g) setRows(list.recordings);
    });
  }
  async function action(type: "transcribe" | "review" | "approve" | "delete") {
    await run(async (signal, g) => {
      const id = selected!.id,
        root = "library/recordings/" + id;
      const r = await api<{ recording: Detail; interviewId?: string }>(
        root +
          (type === "transcribe"
            ? "/transcribe"
            : type === "approve"
              ? "/approve"
              : ""),
        type === "review" ? "PUT" : type === "delete" ? "DELETE" : "POST",
        type === "transcribe"
          ? { version: selected!.version, permissionConfirmed: true }
          : type === "review"
            ? {
                version: selected!.version,
                text,
                reviewed,
                ...(sections ? { sections } : {}),
              }
            : type === "approve"
              ? { version: selected!.version, reviewed: true }
              : { version: selected!.version },
        undefined,
        signal,
      );
      const list = await loadLists(signal);
      if (epoch.current === g) {
        setRows(list.recordings);
        if (type === "delete") setSelected(null);
        else populate(r.recording);
      }
    });
  }
  const latest = selected?.history?.at(-1),
    dirty =
      !!latest &&
      (text !== latest.text ||
        reviewed !== latest.reviewed ||
        JSON.stringify(sections) !== JSON.stringify(latest.sections));
  return (
    <section
      className="panel library-stack"
      aria-label={l.title}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <h2>{l.title}</h2>
      <p className="muted">{l.notice}</p>
      <label>
        {l.language}
        <select
          aria-label={l.language}
          value={language}
          disabled={busy}
          onChange={(e) => {
            reset();
            setSelected(null);
            setPermission(false);
            setLanguage(e.target.value as Language);
          }}
        >
          {languages.map((v) => (
            <option key={v} value={v}>
              {languageNames[v]}
            </option>
          ))}
        </select>
      </label>
      <RecordingBatchPanel
        refreshKey={rows}
        language={language}
        studies={studies}
        canEdit={canEdit}
        blocked={working}
        onBusy={setBatchBusy}
        changed={async () => {
          const list = await loadLists();
          setRows(list.recordings);
          setCanEdit(list.canEdit);
        }}
        open={async (id) => {
          await run(async (signal, g) => {
            const v = await api<{ recording: Detail }>(
              "library/recordings/" + id,
              "GET",
              undefined,
              undefined,
              signal,
            );
            if (epoch.current === g) populate(v.recording);
          });
        }}
      />
      <fieldset disabled={busy || !canEdit} className="library-stack">
        <label>
          {l.study}
          <select
            aria-label={l.study}
            value={studyId}
            onChange={(e) => setStudyId(e.target.value)}
          >
            {studies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          {l.name}
          <input
            aria-label={l.name}
            value={title}
            minLength={3}
            maxLength={160}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          {l.external}
          <input
            aria-label={l.external}
            value={externalId}
            maxLength={100}
            onChange={(e) => setExternalId(e.target.value)}
          />
        </label>
        <label>
          {l.file}
          <input
            aria-label={l.file}
            type="file"
            accept="audio/wav,audio/mp4,audio/webm,audio/ogg,video/mp4,video/webm"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setPermission(false);
              request.current = null;
            }}
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={permission}
            onChange={(e) => setPermission(e.target.checked)}
          />
          {l.permission}
        </label>
        <button
          disabled={
            !file ||
            file.size > maxImportBytes ||
            !permission ||
            title.trim().length < 3 ||
            !externalId.trim() ||
            !studyId
          }
          onClick={() => void upload()}
        >
          {l.upload}
        </button>
      </fieldset>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => void refresh()}
      >
        {l.refresh}
      </button>
      {busy && (
        <p role="status">
          {l.busy} {progress}
        </p>
      )}
      {busy && selected && !selected.original && selected.file && (
        <button
          className="secondary"
          onClick={() => {
            pause.current = true;
          }}
        >
          {l.pause}
        </button>
      )}
      {error && (
        <div role="alert">
          <Notice>{error}</Notice>
        </div>
      )}
      {!rows.length && <p>{l.empty}</p>}
      {rows.map((r) => (
        <article className="panel" key={r.id} data-recording-id={r.id}>
          <strong>{r.title || l.imported}</strong>
          <p>
            {r.status === "imported" ? l.imported : l.draft} · {r.status} · v
            {r.version}
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(async (signal, g) => {
                const value = await api<{ recording: Detail }>(
                  "library/recordings/" + r.id,
                  "GET",
                  undefined,
                  undefined,
                  signal,
                );
                if (epoch.current === g) populate(value.recording);
              })
            }
          >
            {l.open}
          </button>
        </article>
      ))}
      {selected && (
        <section className="panel library-stack" aria-label={l.source}>
          <h3>{selected.title || l.imported}</h3>
          <p>
            {selected.status} · v{selected.version}
          </p>
          {selected.upload && (
            <p role="status">
              {l.progress}:{" "}
              {selected.upload.parts.filter((p) => p.digest).length}/
              {selected.upload.parts.length}
            </p>
          )}
          {selected.job && (
            <p role="status">
              {l.progress}: {selected.job.completed}/{selected.job.total}
            </p>
          )}
          {selected.status === "awaiting_upload" && canEdit && (
            <label>
              {l.resume}
              <input
                type="file"
                aria-label={l.resume}
                disabled={busy}
                accept="audio/wav,audio/mp4,audio/webm,audio/ogg,video/mp4,video/webm"
                onChange={(e) => {
                  const source = e.target.files?.[0];
                  if (source) void resumeUpload(source);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          {selected.lastError && <Notice>{l.error}</Notice>}
          {selected.status === "transcribing" && <Notice>{l.wait}</Notice>}
          {selected.file &&
            (selected.file.mime.startsWith("video/") ? (
              <video
                aria-label={l.play}
                ref={(node) => {
                  player.current = node;
                }}
                onTimeUpdate={() => {
                  if (
                    playUntil.current !== null &&
                    player.current &&
                    player.current.currentTime >= playUntil.current
                  ) {
                    player.current.pause();
                    playUntil.current = null;
                  }
                }}
                controls
                preload="none"
                src={"/api/library/recordings/" + selected.id + "/file"}
              />
            ) : (
              <audio
                aria-label={l.play}
                ref={(node) => {
                  player.current = node;
                }}
                onTimeUpdate={() => {
                  if (
                    playUntil.current !== null &&
                    player.current &&
                    player.current.currentTime >= playUntil.current
                  ) {
                    player.current.pause();
                    playUntil.current = null;
                  }
                }}
                controls
                preload="none"
                src={"/api/library/recordings/" + selected.id + "/file"}
              />
            ))}
          {selected.status !== "imported" && (
            <BackgroundJobsPanel
              language={language}
              targetId={selected.id}
              targets={
                selected.file && !selected.original && !selected.backgroundJobId
                  ? [
                      {
                        id: selected.id,
                        studyId: selected.studyId,
                        kind: "transcription",
                        version: selected.version,
                        label: selected.title || l.title,
                      },
                    ]
                  : []
              }
            />
          )}
          {selected.status === "imported" ? (
            <>
              <p>{l.receipt}</p>
              <button
                onClick={() => {
                  const id = selected.interviewId!;
                  setSelected(null);
                  void openResponse(id);
                }}
              >
                {l.response}
              </button>
            </>
          ) : (
            <>
              <button
                disabled={
                  busy ||
                  !canEdit ||
                  !selected.file ||
                  !!selected.original ||
                  !!selected.backgroundJobId ||
                  (selected.runningSince !== undefined &&
                    Date.now() - selected.runningSince < 120000)
                }
                onClick={() => void transcribeJob()}
              >
                {l.transcribe}
              </button>
              {selected.original && (
                <>
                  <label>
                    {l.text}
                    <textarea
                      aria-label={l.text}
                      value={text}
                      minLength={10}
                      maxLength={maxImportTranscript}
                      disabled={busy || !canEdit}
                      rows={12}
                      onChange={(e) => {
                        setText(e.target.value);
                        setSections(undefined);
                        setReviewed(false);
                      }}
                    />
                  </label>
                  <RecordingSectionsEditor
                    text={text}
                    sections={sections}
                    language={language}
                    disabled={busy || !canEdit}
                    change={(s) => {
                      if (s) setText(text.trim());
                      setSections(s);
                      setReviewed(false);
                    }}
                    play={(start, end) => {
                      if (player.current) {
                        player.current.currentTime = start / 1000;
                        playUntil.current = end / 1000;
                        void player.current.play().catch(() => {});
                      }
                    }}
                  />
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      disabled={busy || !canEdit}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />
                    {l.reviewed}
                  </label>
                  <button
                    disabled={busy || !canEdit || text.trim().length < 10}
                    onClick={() => void action("review")}
                  >
                    {l.save}
                  </button>
                  <button
                    disabled={busy || !canEdit || dirty || !latest?.reviewed}
                    onClick={() => void action("approve")}
                  >
                    {l.approve}
                  </button>
                  <details>
                    <summary>{l.original}</summary>
                    <p className="preserve-lines">{selected.original.text}</p>
                    <p>
                      {selected.original.model} ·{" "}
                      {selected.original.generatedAt}
                    </p>
                  </details>
                  <details>
                    <summary>{l.history}</summary>
                    {selected.history?.map((h) => (
                      <article key={h.version}>
                        <p>
                          v{h.version} · {h.editor.name} · {h.at}
                        </p>
                        <p className="preserve-lines">{h.text}</p>
                        {h.sections?.map((s, n) => (
                          <p key={n}>
                            {s.speaker || sectionLabels[language].speaker} ·{" "}
                            {s.start}–{s.end} ·{" "}
                            {s.startMs === null ? "?" : s.startMs / 1000}–
                            {s.endMs === null ? "?" : s.endMs / 1000}s
                          </p>
                        ))}
                      </article>
                    ))}
                  </details>
                </>
              )}
              <button
                className="secondary"
                disabled={busy || !canEdit}
                onClick={() => {
                  if (confirm(l.confirm)) void action("delete");
                }}
              >
                {l.remove}
              </button>
            </>
          )}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              reset();
              setSelected(null);
            }}
          >
            {l.close}
          </button>
        </section>
      )}
    </section>
  );
}
