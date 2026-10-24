"use client";
import SavedReviewViewsPanel from "./saved-review-views-panel";
import { savedReportViewConfig } from "@/lib/saved-review-views";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import {
  operationsReportLabels,
  operationsReportConfig,
  type OperationsReportConfig,
  type OperationsReportPreview,
} from "@/lib/operations-report";
export default function OperationsReportPanel({
  config,
  onTimeZone,
  onApply,
  onLock,
}: {
  config: {
    language: OperationsReportConfig["language"];
    kind: string;
    filters: unknown;
    timeZone: string;
  };
  onTimeZone: (v: string) => void;
  onApply: (v: OperationsReportConfig) => void;
  onLock: (locked: boolean) => void;
}) {
  const l = operationsReportLabels[config.language],
    [savedDirty, setSavedDirty] = useState(false),
    [preview, setPreview] = useState<OperationsReportPreview | null>(null),
    [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [error, setError] = useState("");
  const alive = useRef(true),
    controller = useRef<AbortController | null>(null),
    captured = useRef<OperationsReportConfig | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
      onLock(false);
    };
  }, [onLock]);
  useEffect(() => {
    onLock(busy || !!preview || savedDirty);
  }, [busy, preview, savedDirty, onLock]);
  async function run(format?: "csv" | "txt") {
    const c = new AbortController();
    controller.current?.abort();
    controller.current = c;
    setBusy(true);
    setError("");
    try {
      if (!format) {
        captured.current = operationsReportConfig.parse(
          structuredClone(config),
        );
        const p = await api<OperationsReportPreview>(
          "library/operations-report/preview",
          "POST",
          { config: captured.current },
          undefined,
          c.signal,
        );
        if (alive.current) {
          setPreview(p);
          setReviewed(false);
        }
      } else {
        const r = await fetch("/api/library/operations-report/export", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          signal: c.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            config: captured.current,
            signature: preview!.signature,
            reviewed,
            format,
          }),
        });
        if (!r.ok) throw Error((await r.json()).error || l.failed);
        const blob = await r.blob();
        if (!alive.current) return;
        const url = URL.createObjectURL(blob),
          link = document.createElement("a");
        link.href = url;
        link.download = `echo-lab-operations-${captured.current!.kind}.${format}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      if (alive.current) {
        setPreview(null);
        setReviewed(false);
        setError((e as Error).message);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section
      className="panel library-stack operations-report"
      aria-label={l.title}
      aria-busy={busy}
    >
      <h4>{l.title}</h4>
      <p className="muted">{l.notice}</p>
      <SavedReviewViewsPanel
        kind={
          config.kind === "workload"
            ? "report_workload"
            : config.kind === "calendar"
              ? "report_calendar"
              : config.kind === "unified"
                ? "report_unified"
                : "report_activity"
        }
        language={config.language}
        disabled={busy || !!preview}
        current={() =>
          savedReportViewConfig.parse({
            kind:
              config.kind === "workload"
                ? "report_workload"
                : config.kind === "calendar"
                  ? "report_calendar"
                  : config.kind === "unified"
                    ? "report_unified"
                    : "report_activity",
            report: operationsReportConfig.parse(config),
          })
        }
        onApply={(value) => onApply(savedReportViewConfig.parse(value).report)}
        onDirty={setSavedDirty}
        onStart={() => setError("")}
      />
      <fieldset
        disabled={savedDirty}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        {!preview && (
          <label>
            {l.timeZone}
            <input
              aria-label={l.timeZone}
              maxLength={100}
              value={config.timeZone}
              disabled={busy}
              onChange={(e) => onTimeZone(e.target.value)}
            />
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        {!preview && (
          <button className="button" disabled={busy} onClick={() => void run()}>
            {l.generate}
          </button>
        )}
        {preview && (
          <>
            <time dateTime={preview.generatedAt}>{preview.generatedAt}</time>
            <dl>
              {preview.metadata.map(([key, value], i) => (
                <div key={i}>
                  <dt>{key}</dt>
                  <dd style={{ marginLeft: 0, overflowWrap: "anywhere" }}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <p role="status">
              {l.rows}: {preview.rows.length}
            </p>
            <p>{l.preview}</p>
            <div
              style={{ overflowX: "auto", maxWidth: "100%" }}
              tabIndex={0}
              aria-label={l.title}
            >
              <table style={{ minWidth: "900px", width: "max-content" }}>
                <thead>
                  <tr>
                    {preview.headers.map((h, i) => (
                      <th
                        key={i}
                        style={{ whiteSpace: "nowrap", minWidth: "8rem" }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 10).map((row, i) => (
                    <tr key={i}>
                      {row.map((v, j) => (
                        <td
                          key={j}
                          style={{ whiteSpace: "nowrap", minWidth: "8rem" }}
                        >
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label>
              <input
                type="checkbox"
                checked={reviewed}
                disabled={busy}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              {l.reviewed}
            </label>
            <button
              className="button"
              disabled={busy || !reviewed}
              onClick={() => void run("csv")}
            >
              {l.csv}
            </button>
            <button
              className="button"
              disabled={busy || !reviewed}
              onClick={() => void run("txt")}
            >
              {l.txt}
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setReviewed(false);
              }}
            >
              {l.close}
            </button>
          </>
        )}
      </fieldset>
    </section>
  );
}
