"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { pptxMime } from "@/lib/participant-pptx";
import type { ReportEdition } from "@/lib/reporting";
import { Notice } from "./components";
type Imported = {
  id: string;
  name: string;
  slides: number;
  bytes: number;
  version: number;
  dataVersion: number;
  reviewed: boolean;
};
export default function PresentationImportPanel({
  studyId,
  editions,
}: {
  studyId: string;
  editions: ReportEdition[];
}) {
  const [imports, setImports] = useState<Imported[]>([]),
    [dataVersion, setVersion] = useState(0),
    [file, setFile] = useState<File | null>(null),
    [name, setName] = useState(""),
    [permission, setPermission] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    request = useRef<string | null>(null),
    generation = useRef(0),
    root = `studies/${studyId}/presentation-imports`;
  async function load(g = generation.current) {
    const r = await api<{ imports: Imported[]; dataVersion: number }>(root);
    if (g === generation.current) {
      setImports(r.imports);
      setVersion(r.dataVersion);
    }
  }
  useEffect(() => {
    const g = ++generation.current;
    void load(g).catch((e) => setError(e.message));
    return () => {
      generation.current++;
    };
  }, [root]);
  async function upload() {
    const g = generation.current;
    setBusy(true);
    setError("");
    if (!request.current) request.current = crypto.randomUUID();
    try {
      const r = await fetch("/api/" + root, {
        method: "POST",
        headers: {
          "content-type": pptxMime,
          "x-import-consent": "yes",
          "x-import-name": encodeURIComponent(name),
          "x-request-id": request.current,
          "x-source-version": String(dataVersion),
        },
        body: file,
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.error);
      if (g === generation.current) {
        request.current = null;
        setFile(null);
        setName("");
        setPermission(false);
        await load(g);
      }
    } catch (e) {
      if (g === generation.current) {
        setError((e as Error).message);
        setPermission(false);
      }
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  return (
    <section
      className="panel visual-stack"
      aria-label="Imported presentation export"
    >
      <h3>Import an existing PowerPoint presentation</h3>
      <p>
        Keep the original static slides, layouts and assets, then append a
        reviewed Echo Lab report as editable slides. Imported slides remain
        user-supplied context, not validated research findings. Different slide
        sizes letterbox the report content. Review the original in PowerPoint
        before marking it approved.
      </p>
      <p className="small">
        Standard unencrypted PPTX only; up to 2 MB/50 original slides, five
        imports per study, 100 total exported slides and 3 MB output. Macros,
        embedded objects, SVG assets and external media are unsupported. HTTPS
        hyperlinks are preserved.
      </p>
      {error && <Notice>{error}</Notice>}
      <fieldset disabled={busy} className="visual-stack reporting-media-fields">
        <label>
          PowerPoint to import
          <input
            aria-label="PowerPoint to import"
            type="file"
            accept={pptxMime + ",.pptx"}
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              setFile(f);
              setName(f?.name.replace(/\.pptx$/i, "").slice(0, 100) || "");
              request.current = null;
              setPermission(false);
            }}
          />
        </label>
        <label>
          Imported presentation name
          <input
            aria-label="Imported presentation name"
            maxLength={100}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              request.current = null;
            }}
          />
        </label>
        <label className="checkbox-label report-review">
          <input
            type="checkbox"
            checked={permission}
            onChange={(e) => setPermission(e.target.checked)}
          />
          I have permission to use these original slides and understand they
          will be stored privately for this study.
        </label>
        <button
          className="button"
          type="button"
          disabled={!file || !name.trim() || !permission}
          onClick={() => void upload()}
        >
          {busy ? "Importing…" : "Import PowerPoint"}
        </button>
      </fieldset>
      <button
        className="button"
        type="button"
        disabled={busy}
        onClick={() => {
          setPermission(false);
          request.current = null;
          void load().catch((e) => setError(e.message));
        }}
      >
        Refresh imported presentations
      </button>
      {imports.map((d) => (
        <ImportedCard
          key={d.id + ":" + d.version}
          imported={d}
          dataVersion={dataVersion}
          editions={editions}
          root={root}
          refresh={load}
        />
      ))}
    </section>
  );
}
function ImportedCard({
  imported: d,
  dataVersion,
  editions,
  root,
  refresh,
}: {
  imported: Imported;
  dataVersion: number;
  editions: ReportEdition[];
  root: string;
  refresh: () => Promise<void>;
}) {
  const [reviewed, setReviewed] = useState(false),
    [editionId, setEdition] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const available = editions.filter(
      (e) => e.reviewed && e.dataVersion === dataVersion,
    ),
    e = available.find((e) => e.id === editionId),
    stale = d.dataVersion !== dataVersion;
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <article className="panel visual-stack">
      <h4>
        {d.name} · {d.slides} original slides
      </h4>
      <p>
        {d.reviewed ? "Original reviewed" : "Original needs review"}
        {stale
          ? " · source set changed: remove and import a current version"
          : ""}
      </p>
      {error && <Notice>{error}</Notice>}
      <a className="button" href={"/api/" + root + "/" + d.id + "/file"}>
        Download original presentation
      </a>
      <fieldset
        disabled={busy || stale}
        className="visual-stack reporting-media-fields"
      >
        <label className="checkbox-label report-review">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
          />
          I reviewed the original slides and the content I am about to export.
        </label>
        {!d.reviewed && (
          <button
            className="button"
            type="button"
            disabled={!reviewed}
            onClick={() =>
              void act(async () => {
                await api(root + "/" + d.id, "PUT", {
                  version: d.version,
                  reviewed: true,
                });
                await refresh();
              })
            }
          >
            Mark imported slides reviewed
          </button>
        )}
        <label>
          Reviewed report to append
          <select
            aria-label="Reviewed report to append"
            value={editionId}
            onChange={(e) => {
              setEdition(e.target.value);
              setReviewed(false);
            }}
          >
            <option value="">Choose a reviewed report</option>
            {available.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title} · v{e.version}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button"
          type="button"
          disabled={!d.reviewed || !reviewed || !e}
          onClick={() =>
            void act(async () => {
              const r = await fetch("/api/" + root + "/" + d.id + "/compose", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  editionId: e!.id,
                  editionVersion: e!.version,
                  importVersion: d.version,
                  reviewed,
                }),
              });
              if (!r.ok) throw Error((await r.json()).error);
              const blob = await r.blob();
              if (!mounted.current) return;
              const url = URL.createObjectURL(blob),
                a = document.createElement("a");
              a.href = url;
              a.download = "research-report-with-import.pptx";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            })
          }
        >
          Export imported slides with report
        </button>
      </fieldset>
      <button
        className="button"
        type="button"
        disabled={busy}
        onClick={() =>
          void act(async () => {
            await api(root + "/" + d.id, "DELETE", { version: d.version });
            await refresh();
          })
        }
      >
        Remove imported presentation
      </button>
    </article>
  );
}
