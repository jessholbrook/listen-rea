"use client";
import { useEffect, useState, useRef } from "react";
import type { Language } from "@/lib/localization";
export default function PrivateConceptImage({
  assetId,
  studyId,
  interviewId,
  token,
  alt,
  language = "en",
  resource = "concept-images",
  enlarge = false,
}: {
  assetId: string;
  studyId?: string;
  interviewId?: string;
  token?: string;
  alt: string;
  language?: Language;
  resource?: "concept-images" | "option-images" | "participant-images";
  enlarge?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [src, setSrc] = useState(""),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  const path = interviewId
    ? "interviews/" + interviewId + "/" + resource + "/" + assetId
    : "studies/" + studyId + "/" + resource + "/" + assetId;
  useEffect(() => {
    const abort = new AbortController();
    let current = true,
      url = "";
    setSrc("");
    setFailed(false);
    void fetch("/api/" + path, {
      signal: abort.signal,
      credentials: "same-origin",
      cache: "no-store",
      headers: token ? { "x-interview-token": token } : {},
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("unavailable");
        const blob = await r.blob();
        if (!current) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => {
        if (current) setFailed(true);
      });
    return () => {
      current = false;
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, token, retry]);
  const words = {
    en: [
      "Loading image…",
      "The image could not be loaded. Retry before answering.",
      "Retry image",
    ],
    es: [
      "Cargando imagen…",
      "No se pudo cargar la imagen. Vuelve a intentarlo antes de responder.",
      "Reintentar imagen",
    ],
    fr: [
      "Chargement de l’image…",
      "L’image n’a pas pu être chargée. Réessayez avant de répondre.",
      "Réessayer l’image",
    ],
  }[language];
  const zoom = {
    en: ["View full image", "Close image"],
    es: ["Ver imagen completa", "Cerrar imagen"],
    fr: ["Voir l’image entière", "Fermer l’image"],
  }[language];
  return (
    <div className="private-concept-image">
      {src && !failed ? (
        <>
          <img src={src} alt={alt} onError={() => setFailed(true)} />
          {enlarge && (
            <>
              <button
                className="text-button"
                type="button"
                onClick={() => dialog.current?.showModal()}
              >
                {zoom[0]}
              </button>
              <dialog
                ref={dialog}
                className="answer-image-dialog"
                aria-label={alt}
              >
                <button
                  autoFocus
                  className="button secondary"
                  type="button"
                  onClick={() => dialog.current?.close()}
                >
                  {zoom[1]}
                </button>
                <img src={src} alt={alt} />
              </dialog>
            </>
          )}
        </>
      ) : failed ? (
        <div role="alert">
          <p>{words[1]}</p>
          <button
            type="button"
            className="button secondary"
            onClick={() => setRetry((n) => n + 1)}
          >
            {words[2]}
          </button>
        </div>
      ) : (
        <p role="status">{words[0]}</p>
      )}
    </div>
  );
}
