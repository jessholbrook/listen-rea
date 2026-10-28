"use client";
import type { Interview } from "@/lib/domain";
import PrivateConceptImage from "./private-concept-image";
export default function AnswerOptionImage({
  option,
  interview,
  token,
}: {
  option: { text: string; imageAssetId?: string | null; imageAlt?: string };
  interview: Interview;
  token: string;
}) {
  return option.imageAssetId ? (
    <PrivateConceptImage
      assetId={option.imageAssetId}
      interviewId={interview.id}
      token={token}
      alt={option.imageAlt || option.text}
      enlarge
      resource="option-images"
      language={interview.language || "en"}
    />
  ) : null;
}
