"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { maxImportBytes } from "@/lib/library-recordings";
import {
  uploadRecordingParts,
  type RecordingDetail as Detail,
} from "@/lib/library-recording-upload-client";
import { backgroundLabels } from "@/lib/background-jobs";
import BackgroundJobsPanel from "./background-jobs-panel";
import { batchLabels } from "@/lib/recording-batches";
import type { Language } from "@/lib/localization";
type Row = Pick<
  Detail,
  | "id"
  | "studyId"
  | "batchId"
  | "title"
  | "status"
  | "lastError"
  | "interviewId"
> & {
  createdAt: string;
  uploadProgress?: { completed: number; total: number };
  transcriptionProgress?: { completed: number; total: number };
};
type Entry = {
  file: File;
  requestId: string;
  title: string;
  externalId: string;
};
export default function RecordingBatchPanel({
  language,
  studies,
  canEdit,
  blocked,
  onBusy,
  changed,
  open,
  refreshKey,
}: {
  language: Language;
  studies: { id: string; title: string }[];
  canEdit: boolean;
  blocked: boolean;
  onBusy: (b: boolean) => void;
  changed: () => Promise<void>;
  open: (id: string) => Promise<void>;
  refreshKey: unknown;
}) {
  const l = batchLabels[language],
    [entries, setEntries] = useState<Entry[]>([]),
    [study, setStudy] = useState(studies[0]?.id || ""),
    [permission, setPermission] = useState(false),
    [rows, setRows] = useState<Row[]>([]),
    [batch, setBatch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [failures, setFailures] = useState<Record<string, string>>({});
  const control = useRef<AbortController | null>(null),
    pause = useRef(false),
    request = useRef(crypto.randomUUID()),
    files = useRef(new Map<string, File>());
  async function load(signal?: AbortSignal) {
    const v = await api<{ recordings: Row[] }>(
      "library/recordings",
      "GET",
      undefined,
      undefined,
      signal,
    );
    if (!signal?.aborted) setRows(v.recordings.filter((r) => r.batchId));
    return v.recordings;
  }
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal).catch(() => {});
    return () => c.abort();
  }, [language, refreshKey]);
  useEffect(
    () => () => {
      control.current?.abort();
    },
    [],
  );
  const groups = [...new Set(rows.map((r) => r.batchId!))],
    active = batch && groups.includes(batch) ? batch : groups[0] || "",
    items = rows.filter((r) => r.batchId === active);
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    const c = new AbortController();
    control.current = c;
    pause.current = false;
    setBusy(true);
    onBusy(true);
    setError("");
    setMessage("");
    try {
      await action(c.signal);
      if (!c.signal.aborted) setMessage(l.done);
    } catch (e) {
      if (!c.signal.aborted) setError((e as Error).message);
    } finally {
      if (!c.signal.aborted) {
        await load(c.signal).catch(() => {});
        setBusy(false);
        onBusy(false);
        try {
          await changed();
        } catch (e) {
          setError((e as Error).message);
        }
      }
    }
  }
  async function uploadQueue(recordings: Detail[], signal: AbortSignal) {
    for (const r of recordings) {
      if (signal.aborted || pause.current) break;
      if (r.status !== "awaiting_upload") continue;
      const file = files.current.get(r.id);
      if (!file) continue;
      try {
        await uploadRecordingParts(
          r,
          file,
          signal,
          (next) => {
            if (!signal.aborted)
              setMessage(
                `${next.title}: ${l.progress} ${next.upload!.parts.filter((p) => p.digest).length}/${next.upload!.parts.length}`,
              );
          },
          () => pause.current,
        );
        setFailures((v) => {
          const n = { ...v };
          delete n[r.id];
          return n;
        });
      } catch (e) {
        if (signal.aborted) throw e;
        setFailures((v) => ({ ...v, [r.id]: (e as Error).message }));
      }
      await load(signal);
    }
  }
  async function create(signal: AbortSignal) {
    const v = await api<{ recordings: Detail[] }>(
      "library/recordings/batch",
      "POST",
      {
        requestId: request.current,
        studyId: study,
        language,
        permissionConfirmed: permission,
        transcriptionPermission: permission,
        items: entries.map(({ requestId, title, externalId }) => ({
          requestId,
          title,
          externalId,
        })),
      },
      undefined,
      signal,
    );
    setBatch(request.current);
    v.recordings.forEach((r, i) => files.current.set(r.id, entries[i].file));
    await load(signal);
    await uploadQueue(v.recordings, signal);
  }
  async function transcribe(signal: AbortSignal) {
    for (const item of items) {
      if (pause.current || signal.aborted) break;
      try {
        let r = (
          await api<{ recording: Detail }>(
            "library/recordings/" + item.id,
            "GET",
            undefined,
            undefined,
            signal,
          )
        ).recording;
        if (!r.file || r.original || r.status === "imported") continue;
        if (r.runningSince && Date.now() - r.runningSince < 120000) continue;
        do {
          r = (
            await api<{ recording: Detail }>(
              `library/recordings/${r.id}/transcribe`,
              "POST",
              { version: r.version, permissionConfirmed: true },
              undefined,
              signal,
            )
          ).recording;
          await load(signal);
        } while (!r.original && !pause.current && !signal.aborted);
        setFailures((v) => {
          const n = { ...v };
          delete n[r.id];
          return n;
        });
      } catch (e) {
        if (signal.aborted) throw e;
        setFailures((v) => ({ ...v, [item.id]: (e as Error).message }));
        await load(signal);
      }
    }
  }
  const disabled = busy || blocked;
  return (
    <section
      className="panel library-stack"
      aria-label={l.title}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <h3>{l.title}</h3>
      <p className="muted">{l.notice}</p>
      <fieldset disabled={disabled || !canEdit} className="library-stack">
        <label>
          {l.files}
          <input
            aria-label={l.files}
            type="file"
            multiple
            accept="audio/wav,audio/mp4,audio/webm,audio/ogg,video/mp4,video/webm"
            onChange={(e) => {
              const selected = Array.from(e.target.files || []);
              setError("");
              setPermission(false);
              request.current = crypto.randomUUID();
              if (
                selected.length < 2 ||
                selected.length > 10 ||
                selected.some((f) => !f.size || f.size > maxImportBytes)
              ) {
                setEntries([]);
                setError(l.limit);
                return;
              }
              setEntries(
                selected.map((file) => ({
                  file,
                  requestId: crypto.randomUUID(),
                  title: (
                    file.name.replace(/\.[^.]+$/, "") + " interview"
                  ).slice(0, 160),
                  externalId: crypto.randomUUID(),
                })),
              );
            }}
          />
        </label>
        <label>
          {language === "en"
            ? "Batch destination study"
            : language === "es"
              ? "Estudio de destino del lote"
              : "Étude de destination du lot"}
          <select
            value={study}
            onChange={(e) => {
              setStudy(e.target.value);
              request.current = crypto.randomUUID();
              setPermission(false);
            }}
          >
            {studies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        {entries.map((entry, i) => (
          <article key={entry.requestId}>
            <p>
              {i + 1}. {entry.file.name} ·{" "}
              {(entry.file.size / 1048576).toFixed(1)} MiB
            </p>
            {(["title", "externalId"] as const).map((key) => (
              <label key={key}>
                {key === "title" ? l.name : l.external} {i + 1}
                <input
                  aria-label={`${key === "title" ? l.name : l.external} ${i + 1}`}
                  value={entry[key]}
                  maxLength={key === "title" ? 160 : 100}
                  onChange={(e) => {
                    setEntries((v) =>
                      v.map((r, n) =>
                        n === i ? { ...r, [key]: e.target.value } : r,
                      ),
                    );
                    request.current = crypto.randomUUID();
                    setPermission(false);
                  }}
                />
              </label>
            ))}
          </article>
        ))}
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
            !study ||
            !permission ||
            entries.length < 2 ||
            entries.some(
              (e) => e.title.trim().length < 3 || !e.externalId.trim(),
            )
          }
          onClick={() => void run(create)}
        >
          {l.create}
        </button>
      </fieldset>
      <label>
        {l.saved}
        <select
          aria-label={l.saved}
          value={active}
          disabled={disabled}
          onChange={(e) => setBatch(e.target.value)}
        >
          {!groups.length && <option value="">{l.empty}</option>}
          {groups.map((id) => (
            <option key={id} value={id}>
              {rows.find((r) => r.batchId === id)!.createdAt.slice(0, 16)} ·{" "}
              {id.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={disabled}
        onClick={() => void load().catch((e) => setError(e.message))}
      >
        {l.refresh}
      </button>
      {!!items.length && (
        <>
          <p>
            {l.draft}: {items.filter((r) => r.status === "draft").length}/
            {items.length} · {l.imported}:{" "}
            {items.filter((r) => r.status === "imported").length}/{items.length}
          </p>
          <button
            disabled={
              disabled ||
              !canEdit ||
              !items.some((r) =>
                ["uploaded", "transcribing"].includes(r.status),
              )
            }
            onClick={() => void run(transcribe)}
          >
            {l.transcribe}
          </button>
          <button
            disabled={disabled || !canEdit}
            onClick={() =>
              void run(async (signal) => {
                for (const item of items) {
                  if (pause.current || signal.aborted) break;
                  const r = (
                    await api<{ recording: Detail }>(
                      `library/recordings/${item.id}`,
                      "GET",
                      undefined,
                      undefined,
                      signal,
                    )
                  ).recording;
                  if (
                    !r.file ||
                    r.original ||
                    r.backgroundJobId ||
                    r.status === "imported"
                  )
                    continue;
                  await api(
                    "background-jobs",
                    "POST",
                    {
                      requestId: crypto.randomUUID(),
                      kind: "transcription",
                      targetId: r.id,
                      studyId: r.studyId,
                      version: r.version,
                      permissionConfirmed: true,
                    },
                    undefined,
                    signal,
                  );
                }
                await load(signal);
              })
            }
          >
            {backgroundLabels[language].start}
          </button>
          <BackgroundJobsPanel language={language} studyId={study} />
          {items.some(
            (r) => r.status === "awaiting_upload" && files.current.has(r.id),
          ) && (
            <button
              disabled={disabled || !canEdit}
              onClick={() =>
                void run(async (signal) => {
                  const current: Detail[] = [];
                  for (const r of items)
                    current.push(
                      (
                        await api<{ recording: Detail }>(
                          `library/recordings/${r.id}`,
                          "GET",
                          undefined,
                          undefined,
                          signal,
                        )
                      ).recording,
                    );
                  await uploadQueue(current, signal);
                })
              }
            >
              {l.resume}
            </button>
          )}
          {items.some((r) => r.status === "awaiting_upload") && (
            <p>{l.missing}</p>
          )}
          {items.map((r, i) => (
            <article
              className="panel"
              key={r.id}
              data-batch-recording-id={r.id}
            >
              <h4>{r.title || `${l.item} ${i + 1}`}</h4>
              <p>
                {
                  {
                    awaiting_upload: l.pending,
                    uploaded: l.uploaded,
                    transcribing: l.transcribing,
                    draft: l.draft,
                    imported: l.imported,
                  }[r.status]
                }
              </p>
              {r.uploadProgress && (
                <p>
                  {l.progress}: {r.uploadProgress.completed}/
                  {r.uploadProgress.total}
                </p>
              )}
              {r.transcriptionProgress && (
                <p>
                  {l.progress}: {r.transcriptionProgress.completed}/
                  {r.transcriptionProgress.total}
                </p>
              )}
              {(failures[r.id] || r.lastError) && (
                <p role="alert">
                  {l.failed} {failures[r.id]}
                </p>
              )}
              <button disabled={disabled} onClick={() => void open(r.id)}>
                {l.review}
              </button>
            </article>
          ))}
        </>
      )}
      {busy && (
        <>
          <p role="status">{l.running}</p>
          <button
            onClick={() => {
              pause.current = true;
            }}
          >
            {l.pause}
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
