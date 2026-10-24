"use client";
import type { Interview } from "@/lib/domain";
import { docxAILabels } from "@/lib/participant-docx-ai";
import PrivateDOCX from "./private-docx";
export default function DOCXPromptCitation({
  interview,
  token,
}: {
  interview: Interview;
  token: string;
}) {
  const source = interview.turns.findLast(
      (t) =>
        t.docxProbe?.docxId === interview.promptDOCXId &&
        t.docxProbe?.status === "asked",
    ),
    p = source?.docxProbe;
  if (
    !interview.promptDOCXId ||
    !source?.participantDOCX ||
    !p?.paragraph ||
    !p.quote
  )
    return null;
  const l = docxAILabels[interview.language || "en"];
  return (
    <section className="panel pdf-evidence" aria-label={l.source}>
      <p>
        {l.paragraph} {p.paragraph}
      </p>
      <blockquote>{p.quote}</blockquote>
      <p className="muted">{l.prepared}</p>
      <PrivateDOCX
        key={interview.promptDOCXId}
        assetId={interview.promptDOCXId}
        interviewId={interview.id}
        token={token}
        language={interview.language}
        highlight={{ paragraph: p.paragraph, quote: p.quote }}
      />
    </section>
  );
}
