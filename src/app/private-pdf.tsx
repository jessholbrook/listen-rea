"use client";
import { useState, useEffect, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { version } from "pdfjs-dist/package.json";
import { copy } from "@/lib/participant-copy";
import type { Language } from "@/lib/localization";
export default function PrivatePDF({
  assetId,
  studyId,
  interviewId,
  token,
  language = "en",
  initialPage = 1,
  autoOpen = false,
}: {
  assetId: string;
  studyId?: string;
  interviewId?: string;
  token?: string;
  language?: Language;
  initialPage?: number;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen),
    [doc, setDoc] = useState<PDFDocumentProxy | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [rendering, setRendering] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const t = (s: string) => copy(language, s);
  const url = studyId
    ? `/api/studies/${studyId}/participant-pdfs/${assetId}`
    : `/api/interviews/${interviewId}/participant-pdfs/${assetId}`;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let active = true;
    let task: ReturnType<typeof import("pdfjs-dist").getDocument> | undefined;
    setDoc(null);
    setError("");
    setPage(initialPage);
    const timer = setTimeout(() => {
      if (active) {
        setError(
          "PDF preview is unavailable. Try downloading the prepared PDF.",
        );
        controller.abort();
        void task?.destroy();
      }
    }, 20000);
    (async () => {
      try {
        const r = await fetch(url, {
          headers: token ? { "x-interview-token": token } : {},
          cache: "no-store",
          signal: controller.signal,
        });
        if (!r.ok) throw Error();
        const bytes = new Uint8Array(await r.arrayBuffer());
        const pdfjs = await import("pdfjs-dist");
        if (!active) return;
        pdfjs.GlobalWorkerOptions.workerSrc = `/pdfjs/${version}/pdf.worker.min.mjs`;
        task = pdfjs.getDocument({
          data: bytes,
          enableXfa: false,
          canvasMaxAreaInBytes: 8000000,
          disableFontFace: true,
          useSystemFonts: true,
          useWorkerFetch: false,
          disableAutoFetch: true,
          disableStream: true,
          disableRange: true,
          stopAtErrors: true,
          maxImageSize: 4000000,
          cMapUrl: `/pdfjs/${version}/cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `/pdfjs/${version}/standard_fonts/`,
          wasmUrl: `/pdfjs/${version}/wasm/`,
        });
        const document = await task.promise;
        if (!active) {
          await task.destroy();
          return;
        }
        if (document.numPages > 20) throw Error();
        clearTimeout(timer);
        setPage(Math.min(Math.max(1, initialPage), document.numPages));
        setDoc(document);
      } catch {
        if (active)
          setError(
            "PDF preview is unavailable. Try downloading the prepared PDF.",
          );
        clearTimeout(timer);
      }
    })();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
      void task?.destroy();
    };
  }, [open, url, token, initialPage]);
  useEffect(() => {
    if (!open || !doc || !canvas.current) return;
    let active = true;
    let task:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    setRendering(true);
    setError("");
    const timer = setTimeout(() => {
      task?.cancel();
      if (active)
        setError(
          "PDF preview is unavailable. Try downloading the prepared PDF.",
        );
    }, 15000);
    (async () => {
      try {
        const p = await doc.getPage(page);
        if (!active || !canvas.current) return;
        const basic = p.getViewport({ scale: 1 }),
          scale = Math.min(1000 / basic.width, 1400 / basic.height, 2),
          v = p.getViewport({ scale });
        canvas.current.width = Math.ceil(v.width);
        canvas.current.height = Math.ceil(v.height);
        task = p.render({
          canvas: canvas.current,
          viewport: v,
          annotationMode: 0,
        });
        await task.promise;
      } catch {
        if (active)
          setError(
            "PDF preview is unavailable. Try downloading the prepared PDF.",
          );
      } finally {
        clearTimeout(timer);
        if (active) setRendering(false);
      }
    })();
    return () => {
      active = false;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [doc, page, open]);
  return (
    <section className="private-pdf" aria-label={t("Private PDF viewer")}>
      <button
        className="button secondary"
        type="button"
        onClick={() => setOpen(!open)}
      >
        {t(open ? "Close PDF" : "View PDF")}
      </button>
      <button
        className="button secondary"
        type="button"
        onClick={async () => {
          try {
            const r = await fetch(url, {
              headers: token ? { "x-interview-token": token } : {},
              cache: "no-store",
            });
            if (!r.ok) throw Error();
            const object = URL.createObjectURL(await r.blob());
            const a = document.createElement("a");
            a.href = object;
            a.download = "echo-lab-document.pdf";
            a.click();
            setTimeout(() => URL.revokeObjectURL(object), 1000);
          } catch {
            setError(
              "PDF preview is unavailable. Try downloading the prepared PDF.",
            );
          }
        }}
      >
        {t("Download PDF")}
      </button>
      {error && <p role="alert">{t(error)}</p>}
      {open && (
        <>
          {(!doc || rendering) && !error && (
            <p role="status">{t("Loading PDF…")}</p>
          )}
          {doc && (
            <>
              <p>
                {t("Page")} {page} / {doc.numPages}
              </p>
              <div className="inline">
                <button
                  type="button"
                  className="button"
                  disabled={page <= 1 || rendering}
                  onClick={() => setPage(page - 1)}
                >
                  {t("Previous page")}
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={page >= doc.numPages || rendering}
                  onClick={() => setPage(page + 1)}
                >
                  {t("Next page")}
                </button>
              </div>
              <canvas
                ref={canvas}
                aria-label={`${t("Page")} ${page}`}
                role="img"
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
