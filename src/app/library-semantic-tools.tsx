"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { Language } from "@/lib/localization";
import {
  semanticLabels,
  type SemanticScope,
  type SemanticCoverage,
  type SemanticRetrieval,
} from "@/lib/library-semantic";
import { Notice } from "./components";
export function SemanticResult({
  value,
  language,
}: {
  value?: SemanticRetrieval;
  language: Language;
}) {
  if (!value) return null;
  const l = semanticLabels[language];
  return (
    <p className="muted" aria-label={l.results}>
      {l.results} · {value.model} · {value.version} · {l.coverage}:{" "}
      {value.indexed}/{value.eligible}. {value.partial ? l.partial : l.meta}
    </p>
  );
}
export default function LibrarySemanticTools({
  scope,
  filter,
  language,
  mode,
  onMode,
  ai,
  disabled = false,
  onInvalidate,
}: {
  scope: SemanticScope;
  filter: object;
  language: Language;
  mode: "keyword" | "semantic";
  onMode: (v: "keyword" | "semantic") => void;
  ai: boolean;
  disabled?: boolean;
  onInvalidate?: () => void;
}) {
  const [coverage, setCoverage] = useState<SemanticCoverage | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const epoch = useRef(0),
    controller = useRef<AbortController | null>(null),
    l = semanticLabels[language],
    signature = JSON.stringify({ ...filter, query: "" });
  useEffect(() => {
    epoch.current++;
    controller.current?.abort();
    setCoverage(null);
    setError("");
    setNotice("");
    setBusy(false);
    return () => {
      epoch.current++;
      controller.current?.abort();
    };
  }, [signature, language]);
  async function action(type: "status" | "index" | "clear") {
    onInvalidate?.();
    controller.current?.abort();
    const generation = ++epoch.current,
      abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await api<{ coverage: SemanticCoverage }>(
        "library/semantic/" + (type === "clear" ? "index" : type),
        type === "clear" ? "DELETE" : "POST",
        type === "clear" ? { scope } : { ...filter, scope, query: "" },
        undefined,
        abort.signal,
      );
      if (epoch.current !== generation) return;
      if (type === "clear") {
        setCoverage(null);
        setNotice(l.cleared);
      } else setCoverage(r.coverage);
    } catch (e) {
      if (epoch.current === generation) {
        setCoverage(null);
        setError((e as Error).message);
      }
    } finally {
      if (epoch.current === generation) setBusy(false);
    }
  }
  return (
    <section
      className="panel library-stack"
      aria-label={l.title}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <h3>{l.title}</h3>
      <p className="muted">{l.notice}</p>
      <label>
        {l.method}
        <select
          aria-label={l.method}
          value={mode}
          disabled={disabled}
          onChange={(e) => onMode(e.target.value as "keyword" | "semantic")}
        >
          <option value="keyword">{l.keyword}</option>
          <option value="semantic" disabled={!ai}>
            {l.semantic}
          </option>
        </select>
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className="secondary"
          disabled={busy || disabled}
          onClick={() => action("status")}
        >
          {l.status}
        </button>
        <button
          className="secondary"
          disabled={busy || disabled || !ai || coverage?.canEdit === false}
          onClick={() => action("index")}
        >
          {l.build}
        </button>
        <button
          className="secondary"
          disabled={busy || disabled || coverage?.canEdit === false}
          onClick={() => {
            if (confirm(l.confirm)) void action("clear");
          }}
        >
          {l.clear}
        </button>
      </div>
      {busy && <p role="status">{l.working}</p>}
      {error && (
        <div role="alert">
          <Notice>{error}</Notice>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {coverage && (
        <p role="status">
          {l.coverage}: {coverage.indexed}/{coverage.eligible} ·{" "}
          {coverage.model} · {coverage.version}.{" "}
          {coverage.indexed === 0
            ? l.empty
            : coverage.partial
              ? l.partial
              : l.ready}
        </p>
      )}
    </section>
  );
}
