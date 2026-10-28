"use client";
import type { Interview } from "@/lib/domain";
import { pptxAILabels } from "@/lib/participant-pptx-ai";
import PrivatePPTX from "./private-pptx";
export default function PPTXPromptCitation({
  interview,
  token,
}: {
  interview: Interview;
  token: string;
}) {
  const source = interview.turns.findLast(
      (t) =>
        t.pptxProbe?.pptxId === interview.promptPPTXId &&
        t.pptxProbe?.status === "asked",
    ),
    p = source?.pptxProbe;
  if (
    !interview.promptPPTXId ||
    !source?.participantPPTX ||
    !p?.slide ||
    !p.quote
  )
    return null;
  const l = pptxAILabels[interview.language || "en"];
  return (
    <section className="panel pdf-evidence" aria-label={l.source}>
      <p>
        {l.slide} {p.slide}
      </p>
      <blockquote>{p.quote}</blockquote>
      <p className="muted">{l.prepared}</p>
      <PrivatePPTX
        key={interview.promptPPTXId}
        assetId={interview.promptPPTXId}
        interviewId={interview.id}
        token={token}
        language={interview.language}
        highlight={{ slide: p.slide, quote: p.quote }}
      />
    </section>
  );
}
