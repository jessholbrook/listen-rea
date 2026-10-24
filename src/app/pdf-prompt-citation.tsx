"use client";
import type { Interview } from "@/lib/domain";
import { copy } from "@/lib/participant-copy";
import PrivatePDF from "./private-pdf";
export default function PDFPromptCitation({
  interview,
  token,
}: {
  interview: Interview;
  token: string;
}) {
  if (!interview.promptPDFId) return null;
  const source = interview.turns.findLast(
    (t) =>
      t.pdfProbe?.pdfId === interview.promptPDFId &&
      t.pdfProbe?.status === "asked",
  );
  if (
    !interview.promptPDFId ||
    !source?.pdfProbe?.page ||
    !source.participantPDF
  )
    return null;
  const p = source.pdfProbe,
    t = (s: string) => copy(interview.language || "en", s);
  return (
    <section
      className="panel pdf-evidence"
      aria-label={t("PDF question source")}
    >
      <p>
        {t("PDF page")} {p.page}
      </p>
      <blockquote>{p.quote}</blockquote>
      <p className="muted">
        {t("This question uses extracted text, not verified document facts.")}
      </p>
      <PrivatePDF
        assetId={interview.promptPDFId}
        interviewId={interview.id}
        token={token}
        language={interview.language || "en"}
        initialPage={p.page}
      />
    </section>
  );
}
