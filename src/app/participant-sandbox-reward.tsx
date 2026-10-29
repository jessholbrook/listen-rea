"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { Language } from "@/lib/localization";
const labels = {
  en: {
    title: "Sandbox reward",
    note: "For test studies only. This reward has no monetary value. Return in this browser after the study team approves your incentive.",
    check: "Check sandbox reward",
    consent:
      "I understand this is a test reward. Opening it shares an opaque reward reference with Tremendous. No interview answers or contact details are sent.",
    prepare: "Prepare sandbox reward link",
    open: "Open sandbox reward",
    wait: "No sandbox reward is available yet. Contact the study team about real compensation.",
    warning:
      "Anyone with a reward link can use it. Keep it private. Generating another link does not revoke earlier links.",
  },
  es: {
    title: "Recompensa de prueba",
    note: "Solo para estudios de prueba. Esta recompensa no tiene valor monetario. Vuelve en este navegador cuando el equipo apruebe tu incentivo.",
    check: "Consultar recompensa de prueba",
    consent:
      "Entiendo que es una recompensa de prueba. Al abrirla, se comparte una referencia anónima con Tremendous. No se envían respuestas ni datos de contacto.",
    prepare: "Preparar enlace de prueba",
    open: "Abrir recompensa de prueba",
    wait: "Todavía no hay una recompensa de prueba disponible. Consulta al equipo sobre la compensación real.",
    warning:
      "Cualquiera que tenga el enlace puede usarlo. Mantenlo privado. Generar otro enlace no anula los anteriores.",
  },
  fr: {
    title: "Récompense de test",
    note: "Pour les études de test uniquement. Cette récompense n’a aucune valeur monétaire. Revenez dans ce navigateur après l’approbation de votre prime par l’équipe.",
    check: "Vérifier la récompense de test",
    consent:
      "Je comprends qu’il s’agit d’une récompense de test. Son ouverture transmet une référence opaque à Tremendous. Aucune réponse ni coordonnée n’est envoyée.",
    prepare: "Préparer le lien de test",
    open: "Ouvrir la récompense de test",
    wait: "Aucune récompense de test n’est disponible pour le moment. Contactez l’équipe pour la rémunération réelle.",
    warning:
      "Toute personne disposant du lien peut l’utiliser. Gardez-le privé. Un nouveau lien n’annule pas les précédents.",
  },
};
export default function ParticipantSandboxReward({
  interviewId,
  token,
  language,
}: {
  interviewId: string;
  token: string;
  language: Language;
}) {
  const t = labels[language],
    [offered, setOffered] = useState(false),
    [available, setAvailable] = useState(false),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [url, setUrl] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    api(`interviews/${interviewId}/sandbox-reward`, "GET", undefined, {
      "x-interview-token": token,
    })
      .then((r) => {
        if (live) setOffered(!!r.offered);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [interviewId, token]);
  async function run(claim: boolean) {
    setBusy(true);
    setMessage("");
    setUrl("");
    try {
      const r = await api(
        `interviews/${interviewId}/sandbox-reward`,
        claim ? "POST" : "GET",
        claim ? { consent } : undefined,
        { "x-interview-token": token },
      );
      if (claim) setUrl(r.url);
      else {
        setAvailable(r.available);
        if (!r.available) setMessage(t.wait);
      }
    } catch (e) {
      setAvailable(false);
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!offered) return null;
  return (
    <div className="visual-stack sandbox-reward" aria-label={t.title}>
      <h2>{t.title}</h2>
      <p>{t.note}</p>
      <button
        className="button"
        disabled={busy}
        onClick={() => void run(false)}
      >
        {t.check}
      </button>
      {available && (
        <>
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked);
                setUrl("");
              }}
            />{" "}
            {t.consent}
          </label>
          <button
            className="button"
            disabled={busy || !consent}
            onClick={() => void run(true)}
          >
            {t.prepare}
          </button>
          <p>{t.warning}</p>
        </>
      )}
      {url && (
        <a
          className="button primary"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        >
          {t.open}
        </a>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
