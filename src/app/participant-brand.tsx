"use client";
import { useState } from "react";
import type { ParticipantBranding } from "@/lib/branding";
import { Brand } from "./components";
export default function ParticipantBrand({
  branding,
}: {
  branding?: ParticipantBranding;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!branding?.enabled || (!branding.name && !branding.logoDataUrl))
    return <Brand />;
  return (
    <span className="participant-brand">
      {branding.logoDataUrl && failed !== branding.logoDataUrl && (
        <img
          src={branding.logoDataUrl}
          alt={branding.logoAlt}
          onError={() => setFailed(branding.logoDataUrl)}
        />
      )}
      {branding.name && <span>{branding.name}</span>}
      {!branding.name && failed === branding.logoDataUrl && <Brand />}
    </span>
  );
}
