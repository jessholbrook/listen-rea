"use client";
import { useEffect, useState, useRef } from "react";
import type { Language } from "@/lib/localization";
export default function PrivateConceptVideo({
  assetId,
  studyId,
  interviewId,
  token,
  alt,
  language = "en",
}: {
  assetId: string;
  studyId?: string;
  interviewId?: string;
  token?: string;
  alt: string;
  language?: Language;
}) {
  const [src, setSrc] = useState(""),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  const player = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = player.current;
    return () => {
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
    };
  }, [src]);
  const path = interviewId
    ? "interviews/" + interviewId + "/concept-videos/" + assetId
    : "studies/" + studyId + "/concept-videos/" + assetId;
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
      "Loading video…",
      "The concept video could not be loaded. Retry or read its text alternative before answering.",
      "Retry video",
    ],
    es: [
      "Cargando vídeo…",
      "No se pudo cargar el vídeo. Reinténtalo o lee la alternativa de texto antes de responder.",
      "Reintentar vídeo",
    ],
    fr: [
      "Chargement de la vidéo…",
      "La vidéo n’a pas pu être chargée. Réessayez ou lisez l’alternative textuelle avant de répondre.",
      "Réessayer la vidéo",
    ],
  }[language];
  return (
    <div className="private-concept-video">
      {src && !failed ? (
        <video
          ref={player}
          controls
          playsInline
          preload="metadata"
          src={src}
          aria-label={alt}
          onError={() => setFailed(true)}
        />
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
